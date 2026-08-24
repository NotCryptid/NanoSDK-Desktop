// MARK: NanoSDK Runtime bootstrap
// Wires the ported interpreter (nanosdk_runtime.js) up to a real window:
// builds the chrome MicroOS itself would normally draw (createAppBar,
// close_apps, error/game.splash), and translates mouse input into the
// menu selection model NanoSDK apps expect.

const theme = [7, 9, 2]; // [taskbar primary, taskbar accent, app-bar accent] -- matches MicroOS's default theme
let _booted = false;

// MARK: App bar
// nanosdk_runtime.js still draws MicroOS's own in-app bar (accent strip +
// Close_App + App_Title) into the top 9 units of the 160x120 framebuffer,
// same as on real MicroOS -- but engine.js crops that strip out of what's
// actually shown on screen, since this runtime gives each app a real OS
// window (title + icon + close) instead. No asset needed for Close_App's
// icon since it's never visible.
function createAppBar(fill, accent) {
    fill = fill === undefined ? 0 : fill;
    accent = accent === undefined ? 2 : accent;
    let fill2 = fill;
    if (fill === 0) {
        // "Auto" fill: follow the app's resolved LGT theme (nanoSDK_theme,
        // which may force dark/light independent of the OS), not just the
        // raw OS darkMode -- otherwise the app-bar background never
        // repaints when an app sets LGT d/m and stays stuck white.
        fill2 = nanoSDK_is_dark(nanoSDK_theme) ? 15 : 1;
    }
    if (accent === 2) {
        accent = theme[2];
    }
    let bg = image.create(160, 120);
    bg.fill(fill2);
    bg.fillRect(0, 0, 160, 9, accent);
    scene.setBackgroundImage(bg);
}

// MARK: Close / exit handling
let _splashActive = false;
let _closeAfterSplash = false;

function close_apps() {
    List_Scroll = 0;
    App_Open = 'null';
    SubMenu = 'null';
    NanoSDK_App_Running = false;
    nanoSDK_hover_highlight = false;
    if (!isDestroyed(NanoSDK_Taskbar_Icon)) NanoSDK_Taskbar_Icon.destroy();
    sprites.destroyAllSpritesOfKind(SpriteKind.Text);
    sprites.destroyAllSpritesOfKind(SpriteKind.App_UI);
    sprites.destroyAllSpritesOfKind(SpriteKind.SimpleMenu);
    scene.setBackgroundImage(null);

    if (_booted) {
        // This runtime hosts exactly one app; once it closes itself there's
        // nothing left to show, so the window goes with it. Deferred so a
        // game.splash() call immediately following close_apps() (as in the
        // "106" command) gets a chance to open first and keep the window
        // open until the player dismisses it.
        setTimeout(() => {
            if (_splashActive) {
                _closeAfterSplash = true;
            } else {
                window.nsa.close();
            }
        }, 0);
    }
}
let List_Scroll = 0;

// MARK: Errors
function error(code) {
    close_apps();
    game.splash('Error ' + code);
}
function softerror(code) {
    game.splash('Error ' + code);
}

// MARK: game.splash / game.reset
// PRN shows a real native OS dialog (via main.js's dialog.showMessageBox),
// not an HTML overlay drawn inside the page. The renderer just awaits it:
// _splashActive gates the tick loop below so nanosdk_runtime.js's line
// execution actually pauses while the dialog is up, same as the blocking
// game.splash() it was ported from.
const game = {
    async splash(msg) {
        _splashActive = true;
        await window.nsa.splash(msg);
        _splashActive = false;
        if (_closeAfterSplash) { window.nsa.close(); }
    },
    reset() {
        window.nsa.close();
    }
};

// MARK: Input -- mouse hover/click over the running app's ListGUI
// MicroOS's own UI (see the Settings screenshot) keeps two things separate:
// moving the cursor over an option highlights it, but only actually
// *picking* it fires an action -- see MouseClick/listSelection in the
// original input.ts, which only ever act on a real click, never on mere
// hover. nanosdk_runtime.js's WHN sel checks read ListMenuGUI.selectedIndex
// directly with no such distinction, so app.js keeps selectedIndex
// click-only (an edge-triggered pulse, so a WHN sel block fires once per
// click, not once per frame) and drives the purely-visual hoverIndex
// (see simpleMenu.js) from mouse position instead.
let _selectClearTimer = null;
let _lastMouseLogicalPt = null;

