/**
 * 统一录制器服务
 *
 * 功能：
 * 1. 整合多个平台适配器
 * 2. 录制用户操作并生成语义化事件
 * 3. 管理录制会话生命周期
 * 4. 支持事件标记和编辑
 */

import type { PlatformAdapter, PlatformEvent } from '@/adapters/platform-adapter';
import { adapterRegistry } from '@/adapters/platform-adapter';
import type { SemanticEvent, EventTag } from '@/types/semantic-event';
import type { RecordingSession, RecordingConfig, RecordingState, RecordingCallback, RecordingEventType } from '@/types/recording-session';
import type { UnifiedElement } from '@/types/unified-element';
import type { UnifiedAction } from '@/types/unified-action';
import { globalListener, type GlobalInputEvent } from './global-listener';

// ── Gesture classifier thresholds ──
const LONG_PRESS_MS = 500;
const DBLCLICK_WINDOW_MS = 400;

/**
 * 手势分类器
 *
 * 接收 raw mousedown/mouseup 事件，输出分类后的手势事件。
 * 纯时间戳驱动——不依赖 setTimeout，在每次 process() 入口通过 flushStale() 清理过期状态。
 * batch 轮询场景下，多个事件同步到达，状态机靠时间戳而非 timer 判断。
 *
 *   mousedown → 立即输出（UI 反馈）
 *   mouseup   → 暂存，等分类结果
 *     单击确认 → 替换 mousedown 为 click
 *     双击确认 → 替换 2×mousedown + 2×mouseup 为 dblclick
 *     长按确认 → 给 down+up 加 longPress 标记
 */
class GestureClassifier {
  private state: 'idle' | 'pending' | 'wait_second_down' | 'wait_second_up' = 'idle';
  private downRef: SemanticEvent | null = null;
  private downRef2: SemanticEvent | null = null;
  private downTs = 0;
  /** 进入 wait_second_down 的时间戳（第一个 mouseup 的时间） */
  private upTs = 0;
  private onReplace: ((oldEvt: SemanticEvent, newEvt: SemanticEvent) => void) | null = null;
  private onRemove: ((evt: SemanticEvent) => void) | null = null;
  private onEmit: ((evt: SemanticEvent) => void) | null = null;

  setCallbacks(opts: {
    onReplace: (oldEvt: SemanticEvent, newEvt: SemanticEvent) => void;
    onRemove: (evt: SemanticEvent) => void;
    onEmit: (evt: SemanticEvent) => void;
  }) {
    this.onReplace = opts.onReplace;
    this.onRemove = opts.onRemove;
    this.onEmit = opts.onEmit;
  }

  reset() {
    this.state = 'idle';
    this.downRef = null;
    this.downRef2 = null;
    this.downTs = 0;
    this.upTs = 0;
  }

  /**
   * 清理过期状态（纯时间戳驱动，不依赖 setTimeout）。
   * 应在每次 process() 入口调用，以及在 batch 末尾、录制停止时调用。
   *
   * @param nowTs 当前参考时间戳（通常是新事件的 timestamp，或 Date.now()）
   */
  flushStale(nowTs: number): void {
    // ── wait_second_down 超时：确认单击 ──
    if (this.state === 'wait_second_down' && (nowTs - this.upTs) > DBLCLICK_WINDOW_MS) {
      console.log(`[GestureClassifier] flushStale → click (gap=${nowTs - this.upTs}ms > ${DBLCLICK_WINDOW_MS}ms)`);
      const click = this.makeGesture('click', this.upTs, this.downRef!);
      this.onReplace?.(this.downRef!, click);
      this.state = 'idle';
      this.downRef = null;
      this.downRef2 = null;
      this.downTs = 0;
      this.upTs = 0;
      return;
    }

    // ── wait_second_up 超时：第二个 mouseup 迟迟不来，降级为两次独立 click ──
    if (this.state === 'wait_second_up' && (nowTs - this.downTs) > LONG_PRESS_MS) {
      console.log(`[GestureClassifier] flushStale → wait_second_up timeout, splitting into 2 clicks`);
      // 结算第一次 click
      const click1 = this.makeGesture('click', this.upTs, this.downRef!);
      this.onReplace?.(this.downRef!, click1);
      // 第二次 mousedown 变成新手势的 pending
      if (this.downRef2) {
        this.downRef = this.downRef2;
        this.downTs = this.downRef2.timestamp;
        this.downRef2 = null;
        this.upTs = 0;
        this.state = 'pending';
        console.log(`[GestureClassifier] → downRef2 rolled into pending, ts=${this.downTs}`);
      } else {
        this.reset();
      }
    }
  }

