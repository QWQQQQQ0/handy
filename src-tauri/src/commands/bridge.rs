/// Bridge to the Python automation engine (pywinauto + mss + Playwright).
///
/// Spawns a long-lived Python child process and communicates via stdin/stdout
/// JSON Line protocol. Thread-safe via Tauri state + Mutex.
///
/// On first request the engine is lazily started. If Python is not installed
/// or pywinauto is missing, the error is reported in the command result.
///
/// All commands are async — the blocking Python I/O runs on a dedicated
/// blocking thread (tokio::task::spawn_blocking) so the Tauri main thread
/// stays free to process window events (avoids "Not Responding" in the float window).

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Holds the Python child process handle and stdio pipes.
pub struct PythonBridge {
    stdin: BufWriter<std::process::ChildStdin>,
    stdout: BufReader<std::process::ChildStdout>,
    #[allow(dead_code)]
    child: Child,
}

/// Tauri managed state — Arc<Mutex<...>> allows cloning the Arc into
/// spawn_blocking closures while keeping a single shared bridge instance.
pub struct BridgeState {
    pub bridge: Arc<Mutex<Option<PythonBridge>>>,
}

impl PythonBridge {
    /// Launch the Python engine and wait for the ready handshake.
    pub fn start() -> Result<Self, String> {
        let engine_path = resolve_engine_path()?;
        let python = std::env::var("OPENPAW_PYTHON").unwrap_or_else(|_| "python".to_string());

        let mut child = Command::new(&python)
            .arg(&engine_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to start Python engine ({} {}): {}. \
                     Make sure Python 3 and pywinauto are installed.",
                    python, engine_path, e
                )
            })?;

        let stdin = BufWriter::new(child.stdin.take().unwrap());
        let mut stdout = BufReader::new(child.stdout.take().unwrap());

        // Read the ready handshake line
        let mut ready_line = String::new();
        stdout.read_line(&mut ready_line).map_err(|e| {
            let _ = child.kill();
            format!("Python engine started but failed to send ready signal: {}", e)
        })?;

        // Quick validate: should be valid JSON with ok=true
        if !ready_line.contains("\"ok\"") {
            let _ = child.kill();
            return Err(format!(
                "Python engine sent unexpected ready signal: {}",
                ready_line.trim()
            ));
        }

        Ok(PythonBridge {
            stdin,
            stdout,
            child,
        })
    }

    /// Send a JSON Line request and read the response (blocking I/O).
    pub fn send(&mut self, tool: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let request = serde_json::json!({
            "id": "req",
            "tool": tool,
            "params": params,
        });

        let payload = serde_json::to_string(&request).unwrap();
        writeln!(self.stdin, "{}", payload).map_err(|e| format!("Write error: {}", e))?;
        self.stdin.flush().map_err(|e| format!("Flush error: {}", e))?;

        let mut line = String::new();
        self.stdout.read_line(&mut line).map_err(|e| {
            format!(
                "Read error (Python engine may have crashed): {}. Request was: {}",
                e, tool
            )
        })?;

        let response: serde_json::Value =
            serde_json::from_str(line.trim()).map_err(|e| {
                format!("JSON parse error: {} — raw: {}", e, line.trim())
            })?;

        if response["ok"].as_bool() == Some(true) {
            Ok(response["data"].clone())
        } else {
            let err_msg = response["error"]
                .as_str()
                .unwrap_or("Unknown error from Python engine");
            Err(err_msg.to_string())
        }
    }
}

/// Resolve the path to python-engine/main.py.
///
/// During development (`cargo tauri dev`) this is `../python-engine/main.py`
/// relative to the `src-tauri/` directory (CARGO_MANIFEST_DIR).
fn resolve_engine_path() -> Result<String, String> {
    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").map_err(|_| "CARGO_MANIFEST_DIR not set".to_string())?;

    let path = std::path::Path::new(&manifest_dir)
        .parent()
        .ok_or("Cannot resolve project root")?
        .join("python-engine")
        .join("main.py");

    if !path.exists() {
        return Err(format!(
            "Python engine not found at: {}. Check that python-engine/main.py exists.",
            path.display()
        ));
    }

    Ok(path.to_string_lossy().to_string())
}

// ── Async bridge helper ──

/// Run a bridge call on a blocking thread so the Tauri main thread stays
/// responsive. The Arc<Mutex<...>> is cloned into the closure — only one
/// request talks to Python at a time (Mutex), but the main thread is never
/// blocked waiting for the Python response.
async fn bridge_call_async(
    bridge: Arc<Mutex<Option<PythonBridge>>>,
    tool: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut guard = bridge.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(PythonBridge::start()?);
        }
        guard.as_mut().unwrap().send(&tool, params)
    })
    .await
    .map_err(|e| format!("Bridge join error: {}", e))?
}

