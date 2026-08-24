// MARK: NanoSDK Runtime interpreter
// Ported from MicroOS's src/nanosdk_runtime.ts. The command interpreter
// logic (nanoSDK_run_line / executeNanoSDKLine and everything it calls) is
// unchanged from the original -- only TypeScript type annotations were
// stripped and the pxt-arcade calls now hit engine.js's shims plus the
// close_apps/createAppBar/error/game helpers defined in app.js.

// MARK: ListGUI Reload Function
function Reload_ListGUI(data, x, y, width, height, destroy) {
    if (destroy) {
        ListMenuGUI.destroy();
    }
    ListMenuGUI = microUtilities.createMenuFromArray(data);
    ListMenuGUI.setDimensions(width, height);
    ListMenuGUI.setPosition(x, y);
    ListMenuGUI.z = -30;
    nanoSDK_apply_theme(nanoSDK_theme);
    nanoSDK_apply_scrollbar(nanoSDK_scrollbar);
}

// MARK: ListGUI Theme
// mode is LGT's raw value: 'd' forces dark, 'l' forces light, 'm' matches
// the real OS's current appearance (darkMode, from globals.js).
function nanoSDK_is_dark(mode) {
    return mode == 'd' || (mode == 'm' && darkMode);
}

function nanoSDK_apply_theme(mode) {
    let dark = nanoSDK_is_dark(mode);
    ListMenuGUI.setColors(dark ? 1 : 15, dark ? 15 : 1, dark ? 15 : 1, dark ? 1 : 15);
    // Keep the letterboxed page background (outside the 160x120 framebuffer)
    // in step with the resolved theme, instead of always being white -- it's
    // otherwise visibly mismatched against a dark-themed ListGUI.
    document.body.classList.toggle('light-mode', !dark);
}

// MARK: ListGUI Scroll Bar
function nanoSDK_apply_scrollbar(enabled) {
    ListMenuGUI.scrollbarEnabled = enabled;
}

// MARK: Variable Definitions

let binary = [];
let command_data = [];
let current_command = '';
let command_category = '';
let line = 5;
let variables = {};
let condition_met = ['null'];
let loop_repeats_left = [];
let loop_line = [];
let loop_condition = [];
let menu_array = [];
// MicroOS's own default: 97 units tall, leaving the bottom 14 units for
// its system taskbar to sit on top of. This desktop port doesn't render
// that taskbar, so instead of stretching the list into that space,
// engine.js crops the reserved band off the window entirely (see
// VISIBLE_H) -- same treatment as the top 9-unit app bar strip.
let menu_data = [80, 58, 160, 97];
let nanoSDK_hover_highlight = true; // LGH's default is "auto" (see compiler.ts's LGH case) until an app says otherwise
let nanoSDK_theme = 'm';
let nanoSDK_scrollbar = false;

// WHN (When) registry
let when_registry = [];
let when_cond_data = [];
let when_ranges = [];

// MARK: DAI Icon Decoding
const NANO_SDK_DEFAULT_ICON = '0AAAABB0AA1AB1B3AA11B133AA11B133AB1B1132BB131122BB13312203332220';

function nanoSDK_decode_icon(hex, size) {
    size = size || 8;
    let source = (hex == null || hex == '' || hex.toLowerCase() == 'default') ? NANO_SDK_DEFAULT_ICON : hex;
    let img = image.create(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let idx = y * size + x;
            let ch = idx < source.length ? source.charAt(idx) : '0';
            let val = parseInt(ch, 16);
            img.setPixel(x, y, isNaN(val) ? 0 : val);
        }
    }
    return img;
}

