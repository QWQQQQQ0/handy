// App index — scans system apps at startup, persists to disk.
// Memory: only a tiny name→path map + aliases. Full data on disk.
//
// All scanners use pure Windows native APIs (COM, Registry, std::fs).
// No PowerShell — avoids GBK/UTF-8 encoding corruption on Chinese Windows.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    IPersistFile, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub app_id: String,
    pub source: String,
    pub path: String,
}

#[derive(Debug, Clone)]
struct AppEntry {
    name: String,
    name_lower: String,
    aliases: Vec<String>,
    exe_path: String,
    app_id: String,
    source: String,
}

// ── Tiny in-memory state (just lookups, not full app list) ──

struct AppLookup {
    name_to_path: HashMap<String, String>,            // name_lower → exe_path
    aliases: HashMap<String, String>,                 // alias_lower → name_lower
    cache_json: Vec<u8>,                              // serialized AppInfo JSON (for list_apps)
}

static APP_LOOKUP: Mutex<Option<AppLookup>> = Mutex::new(None);

fn cache_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let dir = PathBuf::from(&appdata).join("openpaw");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("app_cache.json"))
}

// ── Default Chinese aliases ──

fn default_aliases() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("浏览器".into(), "chrome".into());
    m.insert("谷歌浏览器".into(), "chrome".into());
    m.insert("edge浏览器".into(), "msedge".into());
    m.insert("代码编辑器".into(), "visual studio code".into());
    m.insert("聊天".into(), "wechat".into());
    m.insert("微信".into(), "wechat".into());
    m.insert("记事本".into(), "notepad".into());
    m.insert("画图".into(), "mspaint".into());
    m.insert("计算器".into(), "calculator".into());
    m.insert("文件管理器".into(), "explorer".into());
    m.insert("资源管理器".into(), "explorer".into());
    m.insert("任务管理器".into(), "taskmgr".into());
    m.insert("控制面板".into(), "control".into());
    m.insert("设置".into(), "ms-settings:".into());
    m.insert("终端".into(), "cmd".into());
    m.insert("命令行".into(), "cmd".into());
    m.insert("远程桌面".into(), "mstsc".into());
    m.insert("截图工具".into(), "snippingtool".into());
    m.insert("注册表".into(), "regedit".into());
    m.insert("vscode".into(), "visual studio code".into());
    m.insert("vs code".into(), "visual studio code".into());
    m.insert("code".into(), "visual studio code".into());
    m.insert("word".into(), "winword".into());
    m.insert("excel".into(), "excel".into());
    m.insert("ppt".into(), "powerpnt".into());
    m.insert("powerpoint".into(), "powerpnt".into());
    m
}

// ── COM helper — resolve .lnk target path via IShellLinkW ──

fn resolve_shortcut(lnk_path: &std::path::Path) -> String {
    let path_str = lnk_path.to_string_lossy();
    let wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let sl: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) {
            Ok(sl) => sl,
            Err(_) => return String::new(),
        };

        let pf: IPersistFile = match sl.cast() {
            Ok(pf) => pf,
            Err(_) => return String::new(),
        };

        if pf.Load(PCWSTR::from_raw(wide.as_ptr()), STGM_READ).is_err() {
            return String::new();
        }

        if sl.Resolve(HWND::default(), 0u32).is_err() {
            return String::new();
        }

        let mut buf = [0u16; 260];
        if sl.GetPath(&mut buf, std::ptr::null_mut(), 0u32).is_err() {
            return String::new();
        }

        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    }
}

// ── Scanner 1: Start Menu + Desktop .lnk shortcuts ──

