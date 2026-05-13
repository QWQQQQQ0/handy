// 来源: lib/services/desktop/desktop_native_service.dart — getWindows/focusWindow

use serde::Serialize;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
    SW_RESTORE,
};

#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub hwnd: i64,
    pub title: String,
    pub class_name: String,
    pub is_visible: bool,
    pub process_id: u32,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub width: i32,
    pub height: i32,
}

struct EnumState {
    windows: Vec<WindowInfo>,
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, l_param: LPARAM) -> BOOL {
    let state = &mut *(l_param.0 as *mut EnumState);

    if IsWindowVisible(hwnd).as_bool() == false {
        return BOOL(1);
    }

    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return BOOL(1);
    }

    let mut title_buf = vec![0u16; (title_len + 1) as usize];
    let read = GetWindowTextW(hwnd, &mut title_buf);
    let title = String::from_utf16_lossy(&title_buf[..read as usize]);
    if title.is_empty() {
        return BOOL(1);
    }

    let mut class_buf = vec![0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class_buf);
    let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);

    let mut rect = Default::default();
    let _ = GetWindowRect(hwnd, &mut rect);

    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id));

    state.windows.push(WindowInfo {
        hwnd: hwnd.0 as i64,
        title,
        class_name,
        is_visible: true,
        process_id,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    });

    BOOL(1)
}

#[tauri::command]
pub fn desktop_list_windows() -> Result<Vec<WindowInfo>, String> {
    let mut state = EnumState { windows: Vec::new() };

    let hwnd_ptr: *mut EnumState = &mut state;
    let result = unsafe {
        EnumWindows(
            Some(enum_windows_callback),
            LPARAM(hwnd_ptr as isize),
        )
    };

    if let Err(e) = result {
        return Err(format!("EnumWindows failed: {e:?}"));
    }

    Ok(state.windows)
}

#[tauri::command]
pub fn desktop_focus_window(hwnd: i64) -> Result<bool, String> {
    let hwnd = HWND(hwnd as isize as *mut std::ffi::c_void);

    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let result = SetForegroundWindow(hwnd);
        Ok(result.as_bool())
    }
}