function canvasToLogical(evt) {
    // The visible canvas only shows the framebuffer's bottom VISIBLE_H
    // units (the top 9 -- MicroOS's own app bar -- are cropped out), so a
    // click at visible-canvas row 0 is framebuffer row VISIBLE_Y_OFFSET.
    const rect = screenCanvas.getBoundingClientRect();
    const scaleX = rect.width / LOGICAL_W;
    const scaleY = rect.height / VISIBLE_H;
    return {
        x: (evt.clientX - rect.left) / scaleX,
        y: (evt.clientY - rect.top) / scaleY + VISIBLE_Y_OFFSET
    };
}

// Matches engine.js's renderFrame draw-position math exactly (Math.floor,
// not a plain center calc) so hit-testing agrees with what's on screen.
function spriteDrawOrigin(sprite) {
    return {
        left: Math.floor(sprite.x - sprite.width / 2),
        top: Math.floor(sprite.y - sprite.height / 2)
    };
}

function menuRowAt(pt) {
    if (!ListMenuGUI || isDestroyed(ListMenuGUI)) return -1;
    const { left, top } = spriteDrawOrigin(ListMenuGUI);
    return ListMenuGUI.rowAt(pt.x - left, pt.y - top);
}

function scrollbarThumbRectAt() {
    if (!ListMenuGUI || isDestroyed(ListMenuGUI) || !ListMenuGUI.scrollbarEnabled) return null;
    const { left, top } = spriteDrawOrigin(ListMenuGUI);
    return ListMenuGUI.scrollbarThumbRect(left, top);
}

function pointInRect(pt, rect) {
    return rect && pt.x >= rect.x && pt.x < rect.x + rect.w && pt.y >= rect.y && pt.y < rect.y + rect.h;
}

// Re-applied every frame (not just on mousemove) since a WHN sel action can
// rebuild ListMenuGUI entirely (Reload_ListGUI), which would otherwise
// leave the new instance's hoverIndex at -1 until the mouse next moves.
function syncHover() {
    if (!ListMenuGUI) return;
    const row = (nanoSDK_hover_highlight && _lastMouseLogicalPt) ? menuRowAt(_lastMouseLogicalPt) : -1;
    ListMenuGUI.hoverIndex = row;
}

screenCanvas.addEventListener('mousemove', (evt) => {
    _lastMouseLogicalPt = canvasToLogical(evt);
    if (_scrollDragging) return; // cursor/hover stay put mid-drag; the window listener below drives the scroll
    const row = menuRowAt(_lastMouseLogicalPt);
    const overThumb = pointInRect(_lastMouseLogicalPt, scrollbarThumbRectAt());
    screenCanvas.style.cursor = row >= 0 || overThumb ? 'pointer' : 'default';
    syncHover();
});

// LSB's scrollbar: drag the thumb to scroll, mirroring MicroOS's own
// beginScrollBarDrag/updateScrollBarDrag/endScrollBarDrag (see input.ts) --
// the drag delta is scaled by maxRowOffset/travelDistance so a full drag
// from one end of the thumb's travel to the other covers the whole list.
let _scrollDragging = false;
let _scrollDragStartY = 0;
let _scrollDragStartOffset = 0;
let _justDraggedScrollbar = false;

screenCanvas.addEventListener('mousedown', (evt) => {
    const pt = canvasToLogical(evt);
    const rect = scrollbarThumbRectAt();
    if (!pointInRect(pt, rect)) return;
    evt.preventDefault();
    _scrollDragging = true;
    _scrollDragStartY = pt.y;
    _scrollDragStartOffset = ListMenuGUI.rowOffset;
});

window.addEventListener('mousemove', (evt) => {
    if (!_scrollDragging) return;
    if (!ListMenuGUI || isDestroyed(ListMenuGUI)) { _scrollDragging = false; return; }
    const pt = canvasToLogical(evt);
    const travel = ListMenuGUI.scrollbarTravelDistance();
    const maxOffset = ListMenuGUI.maxRowOffset();
    if (travel > 0 && maxOffset > 0) {
        const deltaRows = (pt.y - _scrollDragStartY) * maxOffset / travel;
        ListMenuGUI.setRowOffset(_scrollDragStartOffset + deltaRows);
        List_Scroll = ListMenuGUI.rowOffset;
    }
    syncHover();
});