  /**
   * 处理一条事件。返回 true 表示事件已被分类器消费（不要直接添加到时间线），
   * false 表示事件应直接添加到时间线。
   */
  process(evt: SemanticEvent): boolean {
    const action = evt.action;
    const ts = evt.timestamp;

    // ── 入口 flush：任何事件（鼠标/键盘/滚轮）都能触发过期状态清理 ──
    this.flushStale(ts);

    const isMouseDown = action.type === 'mousedown' || (action.type as string) === 'mouse_down';
    const isMouseUp = action.type === 'mouseup' || (action.type as string) === 'mouse_up';
    if (!isMouseDown && !isMouseUp) return false;

    if (isMouseDown) {
      if (this.state === 'wait_second_down') {
        // 第二个 mousedown：时间戳校验（flushStale 已清理超时的，这里只在窗口内）
        const gap = ts - this.upTs;
        if (gap > DBLCLICK_WINDOW_MS) {
          // 兜底：理论上 flushStale 应该已处理，这里再保护一次
          console.log(`[GestureClassifier] mousedown₂ ts=${ts} gap=${gap}ms > ${DBLCLICK_WINDOW_MS}ms → settling click & restart`);
          const click = this.makeGesture('click', this.upTs, this.downRef!);
          this.onReplace?.(this.downRef!, click);
          this.downRef = evt;
          this.downRef2 = null;
          this.downTs = ts;
          this.upTs = 0;
          this.state = 'pending';
          return false;
        }
        // 在双击窗口内：准备双击
        this.downRef2 = evt;
        this.downTs = ts;
        this.state = 'wait_second_up';
        console.log(`[GestureClassifier] mousedown₂ ts=${ts} gap=${gap}ms ≤ ${DBLCLICK_WINDOW_MS}ms, state→wait_second_up`);
        return false; // output mousedown immediately
      }

      if (this.state === 'idle' || this.state === 'pending') {
        // 如果已在 pending 但还没收到 mouseup，新的 mousedown 替换（可能是全局+扩展去重后的新事件）
        this.downRef = evt;
        this.downRef2 = null;
        this.downTs = ts;
        this.state = 'pending';
        console.log(`[GestureClassifier] mousedown₁ ts=${ts}, state→pending`);
        return false; // output mousedown immediately
      }

      // wait_second_up：等待第二个 mouseup 完成双击，多余的 mousedown 静默丢弃
      if (this.state === 'wait_second_up') return true;
      return false;
    }

    // ── isMouseUp ──
    if (this.state === 'pending') {
      const duration = ts - this.downTs;
      console.log(`[GestureClassifier] mouseup₁ ts=${ts}, duration=${duration}ms`);
      if (duration > LONG_PRESS_MS) {
        // Long press: mark both down and up
        if (this.downRef) this.downRef.action.params = { ...this.downRef.action.params, longPress: true };
        evt.action.params = { ...evt.action.params, longPress: true };
        console.log(`[GestureClassifier] → long_press (${duration}ms)`);
        this.reset();
        return false; // output mouseup (down already output)
      }
      // Short press: hold mouseup, wait for classification
      this.state = 'wait_second_down';
      this.upTs = ts;
      console.log(`[GestureClassifier] → waiting for second click, upTs=${ts}`);
      return true; // consume mouseup (don't output yet)
    }

    // 全局监听 + 扩展会各发一份 mouseup。第一份已被消费（状态→wait_second_down），
    // 第二份到达时静默丢弃，否则会裸 mouse_up 泄入 session 破坏分类。
    if (this.state === 'wait_second_down') {
      return true;
    }

    if (this.state === 'wait_second_up') {
      // Second mouseup: double-click!
      console.log(`[GestureClassifier] mouseup₂ ts=${ts} → dblclick`);
      if (this.downRef) {
        const dblclick = this.makeGesture('double_click', ts, this.downRef);
        this.onReplace?.(this.downRef, dblclick);
        if (this.downRef2) this.onRemove?.(this.downRef2);
      }
      this.reset();
      return true; // consume this mouseup
    }

    // 其他状态的 mouseup 都是重复事件（全局+扩展双份），静默丢弃
    return true;
  }

  private makeGesture(type: string, ts: number, ref: SemanticEvent): SemanticEvent {
    return {
      id: crypto.randomUUID(),
      timestamp: ts,
      action: {
        type,
        target: ref.action.target,
      },
      element: ref.element,
      context: ref.context,
    };
  }
}

/**
 * 统一录制器
 */
class UnifiedRecorder {
  // ── 状态 ──
  private state: RecordingState = {
    isRecording: false,
    isPaused: false,
    session: null,
    currentEvent: null,
    eventCount: 0,
    duration: 0,
  };

  // ── 适配器 ──
  private adapters: Map<string, PlatformAdapter> = new Map();
  private activeAdapters: Set<string> = new Set();

  // ── 全局监听器 ──
  private globalListenerUnsubscribe: (() => void) | null = null;
  private keyDownTimestamps: Map<string, number> = new Map();
  private pendingDragStart: { event: GlobalInputEvent; timestamp: number } | null = null;

  // ── 热键合并（主动模式）──
  // modifier key_down → hotkey 形成时立即追溯移除 key_down；key_up 到达时直接抑制
  private pendingModifierDowns: Map<string, SemanticEvent> = new Map();
  private consumedModifiers: Set<string> = new Set();

  // ── 手势分类器 ──
  private gestureClassifier = new GestureClassifier();

  // ── 回调 ──
  private callbacks: Set<RecordingCallback> = new Set();
  private eventCallbacks: Set<(event: SemanticEvent) => void> = new Set();
  private eventRemoveCallbacks: Set<(eventId: string) => void> = new Set();

  // ── 定时器 ──
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  /** 时钟对齐：Python collector 时间 ↔ 前端墙上时间 */
  private lastEventCollectedAt = 0; // 最后一个事件的 _collected_at
  private lastEventWallMs = 0;      // 最后一个事件到达时的 Date.now()

  // ── 配置 ──
  private config: RecordingConfig = {
    captureScreenshot: false,
    captureContext: true,
    autoTag: true,
    maxEvents: 1000,
    timeout: 0,
  };

  // ── 生命周期 ──

  /**
   * 初始化录制器
   */
  async initialize(): Promise<void> {
    // 获取所有可用的适配器
    const availableAdapters = await adapterRegistry.getAvailableAdapters();

    for (const adapter of availableAdapters) {
      this.adapters.set(adapter.platform, adapter);
    }

    // 预热 clipboard-capture 模块，避免录制时首次动态 import 拖慢事件管道
    import('./clipboard-capture').catch(() => {});
  }

  /**
   * 开始录制
   */
  async startRecording(config?: RecordingConfig): Promise<RecordingSession> {
    if (this.state.isRecording) {
      throw new Error('Already recording');
    }

    // 合并配置
    this.config = { ...this.config, ...config };

    // 创建新会话
    const session: RecordingSession = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      status: 'recording',
      events: [],
      metadata: {
        userDescription: this.config.description,
        taskType: this.config.taskType ?? 'temporary',
      },
    };