// MARK: Start Runtime
function Open_NanoSDK_App(app_binary) {
    binary = app_binary.split('~');
    close_apps();
    NanoSDK_App_Running = true;
    App_Open = binary[0];
    SubMenu = binary[2];
    if (!isDestroyed(NanoSDK_Taskbar_Icon)) {
        NanoSDK_Taskbar_Icon.destroy();
    }
    NanoSDK_Taskbar_Icon = sprites.create(nanoSDK_decode_icon(binary[1]), SpriteKind.Desktop_UI);
    NanoSDK_Taskbar_Icon.setPosition(92, 111);
    NanoSDK_Taskbar_Name = binary[0];
    createAppBar();
    Close_App = sprites.create(assets.image`Close`, SpriteKind.App_UI);
    Close_App.setPosition(156, 5);
    App_Title = textsprite.create(binary[0], 0, 1);
    App_Title.setPosition(parseInt(binary[3]), 4);

    command_data = [];
    current_command = '';
    command_category = '';
    line = 5;
    variables = {};
    condition_met = ['null'];
    loop_repeats_left = [];
    loop_line = [];
    loop_condition = [];
    menu_array = [];
    menu_data = [80, 58, 160, 97];
    nanoSDK_hover_highlight = true; // LGH's default is "auto"
    nanoSDK_theme = 'm';
    nanoSDK_scrollbar = false;
    when_cond_data = [];
    when_ranges = [];
}

// MARK: Variable String/Value Resolution
function nanoSDK_resolve_vars(str) {
    if (str == null || str.indexOf('!') == -1) { return str; }

    if (str.charAt(0) == '!') {
        let rest = str.substr(1);
        let bang = rest.indexOf('!');
        if (bang == -1 || bang == rest.length - 1) {
            let name = bang == -1 ? rest : rest.substr(0, bang);
            return variables[name] != null ? variables[name] : str;
        }
    }

    let result = '';
    let i = 0;
    while (i < str.length) {
        if (str.charAt(i) == '!') {
            let end = str.indexOf('!', i + 1);
            if (end > i) {
                let name = str.substr(i + 1, end - (i + 1));
                result += variables[name] != null ? variables[name] : str.substr(i, end + 1 - i);
                i = end + 1;
                continue;
            }
        }
        result += str.charAt(i);
        i++;
    }
    return result;
}

// MARK: When Condition Check
function nanoSDK_check_when(idx) {
    let cond = when_cond_data[idx];
    let ctype = cond[0];

    switch (ctype) {
        // MARK: When Button
        case 'b': {
            let down = false;
            let btn = cond[1];
            switch (btn) {
                case 'a': down = controller.A.isPressed(); break;
                case 'b': down = controller.B.isPressed(); break;
                case 'u': down = controller.up.isPressed(); break;
                case 'd': down = controller.down.isPressed(); break;
                case 'l': down = controller.left.isPressed(); break;
                case 'r': down = controller.right.isPressed(); break;
            }
            return cond[2] == 't' ? down : !down;
        }

        // MARK: When Variable
        case 'v': {
            let val = variables[cond[1]] != null ? variables[cond[1]] : cond[1];
            let target = nanoSDK_resolve_vars(cond[3]);
            let op = cond[2];
            switch (op) {
                case '=': return val == target;
                case '>': return parseFloat(val) > parseFloat(target);
                case '<': return parseFloat(val) < parseFloat(target);
                case '≥': return parseFloat(val) >= parseFloat(target);
                case '≤': return parseFloat(val) <= parseFloat(target);
            }
            break;
        }

        // MARK: When ListGUI Select
        case 'sel': {
            let targetIdx = parseInt(cond[1]) - 1;
            return ListMenuGUI.selectedIndex == targetIdx;
        }
    }

    return false;
}

// MARK: When Body Execution
let when_exec_idx = -1;
let when_exec_line = 0;

// MARK: Runtime
function executeNanoSDKLine() {
    // MARK: When Body Execution Step
    if (when_exec_idx >= 0) {
        let range = when_ranges[when_exec_idx];
        if (when_exec_line > range[1]) {
            when_exec_idx = -1;
            return;
        }
        let saved_line = line;
        line = when_exec_line;
        nanoSDK_run_line();
        when_exec_line = line;
        line = saved_line;
        return;
    }

    // MARK: When Check
    if (line > binary.length) {
        if (when_cond_data.length == 0) {
            NanoSDK_App_Running = false;
        }
        for (let wi = 0; wi < when_cond_data.length; wi++) {
            if (nanoSDK_check_when(wi)) {
                when_exec_idx = wi;
                when_exec_line = when_ranges[wi][0];
                return;
            }
        }
        return;
    }

    // MARK: Main Execution
    nanoSDK_run_line();

    if (NanoSDK_App_Running && when_cond_data.length > 0) {
        for (let wi = 0; wi < when_cond_data.length; wi++) {
            if (nanoSDK_check_when(wi)) {
                when_exec_idx = wi;
                when_exec_line = when_ranges[wi][0];
                return;
            }
        }
    }
}

