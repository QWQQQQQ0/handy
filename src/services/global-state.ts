/**
 * 全局状态管理器 - 前端代理
 * 记录完整的用户输入事件，保留所有信息供业务层使用
 */

// ── 类型定义（与后端一致）──

export interface ActiveWindow {
  hwnd: number;
  title: string;
  process_name: string;
  bounds: { x: number; y: number; width: number; height: number };
  last_focused_at: number;
  is_browser: boolean;
}

export interface InputEvent {
  id: string;
  event_type: string;  // key_down, key_up, mouse_click, mouse_double_click, mouse_right_click
  x: number;
  y: number;
  key?: string;
  modifiers: string[];
  window_title: string;
  hwnd: number;
  timestamp: number;
  // 关联信息
  press_duration?: number;  // 按键持续时间（ms），仅 key_up 时有值
  paired_event_id?: string;  // 关联的事件 ID
  // 窗口切换信息（当 hwnd 变化时自动记录）
  from_hwnd?: number;  // 切换前的窗口句柄
  from_title?: string;  // 切换前的窗口标题
  to_hwnd?: number;  // 切换后的窗口句柄
  to_title?: string;  // 切换后的窗口标题
}

export interface TaskState {
  id: string;
  goal: string;
  status: string;
  started_at: number;
  completed_at?: number;
  error?: string;
  tool_calls: number;
}

export interface ActionRecord {
  id: string;
  tool: string;
  params: any;
  result: string;
  timestamp: number;
  duration?: number;
  error?: string;
}

export interface GlobalState {
  // 设备状态
  active_window: ActiveWindow | null;
  last_screenshot: string | null;
  last_screenshot_time: number;

  // Agent 执行状态
  current_task: TaskState | null;
  task_queue: TaskState[];
  recent_agent_actions: ActionRecord[];
}

// ── 状态变更监听器 ──

type StateChangeListener = (key: string) => void;

// ── 全局状态管理器（前端代理）──

class GlobalStateManager {
  private static instance: GlobalStateManager;
  private listeners: StateChangeListener[] = [];
  private cleanupFunctions: Array<() => void> = [];
  private initialized = false;

  private constructor() {
    this.init();
  }

  static getInstance(): GlobalStateManager {
    if (!GlobalStateManager.instance) {
      GlobalStateManager.instance = new GlobalStateManager();
    }
    return GlobalStateManager.instance;
  }

  // ════════════════════════════════════════
  // 初始化
  // ════════════════════════════════════════

  private async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // 初始化后端全局状态
      await invoke('init_global_state');

      // 监听状态变更事件
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<string>('global-state-changed', async (event) => {
        const key = event.payload;
        // 只通知监听器，不记录（记录在后端完成）
        this.notifyListeners(key);
      });
      this.cleanupFunctions.push(unlisten);

      // 监听全局输入事件
      const unlistenInput = await listen<any>('global-input-event', (event) => {
        this.handleGlobalInput(event.payload);
      });
      this.cleanupFunctions.push(unlistenInput);

      // 检查设置，决定是否启动全局监听
      const enableGlobalListener = localStorage.getItem('enable_global_listener') !== 'false';
      if (enableGlobalListener) {
        await invoke('start_global_listener');
        console.log('%c[GlobalState] 已启动（全局监听开启）', 'color: #22c55e; font-weight: bold;');
      } else {
        console.log('%c[GlobalState] 已启动（全局监听关闭）', 'color: #f59e0b; font-weight: bold;');
      }

      // 输出初始状态
      const initialState = await this.getState();
      console.log('%c初始状态:', 'color: #8b5cf6;', initialState);