window.addEventListener('mouseup', () => {
    if (!_scrollDragging) return;
    _scrollDragging = false;
    _justDraggedScrollbar = true;
});

// LSB's scrollbar: mouse wheel over the list scrolls it by row, clamped
// inside SimpleMenu.scrollBy. List_Scroll just tracks the running total for
// parity with nanosdk_runtime.js's reset-on-close (see close_apps).
screenCanvas.addEventListener('wheel', (evt) => {
    if (!ListMenuGUI || isDestroyed(ListMenuGUI) || !ListMenuGUI.scrollbarEnabled) return;
    evt.preventDefault();
    const rows = Math.sign(evt.deltaY) * Math.max(1, Math.round(Math.abs(evt.deltaY) / _MENU_ROW_HEIGHT));
    ListMenuGUI.scrollBy(rows);
    List_Scroll = ListMenuGUI.rowOffset;
    syncHover();
}, { passive: false });

screenCanvas.addEventListener('click', (evt) => {
    if (_justDraggedScrollbar) { _justDraggedScrollbar = false; return; }
    const pt = canvasToLogical(evt);
    const row = menuRowAt(pt);
    if (row < 0 || !ListMenuGUI) return;
    ListMenuGUI.selectedIndex = row;
    clearTimeout(_selectClearTimer);
    _selectClearTimer = setTimeout(() => {
        if (ListMenuGUI && !isDestroyed(ListMenuGUI) && ListMenuGUI.selectedIndex === row) {
            ListMenuGUI.selectedIndex = -1;
        }
    }, 120);
});

// Edge-trigger WHN sel checks so a click's momentary selection pulse fires
// its body exactly once, instead of once per rendered frame it stays set.
const _rawCheckWhen = nanoSDK_check_when;
let _selEdgeSeen = {};
nanoSDK_check_when = function (idx) {
    const cond = when_cond_data[idx];
    if (cond && cond[0] === 'sel') {
        const raw = _rawCheckWhen(idx);
        const prev = !!_selEdgeSeen[idx];
        _selEdgeSeen[idx] = raw;
        return raw && !prev;
    }
    return _rawCheckWhen(idx);
};

// nanosdk_runtime.js's own nanoSDK_apply_theme only ever picks between
// black/white (see its dark ? ... : ... pairs), but MicroOS's actual UI
// (see the Settings screenshot) highlights the selected row with a solid
// purple fill and white text in light mode -- the same selectedBackground/
// Foreground app_backend.ts's own reloadListGUI uses for its light-mode
// lists. In dark mode the real OS just inverts (white fill, black text),
// same as its unselected-row colors. Applying that here, right after
// nanoSDK_apply_theme runs, matches the real OS's look without having to
// touch nanosdk_runtime.js's ported logic.
const _rawApplyTheme = nanoSDK_apply_theme;
nanoSDK_apply_theme = function (mode) {
    _rawApplyTheme(mode);
    if (ListMenuGUI) {
        const dark = nanoSDK_is_dark(mode);
        ListMenuGUI.selectedBackground = dark ? 1 : 3; // white in dark mode, #7A00B3 in light mode
        ListMenuGUI.selectedForeground = dark ? 15 : 1; // black in dark mode, white in light mode
    }
    // createAppBar() only ever runs once, at app open (see Open_NanoSDK_App),
    // so without this its background stays whatever it was drawn as at boot
    // even after an in-script LGT command changes the theme. Redraw it with
    // its default "auto" fill so it repaints to match.
    if (NanoSDK_App_Running) createAppBar();
};

// MARK: Boot
window.nsa.onLoad((file) => {
    Open_NanoSDK_App(file.content);
    _booted = true;

    startEngineLoop(() => {
        syncHover();
        if (_splashActive) return;
        if (NanoSDK_App_Running || when_cond_data.length > 0) {
            executeNanoSDKLine();
        }
    });
});