function nanoSDK_run_line() {
    if (line > binary.length) { return; }

    command_data = binary[line - 1].split('§');
    let raw_cmd = command_data[0];
    command_category = raw_cmd.charAt(0);
    current_command = raw_cmd.charAt(1) + raw_cmd.charAt(2);
    line++;

    // MARK: IFB End early pop (before condition check so nested brackets close correctly)
    if (command_category == '2' && command_data[1] == 'e') {
        condition_met.pop();
        return;
    }

    // MARK: Condition Gate
    if (condition_met[condition_met.length - 1] == 'false') {
        if (command_category == '2' && current_command == '01' && command_data[1] != 'e' && command_data[1] != 'l') {
            condition_met.push('skip');
        }
        if (command_category == '2' && command_data[1] == 'l') {
            if (condition_met[condition_met.length - 1] == 'true') {
                condition_met[condition_met.length - 1] = 'false';
            } else if (condition_met[condition_met.length - 1] == 'false') {
                condition_met[condition_met.length - 1] = 'true';
            }
        }
        return;
    }
    if (condition_met[condition_met.length - 1] == 'skip') { return; }

    switch (command_category) {

        // MARK: Basic Commands
        case '1':
            switch (current_command) {
                case '05':
                    NanoSDK_App_Running = false;
                    game.splash(nanoSDK_resolve_vars(command_data[1]));
                    NanoSDK_App_Running = true;
                    break;
                case '06':
                    close_apps();
                    if (command_data[1] && command_data[1] != '') {
                        game.splash(nanoSDK_resolve_vars(command_data[1]));
                    }
                    break;
                case '07':
                    SubMenu = command_data[1];
                    break;
                default:
                    error(301);
            }
            break;

        // MARK: Logic
        case '2':
            if (current_command == '01') {
                // MARK: IFB
                condition_met.push('false');
                let action = command_data[1];

                switch (action) {
                    case 'l': {
                        condition_met.pop();
                        let top = condition_met[condition_met.length - 1];
                        condition_met[condition_met.length - 1] = top == 'true' ? 'false' : 'true';
                        break;
                    }
                    case 'v': {
                        let lhs = variables[command_data[2]] != null ? variables[command_data[2]] : command_data[2];
                        let rhs = nanoSDK_resolve_vars(command_data[4]);
                        let met = false;
                        switch (command_data[3]) {
                            case '=': met = lhs == rhs; break;
                            case '>': met = parseFloat(lhs) > parseFloat(rhs); break;
                            case '<': met = parseFloat(lhs) < parseFloat(rhs); break;
                            case '≥': met = parseFloat(lhs) >= parseFloat(rhs); break;
                            case '≤': met = parseFloat(lhs) <= parseFloat(rhs); break;
                        }
                        if (met) { condition_met[condition_met.length - 1] = 'true'; }
                        break;
                    }
                    case 'b': {
                        let down = false;
                        switch (command_data[2]) {
                            case 'a': down = controller.A.isPressed(); break;
                            case 'b': down = controller.B.isPressed(); break;
                            case 'u': down = controller.up.isPressed(); break;
                            case 'd': down = controller.down.isPressed(); break;
                            case 'l': down = controller.left.isPressed(); break;
                            case 'r': down = controller.right.isPressed(); break;
                        }
                        let met = command_data[3] == 't' ? down : !down;
                        if (met) { condition_met[condition_met.length - 1] = 'true'; }
                        break;
                    }
                    case 's':
                        break;
                }
            } else if (current_command == '02') {
                // MARK: Loop
                if (command_data[1] == 'e') {
                    let cond = loop_condition[loop_condition.length - 1];
                    if (cond && cond.length > 0) {
                        let met = false;
                        switch (cond[0]) {
                            case 'b': {
                                let down = false;
                                switch (cond[1]) {
                                    case 'a': down = controller.A.isPressed(); break;
                                    case 'b': down = controller.B.isPressed(); break;
                                    case 'u': down = controller.up.isPressed(); break;
                                    case 'd': down = controller.down.isPressed(); break;
                                    case 'l': down = controller.left.isPressed(); break;
                                    case 'r': down = controller.right.isPressed(); break;
                                }
                                met = cond[2] == 't' ? down : !down;
                                break;
                            }
                            case 'v': {
                                let lhs = variables[cond[1]] != null ? variables[cond[1]] : cond[1];
                                let rhs = nanoSDK_resolve_vars(cond[3]);
                                switch (cond[2]) {
                                    case '=': met = lhs == rhs; break;
                                    case '>': met = parseFloat(lhs) > parseFloat(rhs); break;
                                    case '<': met = parseFloat(lhs) < parseFloat(rhs); break;
                                    case '≥': met = parseFloat(lhs) >= parseFloat(rhs); break;
                                    case '≤': met = parseFloat(lhs) <= parseFloat(rhs); break;
                                }
                                break;
                            }
                        }
                        if (met) {
                            line = loop_line[loop_line.length - 1];
                        } else {
                            loop_line.pop();
                            loop_repeats_left.pop();
                            loop_condition.pop();
                        }
                    } else if (loop_repeats_left[loop_repeats_left.length - 1] == 'inf') {
                        line = loop_line[loop_line.length - 1];
                    } else if (loop_repeats_left[loop_repeats_left.length - 1] !== '0') {
                        line = loop_line[loop_line.length - 1];
                        loop_repeats_left[loop_repeats_left.length - 1] = (parseInt(loop_repeats_left[loop_repeats_left.length - 1]) - 1).toString();
                    } else {
                        loop_line.pop();
                        loop_repeats_left.pop();
                        loop_condition.pop();
                    }
                } else if (command_data[1] == 'x') {
                    loop_line.pop();
                    loop_repeats_left.pop();
                    loop_condition.pop();
                    let depth = 1;
                    while (line <= binary.length && depth > 0) {
                        let ld = binary[line - 1].split('§');
                        if (ld[0] == '202' && ld[1] != 'e' && ld[1] != 'x') depth++;
                        if (ld[0] == '202' && ld[1] == 'e') depth--;
                        line++;
                    }
                } else {
                    if (command_data[1] == 'BLW') {
                        loop_repeats_left.push('inf');
                        loop_line.push(line);
                        loop_condition.push(command_data.slice(2));
                    } else {
                        loop_repeats_left.push(command_data[1]);
                        loop_line.push(line);
                        loop_condition.push([]);
                    }
                }
            }
            break;

        // MARK: When
        case '4':
            if (current_command == '01') {
                if (command_data[1] == 'e') {
                    // handled by when-body execution range check
                } else {
                    let bodyStart = line;
                    let depth = 1;
                    let scanLine = line;
                    while (scanLine <= binary.length && depth > 0) {
                        let ld = binary[scanLine - 1].split('§');
                        if (ld[0].charAt(0) == '4' && ld[0].charAt(1) + ld[0].charAt(2) == '01' && ld[1] != 'e') depth++;
                        if (ld[0].charAt(0) == '4' && ld[0].charAt(1) + ld[0].charAt(2) == '01' && ld[1] == 'e') depth--;
                        scanLine++;
                    }
                    let bodyEnd = scanLine - 2;
                    line = scanLine;

                    let cdata = command_data.slice(1);
                    when_cond_data.push(cdata);
                    when_ranges.push([bodyStart, bodyEnd]);
                }
            }
            break;

        // MARK: ListGUI
        case '3':
            switch (current_command) {
                case '01': {
                    let destroy = false;
                    switch (command_data[1]) {
                        case 'f': menu_data = [80, 58, 160, 97]; destroy = true; break;
                        case 's': menu_data = [76, 58, 151, 97]; destroy = true; break;
                    }
                    Reload_ListGUI(menu_array, menu_data[0], menu_data[1], menu_data[2], menu_data[3], destroy);
                    break;
                }
                case '02':
                    menu_data[0] = parseInt(command_data[1]);
                    menu_data[1] = parseInt(command_data[2]);
                    if (ListMenuGUI) { ListMenuGUI.setPosition(menu_data[0], menu_data[1]); }
                    break;
                case '03':
                    menu_data[2] = parseInt(command_data[1]);
                    menu_data[3] = parseInt(command_data[2]);
                    if (ListMenuGUI) { ListMenuGUI.setDimensions(menu_data[2], menu_data[3]); }
                    break;
                case '04':
                    menu_array = [];
                    for (let i = 1; i < command_data.length; i++) {
                        menu_array.push(microUtilities.createMenuItem(nanoSDK_resolve_vars(command_data[i])));
                    }
                    Reload_ListGUI(menu_array, menu_data[0], menu_data[1], menu_data[2], menu_data[3], true);
                    break;
                case '05': {
                    let lgsIndex = parseInt(nanoSDK_resolve_vars(command_data[1]));
                    if (lgsIndex >= 0 && lgsIndex < menu_array.length) {
                        menu_array[lgsIndex] = microUtilities.createMenuItem(nanoSDK_resolve_vars(command_data[2]));
                        Reload_ListGUI(menu_array, menu_data[0], menu_data[1], menu_data[2], menu_data[3], true);
                    }
                    break;
                }
                case '06': {
                    let lgvIndex = parseInt(command_data[1]);
                    if (lgvIndex >= 0 && lgvIndex < menu_array.length) {
                        variables[command_data[2]] = menu_array[lgvIndex].text;
                    }
                    break;
                }
                case '07':
                    menu_array.splice(parseInt(command_data[1]), 1);
                    Reload_ListGUI(menu_array, menu_data[0], menu_data[1], menu_data[2], menu_data[3], true);
                    break;
                case '08':
                    menu_array = [];
                    ListMenuGUI.destroy();
                    break;
                case '09':
                    switch (command_data[1]) {
                        case 'o':
                            nanoSDK_hover_highlight = false;
                            ListMenuGUI.selectedIndex = -1;
                            break;
                        case 'a':
                            nanoSDK_hover_highlight = true;
                            break;
                        default:
                            ListMenuGUI.selectedIndex = parseInt(command_data[1]);
                    }
                    break;
                case '10':
                    nanoSDK_theme = command_data[1];
                    if (ListMenuGUI) { nanoSDK_apply_theme(nanoSDK_theme); }
                    break;
                case '11':
                    nanoSDK_scrollbar = command_data[1] == 't';
                    if (ListMenuGUI) { nanoSDK_apply_scrollbar(nanoSDK_scrollbar); }
                    break;
                default:
                    error(301);
            }
            break;

        // MARK: Variable Commands
        case '5': {
            let variableDataTemp = command_data[2];
            if (current_command == '03') {
                variableDataTemp = command_data[3];
            }
            variableDataTemp = nanoSDK_resolve_vars(variableDataTemp);

            switch (current_command) {
                case '01':
                    variables[command_data[1]] = variableDataTemp;
                    break;
                case '02':
                    variables[command_data[1]] = variableDataTemp;
                    break;
                case '03': {
                    const lhs = parseFloat(variables[command_data[1]]);
                    const rhs = parseFloat(variableDataTemp);
                    let operationOutput = 0;
                    switch (command_data[2]) {
                        case 'a': operationOutput = lhs + rhs; break;
                        case 's': operationOutput = lhs - rhs; break;
                        case 'm': operationOutput = lhs * rhs; break;
                        case 'd': operationOutput = lhs / rhs; break;
                    }
                    variables[command_data[1]] = operationOutput + '';
                    break;
                }
                case '04':
                    variables[command_data[1]] = (variables[command_data[1]] != null ? variables[command_data[1]] : '') + variableDataTemp;
                    break;
            }
            break;
        }
    }
}