      // 监听事件总线（Agent 执行事件）
      this.setupEventBusListeners();

    } catch (e) {
      console.error('[GlobalState] 初始化失败:', e);
    }
  }

  // ════════════════════════════════════════
  // 处理全局输入事件（完整记录）
  // ════════════════════════════════════════

  private async handleGlobalInput(event: any) {
    try {
      console.log('[GlobalInput] received:', event.event_type);
      const { invoke } = await import('@tauri-apps/api/core');

      // 直接记录所有事件，不做过滤
      await invoke('record_input_event', {
        eventType: event.event_type,
        x: event.x,
        y: event.y,
        key: event.key || null,
        modifiers: event.modifiers || [],
        windowTitle: event.window_title,
        hwnd: event.hwnd,
        timestamp: event.timestamp,
      });
    } catch (e) {
      console.warn('[GlobalState] 处理全局输入失败:', e);
    }
  }

  // ════════════════════════════════════════
  // 监听事件总线 (Agent 执行事件)
  // ════════════════════════════════════════

  private setupEventBusListeners() {
    import('./event-bus').then(async ({ appEventBus }) => {
      const unsubAgent = appEventBus.on('agent', '*', (event) => {
        this.handleAgentEvent(event);
      });
      this.cleanupFunctions.push(unsubAgent);
    });
  }

  private async handleAgentEvent(event: any) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const timestamp = Date.now();

      switch (event.type) {
        case 'before_tool':
          await invoke('add_agent_action', {
            action: {
              id: `action_${timestamp}`,
              tool: event.data?.tool || 'unknown',
              params: event.data?.params || {},
              result: 'pending',
              timestamp,
              duration: null,
              error: null,
            }
          });
          break;

        case 'after_tool':
          const state = await invoke<GlobalState>('get_global_state');
          const lastPending = [...state.recent_agent_actions]
            .reverse()
            .find(a => a.result === 'pending');
          if (lastPending) {
            await invoke('update_agent_action_status', {
              actionId: lastPending.id,
              result: event.level === 'error' ? 'failure' : 'success',
              error: event.data?.error || null,
            });
          }

          if (event.data?.tool === 'take_screenshot' && event.data?.result?.image) {
            await invoke('set_screenshot', { base64: event.data.result.image });
          }
          break;

        case 'task_start':
          await invoke('set_current_task', {
            task: {
              id: event.data?.taskId || `task_${timestamp}`,
              goal: event.data?.goal || '',
              status: 'executing',
              started_at: timestamp,
              completed_at: null,
              error: null,
              tool_calls: 0,
            }
          });
          break;

        case 'task_end':
          const currentState = await invoke<GlobalState>('get_global_state');
          if (currentState.current_task) {
            const status = event.level === 'error' ? 'failed' : 'completed';
            await invoke('set_current_task', {
              task: {
                ...currentState.current_task,
                status,
                completed_at: timestamp,
                error: event.data?.error || null,
              }
            });
          }
          break;
      }
    } catch (e) {
      console.warn('[GlobalState] 处理 Agent 事件失败:', e);
    }
  }

  // ════════════════════════════════════════
  // 状态读取
  // ════════════════════════════════════════

  async getState(): Promise<GlobalState> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_global_state');
  }

  async getActiveWindow(): Promise<ActiveWindow | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_active_window_state');
  }

  async getCurrentTask(): Promise<TaskState | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_current_task');
  }

  async getRecentAgentActions(limit?: number): Promise<ActionRecord[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_recent_agent_actions', { limit });
  }

  // ════════════════════════════════════════
  // 状态更新
  // ════════════════════════════════════════

  async setActiveWindow(window: ActiveWindow) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_active_window', { window });
  }

  async setCurrentTask(task: TaskState | null) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_current_task', { task });
  }

  async setScreenshot(base64: string) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_screenshot', { base64 });
  }

  async clearState() {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_global_state');
  }

  // ════════════════════════════════════════
  // 业务层辅助方法（可选使用）
  // ════════════════════════════════════════

  /**
   * 获取按键序列（只包含 key_down，用于快捷键识别）
   */
  async getKeyPresses(limit?: number): Promise<InputEvent[]> {
    const inputs = await this.getRecentInputs(limit);
    return inputs.filter(e => e.event_type === 'key_down');
  }

  /**
   * 获取完整的按键对（key_down + key_up，用于分析按键持续时间）
   */
  async getKeyPressPairs(limit?: number): Promise<Array<{ down: InputEvent; up?: InputEvent; duration?: number }>> {
    const inputs = await this.getRecentInputs(limit);
    const pairs: Array<{ down: InputEvent; up?: InputEvent; duration?: number }> = [];
    const downMap = new Map<string, InputEvent>();

    for (const event of inputs) {
      if (event.event_type === 'key_down' && event.key) {
        downMap.set(event.key, event);
      } else if (event.event_type === 'key_up' && event.key) {
        const down = downMap.get(event.key);
        if (down) {
          pairs.push({
            down,
            up: event,
            duration: event.press_duration,
          });
          downMap.delete(event.key);
        }
      }
    }

    // 添加未匹配的 key_down
    for (const down of downMap.values()) {
      pairs.push({ down });
    }

    return pairs;
  }

  /**
   * 获取鼠标点击事件
   */
  async getMouseClicks(limit?: number): Promise<InputEvent[]> {
    const inputs = await this.getRecentInputs(limit);
    return inputs.filter(e =>
      e.event_type === 'mouse_click' ||
      e.event_type === 'mouse_double_click' ||
      e.event_type === 'mouse_right_click'
    );
  }

  /**
   * 获取长按事件（持续时间超过阈值的按键）
   */
  async getLongPresses(thresholdMs: number = 500, limit?: number): Promise<InputEvent[]> {
    const inputs = await this.getRecentInputs(limit);
    return inputs.filter(e =>
      e.event_type === 'key_up' &&
      e.press_duration &&
      e.press_duration >= thresholdMs
    );
  }

  // ════════════════════════════════════════
  // 事件监听
  // ════════════════════════════════════════

  addListener(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(key: string) {
    this.listeners.forEach(listener => {
      try {
        listener(key);
      } catch (e) {
        console.error('[GlobalState] 监听器错误:', e);
      }
    });
  }

  // ════════════════════════════════════════
  // 调试工具
  // ════════════════════════════════════════

  /** 获取最近的状态变更记录 */
  async getRecentChanges(): Promise<Array<{ keys: string[]; timestamp: number; state: unknown }>> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_recent_changes');
  }

  async debug() {
    const state = await this.getState();
    const recentChanges = await this.getRecentChanges();
    console.group('[GlobalState] 当前状态');
    console.log('完整状态:', state);
    console.log('活动窗口:', state.active_window);
    console.log('当前任务:', state.current_task);
    console.log('最近变更:', recentChanges);
    console.groupEnd();
  }

  destroy() {
    this.cleanupFunctions.forEach(fn => fn());
    this.cleanupFunctions = [];
    this.listeners = [];
  }
}

// ── 导出单例 ──

export const globalState = GlobalStateManager.getInstance();

// 挂载到 window 方便调试
if (typeof window !== 'undefined') {
  (window as any).__globalState = globalState;
}
