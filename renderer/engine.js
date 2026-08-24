// MARK: NanoSDK Runtime rendering engine
//
// A small shim that reproduces just the slice of the MakeCode Arcade API
// surface that nanosdk_runtime.js / simpleMenu.js need (image, screen,
// sprites, controller, textsprite, game, scene, control), backed by HTML
// canvas instead of a real device framebuffer.
//
// The original device is a 160x120 pixel screen. We keep that as the
// logical coordinate space every command/position in a .nsa file is
// written against, but we render it smoothly at high resolution (real
// antialiased vector shapes + text) instead of blowing up individual
// pixels, per the "should look HQ, not pixelated" design goal. App icons
// (8x8, baked into the .nsa binary) are the one exception -- those stay
// blocky on purpose, since that's their native pixel-art format.

const LOGICAL_W = 160;
const LOGICAL_H = 120;
const BASE_SCALE = 6; // CSS pixels per logical unit at 1x DPI
const RENDER_SCALE = BASE_SCALE * (window.devicePixelRatio || 1);

// NanoColor palette, from MicroOS's pxt.json / _palettes.json.
const PALETTE = [
    null,        // 0 = transparent
    '#FFFFFF',   // 1
    '#590094',   // 2
    '#7A00B3',   // 3
    '#0148EF',   // 4
    '#0091FF',   // 5
    '#803D00',   // 6
    '#B67CFE',   // 7
    '#008033',   // 8
    '#EF9EFF',   // 9
    '#FF00AE',   // 10
    '#FFAE00',   // 11
    '#32008F',   // 12
    '#969696',   // 13
    '#373737',   // 14
    '#000000'    // 15
];

const FONT_STACK = '"SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const FONT_UNITS = 7.5; // logical units tall

function px(v) { return v * RENDER_SCALE; }

// MARK: Image
// Backs every `image.create(...)` call, plus the visible screen itself.
class OSImage {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.canvas = document.createElement('canvas');
        this.canvas.width = Math.max(1, Math.round(px(width)));
        this.canvas.height = Math.max(1, Math.round(px(height)));
        this.ctx = this.canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.textBaseline = 'top';
    }

    fill(color) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (color) {
            this.ctx.fillStyle = PALETTE[color];
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    fillRect(x, y, w, h, color) {
        if (!color) {
            this.ctx.clearRect(px(x), px(y), px(w), px(h));
            return;
        }
        this.ctx.fillStyle = PALETTE[color];
        this.ctx.fillRect(px(x), px(y), px(w), px(h));
    }

    fillRoundedRect(x, y, w, h, r, color) {
        const c = this.ctx;
        c.fillStyle = PALETTE[color];
        c.beginPath();
        c.roundRect(px(x), px(y), px(w), px(h), px(r));
        c.fill();
    }

    drawLine(x0, y0, x1, y1, color) {
        const c = this.ctx;
        c.strokeStyle = PALETTE[color];
        c.lineWidth = Math.max(1, RENDER_SCALE * 0.6);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(px(x0) + 0.5, px(y0) + 0.5);
        c.lineTo(px(x1) + 0.5, px(y1) + 0.5);
        c.stroke();
    }

    // Used for baked-in 8x8 app icons -- deliberately kept blocky (nearest
    // neighbor "pixel" squares), unlike everything else in this engine.
    setPixel(x, y, color) {
        if (!color) {
            this.ctx.clearRect(px(x), px(y), px(1), px(1));
            return;
        }
        this.ctx.fillStyle = PALETTE[color];
        this.ctx.fillRect(px(x), px(y), px(1), px(1));
    }

    print(text, x, y, color, font) {
        if (!color || !text) return;
        const c = this.ctx;
        c.fillStyle = PALETTE[color];
        c.font = `600 ${px(FONT_UNITS)}px ${FONT_STACK}`;
        c.textBaseline = 'top';
        c.fillText(text, px(x), px(y));
    }
}

