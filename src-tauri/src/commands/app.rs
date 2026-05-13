// App commands — list apps from cached index, launch apps with existing-instance check.

use crate::commands::app_index;
use windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// Check if an app with the given executable is already running.
/// If so, bring its window to the foreground and return true.
fn bring_to_front_if_running(exe_path: &str) -> bool {
    let exe_name = std::path::Path::new(exe_path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if exe_name.is_empty() {
        return false;
    }

    // Step 1: Find all PIDs with matching executable name via ToolHelp snapshot
    let mut pids: Vec<u32> = Vec::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return false,
        };

        let mut pe = PROCESSENTRY32W::default();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut pe).is_ok() {
            loop {
                let end = pe.szExeFile.iter().position(|&c| c == 0).unwrap_or(pe.szExeFile.len());
                let name = String::from_utf16_lossy(&pe.szExeFile[..end]).to_lowercase();
                if name == exe_name {
                    pids.push(pe.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut pe).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }

    if pids.is_empty() {
        return false;
    }

    // Step 2: Find the first visible window with a title that belongs to one of these PIDs
    struct FindState {
        pids: Vec<u32>,
        found_hwnd: Option<HWND>,
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut FindState);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        if GetWindowTextLengthW(hwnd) == 0 {
            return BOOL(1);
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if state.pids.contains(&pid) {
            state.found_hwnd = Some(hwnd);
            return BOOL(0); // stop enumeration
        }
        BOOL(1)
    }

    let mut state = FindState { pids, found_hwnd: None };
    unsafe {
        let _ = EnumWindows(Some(enum_callback), LPARAM(&mut state as *mut _ as isize));
    }

    if let Some(hwnd) = state.found_hwnd {
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        return true;
    }

    false
}

#[tauri::command]
pub fn desktop_list_apps() -> Result<Vec<app_index::AppInfo>, String> {
    app_index::get_apps_from_disk()
}

#[tauri::command]
pub fn desktop_open_app(name: String) -> Result<bool, String> {
    if let Some(exe_path) = app_index::find_app(&name) {
        // Check if already running — bring to front if so
        if bring_to_front_if_running(&exe_path) {
            return Ok(true);
        }
        // Launch new instance
        match std::process::Command::new(&exe_path).spawn() {
            Ok(_child) => return Ok(true),
            Err(e) => {
                log::warn!("Failed to launch '{}' via '{}': {e}, falling back to cmd start", name, exe_path);
            }
        }
    }

    // Fallback: use cmd /c start for Store apps and unknown names
    match std::process::Command::new("cmd")
        .args(["/c", "start", "", &name])
        .spawn()
    {
        Ok(_child) => Ok(true),
        Err(e) => Err(format!("Failed to launch '{}': {}", name, e)),
    }
}

#[tauri::command]
pub fn desktop_refresh_apps() -> Result<usize, String> {
    Ok(app_index::build_and_persist())
}