// ═══════════════════════════════════════════════════════════════
// Tauri commands — all async to keep the UI responsive
// ═══════════════════════════════════════════════════════════════

/// Pre-warm the Python engine on app startup.
/// This starts the Python child process and its extension WebSocket server
/// (port 19840) so the Chrome extension can connect immediately.
#[tauri::command]
pub async fn prewarm_python_engine(
    state: tauri::State<'_, BridgeState>,
) -> Result<String, String> {
    bridge_call_async(
        state.bridge.clone(),
        "prewarm".into(),
        serde_json::json!({}),
    )
    .await?;
    Ok("Python engine started".into())
}

/// Check if the Chrome extension is connected via WebSocket.
/// Returns { connected: bool, url?: string }
#[tauri::command]
pub async fn get_extension_status(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    let data = bridge_call_async(
        state.bridge.clone(),
        "browser_status".into(),
        serde_json::json!({}),
    )
    .await?;
    Ok(data)
}

// ── Desktop UIA commands ──

#[tauri::command]
pub async fn uia_get_interactive(
    state: tauri::State<'_, BridgeState>,
    window_hwnd: Option<i64>,
    roles: Option<Vec<String>>,
    name_keyword: Option<String>,
    onscreen_only: Option<bool>,
    limit: Option<usize>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_get_interactive".into(),
        serde_json::json!({
            "window_hwnd": window_hwnd,
            "roles": roles,
            "name_keyword": name_keyword,
            "onscreen_only": onscreen_only.unwrap_or(false),
            "limit": limit,
        }),
    )
    .await
}

#[tauri::command]
pub async fn uia_click(
    state: tauri::State<'_, BridgeState>,
    role: String,
    name: Option<String>,
    window_hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_click".into(),
        serde_json::json!({ "role": role, "name": name, "window_hwnd": window_hwnd }),
    )
    .await
}

#[tauri::command]
pub async fn uia_type_text(
    state: tauri::State<'_, BridgeState>,
    text: String,
    role: Option<String>,
    name: Option<String>,
    window_hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_type".into(),
        serde_json::json!({ "text": text, "role": role, "name": name, "window_hwnd": window_hwnd }),
    )
    .await
}

#[tauri::command]
pub async fn uia_find_element(
    state: tauri::State<'_, BridgeState>,
    role: String,
    name: Option<String>,
    window_hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_find".into(),
        serde_json::json!({ "role": role, "name": name, "window_hwnd": window_hwnd }),
    )
    .await
}

#[tauri::command]
pub async fn uia_get_property(
    state: tauri::State<'_, BridgeState>,
    role: String,
    name: Option<String>,
    property: String,
    window_hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_get_property".into(),
        serde_json::json!({ "role": role, "name": name, "property": property, "window_hwnd": window_hwnd }),
    )
    .await
}

#[tauri::command]
pub async fn uia_fingerprint(
    state: tauri::State<'_, BridgeState>,
    window_hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_fingerprint".into(),
        serde_json::json!({ "window_hwnd": window_hwnd }),
    )
    .await
}

#[tauri::command]
pub async fn uia_find_element_at_point(
    state: tauri::State<'_, BridgeState>,
    x: i32,
    y: i32,
    hwnd: Option<i64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "uia_find_at_point".into(),
        serde_json::json!({ "x": x, "y": y, "hwnd": hwnd }),
    )
    .await
}

// ── Browser (Playwright) commands ──

#[tauri::command]
pub async fn web_launch(
    state: tauri::State<'_, BridgeState>,
    headless: Option<bool>,
    channel: Option<String>,
    connect_existing: Option<bool>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_launch".into(),
        serde_json::json!({
            "headless": headless.unwrap_or(false),
            "channel": channel,
            "connect_existing": connect_existing.unwrap_or(true)
        }),
    )
    .await
}

#[tauri::command]
pub async fn web_connect_cdp(
    state: tauri::State<'_, BridgeState>,
    cdp_url: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_connect_cdp".into(),
        serde_json::json!({ "cdp_url": cdp_url.unwrap_or_else(|| "http://localhost:9222".into()) }),
    )
    .await
}

#[tauri::command]
pub async fn web_navigate(
    state: tauri::State<'_, BridgeState>,
    url: Option<String>,
    action: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_navigate".into(),
        serde_json::json!({ "url": url.unwrap_or_default(), "action": action.unwrap_or_else(|| "goto".into()) }),
    )
    .await
}

#[tauri::command]
pub async fn web_get_interactive(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_get_interactive".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn ext_get_recorded_events(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "ext_get_recorded_events".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn ext_set_capture(
    state: tauri::State<'_, BridgeState>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "ext_set_capture".into(),
        serde_json::json!({ "enabled": enabled }),
    )
    .await
}

