import { useState, useRef, useCallback, useEffect } from 'react';
import { GripHorizontal, X, Minus, MessageSquare, Wrench, Clock, Circle, BookOpen, Cpu, Link, ImageIcon, Trash2, Sparkles, Settings, Globe, LoaderCircle } from 'lucide-react';
import { ToolMode } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getBuiltinSkill, getBuiltinExecutor, initBuiltinExecutor } from '@/skills/builtin-executor';
import { watcherManager } from '@/services/watcher';
import type { LearningProgress } from '@/types/cache';
import * as capabilityLearner from '@/services/capability-learner';
import { RecorderMode } from '@/components/recorder';
import { readLocal, writeLocal, readToolGroups, writeToolGroups } from './utils';
import type { FloatMode, ToolGroup } from './types';
import ChatMode, { type ChatModeHandle } from './chat-mode';
import TaskMode from './task-mode';
import WatcherMode from './watcher-mode';
import LearnMode from './learn-mode';

// 初始化全局状态管理器（浮窗也需要，因为是独立的 JS 上下文）
import { globalState } from '@/services/global-state';

export default function FloatPage() {
  // ── 主题支持 ──
  const themeMode = useSettingsStore((s) => s.themeMode);

  useEffect(() => {
    const root = document.documentElement;

    if (themeMode === 'dark') {
      root.classList.add('dark');
    } else if (themeMode === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        if (mq.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [themeMode]);

  // ── Shared state ──
  const [mode, setMode] = useState<FloatMode>(() => readLocal('float_mode', 'chat'));
  const [sendToModel, setSendToModel] = useState(() => readLocal('float_send_to_model', true));
  const [allowImagePaste, setAllowImagePaste] = useState(() => readLocal('float_allow_image_paste', true));
  const [noSystemPrompt, setNoSystemPrompt] = useState(() => readLocal('float_no_system_prompt', false));
  const chatModeRef = useRef<ChatModeHandle>(null);

  const persistMode = useCallback((v: FloatMode) => { setMode(v); writeLocal('float_mode', v); }, []);
  const persistSendToModel = useCallback((v: boolean) => { setSendToModel(v); writeLocal('float_send_to_model', v); }, []);
  const persistAllowImagePaste = useCallback((v: boolean) => { setAllowImagePaste(v); writeLocal('float_allow_image_paste', v); }, []);
  const persistNoSystemPrompt = useCallback((v: boolean) => { setNoSystemPrompt(v); writeLocal('float_no_system_prompt', v); }, []);

  // ── Tool mode (shared between Task and Watcher) ──
  const [toolMode, setToolMode] = useState<ToolMode>(() => readLocal('float_tool_mode', ToolMode.basic));
  const [customTools, setCustomTools] = useState<Set<string>>(() => new Set(readLocal<string[]>('float_custom_tools', [])));
  const [groups, setGroups] = useState<ToolGroup[]>(() => readToolGroups());
  const [executorReady, setExecutorReady] = useState(false);
  const allTools = executorReady ? getBuiltinExecutor().allTools : [];

  const handleToolModeChange = useCallback((m: ToolMode) => {
    setToolMode(m);
    writeLocal('float_tool_mode', m);
  }, []);

  const handleCustomToolsChange = useCallback((tools: Set<string>) => {
    setCustomTools(tools);
    writeLocal('float_custom_tools', [...tools]);
  }, []);

  const handleSaveGroup = useCallback((name: string) => {
    const newGroup: ToolGroup = {
      id: crypto.randomUUID(),
      name,
      tools: [...customTools],
      createdAt: new Date().toISOString(),
    };
    const updated = [...groups, newGroup];
    setGroups(updated);
    writeToolGroups(updated);
  }, [customTools, groups]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    const updated = groups.filter(g => g.id !== groupId);
    setGroups(updated);
    writeToolGroups(updated);
  }, [groups]);

  const handleGroupSelect = useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      setCustomTools(new Set(group.tools));
      writeLocal('float_custom_tools', [...group.tools]);
      setToolMode(ToolMode.custom);
      writeLocal('float_tool_mode', ToolMode.custom);
    }
  }, [groups]);

  // ── State from child components ──
  const [isAutomating, setIsAutomating] = useState(false);
  const [learningProgress, setLearningProgress] = useState<LearningProgress>({
    status: 'idle', session: null, totalDiscovered: 0, lastInteraction: null,
  });

  // ── Minimized state ──
  const [isMinimized, setIsMinimized] = useState(false);

  // ── Browser launch state ──
  const [browserLaunching, setBrowserLaunching] = useState(false);
  const [browserLaunched, setBrowserLaunched] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);

  const handleLaunchBrowser = useCallback(async () => {
    if (browserLaunching) return;
    setBrowserLaunching(true);
    try {
      const { desktopService } = await import('@/services/desktop-service');
      await desktopService.webPwLaunchBrowser('msedge');
      setBrowserLaunched(true);
    } catch (e) {
      console.error('[float] browser launch failed:', e);
    } finally {
      setBrowserLaunching(false);
    }
  }, [browserLaunching]);

  // Poll extension connection status
  useEffect(() => {
    let mounted = true;
    const checkExtension = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ connected: boolean; url?: string }>('get_extension_status');
        if (mounted) setExtensionConnected(result.connected);
      } catch { /* ignore */ }
    };
    // Check immediately, then every 5 seconds
    checkExtension();
    const interval = setInterval(checkExtension, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ── Settings popover ──
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  // ── Mount effects ──
  useEffect(() => { useSettingsStore.getState().load(); watcherManager.restore().catch(() => {}); watcherManager.initSync().catch(() => {}); }, []);

  // 检测窗口是否卡在缩小状态（React 状态丢失但 Tauri 窗口仍为 tiny size），自动恢复
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        const size = await win.innerSize();
        const scale = await win.scaleFactor();
        const logicalH = Math.round(size.height / (scale || 1));
        // 高度小于 100px = 窗口卡在缩小状态，需要恢复
        if (logicalH < 100 && !cancelled) {
          console.log(`[float] 检测到窗口卡在缩小状态 (${logicalH}px)，自动恢复`);
          setIsMinimized(false);
          const prev = readLocal<{ width: number; height: number }>('float_prev_size', { width: 360, height: 480 });
          const { LogicalSize } = await import('@tauri-apps/api/dpi');
          const w = Math.max(280, Math.min(prev.width, 600));
          const h = Math.max(320, Math.min(prev.height, 800));
          await win.setMinSize(new LogicalSize(200, 200));
          await win.setMaxSize(new LogicalSize(2000, 2000));
          await win.setSize(new LogicalSize(w, h));
          await win.setResizable(true);
        }
      } catch { /* 非 Tauri 环境 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    (async () => {
      const { useSkillStore } = await import('@/stores/skill-store');
      await useSkillStore.getState().initializeSkills();
      const configs = useSkillStore.getState().allConfigs;
      if (configs.length > 0) {
        await initBuiltinExecutor(configs);
        setExecutorReady(true);
      }
    })();
  }, []);

  // Listen for automation-goal from main window
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        unlisten = await getCurrentWebviewWindow().listen<{ goal: string }>('automation-goal', (event) => {
          persistMode('task');
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { unlisten?.(); };
  }, [persistMode]);

  // ── Refresh watcher configs (exposed to TaskMode) ──
  const refreshWatcherConfigs = useCallback(async () => {
    // WatcherMode manages its own state; this is a no-op placeholder
    // TaskMode calls this after scheduling a task to trigger watcher refresh
  }, []);

  // ── Window controls ──
  const handleClose = useCallback(async () => {
    if (learningProgress.status !== 'idle') {
      await capabilityLearner.stopLearning();
    }
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().close();
  }, [learningProgress.status]);

  const handleMinimize = useCallback(async () => {
    setIsMinimized(true);
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = getCurrentWebviewWindow();
      const size = await win.outerSize();
      const scale = await win.scaleFactor();
      const logicalW = Math.round(size.width / (scale || 1));
      const logicalH = Math.round(size.height / (scale || 1));
      writeLocal('float_prev_size', { width: logicalW, height: logicalH });
      await win.setMinSize(new LogicalSize(260, 40));
      await win.setMaxSize(new LogicalSize(800, 60));
      await win.setSize(new LogicalSize(260, 40));
      await win.setResizable(false);
    } catch { /* ignore */ }
  }, []);

  const handleRestore = useCallback(async () => {
    setIsMinimized(false);
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = getCurrentWebviewWindow();
      const prev = readLocal<{ width: number; height: number }>('float_prev_size', { width: 360, height: 480 });
      // 限制恢复尺寸在合理范围内，防止异常放大
      const w = Math.max(280, Math.min(prev.width, 600));
      const h = Math.max(320, Math.min(prev.height, 800));
      await win.setMinSize(new LogicalSize(200, 200));
      await win.setMaxSize(new LogicalSize(2000, 2000));
      await win.setSize(new LogicalSize(w, h));
      await win.setResizable(true);
    } catch { /* ignore */ }
  }, []);

  // ── Minimized status text ──
  const getMinimizedStatusText = useCallback((): string => {
    if (learningProgress.status === 'learning' || learningProgress.status === 'paused') {
      return `学习中 ${learningProgress.totalDiscovered}个能力`;
    }
    if (isAutomating) return '执行任务中...';
    return '';
  }, [learningProgress, isAutomating]);

  // ── Render ──
  // Use CSS 'hidden' instead of conditional rendering to keep children mounted and preserve state on minimize
  return (
    <div className="relative flex flex-col h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      {/* Minimized status bar - absolutely positioned, overlays on top when minimized */}
      {isMinimized && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 cursor-pointer"
          onClick={handleRestore}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {(learningProgress.status === 'learning' || learningProgress.status === 'paused') && (
            <div className={`w-2 h-2 rounded-full ${
              learningProgress.status === 'learning' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
            }`} />
          )}
          {isAutomating && (
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400">{getMinimizedStatusText() || 'Handy'}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setIsMinimized(false); }}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
          >
            <Sparkles size={10} />
          </button>
        </div>
      )}

      {/* Main content - stays mounted, hidden via CSS when minimized */}
      <div className={isMinimized ? 'hidden' : 'contents'}>
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-zinc-400" />
          <span className="text-[12px] font-semibold text-zinc-600 dark:text-zinc-400">Handy</span>
          {(learningProgress.status === 'learning' || learningProgress.status === 'paused') && (
            <div className={`w-2 h-2 rounded-full ${
              learningProgress.status === 'learning' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
            }`} />
          )}
          {isAutomating && (
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={handleMinimize} title="Minimize" className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 transition-colors">
            <Minus size={16} strokeWidth={2.5} />
          </button>
          <button onClick={handleClose} title="Close" className="p-1.5 rounded hover:bg-red-500 hover:text-white text-zinc-500 transition-colors">
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Mode tabs + toggles */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0 gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5 shrink-0">
          {([
            { key: 'chat' as const, icon: <MessageSquare size={12} />, tip: 'Chat' },
            { key: 'task' as const, icon: <Wrench size={12} />, tip: 'Task' },
            { key: 'watcher' as const, icon: <Clock size={12} />, tip: '后台任务' },
            { key: 'recorder' as const, icon: <Circle size={12} />, tip: 'Recorder' },
            { key: 'learn' as const, icon: <BookOpen size={12} />, tip: 'Learn' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => persistMode(tab.key)}
              title={tab.tip}
              className={`p-1.5 rounded-md transition-colors ${
                mode === tab.key ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {tab.icon}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {mode === 'chat' && (
            <button
              onClick={() => chatModeRef.current?.clearMessages()}
              className="p-1 rounded text-zinc-400 hover:text-red-500 transition-colors"
              title="Clear context"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={() => persistNoSystemPrompt(!noSystemPrompt)}
            className={`p-1 rounded transition-colors ${noSystemPrompt ? 'text-zinc-400 hover:text-zinc-500' : 'text-blue-500 hover:text-blue-400'}`}
            title={noSystemPrompt ? 'System Prompt: OFF' : 'System Prompt: ON'}
          >
            <Cpu size={12} />
          </button>
          <button
            onClick={() => persistSendToModel(!sendToModel)}
            className={`p-1 rounded transition-colors ${sendToModel ? 'text-blue-500 hover:text-blue-400' : 'text-zinc-400 hover:text-zinc-500'}`}
            title={sendToModel ? 'Model: ON' : 'Model: OFF'}
          >
            <Link size={12} />
          </button>
          <button
            onClick={() => persistAllowImagePaste(!allowImagePaste)}
            className={`p-1 rounded transition-colors ${allowImagePaste ? 'text-blue-500 hover:text-blue-400' : 'text-zinc-400 hover:text-zinc-500'}`}
            title={allowImagePaste ? 'Image: ON' : 'Image: OFF'}
          >
            <ImageIcon size={12} />
          </button>
          <button
            onClick={handleLaunchBrowser}
            className={`p-1 rounded transition-colors ${
              extensionConnected || browserLaunched ? 'text-green-500 hover:text-green-400' : browserLaunching ? 'text-blue-400' : 'text-zinc-400 hover:text-zinc-500'
            }`}
            title={extensionConnected ? 'Extension connected' : browserLaunched ? 'Browser launched' : 'Launch browser with extension'}
          >
            {browserLaunching ? <LoaderCircle size={12} className="animate-spin" /> : <Globe size={12} />}
          </button>
        </div>
      </div>

      {/* Content area */}
      {mode === 'chat' ? (
        <ChatMode
          ref={chatModeRef}
          sendToModel={sendToModel}
          allowImagePaste={allowImagePaste}
          noSystemPrompt={noSystemPrompt}
          toolMode={toolMode}
          customTools={customTools}
          groups={groups}
          onToolModeChange={handleToolModeChange}
          onCustomToolsChange={handleCustomToolsChange}
          onSaveGroup={handleSaveGroup}
          onDeleteGroup={handleDeleteGroup}
          onGroupSelect={handleGroupSelect}
          executorReady={executorReady}
        />
      ) : mode === 'watcher' ? (
        <WatcherMode mode={mode} toolMode={toolMode} customTools={customTools} />
      ) : mode === 'recorder' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <RecorderMode />
        </div>
      ) : mode === 'learn' ? (
        <LearnMode onProgressChange={setLearningProgress} />
      ) : (
        <TaskMode
          toolMode={toolMode}
          customTools={customTools}
          groups={groups}
          executorReady={executorReady}
          allTools={allTools}
          onToolModeChange={handleToolModeChange}
          onCustomToolsChange={handleCustomToolsChange}
          onSaveGroup={handleSaveGroup}
          onDeleteGroup={handleDeleteGroup}
          onGroupSelect={handleGroupSelect}
          onRefreshWatcherConfigs={refreshWatcherConfigs}
          onModeChange={persistMode}
          onAutomatingChange={setIsAutomating}
        />
      )}
      </div>
    </div>
  );
}