// The full 160x120 framebuffer everything actually draws into -- kept
// off-DOM so every command coordinate in a .nsa file (all written against
// the original 160x120 device screen) stays correct unmodified.
const screenImage = new OSImage(LOGICAL_W, LOGICAL_H);

// The top 9 units of that framebuffer are MicroOS's own in-app title bar
// (createAppBar's accent strip + Close_App + App_Title). This runtime
// gives every app a real native OS window instead, so that strip is
// cropped out of what's actually shown -- the visible canvas presents
// only the content below it, letting the OS's own title bar take over
// identity/close (see main.js's setTitle/setIcon).
const VISIBLE_Y_OFFSET = 9;
// The bottom 14 units of the framebuffer are MicroOS's own system taskbar
// band (its default ListGUI height of 97 leaves exactly this much room:
// 120 - 9 - 97 = 14). This runtime has no taskbar to draw there either, so
// that band is cropped off the bottom of the window the same way the app
// bar strip is cropped off the top, instead of showing as dead space.
const TASKBAR_H = 14;
const VISIBLE_H = LOGICAL_H - VISIBLE_Y_OFFSET - TASKBAR_H;

const screenCanvas = document.getElementById('screen');
const presentCtx = screenCanvas.getContext('2d');
screenCanvas.width = Math.round(px(LOGICAL_W));
screenCanvas.height = Math.round(px(VISIBLE_H));
presentCtx.imageSmoothingEnabled = true;

function presentFrame() {
    presentCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    presentCtx.drawImage(
        screenImage.canvas,
        0, Math.round(px(VISIBLE_Y_OFFSET)), screenImage.canvas.width, Math.round(px(VISIBLE_H)),
        0, 0, screenCanvas.width, screenCanvas.height
    );
}

const image = {
    create(w, h) { return new OSImage(w, h); },
    getFontForText(text) {
        return { charWidth: FONT_UNITS * 0.62 };
    }
};

const screen = {
    fillRect: (x, y, w, h, color) => screenImage.fillRect(x, y, w, h, color),
    fillRoundedRect: (x, y, w, h, r, color) => screenImage.fillRoundedRect(x, y, w, h, r, color),
    print: (text, x, y, color, font) => screenImage.print(text, x, y, color, font),
    drawTransparentImage(img, x, y) {
        if (!img) return;
        screenImage.ctx.drawImage(img.canvas, Math.round(px(x)), Math.round(px(y)));
    }
};

const scene = {
    _background: null,
    setBackgroundImage(img) { scene._background = img; }
};

const control = {
    _start: performance.now(),
    millis() { return performance.now() - control._start; }
};

// MARK: Sprites
const SpriteKind = {
    _next: 0,
    create() { return SpriteKind._next++; }
};

const FLAG_DESTROYED = 1;
let _allSprites = [];

class Sprite {
    constructor(img, kind) {
        this.image = img || null;
        this.kind = kind;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.flags = 0;
        _allSprites.push(this);
    }
    get width() { return this.image ? this.image.width : 0; }
    get height() { return this.image ? this.image.height : 0; }
    setPosition(x, y) { this.x = x; this.y = y; }
    setKind(k) { this.kind = k; }
    setImage(img) { this.image = img; }
    destroy() {
        if (this.flags & FLAG_DESTROYED) return;
        this.flags |= FLAG_DESTROYED;
        const i = _allSprites.indexOf(this);
        if (i >= 0) _allSprites.splice(i, 1);
    }
    draw(left, top) {
        if (this.image) screen.drawTransparentImage(this.image, left, top);
    }
}

class ExtendableSprite extends Sprite {
    constructor(img, kind) {
        super(img, kind);
        this._w = img ? img.width : 1;
        this._h = img ? img.height : 1;
    }
    get width() { return this._w; }
    get height() { return this._h; }
    setDimensions(w, h) { this._w = w; this._h = h; }
}

const sprites = {
    ExtendableSprite,
    create(img, kind) { return new Sprite(img, kind); },
    destroy(s) { if (s) s.destroy(); },
    destroyAllSpritesOfKind(kind) {
        _allSprites.slice().forEach(s => { if (s.kind === kind) s.destroy(); });
    }
};