    // 初始化手势分类器
    this.gestureClassifier.reset(); // 清理上一次录制的残留状态
    this.pendingModifierDowns.clear();
    this.consumedModifiers.clear();
    this.gestureClassifier.setCallbacks({
      onReplace: (oldEvt, newEvt) => {
        const events = this.state.session?.events;
        if (!events) return;
        const idx = events.findIndex(e => e.id === oldEvt.id);
        console.log('[UnifiedRecorder] onReplace: %s → %s (idx=%d, sessionLen=%d → %d)',
          oldEvt.action.type, newEvt.action.type, idx, events.length,
          idx !== -1 ? events.length : events.length + 1);
        if (idx !== -1) events[idx] = newEvt;
        else {
          // 旧事件可能在之前已被去重删除，直接将新事件追加进 session
          console.log('[UnifiedRecorder] onReplace: old event not in session, pushing new event');
          events.push(newEvt);
          this.state.eventCount++;
        }
        // 通知 UI 移除旧事件（mousedown）
        this.emit('event-remove', oldEvt.id);
        // 通知 RecordingCallback 监听者
        this.emit('event', newEvt);
        // 通知 eventCallbacks（UI 事件列表通过 onEvent 注册到这里）
        this.eventCallbacks.forEach(cb => cb(newEvt));
      },
      onRemove: (evt) => {
        const events = this.state.session?.events;
        if (!events) return;
        const idx = events.findIndex(e => e.id === evt.id);
        console.log('[UnifiedRecorder] onRemove: %s (id=%s, idx=%d, sessionLen=%d)',
          evt.action.type, evt.id.slice(0, 8), idx, events.length);
        if (idx !== -1) {
          events.splice(idx, 1);
          this.state.eventCount--;
          this.emit('event-remove', evt.id);
        }
      },
      onEmit: (evt) => {
        this.addSemanticEvent(evt);
      },
    });

