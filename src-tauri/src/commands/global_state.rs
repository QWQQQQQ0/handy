/**
 * 全局状态管理 - Tauri 后端
 * 记录完整的用户输入事件，保留所有信息供业务层使用
 */

use std::sync::{Arc, Mutex, OnceLock};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ── 状态类型定义 ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveWindow {
    pub hwnd: i64,
    pub title: String,
    pub process_name: String,
    pub bounds: WindowBounds,
    pub last_focused_at: u64,
    pub is_browser: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputEvent {
    pub id: String,
    pub event_type: String,  // key_down, key_up, mouse_click, mouse_double_click, mouse_right_click
    pub x: i32,
    pub y: i32,
    pub key: Option<String>,
    pub modifiers: Vec<String>,
    pub window_title: String,
    pub hwnd: i64,
    pub timestamp: u64,
    // 关联信息
    pub press_duration: Option<u64>,  // 按键持续时间（ms），仅 key_up 时有值
    pub paired_event_id: Option<String>,  // 关联的事件 ID
    // 窗口切换信息（当 hwnd 变化时自动记录）
    pub from_hwnd: Option<i64>,  // 切换前的窗口句柄
    pub from_title: Option<String>,  // 切换前的窗口标题
    pub to_hwnd: Option<i64>,  // 切换后的窗口句柄
    pub to_title: Option<String>,  // 切换后的窗口标题
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub id: String,
    pub goal: String,
    pub status: String,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
    pub tool_calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRecord {
    pub id: String,
    pub tool: String,
    pub params: serde_json::Value,
    pub result: String,
    pub timestamp: u64,
    pub duration: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalStateSnapshot {
    // 设备状态
    pub active_window: Option<ActiveWindow>,
    pub last_screenshot: Option<String>,
    pub last_screenshot_time: u64,

    // Agent 执行状态
    pub current_task: Option<TaskState>,
    pub task_queue: Vec<TaskState>,
    pub recent_agent_actions: Vec<ActionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateChangeRecord {
    pub keys: Vec<String>,
    pub timestamp: u64,
    pub state: GlobalStateSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalState {
    // 设备状态
    pub active_window: Option<ActiveWindow>,
    pub last_screenshot: Option<String>,
    pub last_screenshot_time: u64,

    // Agent 执行状态
    pub current_task: Option<TaskState>,
    pub task_queue: Vec<TaskState>,
    pub recent_agent_actions: Vec<ActionRecord>,

    // 最近状态变更记录
    pub recent_changes: Vec<StateChangeRecord>,
    // 临时收集同一动作的变更 key
    pub pending_keys: Vec<String>,
}

impl Default for GlobalState {
    fn default() -> Self {
        Self {
            active_window: None,
            last_screenshot: None,
            last_screenshot_time: 0,
            current_task: None,
            task_queue: Vec::new(),
            recent_agent_actions: Vec::new(),
            recent_changes: Vec::new(),
            pending_keys: Vec::new(),
        }
    }
}

// ── 全局状态存储 ──

static GLOBAL_STATE: OnceLock<Arc<Mutex<GlobalState>>> = OnceLock::new();
static APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
// 用于关联 key_down 和 key_up 事件
static PENDING_KEY_EVENTS: OnceLock<Mutex<HashMap<String, InputEvent>>> = OnceLock::new();

fn get_state() -> &'static Arc<Mutex<GlobalState>> {
    GLOBAL_STATE.get_or_init(|| Arc::new(Mutex::new(GlobalState::default())))
}

fn get_app_handle() -> &'static Mutex<Option<AppHandle>> {
    APP_HANDLE.get_or_init(|| Mutex::new(None))
}

fn get_pending_key_events() -> &'static Mutex<HashMap<String, InputEvent>> {
    PENDING_KEY_EVENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn emit_state_change(key: &str) {
    if let Some(handle) = get_app_handle().lock().unwrap().as_ref() {
        let _ = handle.emit("global-state-changed", key);
    }
}

// ── 辅助函数 ──

fn generate_event_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", timestamp)
}

// ── Tauri 命令 ──

/// 初始化全局状态模块
#[tauri::command]
pub fn init_global_state(app_handle: AppHandle) {
    *get_app_handle().lock().unwrap() = Some(app_handle);
}

/// 获取完整状态
#[tauri::command]
pub fn get_global_state() -> GlobalState {
    get_state().lock().unwrap().clone()
}

/// 获取活动窗口
#[tauri::command]
pub fn get_active_window_state() -> Option<ActiveWindow> {
    get_state().lock().unwrap().active_window.clone()
}

/// 获取当前任务
#[tauri::command]
pub fn get_current_task() -> Option<TaskState> {
    get_state().lock().unwrap().current_task.clone()
}

/// 获取最近 Agent 操作
#[tauri::command]
pub fn get_recent_agent_actions(limit: Option<usize>) -> Vec<ActionRecord> {
    let state = get_state().lock().unwrap();
    let limit = limit.unwrap_or(100);
    state.recent_agent_actions.iter().rev().take(limit).cloned().collect()
}

/// 记录输入事件（完整记录，不做过滤）
#[tauri::command]
pub fn record_input_event(event_type: String, x: i32, y: i32, key: Option<String>, modifiers: Vec<String>, window_title: String, hwnd: i64, timestamp: u64) {
    let mut state = get_state().lock().unwrap();
    let mut pending = get_pending_key_events().lock().unwrap();

    let event_id = generate_event_id();

    // 处理键盘事件的关联
    let (press_duration, paired_event_id) = if event_type == "key_up" {
        // key_up：查找对应的 key_down
        let key_str = key.clone().unwrap_or_default();
        if let Some(down_event) = pending.remove(&key_str) {
            let duration = timestamp.saturating_sub(down_event.timestamp);
            (Some(duration), Some(down_event.id))
        } else {
            (None, None)
        }
    } else if event_type == "key_down" {
        // key_down：记录到 pending，等待 key_up
        let key_str = key.clone().unwrap_or_default();
        let event = InputEvent {
            id: event_id.clone(),
            event_type: event_type.clone(),
            x, y,
            key: key.clone(),
            modifiers: modifiers.clone(),
            window_title: window_title.clone(),
            hwnd,
            timestamp,
            press_duration: None,
            paired_event_id: None,
            from_hwnd: None,
            from_title: None,
            to_hwnd: None,
            to_title: None,
        };
        pending.insert(key_str, event);
        (None, None)
    } else {
        (None, None)
    };

    // 检测窗口是否发生变化
    let previous_hwnd = state.active_window.as_ref().map(|w| w.hwnd).unwrap_or(0);
    let window_changed = previous_hwnd != 0 && previous_hwnd != hwnd;
    let from_hwnd = if window_changed { Some(previous_hwnd) } else { None };
    let from_title = if window_changed {
        state.active_window.as_ref().map(|w| w.title.clone())
    } else {
        None
    };

    let input_event = InputEvent {
        id: event_id,
        event_type: event_type.clone(),
        x, y,
        key: key.clone(),
        modifiers: modifiers.clone(),
        window_title: window_title.clone(),
        hwnd,
        timestamp,
        press_duration,
        paired_event_id,
        // 窗口切换信息
        from_hwnd,
        from_title,
        to_hwnd: if window_changed { Some(hwnd) } else { None },
        to_title: if window_changed { Some(window_title.clone()) } else { None },
    };

    // 更新活动窗口
    state.active_window = Some(ActiveWindow {
        hwnd,
        title: window_title,
        process_name: String::new(),
        bounds: WindowBounds { x: 0, y: 0, width: 0, height: 0 },
        last_focused_at: timestamp,
        is_browser: false,
    });

    // 收集变更的 key
    if !state.pending_keys.contains(&event_type) {
        state.pending_keys.push(event_type.clone());
    }

    // 在 mouse_up 或 key_up 时记录完整状态
    if event_type == "mouse_up" || event_type == "key_up" {
        println!("[GlobalState] recording action: {:?}", state.pending_keys);
        let snapshot = GlobalStateSnapshot {
            active_window: state.active_window.clone(),
            last_screenshot: state.last_screenshot.clone(),
            last_screenshot_time: state.last_screenshot_time,
            current_task: state.current_task.clone(),
            task_queue: state.task_queue.clone(),
            recent_agent_actions: state.recent_agent_actions.clone(),
        };
        let record = StateChangeRecord {
            keys: state.pending_keys.clone(),
            timestamp,
            state: snapshot,
        };
        state.recent_changes.push(record);
        let len = state.recent_changes.len();
        if len > 10 {
            state.recent_changes.drain(0..len - 10);
        }
        // 清空 pending_keys
        state.pending_keys.clear();
        println!("[GlobalState] total records: {}", state.recent_changes.len());
    }

    // 触发事件
    emit_state_change(&event_type);
}

/// 设置活动窗口
#[tauri::command]
pub fn set_active_window(window: ActiveWindow) {
    let mut state = get_state().lock().unwrap();
    state.active_window = Some(window);
    emit_state_change("active_window");
}

/// 设置当前任务
#[tauri::command]
pub fn set_current_task(task: Option<TaskState>) {
    let mut state = get_state().lock().unwrap();
    state.current_task = task;
    emit_state_change("current_task");
}

/// 添加 Agent 操作记录
#[tauri::command]
pub fn add_agent_action(action: ActionRecord) {
    let mut state = get_state().lock().unwrap();

    state.recent_agent_actions.push(action);
    let len = state.recent_agent_actions.len();
    if len > 100 {
        state.recent_agent_actions.drain(0..len - 100);
    }

    emit_state_change("recent_agent_actions");
}

/// 更新 Agent 操作状态
#[tauri::command]
pub fn update_agent_action_status(action_id: String, result: String, error: Option<String>) {
    let mut state = get_state().lock().unwrap();

    if let Some(action) = state.recent_agent_actions.iter_mut().find(|a| a.id == action_id) {
        action.result = result;
        action.error = error;
    }

    emit_state_change("recent_agent_actions");
}

/// 设置截图
#[tauri::command]
pub fn set_screenshot(base64: String) {
    let mut state = get_state().lock().unwrap();
    state.last_screenshot = Some(base64);
    state.last_screenshot_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    emit_state_change("last_screenshot");
}

/// 获取最近状态变更记录
#[tauri::command]
pub fn get_recent_changes() -> Vec<StateChangeRecord> {
    let state = get_state().lock().unwrap();
    state.recent_changes.clone()
}

/// 清空状态
#[tauri::command]
pub fn clear_global_state() {
    let mut state = get_state().lock().unwrap();
    *state = GlobalState::default();
    let mut pending = get_pending_key_events().lock().unwrap();
    pending.clear();
    emit_state_change("all");
}