#[tauri::command]
pub async fn web_click_selector(
    state: tauri::State<'_, BridgeState>,
    selector: String,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_click_selector".into(),
        serde_json::json!({ "selector": selector }),
    )
    .await
}

#[tauri::command]
pub async fn web_click_role(
    state: tauri::State<'_, BridgeState>,
    role: String,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_click_role".into(),
        serde_json::json!({ "role": role, "name": name }),
    )
    .await
}

#[tauri::command]
pub async fn web_fill(
    state: tauri::State<'_, BridgeState>,
    selector: String,
    text: String,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_fill".into(),
        serde_json::json!({ "selector": selector, "text": text }),
    )
    .await
}

#[tauri::command]
pub async fn web_scroll(
    state: tauri::State<'_, BridgeState>,
    delta_y: Option<i32>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_scroll".into(),
        serde_json::json!({ "delta_y": delta_y }),
    )
    .await
}

#[tauri::command]
pub async fn web_close(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_close".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn web_launch_browser(
    state: tauri::State<'_, BridgeState>,
    browser: Option<String>,
    port: Option<u16>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_launch_browser".into(),
        serde_json::json!({
            "browser": browser.unwrap_or_else(|| "msedge".into()),
            "port": port.unwrap_or(9222)
        }),
    )
    .await
}

#[tauri::command]
pub async fn web_start_recording(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_start_recording".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn web_stop_recording(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_stop_recording".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn web_get_recorded_events(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_get_recorded_events".into(),
        serde_json::json!({}),
    )
    .await
}

// ── Screenshot (mss) commands ──

#[tauri::command]
pub async fn screenshot_full(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "screenshot_full".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn screenshot_region(
    state: tauri::State<'_, BridgeState>,
    left: i32,
    top: i32,
    width: i32,
    height: i32,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "screenshot_region".into(),
        serde_json::json!({ "left": left, "top": top, "width": width, "height": height }),
    )
    .await
}

// ── OCR (PaddleOCR) commands ──

#[tauri::command]
pub async fn ocr_recognize(
    state: tauri::State<'_, BridgeState>,
    image_base64: Option<String>,
    image_path: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "ocr_recognize".into(),
        serde_json::json!({ "image_base64": image_base64, "image_path": image_path }),
    )
    .await
}

// ── Global input listener (pynput) commands ──

#[tauri::command]
pub async fn global_listener_start(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    let parent_pid = std::process::id();
    bridge_call_async(
        state.bridge.clone(),
        "global_listener_start".into(),
        serde_json::json!({ "parent_pid": parent_pid }),
    )
    .await
}

#[tauri::command]
pub async fn global_listener_stop(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "global_listener_stop".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn global_listener_poll(
    state: tauri::State<'_, BridgeState>,
    max_events: Option<usize>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "global_listener_poll".into(),
        serde_json::json!({ "max_events": max_events.unwrap_or(100) }),
    )
    .await
}

#[tauri::command]
pub async fn event_collector_poll(
    state: tauri::State<'_, BridgeState>,
    max_events: Option<usize>,
) -> Result<serde_json::Value, String> {
    let result = bridge_call_async(
        state.bridge.clone(),
        "event_collector_poll".into(),
        serde_json::json!({ "max_events": max_events.unwrap_or(50) }),
    )
    .await?;
    let count = result.get("count").and_then(|c| c.as_u64()).unwrap_or(0);
    if count > 0 {
        if let Some(events) = result.get("events").and_then(|e| e.as_array()) {
            eprintln!("[bridge] event_collector_poll returning {} events:", events.len());
            for (i, evt) in events.iter().enumerate() {
                let src = evt.get("_source").and_then(|s| s.as_str()).unwrap_or("?");
                let etype = evt.get("type").or(evt.get("event_type")).and_then(|t| t.as_str()).unwrap_or("?");
                eprintln!("[bridge]   [{}] _source={} type={}", i, src, etype);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn event_collector_start(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "event_collector_start".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn event_collector_stop(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "event_collector_stop".into(),
        serde_json::json!({}),
    )
    .await
}

// ── Office document generator commands ──

#[tauri::command]
pub async fn word_generate(
    state: tauri::State<'_, BridgeState>,
    title: String,
    content: String,
    subtitle: Option<String>,
    author: Option<String>,
    save_path: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "word_generate".into(),
        serde_json::json!({
            "title": title,
            "content": content,
            "subtitle": subtitle,
            "author": author,
            "save_path": save_path,
        }),
    )
    .await
}

#[tauri::command]
pub async fn excel_generate(
    state: tauri::State<'_, BridgeState>,
    title: String,
    sheets: Vec<serde_json::Value>,
    author: Option<String>,
    save_path: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "excel_generate".into(),
        serde_json::json!({
            "title": title,
            "sheets": sheets,
            "author": author,
            "save_path": save_path,
        }),
    )
    .await
}

#[tauri::command]
pub async fn ppt_generate(
    state: tauri::State<'_, BridgeState>,
    title: String,
    slides: Option<Vec<serde_json::Value>>,
    markdown: Option<String>,
    author: Option<String>,
    save_path: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "ppt_generate".into(),
        serde_json::json!({
            "title": title,
            "slides": slides,
            "markdown": markdown,
            "author": author,
            "save_path": save_path,
        }),
    )
    .await
}

// ── Office COM automation commands ──

#[tauri::command]
pub async fn office_detect(
    state: tauri::State<'_, BridgeState>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "office_detect".into(),
        serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub async fn ppt_com_read(
    state: tauri::State<'_, BridgeState>,
    slide_start: Option<usize>,
    slide_end: Option<usize>,
    slide_index: Option<usize>,
    slide_info: Option<bool>,
    find_text: Option<bool>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "ppt_com_read".into(),
        serde_json::json!({
            "slide_start": slide_start,
            "slide_end": slide_end,
            "slide_index": slide_index,
            "slide_info": slide_info,
            "find_text": find_text,
        }),
    )
    .await
}

#[tauri::command]
pub async fn ppt_com_edit(
    state: tauri::State<'_, BridgeState>,
    operation: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut payload = params.as_object().cloned().unwrap_or_default();
    payload.insert("operation".into(), serde_json::Value::String(operation));
    bridge_call_async(
        state.bridge.clone(),
        "ppt_com_edit".into(),
        serde_json::Value::Object(payload),
    )
    .await
}

#[tauri::command]
pub async fn word_com_read(
    state: tauri::State<'_, BridgeState>,
    paragraph_start: Option<usize>,
    paragraph_end: Option<usize>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "word_com_read".into(),
        serde_json::json!({
            "paragraph_start": paragraph_start,
            "paragraph_end": paragraph_end,
        }),
    )
    .await
}