function isDestroyed(sprite) {
    return !sprite || !!(sprite.flags & FLAG_DESTROYED);
}

// MARK: TextSprite
SpriteKind.Text = SpriteKind.create();

class TextSprite extends Sprite {
    constructor(text, font, color) {
        super(null, SpriteKind.Text);
        this._text = text;
        this._color = color || 1;
        this._rebuild();
    }
    _rebuild() {
        const w = Math.max(1, this._text.length * FONT_UNITS * 0.62 + 2);
        const h = FONT_UNITS + 2;
        const img = new OSImage(w, h);
        img.print(this._text, 0, 0, this._color, 0);
        this.image = img;
        this._w = w; this._h = h;
    }
    get width() { return this._w; }
    get height() { return this._h; }
    setText(text) { this._text = text; this._rebuild(); }
    setColor(color) { this._color = color; this._rebuild(); }
}

const textsprite = {
    create(text, font, color) { return new TextSprite(text, font, color); }
};

// MARK: Controller
function makeButton() {
    let held = false;
    const listeners = [];
    return {
        isPressed: () => held,
        onEvent(evt, cb) { listeners.push(cb); },
        _set(v) {
            if (v && !held) listeners.forEach(cb => cb());
            held = v;
        }
    };
}

const controller = {
    A: makeButton(),
    B: makeButton(),
    up: makeButton(),
    down: makeButton(),
    left: makeButton(),
    right: makeButton()
};

const KEY_MAP = {
    ArrowUp: controller.up, KeyW: controller.up,
    ArrowDown: controller.down, KeyS: controller.down,
    ArrowLeft: controller.left, KeyA: controller.left,
    ArrowRight: controller.right, KeyD: controller.right,
    KeyZ: controller.A, Space: controller.A, Enter: controller.A,
    KeyX: controller.B, Backspace: controller.B, Escape: controller.B
};

window.addEventListener('keydown', (e) => {
    const btn = KEY_MAP[e.code];
    if (btn) { btn._set(true); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
    const btn = KEY_MAP[e.code];
    if (btn) btn._set(false);
});

// MARK: Assets
// Only the assets the standalone app runtime itself needs to draw its own
// chrome (nothing app-authored ever references these).
const ASSET_IMAGES = {};
const assets = {
    image(strings) { return ASSET_IMAGES[strings[0].trim()] || new OSImage(1, 1); }
};

// MARK: Frame loop
function renderFrame() {
    screenImage.ctx.clearRect(0, 0, screenImage.canvas.width, screenImage.canvas.height);
    if (scene._background) {
        screen.drawTransparentImage(scene._background, 0, 0);
    }
    const ordered = _allSprites.slice().sort((a, b) => a.z - b.z);
    for (const s of ordered) {
        // Desktop_UI is MicroOS's bottom system taskbar's icon slot (see
        // NanoSDK_Taskbar_Icon in nanosdk_runtime.js). There's no desktop
        // shell here for it to live in -- the app's own icon is shown by
        // the real OS window/Dock instead (see main.js) -- so it's skipped.
        if (s.kind === SpriteKind.Desktop_UI) continue;
        // Floored (not rounded) to the nearest logical pixel: the original
        // hardware only ever had integer framebuffer coordinates, so a
        // sprite centered on a half-unit position (e.g. y=58 with an odd
        // height, giving top=9.5) never left a visible sub-pixel gap there
        // the way this engine's real-number vector rendering otherwise
        // would. Math.round would push 9.5 up to 10, opening a 1-unit gap
        // against the visible area's top edge at y=9 instead of closing it.
        const left = Math.floor(s.x - s.width / 2);
        const top = Math.floor(s.y - s.height / 2);
        s.draw(left, top);
    }
    presentFrame();
}

function startEngineLoop(tick, afterRender) {
    function frame() {
        if (tick) tick();
        renderFrame();
        if (afterRender) afterRender();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
