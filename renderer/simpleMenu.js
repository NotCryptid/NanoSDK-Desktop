// MARK: SimpleMenu
// Ported from MicroOS's simpleMenu.ts (microUtilities package) -- a single
// column of fixed-height text rows, 12 logical units tall, with two-color
// theming and marquee-scrolling of the selected row's overflow text.
// Logic is unchanged from the original; only the TS types are gone and it
// now runs against engine.js's shims instead of the real pxt-arcade APIs.

SpriteKind.SimpleMenu = SpriteKind.create();

const _MENU_ROW_HEIGHT = 12;
const _MENU_ROW_START_Y = 0;

const microUtilities = {
    createMenuItem(text) {
        return { text };
    },
    createMenuFromArray(items) {
        return new SimpleMenu(items);
    }
};

class SimpleMenu extends ExtendableSprite {
    constructor(items) {
        super(new OSImage(1, 1), SpriteKind.SimpleMenu);
        this.items = items || [];
        this.selectedIndex = -1;
        // Desktop-only: a purely visual "mouse is over this row" index,
        // separate from selectedIndex. MicroOS's real hardware distinguishes
        // moving the cursor over an option (just a highlight) from actually
        // picking it (see MouseClick/listSelection in the original OS) --
        // nanosdk_runtime.js's WHN sel checks only ever look at
        // selectedIndex, so app.js drives hoverIndex from mouse movement
        // and leaves selectedIndex for actual clicks.
        this.hoverIndex = -1;

        this.defaultForeground = 15;
        this.defaultBackground = 0;
        this.selectedForeground = 1;
        this.selectedBackground = 15;

        this.scrollEnabled = true;
        this.scrollDelay = 700;
        this.scrollSpeed = 20;
        this.scrollTrackedIndex = -1;
        this.scrollStartTime = 0;
    }

    setScroll(enabled, delayMs, speedPxPerSec) {
        this.scrollEnabled = enabled;
        if (delayMs !== undefined) this.scrollDelay = delayMs;
        if (speedPxPerSec !== undefined) this.scrollSpeed = speedPxPerSec;
    }

    setColors(defaultForeground, defaultBackground, selectedForeground, selectedBackground) {
        this.defaultForeground = defaultForeground;
        this.defaultBackground = defaultBackground;
        this.selectedForeground = selectedForeground;
        this.selectedBackground = selectedBackground;
    }

    // Returns the 0-based row index under a local (sprite-relative) point,
    // or -1 if the point isn't over any visible row. Used by app.js for
    // mouse hover/click since the real hardware's d-pad navigation isn't
    // meaningful on desktop.
    rowAt(localX, localY) {
        if (localX < 0 || localX >= this.width || localY < 0) return -1;
        const row = Math.floor((localY - _MENU_ROW_START_Y) / _MENU_ROW_HEIGHT);
        const visibleRows = Math.min(this.items.length, Math.max(0, ((this.height - _MENU_ROW_START_Y) / _MENU_ROW_HEIGHT) | 0));
        if (row < 0 || row >= visibleRows) return -1;
        return row;
    }

    draw(drawLeft, drawTop) {
        if (this.selectedIndex !== this.scrollTrackedIndex) {
            this.scrollTrackedIndex = this.selectedIndex;
            this.scrollStartTime = control.millis();
        }

        const visibleRows = Math.min(
            this.items.length,
            Math.max(0, ((this.height - _MENU_ROW_START_Y) / _MENU_ROW_HEIGHT) | 0)
        );

        for (let i = 0; i < visibleRows; i++) {
            const item = this.items[i];
            const rowTop = drawTop + _MENU_ROW_START_Y + i * _MENU_ROW_HEIGHT;
            const selected = i === this.selectedIndex || i === this.hoverIndex;
            const background = selected ? this.selectedBackground : this.defaultBackground;
            const foreground = selected ? this.selectedForeground : this.defaultForeground;

            if (background) {
                screen.fillRect(drawLeft, rowTop, this.width, _MENU_ROW_HEIGHT, background);
            }
            if (!foreground || !item.text) continue;

            const paddedAvailable = this.width - 4;
            const font = image.getFontForText(item.text);
            const textWidth = item.text.length * font.charWidth;

            if (selected && this.scrollEnabled && textWidth > paddedAvailable) {
                const scrollRange = textWidth - paddedAvailable;
                const offset = this.scrollOffset(scrollRange);
                const clip = image.create(this.width, _MENU_ROW_HEIGHT);
                clip.print(item.text, 2 - offset, 2, foreground, font);
                screen.drawTransparentImage(clip, drawLeft, rowTop);
            } else {
                const flushAvailable = this.width - 2;
                const maxChars = Math.max(0, (flushAvailable / font.charWidth) | 0);
                const text = item.text.length > maxChars ? item.text.slice(0, maxChars) : item.text;
                screen.print(text, drawLeft + 2, rowTop + 2, foreground);
            }
        }
    }

    scrollOffset(overflow) {
        const elapsed = control.millis() - this.scrollStartTime;
        const pause = this.scrollDelay;
        const travel = Math.max(1, (overflow * 1000) / this.scrollSpeed);
        const cycle = pause * 2 + travel * 2;
        const t = elapsed % cycle;

        if (t < pause) return 0;
        if (t < pause + travel) return (((t - pause) / travel) * overflow) | 0;
        if (t < pause * 2 + travel) return overflow;
        return (overflow - ((t - pause * 2 - travel) / travel) * overflow) | 0;
    }

    close() {
        this.destroy();
    }
}