    // 启动事件汇聚层
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_start');
    } catch { /* ignore */ }

    // 启用扩展事件捕获
    try {
      const { desktopService } = await import('./desktop-service');
      await desktopService.extSetCapture(true);
      // 清空扩展缓冲区中的旧事件
      await desktopService.extGetRecordedEvents();
      console.log('[startRecording] extension capture enabled');
    } catch (e) {
      console.warn('[startRecording] extension NOT connected — web events will be missing:', e);
    }

    // 启动全局监听器（现在通过统一接口轮询所有事件）
    try {
      await globalListener.start();
      this.globalListenerUnsubscribe = globalListener.onEvent(this.handleGlobalEvent.bind(this));
    } catch { /* ignore */ }

    // 启动适配器
    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.startListening(this.handlePlatformEvent.bind(this));
        this.activeAdapters.add(platform);
      } catch { /* ignore */ }
    }

    // 更新状态
    this.state = {
      isRecording: true,
      isPaused: false,
      session,
      currentEvent: null,
      eventCount: 0,
      duration: 0,
    };

    this.startTime = Date.now();

    // 启动时长计时器
    this.durationTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused) {
        this.state.duration = Date.now() - this.startTime;
        this.emit('event', { type: 'tick', duration: this.state.duration });
      }
    }, 1000);

    // 启动手势分类器周期 flush：推算 Python 时钟避免双钟混用
    this.flushTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused && this.lastEventCollectedAt > 0) {
        const estimatedPythonTs = this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs);
        this.gestureClassifier.flushStale(estimatedPythonTs);
      }
    }, DBLCLICK_WINDOW_MS + 50);

    // 通知回调
    this.emit('start', session);

    return session;
  }

  /**
   * 停止录制
   */
  async stopRecording(): Promise<RecordingSession> {
    if (!this.state.isRecording) {
      throw new Error('Not recording');
    }

    // 停止事件汇聚层
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_stop');
    } catch { /* ignore */ }

    // 禁用扩展事件捕获
    try {
      const { desktopService } = await import('./desktop-service');
      await desktopService.extSetCapture(false);
    } catch { /* extension not connected */ }

    // 停止全局监听器
    if (this.globalListenerUnsubscribe) {
      this.globalListenerUnsubscribe();
      this.globalListenerUnsubscribe = null;
    }
    this.pendingDragStart = null;
    try {
      await globalListener.stop();
    } catch { /* ignore */ }

    // 停止适配器
    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) {
        try {
          await adapter.stopListening();
        } catch { /* ignore */ }
      }
    }
    this.activeAdapters.clear();

    // 停止计时器
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // 结算手势分类器：flush 最后一个待定手势（例如单击后立即停止录制）
    // 用估算的 Python 时间，避免 Date.now() 和事件 _collected_at 不同钟导致误判
    const estimatedTs = this.lastEventCollectedAt > 0
      ? this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs)
      : Date.now();
    this.gestureClassifier.flushStale(estimatedTs);

    // 更新会话状态
    const session = this.state.session!;
    session.endTime = Date.now();
    session.status = 'completed';
    session.metadata.stats = this.calculateStats(session);

    // [DEBUG] 录制结束时完整事件列表
    console.log('[UnifiedRecorder] stopRecording — session.events (%d):', session.events.length);
    session.events.forEach((e, i) => {
      const coord = e.action.target?.coordinate;
      const c = coord ? `(${coord.x}, ${coord.y})` : '';
      console.log(`  %d. %s %s — %s`, i + 1, e.action.type, c, e.context?.windowTitle || '');
    });

    // 更新状态
    this.state = {
      isRecording: false,
      isPaused: false,
      session: null,
      currentEvent: null,
      eventCount: 0,
      duration: 0,
    };

    // 通知回调
    this.emit('stop', session);

    return session;
  }

  /**
   * 暂停录制
   */
  async pauseRecording(): Promise<void> {
    if (!this.state.isRecording || this.state.isPaused) {
      return;
    }

    this.state.isPaused = true;

    // 停止事件汇聚层（Python 端停止接收新事件）
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_stop');
    } catch { /* ignore */ }

    // 停止全局监听器轮询
    if (this.globalListenerUnsubscribe) {
      this.globalListenerUnsubscribe();
      this.globalListenerUnsubscribe = null;
    }
    this.pendingDragStart = null;
    try {
      await globalListener.stop();
    } catch { /* ignore */ }

    // 暂停适配器
    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) {
        adapter.stopListening();
      }
    }

    // 结算并暂停手势分类器周期 flush
    this.gestureClassifier.flushStale(Date.now());
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.emit('pause');
  }

  /**
   * 恢复录制
   */
  async resumeRecording(): Promise<void> {
    if (!this.state.isRecording || !this.state.isPaused) {
      return;
    }

    this.state.isPaused = false;

    // 重新启动事件汇聚层
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_start');
    } catch { /* ignore */ }

    // 重新启动全局监听器轮询
    try {
      await globalListener.start();
      this.globalListenerUnsubscribe = globalListener.onEvent(this.handleGlobalEvent.bind(this));
    } catch { /* ignore */ }

    // 恢复适配器
    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) {
        adapter.startListening(this.handlePlatformEvent.bind(this));
      }
    }

    // 恢复手势分类器周期 flush
    // 恢复手势分类器周期 flush（时钟对齐版）
    this.flushTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused && this.lastEventCollectedAt > 0) {
        const estimatedPythonTs = this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs);
        this.gestureClassifier.flushStale(estimatedPythonTs);
      }
    }, DBLCLICK_WINDOW_MS + 50);

    this.emit('resume');
  }

  /**
   * 取消录制
   */
  async cancelRecording(): Promise<void> {
    if (!this.state.isRecording) {
      return;
    }

    // 停止适配器
    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) {
        await adapter.stopListening();
      }
    }
    this.activeAdapters.clear();
    this.pendingDragStart = null;
    this.gestureClassifier.reset();

    // 停止计时器
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    const session = this.state.session;
    if (session) {
      session.status = 'cancelled';
    }

    // 更新状态
    this.state = {
      isRecording: false,
      isPaused: false,
      session: null,
      currentEvent: null,
      eventCount: 0,
      duration: 0,
    };

    this.emit('stop', session);
  }

  // ── 事件处理 ──

  /**
   * 处理事件（来自统一汇聚层，包含 global 和 extension）
   */
  private async handleGlobalEvent(event: GlobalInputEvent & { _source?: string; _ext?: any }): Promise<void> {
    const extType = (event as any).type;
    // 放在 isRecording 检查之前，确认事件是否到达前端
    if ((event as any)._source === 'extension') {
      console.log(`[handleGlobalEvent] EXT event arrived: type=${extType} isRecording=${this.state.isRecording} isPaused=${this.state.isPaused}`);
    }

    if (!this.state.isRecording || this.state.isPaused) {
      return;
    }

    console.log(`[handleGlobalEvent] _source=${event._source} event_type=${event.event_type} extType=${extType}`);

    // 合并后的扩展鼠标事件（Python 已归一化 event_type）→ 走 recordGlobalEvent 进分类器
    if (event._source === 'extension' && (event.event_type === 'mouse_down' || event.event_type === 'mouse_up')) {
      console.log(`[handleGlobalEvent] → extension mouse event (${event.event_type}), routing to recordGlobalEvent`);
      await this.recordGlobalEvent(event);
      return;
    }

    // 原始扩展事件（contextmenu, input 等）→ 扩展处理路径
    if (event._source === 'extension') {
      console.log(`[handleGlobalEvent] → extension non-mouse event, routing to handleExtensionEvent`);
      await this.handleExtensionEvent(event as any);
      return;
    }

    // 过滤无意义的全局事件
    if (this.shouldIgnoreGlobalEvent(event)) {
      return;
    }

    // ── Drag merging: buffer drag_start, merge with drag_end ──
    if (event.event_type === 'mouse_drag_start') {
      this.pendingDragStart = { event, timestamp: Date.now() };
      return; // don't record yet, wait for drag_end
    }

    if (event.event_type === 'mouse_drag_end' && this.pendingDragStart) {
      const startEvt = this.pendingDragStart.event;
      this.pendingDragStart = null;

      // 拖拽确认：清除之前记录的 mouse_down（已被拖拽取代）
      this.removeLastMouseDown();
      this.gestureClassifier.reset();

      // Create merged drag event with both start and end coordinates
      const mergedEvent: GlobalInputEvent = {
        event_type: 'mouse_drag_end', // keep as drag_end for buildAction
        x: event.x,
        y: event.y,
        key: event.key,
        modifiers: event.modifiers,
        hwnd: event.hwnd,
        window_title: event.window_title,
        timestamp: Date.now(),
        scroll_dx: startEvt.x, // reuse scroll_dx for start_x
        scroll_dy: startEvt.y, // reuse scroll_dy for start_y
      };

      await this.recordGlobalEvent(mergedEvent, {
        start_x: startEvt.x,
        start_y: startEvt.y,
        end_x: event.x,
        end_y: event.y,
      });
      return;
    }

    // If we have a pending drag_start but received a non-drag_end event, flush it
    if (this.pendingDragStart) {
      const pending = this.pendingDragStart;
      this.pendingDragStart = null;
      await this.recordGlobalEvent(pending.event);
    }

    await this.recordGlobalEvent(event);
  }

  private buildExtElement(el: Record<string, any>): UnifiedElement | null {
    if (!el) return null;
    const bounds = el.bounds as { x: number; y: number; width: number; height: number } | undefined;
    return {
      identity: {
        role: (el.role as string) || (el.tag as string) || 'unknown',
        name: (el.name as string) || '',
      },
      location: {
        semanticPath: [],
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined,
        precisePath: el.selector || undefined,
      },
      raw: { platform: 'dom', data: el },
    };
  }

  /**
   * Record a single global event (after drag merging).
   * Also handles extension mouse events (mousedown/mouseup) that carry DOM element info.
   */
  private async recordGlobalEvent(event: GlobalInputEvent, dragCoords?: { start_x: number; start_y: number; end_x: number; end_y: number }): Promise<void> {
    // 右键 mouse_up 不单独记录（mouse_down 已在 buildAction 转为 right_click，只剩 mouse_up 需要拦截）
    const eType = event.event_type || (event as any).type;
    if ((event as any).button === 2 && (eType === 'mouse_up' || eType === 'mouseup')) {
      this.emit('event-loading-end');
      return;
    }

    // 在事件收到时立即记录时间戳（UIA 查询可能耗时很长，不能等它完成）
    const receivedAt = Date.now();

    // 通知 UI 开始加载（显示 loading）
    this.emit('event-loading', event);

    // 转换为语义化事件（recorder 模式跳过 UIA 查询，精准定位是 computeruse agent 的职责）
    const semanticEvent = await globalListener.toSemanticEvent(event, { skipUIA: true });
    // 用 Python 汇聚层的 _collected_at（同一时钟，差值 <10ms），不用原始时间戳（不同来源，差 100ms+）
    semanticEvent.timestamp = (event as any)._collected_at || receivedAt;

    console.log(`[recordGlobalEvent] _source=${(event as any)._source} action=${semanticEvent.action.type} platform=${semanticEvent.context.platform} hasElement=${!!semanticEvent.element}`);

    // ── 扩展（Web）事件：用 DOM 数据覆盖 UIA 查询结果 ──
    // 扩展自带的 element/url/viewport 信息比 UIA 更精确，
    // 且 platform='dom' 让 UI 能区分 web 点击和全局点击
    const rawExt = event as any;
    if (rawExt._source === 'extension') {
      console.log(`[recordGlobalEvent] → DOM override, extElement=${!!rawExt.element} url=${rawExt.url} globalXY=${rawExt.global_x},${rawExt.global_y}`);
      // 用扩展 DOM 元素信息替换 UIA 结果
      if (rawExt.element) {
        semanticEvent.element = this.buildExtElement(rawExt.element);
      }
      // 用扩展的页面信息设置上下文
      semanticEvent.context.platform = 'dom';
      if (rawExt.url) semanticEvent.context.pageUrl = rawExt.url;
      // 页面标题比 OS 窗口标题对 web 事件更有意义（如 "GitHub" vs "Google Chrome"）
      if (rawExt.title) semanticEvent.context.windowTitle = rawExt.title;

      // 坐标：优先用合并后的全局坐标（物理像素），否则用扩展的缩放计算
      if (rawExt.global_x != null && rawExt.global_y != null) {
        // Merged: 全局坐标作为 action target
        semanticEvent.action.target = { coordinate: { x: rawExt.global_x, y: rawExt.global_y } };
        if (rawExt.hwnd) semanticEvent.context.windowHwnd = rawExt.hwnd;
        // 窗口相对坐标
        const wx = (rawExt.window_x as number) ?? 0;
        const wy = (rawExt.window_y as number) ?? 0;
        const ww = (rawExt.window_width as number) ?? 0;
        const wh = (rawExt.window_height as number) ?? 0;
        if (ww > 0 && wh > 0) {
          semanticEvent.context.windowRect = { x: wx, y: wy, width: ww, height: wh };
          semanticEvent.context.relativeCoord = { x: rawExt.global_x - wx, y: rawExt.global_y - wy };
          semanticEvent.context.percentCoord = {
            x: Math.round(((rawExt.global_x - wx) / ww) * 10000) / 100,
            y: Math.round(((rawExt.global_y - wy) / wh) * 10000) / 100,
          };
        }
      } else {
        // Unmerged: 用扩展的 viewport + 缩放因子计算坐标
        const viewport = rawExt.viewport as { width: number; height: number; dpr: number } | undefined;
        if (viewport) {
          const dpr = viewport.dpr || 1;
          const cssW = (rawExt.screenWidth as number) || 0;
          const cssH = (rawExt.screenHeight as number) || 0;
          const physW = (rawExt.physicalWidth as number) || 0;
          const physH = (rawExt.physicalHeight as number) || 0;
          const sx = cssW > 0 && physW > 0 ? physW / (cssW - 1) : dpr;
          const sy = cssH > 0 && physH > 0 ? physH / (cssH - 1) : dpr;

          // action target 替换为物理屏幕坐标（toSemanticEvent 用的是视口坐标）
          if (rawExt.screenX != null && rawExt.screenY != null) {
            semanticEvent.action.target = {
              coordinate: {
                x: Math.round((rawExt.screenX as number) * sx),
                y: Math.round((rawExt.screenY as number) * sy),
              },
            };
          }

          if (rawExt.screenX != null && rawExt.screenY != null) {
            semanticEvent.context.windowRect = {
              x: Math.round(((rawExt.screenX as number) - ((rawExt.x as number) ?? 0)) * sx),
              y: Math.round(((rawExt.screenY as number) - ((rawExt.y as number) ?? 0)) * sy),
              width: Math.round(viewport.width * sx),
              height: Math.round(viewport.height * sy),
            };
          }
          if (rawExt.x != null && rawExt.y != null) {
            semanticEvent.context.relativeCoord = {
              x: Math.round((rawExt.x as number) * sx),
              y: Math.round((rawExt.y as number) * sy),
            };
            semanticEvent.context.percentCoord = {
              x: viewport.width > 0 ? Math.round(((rawExt.x as number) / viewport.width) * 10000) / 100 : 0,
              y: viewport.height > 0 ? Math.round(((rawExt.y as number) / viewport.height) * 10000) / 100 : 0,
            };
          }
        }
      }
    }

    // 剪贴板捕获：复制/粘贴时读取剪贴板内容
    try {
      const { captureClipboardIfNeeded } = await import('./clipboard-capture');
      const clipboardContent = await captureClipboardIfNeeded(event);
      if (clipboardContent) {
        semanticEvent.context.clipboardContent = clipboardContent;
      }
    } catch { /* ignore */ }

    // For merged drag events, override the action to include both coordinates
    if (dragCoords) {
      semanticEvent.action = {
        type: 'drag',
        target: {
          coordinate: { x: dragCoords.end_x, y: dragCoords.end_y },
        },
        params: {
          start_x: dragCoords.start_x,
          start_y: dragCoords.start_y,
          end_x: dragCoords.end_x,
          end_y: dragCoords.end_y,
          button: event.key || 'left',
        },
      };
    }

    // 检查是否超过最大事件数
    if (this.config.maxEvents && this.state.session!.events.length >= this.config.maxEvents) {
      this.stopRecording();
      return;
    }

    // 经过手势分类器处理（Python 层已做合并去重，前端不再重复处理）
    this.addProcessedEvent(semanticEvent);
    this.emit('event-loading-end');
  }

  /**
   * 是否应该忽略全局事件
   */
  private static MODIFIER_KEYS = new Set([
    'Shift', 'LShift', 'RShift', 'Ctrl', 'LCtrl', 'RCtrl',
    'Alt', 'LAlt', 'RAlt', 'Win', 'LWin', 'RWin',
  ]);

  private isModifierKey(key: string | undefined): boolean {
    return !!(key && UnifiedRecorder.MODIFIER_KEYS.has(key));
  }

  /** 拖拽确认后清除 session 中最新的 mouse_down（已被拖拽事件取代） */
  private removeLastMouseDown(): void {
    const session = this.state.session;
    if (!session) return;
    const events = session.events;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.action.type === 'mouse_down') {
        events.splice(i, 1);
        this.state.eventCount--;
        this.emit('event-remove', e.id);
        return;
      }
    }
  }

  private shouldIgnoreGlobalEvent(event: GlobalInputEvent): boolean {
    // 忽略浮窗自身的事件
    const floatWindow = document.querySelector('[data-tauri-drag-region]');
    if (floatWindow) {
      const rect = floatWindow.getBoundingClientRect();
      if (event.x >= rect.left && event.x <= rect.right &&
          event.y >= rect.top && event.y <= rect.bottom) {
        return true;
      }
    }

    // 修饰键集合（与 global-listener.ts 中 MODIFIER_KEY_SET 保持一致）
    // 右键 mouse_up 不单独记录（mouse_down 已在 buildAction 转为 right_click）
    if (event.event_type === 'mouse_up' && (event as any).button === 2) {
      return true;
    }

    const modifierKeys = new Set([
      'Shift', 'LShift', 'RShift',
      'Ctrl', 'LCtrl', 'RCtrl',
      'Alt', 'LAlt', 'RAlt',
      'Win', 'LWin', 'RWin',
    ]);
    const isModifier = !!(event.key && modifierKeys.has(event.key));

    // key_down: 记录时间戳，不忽略（包括修饰键 — 它们构成"按住修饰键→操作→释放"动作链的起点）
    if (event.event_type === 'key_down') {
      if (event.key) this.keyDownTimestamps.set(event.key, event.timestamp);
      return false;
    }

    // key_up: 短按（<500ms）丢弃，长按保留。修饰键和普通键统一处理。
    // 组成热键的修饰键 key_up 由主动合并在 addExternalEvent 中抑制。
    if (event.event_type === 'key_up') {
      const downTime = event.key ? this.keyDownTimestamps.get(event.key) : undefined;
      if (event.key) this.keyDownTimestamps.delete(event.key);
      if (!downTime || event.timestamp - downTime < 500) {
        return true; // 短按，忽略 key_up
      }
      return false; // 长按，保留 key_up
    }

    return false;
  }

  private handlePlatformEvent(event: PlatformEvent): void {
    if (!this.state.isRecording || this.state.isPaused) {
      return;
    }

    const adapter = this.adapters.get(event.platform);
    if (!adapter) {
      return;
    }

    // 转换为统一事件
    const unifiedEvent = adapter.toUnifiedEvent(event);

    // 检查是否超过最大事件数
    if (this.config.maxEvents && this.state.session!.events.length >= this.config.maxEvents) {
      this.stopRecording();
      return;
    }

    // 自动标记
    if (this.config.autoTag) {
      this.autoTagEvent(unifiedEvent);
    }

    // 添加到会话
    this.state.session!.events.push(unifiedEvent);
    this.state.currentEvent = unifiedEvent;
    this.state.eventCount++;

    // 通知回调
    this.emit('event', unifiedEvent);
    this.eventCallbacks.forEach(cb => cb(unifiedEvent));

  }

  private autoTagEvent(event: SemanticEvent): void {
    const tags: EventTag[] = [];

    // 根据动作类型自动标记
    if (event.action.type === 'copy') {
      tags.push('copy');
    } else if (event.action.type === 'paste' ||
               (event.action.type === 'hotkey' && event.action.params?.key === 'Ctrl+v')) {
      tags.push('paste');
    }

    // 根据元素结构自动标记
    if (event.element?.structure?.container) {
      const container = event.element.structure.container;

      if (container.role === 'table' || container.role === 'grid') {
        // 表格中的元素可能是数据源或目标
        if (event.action.type === 'click') {
          tags.push('variable');
        }
      }

      if (container.role === 'list') {
        // 列表中的元素可能是变量
        if (event.action.type === 'click') {
          tags.push('variable');
        }
      }
    }

    // 根据上下文自动标记
    if (event.context.windowTitle) {
      // 可以根据窗口标题判断是否是源或目标
    }

    if (tags.length > 0) {
      event.tags = tags;
    }
  }

  // ── 扩展事件处理（来自统一汇聚层）──

  /**
   * 处理扩展事件（从 event_collector 统一接口接收）
   */
  private async handleExtensionEvent(raw: Record<string, unknown>): Promise<void> {
    // 构建动作
    const action = this.buildExtensionAction(raw);
    if (!action) return;

    // 构建元素
    const element = this.buildExtensionElement(raw);

    const context: SemanticEvent['context'] = {
      windowTitle: (raw.title as string) || '',
      pageUrl: (raw.url as string) || '',
      platform: 'dom',
    };

    // 坐标上下文：优先用全局监听数据（已合并），否则用扩展数据 + 缩放
    if (raw.global_x != null && raw.global_y != null) {
      // 已合并：直接用全局的物理坐标和窗口信息
      const gx = raw.global_x as number;
      const gy = raw.global_y as number;
      context.windowHwnd = raw.hwnd as number;
      const wx = (raw.window_x as number) ?? 0;
      const wy = (raw.window_y as number) ?? 0;
      const ww = (raw.window_width as number) ?? 0;
      const wh = (raw.window_height as number) ?? 0;
      if (ww > 0 && wh > 0) {
        context.windowRect = { x: wx, y: wy, width: ww, height: wh };
        context.relativeCoord = { x: gx - wx, y: gy - wy };
        context.percentCoord = {
          x: Math.round(((gx - wx) / ww) * 10000) / 100,
          y: Math.round(((gy - wy) / wh) * 10000) / 100,
        };
      }
    } else {
      // 未合并：用扩展的视口数据 + 缩放因子
      const viewport = raw.viewport as { width: number; height: number; dpr: number } | undefined;
      if (viewport) {
        const dpr = viewport.dpr || 1;
        const cssW = (raw.screenWidth as number) || 0;
        const cssH = (raw.screenHeight as number) || 0;
        const physW = (raw.physicalWidth as number) || 0;
        const physH = (raw.physicalHeight as number) || 0;
        const sx = cssW > 0 && physW > 0 ? physW / (cssW - 1) : dpr;
        const sy = cssH > 0 && physH > 0 ? physH / (cssH - 1) : dpr;

        if (raw.screenX != null && raw.screenY != null) {
          context.windowRect = {
            x: Math.round(((raw.screenX as number) - ((raw.x as number) ?? 0)) * sx),
            y: Math.round(((raw.screenY as number) - ((raw.y as number) ?? 0)) * sy),
            width: Math.round(viewport.width * sx),
            height: Math.round(viewport.height * sy),
          };
        }
        if (raw.x != null && raw.y != null) {
          context.relativeCoord = {
            x: Math.round((raw.x as number) * sx),
            y: Math.round((raw.y as number) * sy),
          };
          context.percentCoord = {
            x: viewport.width > 0 ? Math.round(((raw.x as number) / viewport.width) * 10000) / 100 : 0,
            y: viewport.height > 0 ? Math.round(((raw.y as number) / viewport.height) * 10000) / 100 : 0,
          };
        }
      }
    }

    const event: SemanticEvent = {
      id: crypto.randomUUID(),
      timestamp: (raw.timestamp as number) || Date.now(),
      action,
      element,
      context,
    };

    // 经过手势分类器处理
    this.addProcessedEvent(event);
  }

  private buildExtensionAction(raw: Record<string, unknown>): UnifiedAction | null {
    const type = raw.event_type as string || raw.type as string;

    // 优先用全局监听的物理坐标（已合并），否则用扩展坐标 + 缩放
    let screenX: number;
    let screenY: number;
    if (raw.global_x != null && raw.global_y != null) {
      screenX = raw.global_x as number;
      screenY = raw.global_y as number;
    } else {
      const dpr = (raw.viewport as any)?.dpr || 1;
      const cssW = (raw.screenWidth as number) || 0;
      const cssH = (raw.screenHeight as number) || 0;
      const physW = (raw.physicalWidth as number) || 0;
      const physH = (raw.physicalHeight as number) || 0;
      const scaleX = cssW > 0 && physW > 0 ? physW / (cssW - 1) : dpr;
      const scaleY = cssH > 0 && physH > 0 ? physH / (cssH - 1) : dpr;
      screenX = raw.screenX != null ? Math.round((raw.screenX as number) * scaleX) : raw.x as number;
      screenY = raw.screenY != null ? Math.round((raw.screenY as number) * scaleY) : raw.y as number;
    }

    switch (type) {
      case 'contextmenu':
        return { type: 'right_click', target: { coordinate: { x: screenX, y: screenY } } };
      case 'input':
        return { type: 'type', params: { value: (raw.value as string) || '' } };
      default:
        return null;
    }
  }

  private buildExtensionElement(raw: Record<string, unknown>): UnifiedElement | null {
    const el = raw.element as Record<string, unknown> | undefined;
    if (!el) return null;

    const bounds = el.bounds as { x: number; y: number; width: number; height: number } | undefined;
    return {
      identity: {
        role: (el.role as string) || (el.tag as string) || 'unknown',
        name: (el.name as string) || '',
      },
      location: {
        semanticPath: [],
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined,
        precisePath: (el.selector as string) || undefined,
      },
      raw: { platform: 'dom', data: el as Record<string, unknown> },
    };
  }

  // ── 外部事件注入（Web 录制器）──

  /**
   * 添加外部事件到当前录制会话（由 Web 录制器调用）
   * 自动去重：基于动作类型 + 坐标接近度，移除重复的全局事件（DOM 信息更丰富）
   */
  /**
   * 添加事件，经过手势分类器处理
   */
  addProcessedEvent(event: SemanticEvent): void {
    console.log('[addProcessedEvent]', event.action.type, event.timestamp);

    // 无论事件是否被分类器消费（consumed），都更新时钟对。
    // consumed 事件（如被持有的 mouseup）同样携带最新的 _collected_at，
    // flushTimer 需要这个时间戳来正确推算当前 Python 时钟，否则会用过期时间
    // 过早 flushStale 导致双击被误判为单击。
    if (this.state.isRecording && this.state.session) {
      this.lastEventCollectedAt = event.timestamp;
      this.lastEventWallMs = Date.now();
    }

    const consumed = this.gestureClassifier.process(event);
    console.log('[addProcessedEvent] consumed=', consumed);
    if (!consumed) {
      this.addExternalEvent(event);
    }
    // consumed=true: 事件被分类器持有，等分类结果出来后通过回调 replace/remove/emit 处理
  }

  addExternalEvent(event: SemanticEvent): void {
    if (!this.state.isRecording || !this.state.session) {
      console.log(`[addExternalEvent] DROPPED — isRecording=${this.state.isRecording} hasSession=${!!this.state.session}`);
      return;
    }

    // 保留 Python _collected_at 时间戳，不覆写为墙钟。
    // 去重、合并、waitBefore 计算都依赖事件间的真实间隔，墙钟包含了不可控的
    // 异步/UIA 延迟，会导致热键合并 span 误判、去重窗口失效等问题。
    const pythonTimestamp = event.timestamp;
    const receivedAt = Date.now();

    // 记录时钟对应关系，用于 flush 定时器推算 Python 时间
    this.lastEventCollectedAt = pythonTimestamp;
    this.lastEventWallMs = receivedAt;

    console.log(`[addExternalEvent] action=${event.action.type} platform=${event.context.platform} elementRole=${event.element?.identity?.role || '-'} url=${event.context.pageUrl || '-'}`);
    if (event.action.type === 'mousedown' || event.action.type === 'mouseup') {
      console.trace(`[addExternalEvent] raw mouse event added`);
    }

    const session = this.state.session!;
    const events = session.events;

    // 去重：动作类型 + 时间窗口（不比较坐标，因为两个源坐标系不同）
    // DOM 事件信息更丰富，遇到重复的 global 事件时移除 global 保留 DOM
    const timeThreshold = 300; // ms - 时间窗口
    const scanLimit = Math.min(events.length, 10);
    for (let i = events.length - 1; i >= Math.max(0, events.length - scanLimit); i--) {
      const existing = events[i];

      if (existing.context.platform !== 'global') continue;
      if (existing.action.type !== event.action.type) continue;

      const timeDiff = Math.abs(existing.timestamp - event.timestamp);
      if (timeDiff > timeThreshold) continue;

      events.splice(i, 1);
      this.state.eventCount--;
      this.emit('event-remove', existing.id);
    }

    // ── 热键合并（主动模式）：hotkey 形成时追溯移除 modifier key_down ──
    // 旧模式等 key_up 到达再追溯，依赖三个事件连续 + span<500ms，异步/UIA 延迟极易失败。
    // 主动模式：hotkey 形成时立即移除前面的 modifier key_down，key_up 直接抑制。
    // 例：LCtrl↓ + v↓(→hotkey LCtrl+v) + LCtrl↑ → events 中仅有 hotkey LCtrl+v

    // 1. 记录 modifier key_down 用于后续 hotkey 追溯
    if (event.action.type === 'key_down' && this.isModifierKey(event.action.params?.key as string)) {
      const modKey = event.action.params?.key as string;
      this.pendingModifierDowns.set(modKey, event);
      this.consumedModifiers.delete(modKey);
    }

    // 2. hotkey 形成 → 追溯移除前面已记录的 modifier key_down
    if (event.action.type === 'hotkey') {
      const hotkeyStr = event.action.params?.key as string ?? '';
      for (const [modKey, modEvent] of this.pendingModifierDowns) {
        if (hotkeyStr.includes(modKey)) {
          const idx = events.findIndex(e => e.id === modEvent.id);
          if (idx !== -1) {
            events.splice(idx, 1);
            this.state.eventCount--;
            this.emit('event-remove', modEvent.id);
            console.log(`[addExternalEvent] hotkey="${hotkeyStr}" removed preceding modifier key_down="${modKey}"`);
          }
          this.pendingModifierDowns.delete(modKey);
          this.consumedModifiers.add(modKey);
        }
      }
    }

    // 3. modifier key_up → 已被 hotkey 消费的直接抑制
    if (event.action.type === 'key_up' && this.isModifierKey(event.action.params?.key as string)) {
      const modKey = event.action.params?.key as string;
      this.pendingModifierDowns.delete(modKey);
      if (this.consumedModifiers.has(modKey)) {
        this.consumedModifiers.delete(modKey);
        console.log(`[addExternalEvent] suppressing key_up="${modKey}" — already consumed by hotkey`);
        return;
      }
    }

    // 添加到会话
    session.events.push(event);
    this.state.currentEvent = event;
    this.state.eventCount++;

    // 通知回调
    this.emit('event', event);
    this.eventCallbacks.forEach(cb => cb(event));
  }

  // ── 事件标记 ──

  /**
   * 标记事件
   */
  tagEvent(eventId: string, tag: EventTag): void {
    if (!this.state.session) {
      return;
    }

    const event = this.state.session.events.find(e => e.id === eventId);
    if (event) {
      if (!event.tags) {
        event.tags = [];
      }
      if (!event.tags.includes(tag)) {
        event.tags.push(tag);
      }
      this.emit('tag', { eventId, tag });
    }
  }

  /**
   * 取消标记
   */
  untagEvent(eventId: string, tag: EventTag): void {
    if (!this.state.session) {
      return;
    }

    const event = this.state.session.events.find(e => e.id === eventId);
    if (event && event.tags) {
      event.tags = event.tags.filter(t => t !== tag);
      this.emit('tag', { eventId, tag, removed: true });
    }
  }

  /**
   * 清除事件的所有标记
   */
  clearEventTags(eventId: string): void {
    if (!this.state.session) {
      return;
    }

    const event = this.state.session.events.find(e => e.id === eventId);
    if (event) {
      event.tags = [];
    }
  }

  // ── 事件编辑 ──

  /**
   * 删除事件
   */
  deleteEvent(eventId: string): void {
    if (!this.state.session) {
      return;
    }

    const index = this.state.session.events.findIndex(e => e.id === eventId);
    if (index !== -1) {
      this.state.session.events.splice(index, 1);
      this.state.eventCount--;
      this.emit('undo', { eventId });
    }
  }

  /**
   * 撤销最后一个事件
   */
  undoLastEvent(): void {
    if (!this.state.session || this.state.session.events.length === 0) {
      return;
    }

    const event = this.state.session.events.pop()!;
    this.state.eventCount--;
    this.emit('undo', { eventId: event.id });
  }

  // ── 回调管理 ──

  /**
   * 注册回调
   */
  on(callback: RecordingCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * 注册事件回调
   */
  onEvent(callback: (event: SemanticEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * 注册事件移除回调
   */
  onEventRemove(callback: (eventId: string) => void): () => void {
    this.eventRemoveCallbacks.add(callback);
    return () => this.eventRemoveCallbacks.delete(callback);
  }

  /**
   * 注册录制器事件回调（用于 loading 等状态）
   */
  onRecorderEvent(callback: (type: RecordingEventType) => void): () => void {
    const wrappedCallback: RecordingCallback = (type) => callback(type);
    this.callbacks.add(wrappedCallback);
    return () => this.callbacks.delete(wrappedCallback);
  }

  private emit(type: RecordingEventType, data?: unknown): void {
    this.callbacks.forEach(cb => {
      try {
        cb(type, data);
      } catch { /* ignore */ }
    });

    // 处理事件移除通知
    if (type === 'event-remove' && typeof data === 'string') {
      this.eventRemoveCallbacks.forEach(cb => {
        try {
          cb(data);
        } catch { /* ignore */ }
      });
    }
  }

  // ── 状态查询 ──

  /**
   * 获取当前状态
   */
  getState(): RecordingState {
    return { ...this.state };
  }

  /**
   * 获取当前会话
   */
  getSession(): RecordingSession | null {
    return this.state.session;
  }

  /**
   * 是否正在录制
   */
  isRecording(): boolean {
    return this.state.isRecording;
  }

  /**
   * 是否已暂停
   */
  isPaused(): boolean {
    return this.state.isPaused;
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.state.eventCount;
  }

  /**
   * 获取录制时长
   */
  getDuration(): number {
    return this.state.duration;
  }

  /**
   * 获取可用的适配器
   */
  getAvailableAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  // ── 统计 ──

  private calculateStats(session: RecordingSession) {
    const events = session.events;
    const duration = (session.endTime || Date.now()) - session.startTime;

    // 统计动作类型
    const actionTypeCounts: Record<string, number> = {};
    for (const event of events) {
      const type = event.action.type;
      actionTypeCounts[type] = (actionTypeCounts[type] || 0) + 1;
    }

    // 统计标签
    const tagCounts: Record<string, number> = {};
    for (const event of events) {
      if (event.tags) {
        for (const tag of event.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    // 计算平均间隔
    let totalInterval = 0;
    for (let i = 1; i < events.length; i++) {
      totalInterval += events[i].timestamp - events[i - 1].timestamp;
    }
    const averageInterval = events.length > 1 ? totalInterval / (events.length - 1) : 0;

    return {
      totalEvents: events.length,
      actionTypeCounts,
      tagCounts,
      duration,
      averageInterval,
    };
  }
}

// 导出单例
export const unifiedRecorder = new UnifiedRecorder();
