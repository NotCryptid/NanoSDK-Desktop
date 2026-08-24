// MARK: Runtime globals
// Stand-ins for the state MicroOS's boot.ts normally declares for the whole
// desktop shell. This runtime only ever hosts a single app (the .nsa file
// it was opened with), so it's a small subset of the original list --
// just what nanosdk_runtime.js actually touches.

SpriteKind.Desktop_UI = SpriteKind.create();
SpriteKind.App_UI = SpriteKind.create();

let ListMenuGUI = microUtilities.createMenuFromArray([microUtilities.createMenuItem('')]);

// Tracks the real OS color scheme so LGT's "m" (match OS theme) mode has
// something to read -- this used to be hardcoded false and never updated.
// Read from the main process's nativeTheme (see preload.js/main.js) rather
// than this sandboxed renderer's own prefers-color-scheme media query,
// which doesn't reliably track macOS's actual appearance.
let darkMode = window.nsa.isDarkMode();
window.nsa.onDarkModeChange((dark) => { darkMode = dark; });

let NanoSDK_App_Running = false;
let App_Open = 'null';
let SubMenu = 'null';
let NanoSDK_Taskbar_Icon = null;
let NanoSDK_Taskbar_Name = '';
let App_Title = null;
let Close_App = null;
