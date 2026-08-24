const { app, BrowserWindow, ipcMain, Menu, dialog, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// NanoSDK Runtime is a viewer for .nsa files only -- it has no "blank" or
// "open file" state. If it isn't handed a .nsa path (via file association,
// argv, or macOS's open-file event) it quits instead of showing a window.

let pendingOpenPath = null;
const windows = new Map(); // filePath -> BrowserWindow

function findNsaArg(argv) {
    for (const a of argv) {
        if (typeof a === 'string' && a.toLowerCase().endsWith('.nsa') && fs.existsSync(a)) {
            return path.resolve(a);
        }
    }
    return null;
}

// MARK: Per-app icon
// Every .nsa file bakes its own 8x8 pixel-art icon into the binary (field
// 2, e.g. "0AAAABB0AA1AB1B3..." -- one palette-index hex nibble per
// pixel). MicroOS itself only ever draws this small in its own taskbar;
// on desktop it's the app's real identity, so it becomes the window/Dock/
// taskbar icon instead of floating inside the content area.
const PALETTE_RGB = [
    null, [0xFF, 0xFF, 0xFF], [0x59, 0x00, 0x94], [0x7A, 0x00, 0xB3],
    [0x01, 0x48, 0xEF], [0x00, 0x91, 0xFF], [0x80, 0x3D, 0x00], [0xB6, 0x7C, 0xFE],
    [0x00, 0x80, 0x33], [0xEF, 0x9E, 0xFF], [0xFF, 0x00, 0xAE], [0xFF, 0xAE, 0x00],
    [0x32, 0x00, 0x8F], [0x96, 0x96, 0x96], [0x37, 0x37, 0x37], [0x00, 0x00, 0x00]
];
const DEFAULT_ICON_HEX = '0AAAABB0AA1AB1B3AA11B133AA11B133AB1B1132BB131122BB13312203332220';

function decodeAppIcon(hex) {
    const src = (!hex || hex.toLowerCase() === 'default') ? DEFAULT_ICON_HEX : hex;
    const size = 8;
    const scale = 16; // upscale the 8x8 pixel art for a crisp enough dock/taskbar icon
    const artSize = size * scale;
    // Drawn edge-to-edge, the flat 8x8 art fills the whole tile and reads
    // as oversized next to Dock/taskbar icons that carry their own inset
    // margin -- padding it out onto a larger transparent canvas matches
    // that convention instead of looking zoomed in.
    const padding = Math.round(artSize * 0.18);
    const out = artSize + padding * 2;
    const buf = Buffer.alloc(out * out * 4); // BGRA, per nativeImage.createFromBitmap

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = y * size + x;
            const ch = idx < src.length ? src[idx] : '0';
            const val = parseInt(ch, 16);
            const rgb = isNaN(val) ? null : PALETTE_RGB[val];
            if (!rgb) continue;
            for (let sy = 0; sy < scale; sy++) {
                for (let sx = 0; sx < scale; sx++) {
                    const o = ((padding + y * scale + sy) * out + (padding + x * scale + sx)) * 4;
                    buf[o] = rgb[2]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[0]; buf[o + 3] = 255;
                }
            }
        }
    }
    return nativeImage.createFromBitmap(buf, { width: out, height: out });
}

// macOS fires this when the app is launched by double-clicking a .nsa file,
// or when a file is opened while the app is already running.
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) {
        openNsaWindow(filePath);
    } else {
        pendingOpenPath = filePath;
    }
});

function openNsaWindow(filePath) {
    filePath = path.resolve(filePath);
    if (!fs.existsSync(filePath)) return;

    const existing = windows.get(filePath);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return;
    }

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        dialog.showErrorBox('NanoSDK Runtime', `Couldn't read file:\n${filePath}\n\n${e.message}`);
        return;
    }

    // .nsa layout: Name~IconHex~SubMenu~TitleX~<commands...>
    const fields = content.split('~');
    const appName = fields[0] || path.basename(filePath, path.extname(filePath));
    const icon = decodeAppIcon(fields[1]);

    // Each .nsa double-click launches its own process (no single-instance
    // lock -- see the note near app.whenReady below), so the process-wide
    // app name is effectively per-app: this is what replaces "Electron" in
    // the macOS menu bar / Dock with the running app's own name.
    app.setName(appName);
    if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(icon);
    }

    // 160x97: MicroOS's own fullscreen ListGUI preset (see e.g. Web Chat's
    // reloadListGUI(80, 58, 160, 97, ...) in app_backend.ts) -- also
    // renderer/engine.js's LOGICAL_W x VISIBLE_H, the exact content area
    // this runtime actually draws into. The window is sized to that ratio
    // and locked to it so the canvas never gets stretched off-ratio by an
    // arbitrarily-shaped window (see style.css's matching aspect-ratio).
    const CONTENT_SCALE = 6;
    const win = new BrowserWindow({
        width: 160 * CONTENT_SCALE,
        height: 97 * CONTENT_SCALE,
        minWidth: 160 * 3,
        minHeight: 97 * 3,
        useContentSize: true,
        title: appName,
        icon,
        backgroundColor: '#FFFFFF',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    win.setAspectRatio(160 / 97);

    win.setMenuBarVisibility(false);
    // index.html has a static <title>; don't let it clobber the app name
    // we just set above.
    win.on('page-title-updated', (e) => e.preventDefault());

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('nsa:load', {
            path: filePath,
            name: appName,
            content
        });
    });

    win.on('closed', () => windows.delete(filePath));
    windows.set(filePath, win);

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// LGT's "m" (match OS theme) mode reads this. A sandboxed renderer's own
// window.matchMedia('(prefers-color-scheme: dark)') doesn't reliably track
// macOS's actual appearance here, so the renderer asks the main process's
// nativeTheme instead, which does.
ipcMain.on('nsa:darkMode', (event) => {
    event.returnValue = nativeTheme.shouldUseDarkColors;
});
nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('nsa:darkMode-changed', nativeTheme.shouldUseDarkColors);
    }
});

ipcMain.handle('nsa:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
});

// PRN (game.splash) shows a real OS dialog attached to the app's window,
// not an in-page HTML overlay -- resolves once the player dismisses it,
// which is what pauses nanosdk_runtime.js's line execution until then
// (see game.splash in renderer/app.js).
ipcMain.handle('nsa:splash', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await dialog.showMessageBox(win, {
        type: 'none',
        message: String(message),
        buttons: ['OK'],
        defaultId: 0,
        noLink: true
    });
});

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    const argPath = findNsaArg(process.argv.slice(1));
    const openPath = pendingOpenPath || argPath;

    if (!openPath) {
        // Launched with nothing to run -- this runtime only opens .nsa files.
        app.quit();
        return;
    }

    openNsaWindow(openPath);
});

// Windows/Linux: a second .nsa double-click launches a fresh process with
// its own argv, which is handled the same way as the first launch above --
// no single-instance lock needed since each window is independent.

app.on('window-all-closed', () => {
    app.quit();
});
