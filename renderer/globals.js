// MARK: Runtime globals
// Stand-ins for the state MicroOS's boot.ts normally declares for the whole
// desktop shell. This runtime only ever hosts a single app (the .nsa file
// it was opened with), so it's a small subset of the original list --
// just what nanosdk_runtime.js actually touches.

SpriteKind.Desktop_UI = SpriteKind.create();
SpriteKind.App_UI = SpriteKind.create();

let ListMenuGUI = microUtilities.createMenuFromArray([microUtilities.createMenuItem('')]);
let darkMode = false;

let NanoSDK_App_Running = false;
let App_Open = 'null';
let SubMenu = 'null';
let NanoSDK_Taskbar_Icon = null;
let NanoSDK_Taskbar_Name = '';
let App_Title = null;
let Close_App = null;
