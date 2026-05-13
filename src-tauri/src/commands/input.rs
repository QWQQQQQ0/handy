// 来源: lib/services/desktop/desktop_native_service.dart — click/doubleClick/rightClick/typeText/pressKey/scroll/moveMouse

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEINPUT, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

fn send_mouse_input(flags: MOUSE_EVENT_FLAGS, data: u32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let mut inputs = [input];
        SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn send_keyboard_input(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let mut inputs = [input];
        SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[tauri::command]
pub fn desktop_click(x: i32, y: i32) -> Result<(), String> {
    unsafe { SetCursorPos(x, y) }.map_err(|e| format!("SetCursorPos failed: {e:?}"))?;
    std::thread::sleep(std::time::Duration::from_millis(10));
    send_mouse_input(MOUSEEVENTF_LEFTDOWN, 0);
    send_mouse_input(MOUSEEVENTF_LEFTUP, 0);
    Ok(())
}

#[tauri::command]
pub fn desktop_double_click(x: i32, y: i32) -> Result<(), String> {
    desktop_click(x, y)?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    desktop_click(x, y)
}

#[tauri::command]
pub fn desktop_right_click(x: i32, y: i32) -> Result<(), String> {
    unsafe { SetCursorPos(x, y) }.map_err(|e| format!("SetCursorPos failed: {e:?}"))?;
    std::thread::sleep(std::time::Duration::from_millis(10));
    send_mouse_input(MOUSEEVENTF_RIGHTDOWN, 0);
    send_mouse_input(MOUSEEVENTF_RIGHTUP, 0);
    Ok(())
}

#[tauri::command]
pub fn desktop_type_text(text: String) -> Result<(), String> {
    for ch in text.encode_utf16() {
        send_keyboard_input(VIRTUAL_KEY(0), ch, KEYEVENTF_UNICODE);
        send_keyboard_input(VIRTUAL_KEY(0), ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_press_key(key: String) -> Result<(), String> {
    let vk = match key.to_lowercase().as_str() {
        "enter" | "return" => 0x0Du16,
        "escape" | "esc" => 0x1Bu16,
        "tab" => 0x09u16,
        "backspace" => 0x08u16,
        "delete" | "del" => 0x2Eu16,
        "space" => 0x20u16,
        "arrowup" | "up" => 0x26u16,
        "arrowdown" | "down" => 0x28u16,
        "arrowleft" | "left" => 0x25u16,
        "arrowright" | "right" => 0x27u16,
        "home" => 0x24u16,
        "end" => 0x23u16,
        "pageup" => 0x21u16,
        "pagedown" => 0x22u16,
        "f1" => 0x70u16,
        "f2" => 0x71u16,
        "f3" => 0x72u16,
        "f4" => 0x73u16,
        "f5" => 0x74u16,
        "f6" => 0x75u16,
        "f7" => 0x76u16,
        "f8" => 0x77u16,
        "f9" => 0x78u16,
        "f10" => 0x79u16,
        "f11" => 0x7Au16,
        "f12" => 0x7Bu16,
        _ => return Err(format!("Unknown key: {key}")),
    };

    let vk_code = VIRTUAL_KEY(vk);
    send_keyboard_input(vk_code, 0, KEYBD_EVENT_FLAGS(0));
    send_keyboard_input(vk_code, 0, KEYEVENTF_KEYUP);
    Ok(())
}

#[tauri::command]
pub fn desktop_scroll(x: i32, y: i32, delta: i32) -> Result<(), String> {
    unsafe { SetCursorPos(x, y) }.map_err(|e| format!("SetCursorPos failed: {e:?}"))?;
    std::thread::sleep(std::time::Duration::from_millis(10));
    send_mouse_input(MOUSEEVENTF_WHEEL, delta as u32);
    Ok(())
}

#[tauri::command]
pub fn desktop_move_mouse(x: i32, y: i32) -> Result<(), String> {
    unsafe { SetCursorPos(x, y) }.map_err(|e| format!("SetCursorPos failed: {e:?}"))?;
    Ok(())
}
