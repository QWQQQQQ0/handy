/**
 * 统一录制器服务
 *
 * 功能：
 * 1. 整合多个平台适配器
 * 2. 录制用户操作并生成语义化事件
 * 3. 管理录制会话生命周期
 * 4. 支持事件标记和编辑
 *
 * 结构：
 *   index.ts               — UnifiedRecorder 主类 + 单例导出
 *   gesture-classifier.ts  — GestureClassifier (手势分类器)
 */

import type { PlatformAdapter, PlatformEvent } from '@/adapters/platform-adapter';
import { adapterRegistry } from '@/adapters/platform-adapter';
import type { SemanticEvent, EventTag } from '@/types/semantic-event';
import type { RecordingSession, RecordingConfig, RecordingState, RecordingCallback, RecordingEventType } from '@/types/recording-session';
import type { UnifiedElement } from '@/types/unified-element';
import type { UnifiedAction } from '@/types/unified-action';
import { globalListener, type GlobalInputEvent } from '../global-listener';
import { GestureClassifier } from './gesture-classifier';

const DBLCLICK_WINDOW_MS = 400;

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
  private lastEventCollectedAt = 0;
  private lastEventWallMs = 0;

  // ── 配置 ──
  private config: RecordingConfig = {
    captureScreenshot: false,
    captureContext: true,
    autoTag: true,
    maxEvents: 1000,
    timeout: 0,
  };

  // ── 修饰键工具 ──
  private static MODIFIER_KEYS = new Set([
    'Shift', 'LShift', 'RShift', 'Ctrl', 'LCtrl', 'RCtrl',
    'Alt', 'LAlt', 'RAlt', 'Win', 'LWin', 'RWin',
  ]);

  private isModifierKey(key: string | undefined): boolean {
    return !!(key && UnifiedRecorder.MODIFIER_KEYS.has(key));
  }

  // ── 生命周期 ──

  async initialize(): Promise<void> {
    const availableAdapters = await adapterRegistry.getAvailableAdapters();
    for (const adapter of availableAdapters) {
      this.adapters.set(adapter.platform, adapter);
    }
    import('../clipboard-capture').catch(() => {});
  }

  async startRecording(config?: RecordingConfig): Promise<RecordingSession> {
    if (this.state.isRecording) throw new Error('Already recording');

    this.config = { ...this.config, ...config };

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

    this.gestureClassifier.reset();
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
          console.log('[UnifiedRecorder] onReplace: old event not in session, pushing new event');
          events.push(newEvt);
          this.state.eventCount++;
        }
        this.emit('event-remove', oldEvt.id);
        this.emit('event', newEvt);
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
      const { desktopService } = await import('../desktop-service');
      await desktopService.extSetCapture(true);
      await desktopService.extGetRecordedEvents();
      console.log('[startRecording] extension capture enabled');
    } catch (e) {
      console.warn('[startRecording] extension NOT connected — web events will be missing:', e);
    }

    // 启动全局监听器
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

    this.state = {
      isRecording: true,
      isPaused: false,
      session,
      currentEvent: null,
      eventCount: 0,
      duration: 0,
    };
    this.startTime = Date.now();

    this.durationTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused) {
        this.state.duration = Date.now() - this.startTime;
        this.emit('event', { type: 'tick', duration: this.state.duration });
      }
    }, 1000);

    this.flushTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused && this.lastEventCollectedAt > 0) {
        const estimatedPythonTs = this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs);
        this.gestureClassifier.flushStale(estimatedPythonTs);
      }
    }, DBLCLICK_WINDOW_MS + 50);

    this.emit('start', session);
    return session;
  }

  async stopRecording(): Promise<RecordingSession> {
    if (!this.state.isRecording) throw new Error('Not recording');

    // 停止事件汇聚层
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_stop');
    } catch { /* ignore */ }

    // 禁用扩展事件捕获
    try {
      const { desktopService } = await import('../desktop-service');
      await desktopService.extSetCapture(false);
    } catch { /* extension not connected */ }

    // 停止全局监听器
    if (this.globalListenerUnsubscribe) {
      this.globalListenerUnsubscribe();
      this.globalListenerUnsubscribe = null;
    }
    this.pendingDragStart = null;
    try { await globalListener.stop(); } catch { /* ignore */ }

    // 停止适配器
    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) {
        try { await adapter.stopListening(); } catch { /* ignore */ }
      }
    }
    this.activeAdapters.clear();

    // 停止计时器
    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }

    // 结算手势分类器
    const estimatedTs = this.lastEventCollectedAt > 0
      ? this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs)
      : Date.now();
    this.gestureClassifier.flushStale(estimatedTs);

    const session = this.state.session!;
    session.endTime = Date.now();
    session.status = 'completed';
    session.metadata.stats = this.calculateStats(session);

    // [DEBUG]
    console.log('[UnifiedRecorder] stopRecording — session.events (%d):', session.events.length);
    session.events.forEach((e, i) => {
      const coord = e.action.target?.coordinate;
      const c = coord ? `(${coord.x}, ${coord.y})` : '';
      console.log(`  %d. %s %s — %s`, i + 1, e.action.type, c, e.context?.windowTitle || '');
    });

    this.state = {
      isRecording: false, isPaused: false, session: null,
      currentEvent: null, eventCount: 0, duration: 0,
    };

    this.emit('stop', session);
    return session;
  }

  async pauseRecording(): Promise<void> {
    if (!this.state.isRecording || this.state.isPaused) return;

    this.state.isPaused = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_stop');
    } catch { /* ignore */ }

    if (this.globalListenerUnsubscribe) {
      this.globalListenerUnsubscribe();
      this.globalListenerUnsubscribe = null;
    }
    this.pendingDragStart = null;
    try { await globalListener.stop(); } catch { /* ignore */ }

    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) adapter.stopListening();
    }

    this.gestureClassifier.flushStale(Date.now());
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }

    this.emit('pause');
  }

  async resumeRecording(): Promise<void> {
    if (!this.state.isRecording || !this.state.isPaused) return;

    this.state.isPaused = false;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('event_collector_start');
    } catch { /* ignore */ }

    try {
      await globalListener.start();
      this.globalListenerUnsubscribe = globalListener.onEvent(this.handleGlobalEvent.bind(this));
    } catch { /* ignore */ }

    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) adapter.startListening(this.handlePlatformEvent.bind(this));
    }

    this.flushTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.isPaused && this.lastEventCollectedAt > 0) {
        const estimatedPythonTs = this.lastEventCollectedAt + (Date.now() - this.lastEventWallMs);
        this.gestureClassifier.flushStale(estimatedPythonTs);
      }
    }, DBLCLICK_WINDOW_MS + 50);

    this.emit('resume');
  }

  async cancelRecording(): Promise<void> {
    if (!this.state.isRecording) return;

    for (const platform of this.activeAdapters) {
      const adapter = this.adapters.get(platform);
      if (adapter) await adapter.stopListening();
    }
    this.activeAdapters.clear();
    this.pendingDragStart = null;
    this.gestureClassifier.reset();

    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }

    const session = this.state.session;
    if (session) session.status = 'cancelled';

    this.state = {
      isRecording: false, isPaused: false, session: null,
      currentEvent: null, eventCount: 0, duration: 0,
    };

    this.emit('stop', session);
  }

  // ── 事件处理 ──

  private async handleGlobalEvent(event: GlobalInputEvent & { _source?: string; _ext?: any }): Promise<void> {
    const extType = (event as any).type;
    if ((event as any)._source === 'extension') {
      console.log(`[handleGlobalEvent] EXT event arrived: type=${extType} isRecording=${this.state.isRecording} isPaused=${this.state.isPaused}`);
    }
    if (!this.state.isRecording || this.state.isPaused) return;

    console.log(`[handleGlobalEvent] _source=${event._source} event_type=${event.event_type} extType=${extType}`);

    // 合并后的扩展鼠标事件 → 走 recordGlobalEvent 进分类器
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

    if (this.shouldIgnoreGlobalEvent(event)) return;

    // ── Drag merging ──
    if (event.event_type === 'mouse_drag_start') {
      this.pendingDragStart = { event, timestamp: Date.now() };
      return;
    }

    if (event.event_type === 'mouse_drag_end' && this.pendingDragStart) {
      const startEvt = this.pendingDragStart.event;
      this.pendingDragStart = null;

      this.removeLastMouseDown();
      this.gestureClassifier.reset();

      const mergedEvent: GlobalInputEvent = {
        event_type: 'mouse_drag_end',
        x: event.x,
        y: event.y,
        key: event.key,
        modifiers: event.modifiers,
        hwnd: event.hwnd,
        window_title: event.window_title,
        timestamp: Date.now(),
        scroll_dx: startEvt.x,
        scroll_dy: startEvt.y,
      };

      await this.recordGlobalEvent(mergedEvent, {
        start_x: startEvt.x,
        start_y: startEvt.y,
        end_x: event.x,
        end_y: event.y,
      });
      return;
    }

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

  private async recordGlobalEvent(
    event: GlobalInputEvent,
    dragCoords?: { start_x: number; start_y: number; end_x: number; end_y: number },
  ): Promise<void> {
    const eType = event.event_type || (event as any).type;
    if ((event as any).button === 2 && (eType === 'mouse_up' || eType === 'mouseup')) {
      this.emit('event-loading-end');
      return;
    }

    const receivedAt = Date.now();
    this.emit('event-loading', event);

    const semanticEvent = await globalListener.toSemanticEvent(event, { skipUIA: true });
    semanticEvent.timestamp = (event as any)._collected_at || receivedAt;

    console.log(`[recordGlobalEvent] _source=${(event as any)._source} action=${semanticEvent.action.type} platform=${semanticEvent.context.platform} hasElement=${!!semanticEvent.element}`);

    // ── 扩展（Web）事件：用 DOM 数据覆盖 UIA 查询结果 ──
    const rawExt = event as any;
    if (rawExt._source === 'extension') {
      console.log(`[recordGlobalEvent] → DOM override, extElement=${!!rawExt.element} url=${rawExt.url} globalXY=${rawExt.global_x},${rawExt.global_y}`);
      if (rawExt.element) {
        semanticEvent.element = this.buildExtElement(rawExt.element);
      }
      semanticEvent.context.platform = 'dom';
      if (rawExt.url) semanticEvent.context.pageUrl = rawExt.url;
      if (rawExt.title) semanticEvent.context.windowTitle = rawExt.title;

      if (rawExt.global_x != null && rawExt.global_y != null) {
        semanticEvent.action.target = { coordinate: { x: rawExt.global_x, y: rawExt.global_y } };
        if (rawExt.hwnd) semanticEvent.context.windowHwnd = rawExt.hwnd;
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
        const viewport = rawExt.viewport as { width: number; height: number; dpr: number } | undefined;
        if (viewport) {
          const dpr = viewport.dpr || 1;
          const cssW = (rawExt.screenWidth as number) || 0;
          const cssH = (rawExt.screenHeight as number) || 0;
          const physW = (rawExt.physicalWidth as number) || 0;
          const physH = (rawExt.physicalHeight as number) || 0;
          const sx = cssW > 0 && physW > 0 ? physW / (cssW - 1) : dpr;
          const sy = cssH > 0 && physH > 0 ? physH / (cssH - 1) : dpr;

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

    // 剪贴板捕获
    try {
      const { captureClipboardIfNeeded } = await import('../clipboard-capture');
      const clipboardContent = await captureClipboardIfNeeded(event);
      if (clipboardContent) {
        semanticEvent.context.clipboardContent = clipboardContent;
      }
    } catch { /* ignore */ }

    if (dragCoords) {
      semanticEvent.action = {
        type: 'drag',
        target: { coordinate: { x: dragCoords.end_x, y: dragCoords.end_y } },
        params: {
          start_x: dragCoords.start_x,
          start_y: dragCoords.start_y,
          end_x: dragCoords.end_x,
          end_y: dragCoords.end_y,
          button: event.key || 'left',
        },
      };
    }

    if (this.config.maxEvents && this.state.session!.events.length >= this.config.maxEvents) {
      this.stopRecording();
      return;
    }

    this.addProcessedEvent(semanticEvent);
    this.emit('event-loading-end');
  }

  private shouldIgnoreGlobalEvent(event: GlobalInputEvent): boolean {
    const floatWindow = document.querySelector('[data-tauri-drag-region]');
    if (floatWindow) {
      const rect = floatWindow.getBoundingClientRect();
      if (event.x >= rect.left && event.x <= rect.right &&
          event.y >= rect.top && event.y <= rect.bottom) {
        return true;
      }
    }

    if (event.event_type === 'mouse_up' && (event as any).button === 2) {
      return true;
    }

    const modifierKeys = new Set([
      'Shift', 'LShift', 'RShift', 'Ctrl', 'LCtrl', 'RCtrl',
      'Alt', 'LAlt', 'RAlt', 'Win', 'LWin', 'RWin',
    ]);

    if (event.event_type === 'key_down') {
      if (event.key) this.keyDownTimestamps.set(event.key, event.timestamp);
      return false;
    }

    if (event.event_type === 'key_up') {
      const downTime = event.key ? this.keyDownTimestamps.get(event.key) : undefined;
      if (event.key) this.keyDownTimestamps.delete(event.key);
      if (!downTime || event.timestamp - downTime < 500) return true;
      return false;
    }

    return false;
  }

  private handlePlatformEvent(event: PlatformEvent): void {
    if (!this.state.isRecording || this.state.isPaused) return;

    const adapter = this.adapters.get(event.platform);
    if (!adapter) return;

    const unifiedEvent = adapter.toUnifiedEvent(event);

    if (this.config.maxEvents && this.state.session!.events.length >= this.config.maxEvents) {
      this.stopRecording();
      return;
    }

    if (this.config.autoTag) {
      this.autoTagEvent(unifiedEvent);
    }

    this.state.session!.events.push(unifiedEvent);
    this.state.currentEvent = unifiedEvent;
    this.state.eventCount++;

    this.emit('event', unifiedEvent);
    this.eventCallbacks.forEach(cb => cb(unifiedEvent));
  }

  private autoTagEvent(event: SemanticEvent): void {
    const tags: EventTag[] = [];

    if (event.action.type === 'copy') {
      tags.push('copy');
    } else if (event.action.type === 'paste' ||
               (event.action.type === 'hotkey' && event.action.params?.key === 'Ctrl+v')) {
      tags.push('paste');
    }

    if (event.element?.structure?.container) {
      const container = event.element.structure.container;
      if (container.role === 'table' || container.role === 'grid') {
        if (event.action.type === 'click') tags.push('variable');
      }
      if (container.role === 'list') {
        if (event.action.type === 'click') tags.push('variable');
      }
    }

    if (tags.length > 0) event.tags = tags;
  }

  // ── 扩展事件处理 ──

  private async handleExtensionEvent(raw: Record<string, unknown>): Promise<void> {
    const action = this.buildExtensionAction(raw);
    if (!action) return;

    const element = this.buildExtensionElement(raw);

    const context: SemanticEvent['context'] = {
      windowTitle: (raw.title as string) || '',
      pageUrl: (raw.url as string) || '',
      platform: 'dom',
    };

    if (raw.global_x != null && raw.global_y != null) {
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

    this.addProcessedEvent(event);
  }

  private buildExtensionAction(raw: Record<string, unknown>): UnifiedAction | null {
    const type = raw.event_type as string || raw.type as string;

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

  // ── 外部事件注入 ──

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

  /**
   * 添加事件，经过手势分类器处理
   */
  addProcessedEvent(event: SemanticEvent): void {
    console.log('[addProcessedEvent]', event.action.type, event.timestamp);

    if (this.state.isRecording && this.state.session) {
      this.lastEventCollectedAt = event.timestamp;
      this.lastEventWallMs = Date.now();
    }

    const consumed = this.gestureClassifier.process(event);
    console.log('[addProcessedEvent] consumed=', consumed);
    if (!consumed) {
      this.addExternalEvent(event);
    }
  }

  addExternalEvent(event: SemanticEvent): void {
    if (!this.state.isRecording || !this.state.session) {
      console.log(`[addExternalEvent] DROPPED — isRecording=${this.state.isRecording} hasSession=${!!this.state.session}`);
      return;
    }

    const pythonTimestamp = event.timestamp;
    const receivedAt = Date.now();

    this.lastEventCollectedAt = pythonTimestamp;
    this.lastEventWallMs = receivedAt;

    console.log(`[addExternalEvent] action=${event.action.type} platform=${event.context.platform} elementRole=${event.element?.identity?.role || '-'} url=${event.context.pageUrl || '-'}`);
    if (event.action.type === 'mousedown' || event.action.type === 'mouseup') {
      console.trace(`[addExternalEvent] raw mouse event added`);
    }

    const session = this.state.session!;
    const events = session.events;

    // 去重：动作类型 + 时间窗口（不比较坐标，因为两个源坐标系不同）
    const timeThreshold = 300;
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

    // ── 热键合并（主动模式）──
    if (event.action.type === 'key_down' && this.isModifierKey(event.action.params?.key as string)) {
      const modKey = event.action.params?.key as string;
      this.pendingModifierDowns.set(modKey, event);
      this.consumedModifiers.delete(modKey);
    }

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

    if (event.action.type === 'key_up' && this.isModifierKey(event.action.params?.key as string)) {
      const modKey = event.action.params?.key as string;
      this.pendingModifierDowns.delete(modKey);
      if (this.consumedModifiers.has(modKey)) {
        this.consumedModifiers.delete(modKey);
        console.log(`[addExternalEvent] suppressing key_up="${modKey}" — already consumed by hotkey`);
        return;
      }
    }

    events.push(event);
    this.state.currentEvent = event;
    this.state.eventCount++;

    this.emit('event', event);
    this.eventCallbacks.forEach(cb => cb(event));
  }

  // ── 事件标记 ──

  tagEvent(eventId: string, tag: EventTag): void {
    if (!this.state.session) return;

    const event = this.state.session.events.find(e => e.id === eventId);
    if (event) {
      if (!event.tags) event.tags = [];
      if (!event.tags.includes(tag)) event.tags.push(tag);
      this.emit('tag', { eventId, tag });
    }
  }

  untagEvent(eventId: string, tag: EventTag): void {
    if (!this.state.session) return;

    const event = this.state.session.events.find(e => e.id === eventId);
    if (event && event.tags) {
      event.tags = event.tags.filter(t => t !== tag);
      this.emit('tag', { eventId, tag, removed: true });
    }
  }

  clearEventTags(eventId: string): void {
    if (!this.state.session) return;
    const event = this.state.session.events.find(e => e.id === eventId);
    if (event) event.tags = [];
  }

  // ── 事件编辑 ──

  deleteEvent(eventId: string): void {
    if (!this.state.session) return;

    const index = this.state.session.events.findIndex(e => e.id === eventId);
    if (index !== -1) {
      this.state.session.events.splice(index, 1);
      this.state.eventCount--;
      this.emit('undo', { eventId });
    }
  }

  undoLastEvent(): void {
    if (!this.state.session || this.state.session.events.length === 0) return;

    const event = this.state.session.events.pop()!;
    this.state.eventCount--;
    this.emit('undo', { eventId: event.id });
  }

  // ── 回调管理 ──

  on(callback: RecordingCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  onEvent(callback: (event: SemanticEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  onEventRemove(callback: (eventId: string) => void): () => void {
    this.eventRemoveCallbacks.add(callback);
    return () => this.eventRemoveCallbacks.delete(callback);
  }

  onRecorderEvent(callback: (type: RecordingEventType) => void): () => void {
    const wrappedCallback: RecordingCallback = (type) => callback(type);
    this.callbacks.add(wrappedCallback);
    return () => this.callbacks.delete(wrappedCallback);
  }

  private emit(type: RecordingEventType, data?: unknown): void {
    this.callbacks.forEach(cb => {
      try { cb(type, data); } catch { /* ignore */ }
    });

    if (type === 'event-remove' && typeof data === 'string') {
      this.eventRemoveCallbacks.forEach(cb => {
        try { cb(data); } catch { /* ignore */ }
      });
    }
  }

  // ── 状态查询 ──

  getState(): RecordingState { return { ...this.state }; }
  getSession(): RecordingSession | null { return this.state.session; }
  isRecording(): boolean { return this.state.isRecording; }
  isPaused(): boolean { return this.state.isPaused; }
  getEventCount(): number { return this.state.eventCount; }
  getDuration(): number { return this.state.duration; }
  getAvailableAdapters(): string[] { return Array.from(this.adapters.keys()); }

  // ── 统计 ──

  private calculateStats(session: RecordingSession) {
    const events = session.events;
    const duration = (session.endTime || Date.now()) - session.startTime;

    const actionTypeCounts: Record<string, number> = {};
    for (const event of events) {
      const type = event.action.type;
      actionTypeCounts[type] = (actionTypeCounts[type] || 0) + 1;
    }

    const tagCounts: Record<string, number> = {};
    for (const event of events) {
      if (event.tags) {
        for (const tag of event.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    let totalInterval = 0;
    for (let i = 1; i < events.length; i++) {
      totalInterval += events[i].timestamp - events[i - 1].timestamp;
    }
    const averageInterval = events.length > 1 ? totalInterval / (events.length - 1) : 0;

    return { totalEvents: events.length, actionTypeCounts, tagCounts, duration, averageInterval };
  }
}

// 导出单例
export const unifiedRecorder = new UnifiedRecorder();