#[tauri::command]
pub async fn word_com_edit(
    state: tauri::State<'_, BridgeState>,
    operation: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut payload = params.as_object().cloned().unwrap_or_default();
    payload.insert("operation".into(), serde_json::Value::String(operation));
    bridge_call_async(
        state.bridge.clone(),
        "word_com_edit".into(),
        serde_json::Value::Object(payload),
    )
    .await
}

#[tauri::command]
pub async fn excel_com_read(
    state: tauri::State<'_, BridgeState>,
    range: Option<String>,
    sheet: Option<String>,
    get_selection: Option<bool>,
    sheet_info: Option<bool>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "excel_com_read".into(),
        serde_json::json!({
            "range": range,
            "sheet": sheet,
            "get_selection": get_selection,
            "sheet_info": sheet_info,
        }),
    )
    .await
}

#[tauri::command]
pub async fn excel_com_edit(
    state: tauri::State<'_, BridgeState>,
    operation: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut payload = params.as_object().cloned().unwrap_or_default();
    payload.insert("operation".into(), serde_json::Value::String(operation));
    bridge_call_async(
        state.bridge.clone(),
        "excel_com_edit".into(),
        serde_json::Value::Object(payload),
    )
    .await
}

// ── Web search commands ──

#[tauri::command]
pub async fn web_search(
    state: tauri::State<'_, BridgeState>,
    query: String,
    max_results: Option<usize>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_search".into(),
        serde_json::json!({
            "query": query,
            "max_results": max_results.unwrap_or(10),
        }),
    )
    .await
}

#[tauri::command]
pub async fn web_fetch(
    state: tauri::State<'_, BridgeState>,
    url: String,
    timeout: Option<u64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_fetch".into(),
        serde_json::json!({
            "url": url,
            "timeout": timeout.unwrap_or(25),
        }),
    )
    .await
}

// ── Doc code exec (document sandbox) ──

#[tauri::command]
pub async fn doc_code_exec(
    state: tauri::State<'_, BridgeState>,
    code: String,
    timeout_sec: Option<u64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "doc_code_exec".into(),
        serde_json::json!({
            "code": code,
            "timeout_sec": timeout_sec.unwrap_or(60),
        }),
    )
    .await
}

#[tauri::command]
pub async fn web_code_exec(
    state: tauri::State<'_, BridgeState>,
    code: String,
    timeout_sec: Option<u64>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "web_code_exec".into(),
        serde_json::json!({
            "code": code,
            "timeout_sec": timeout_sec.unwrap_or(60),
        }),
    )
    .await
}

#[tauri::command]
pub async fn exec_python(
    state: tauri::State<'_, BridgeState>,
    code: String,
    timeout_sec: Option<u64>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    bridge_call_async(
        state.bridge.clone(),
        "exec_python".into(),
        serde_json::json!({
            "code": code,
            "timeout_sec": timeout_sec.unwrap_or(30),
            "params": params.unwrap_or(serde_json::json!({})),
        }),
    )
    .await
}