fn scan_shortcuts() -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();

    let dirs: Vec<String> = vec![
        std::env::var("APPDATA").map(|p| format!("{}\\Microsoft\\Windows\\Start Menu\\Programs", p)).unwrap_or_default(),
        std::env::var("PROGRAMDATA").map(|p| format!("{}\\Microsoft\\Windows\\Start Menu\\Programs", p)).unwrap_or_default(),
        std::env::var("USERPROFILE").map(|p| format!("{}\\Desktop", p)).unwrap_or_default(),
        r"C:\Users\Public\Desktop".to_string(),
    ];

    for dir in &dirs {
        walk_lnk_dir(dir, &mut apps, &mut seen);
    }

    apps
}

fn walk_lnk_dir(dir: &str, apps: &mut Vec<AppEntry>, seen: &mut HashMap<String, bool>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_lnk_dir(&path.to_string_lossy(), apps, seen);
        } else if path.extension().map_or(false, |e| e.eq_ignore_ascii_case("lnk")) {
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name.is_empty() || seen.contains_key(&name.to_lowercase()) {
                continue;
            }
            seen.insert(name.to_lowercase(), true);
            let target = resolve_shortcut(&path);
            apps.push(AppEntry {
                name: name.clone(),
                name_lower: name.to_lowercase(),
                aliases: vec![],
                exe_path: target,
                app_id: String::new(),
                source: "shortcut".into(),
            });
        }
    }
}

// ── Scanner 2: Registry Uninstall entries (via winreg) ──

fn scan_registry() -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();

    let roots = [
        (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hkey, path) in &roots {
        let key = match RegKey::predef(*hkey).open_subkey_with_flags(path, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };
        for subkey_name in key.enum_keys().flatten() {
            if seen.contains_key(&subkey_name.to_lowercase()) {
                continue;
            }
            let subkey = match key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };
            let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
            if display_name.is_empty() || seen.contains_key(&display_name.to_lowercase()) {
                continue;
            }
            seen.insert(display_name.to_lowercase(), true);
            apps.push(AppEntry {
                name: display_name.clone(),
                name_lower: display_name.to_lowercase(),
                aliases: vec![],
                exe_path: String::new(),
                app_id: String::new(),
                source: "registry".into(),
            });
        }
    }
    apps
}

// ── Scanner 3: Program Files directories (std::fs, no encoding issues) ──

fn scan_program_files() -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();

    for base in &[r"C:\Program Files", r"C:\Program Files (x86)"] {
        let entries = match std::fs::read_dir(base) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name.is_empty() || seen.contains_key(&name.to_lowercase()) {
                continue;
            }
            let exe_path = path.join(format!("{}.exe", name));
            if exe_path.exists() {
                seen.insert(name.to_lowercase(), true);
                apps.push(AppEntry {
                    name: name.clone(),
                    name_lower: name.to_lowercase(),
                    aliases: vec![],
                    exe_path: exe_path.to_string_lossy().to_string(),
                    app_id: String::new(),
                    source: "program_files".into(),
                });
            }
        }
    }
    apps
}

// ── Build + persist to disk ──

fn load_user_aliases() -> HashMap<String, String> {
    if let Some(path) = cache_path() {
        let alias_path = path.parent().unwrap().join("aliases.json");
        if let Ok(content) = std::fs::read_to_string(&alias_path) {
            if let Ok(ua) = serde_json::from_str::<HashMap<String, String>>(&content) {
                return ua;
            }
        }
    }
    HashMap::new()
}

pub fn build_and_persist() -> usize {
    // Initialize COM for IShellLinkW (needed on background threads)
    unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); }

    let shortcuts = scan_shortcuts();
    let pf_apps = scan_program_files();
    let registry_apps = scan_registry();
    log::info!("App index scan: shortcuts={} program_files={} registry={}", shortcuts.len(), pf_apps.len(), registry_apps.len());

    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();

    // Priority: shortcuts (have .exe paths) > pf_apps > registry
    for entry in shortcuts.into_iter().chain(pf_apps).chain(registry_apps) {
        if seen.contains_key(&entry.name_lower) {
            if !entry.exe_path.is_empty() {
                if let Some(existing) = apps.iter_mut().find(|a| a.name_lower == entry.name_lower) {
                    if existing.exe_path.is_empty() { *existing = entry; }
                }
            }
            continue;
        }
        seen.insert(entry.name_lower.clone(), true);
        apps.push(entry);
    }

    // Merge default + user aliases
    let mut alias_map = default_aliases();
    for (k, v) in load_user_aliases() { alias_map.entry(k).or_insert(v); }

    for (alias, target) in &alias_map {
        let tl = target.to_lowercase();
        if let Some(entry) = apps.iter_mut().find(|a| a.name_lower == tl || a.name_lower.contains(&tl) || tl.contains(&a.name_lower)) {
            if !entry.aliases.contains(alias) { entry.aliases.push(alias.clone()); }
        }
    }

    apps.sort_by(|a, b| a.name_lower.cmp(&b.name_lower));

    // Build AppInfo list for disk
    let info_list: Vec<AppInfo> = apps.iter().map(|e| AppInfo {
        name: e.name.clone(), app_id: e.app_id.clone(), source: e.source.clone(), path: e.exe_path.clone(),
    }).collect();

    // Persist full data to disk
    if let Some(path) = cache_path() {
        if let Ok(json) = serde_json::to_vec(&info_list) {
            let _ = std::fs::write(&path, &json);
        }
    }

    // Build tiny in-memory lookup
    let mut name_to_path: HashMap<String, String> = HashMap::new();
    let mut flat_aliases: HashMap<String, String> = HashMap::new();
    for entry in &apps {
        if !entry.exe_path.is_empty() {
            name_to_path.insert(entry.name_lower.clone(), entry.exe_path.clone());
        }
        for alias in &entry.aliases {
            flat_aliases.insert(alias.to_lowercase(), entry.name_lower.clone());
        }
    }

    let count = info_list.len();
    let cache_json = serde_json::to_vec(&info_list).unwrap_or_default();
    *APP_LOOKUP.lock().unwrap() = Some(AppLookup { name_to_path, aliases: flat_aliases, cache_json });

    unsafe { CoUninitialize(); }

    log::info!("App index: {} apps saved to disk", count);
    count
}

// ── Read from disk (for list_apps — no memory overhead) ──

pub fn get_apps_from_disk() -> Result<Vec<AppInfo>, String> {
    if let Some(path) = cache_path() {
        if let Ok(data) = std::fs::read(&path) {
            if let Ok(list) = serde_json::from_slice::<Vec<AppInfo>>(&data) {
                return Ok(list);
            }
        }
    }
    // Fall back to cached JSON in memory
    if let Some(ref lookup) = *APP_LOOKUP.lock().unwrap() {
        if let Ok(list) = serde_json::from_slice::<Vec<AppInfo>>(&lookup.cache_json) {
            return Ok(list);
        }
    }
    Err("App index not built yet".to_string())
}

// ── Fuzzy match (uses tiny in-memory lookup) ──

pub fn find_app(query: &str) -> Option<String> {
    let guard = APP_LOOKUP.lock().unwrap();
    let lookup = guard.as_ref()?;
    let q = query.trim().to_lowercase();
    if q.is_empty() { return None; }

    // 1. Exact alias match → lookup canonical name → lookup path
    if let Some(name) = lookup.aliases.get(&q) {
        if let Some(path) = lookup.name_to_path.get(name) { return Some(path.clone()); }
    }
    // 2. Exact name match
    if let Some(path) = lookup.name_to_path.get(&q) { return Some(path.clone()); }
    // 3. Contains match (name contains query)
    if let Some((_, path)) = lookup.name_to_path.iter().find(|(n, _)| n.contains(&q)) {
        return Some(path.clone());
    }
    // 4. Alias contains query
    if let Some((_, name)) = lookup.aliases.iter().find(|(a, _)| a.contains(&q)) {
        if let Some(path) = lookup.name_to_path.get(name) { return Some(path.clone()); }
    }
    None
}
