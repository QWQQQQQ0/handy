import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Play, StopCircle, Wrench, CheckCircle, XCircle, GripHorizontal, X, Minus, MessageSquare, Link, ImageIcon, Circle, Sparkles } from 'lucide-react';
import { desktopService, WindowInfo } from '@/services/desktop-service';
import { DesktopScreenSkill } from '@/skills/desktop';
import { Switch } from '@/components/ui/switch';
import { MessageInput } from '@/components/chat/message-input';
import { ToolModeBar } from '@/components/chat/tool-mode-bar';
import { ToolMode } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { MessageContent, LLMMessage, ContentPart } from '@/types/message';
import type { CompressedImage } from '@/utils/image';
import { DesktopAutomationAgent } from '@/services/desktop-automation-agent';
import { automationRecorder } from '@/services/recorder';
import { useSkillStore } from '@/stores/skill-store';
import { UserDefinedSkill } from '@/skills/user-defined';
import type { UserSkillConfig, AutomationStep } from '@/types/skill';

// ── Persisted settings ──

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function writeLocal<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ── Float chat message type ──

interface FloatChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: string[]; // dataUrls
  status: 'done' | 'streaming' | 'error';
}

// ── Action log (Task mode) ──

interface ActionLog {
  action: string;
  success: boolean;
  error?: string;
}

// ── Main component ──

export default function FloatPage() {
  // ── Mode & toggles (persisted) ──
  const [mode, setMode] = useState<'chat' | 'task'>(() => readLocal('float_mode', 'chat'));
  const [sendToModel, setSendToModel] = useState(() => readLocal('float_send_to_model', true));
  const [allowImagePaste, setAllowImagePaste] = useState(() => readLocal('float_allow_image_paste', true));

  const persistMode = useCallback((v: 'chat' | 'task') => { setMode(v); writeLocal('float_mode', v); }, []);
  const persistSendToModel = useCallback((v: boolean) => { setSendToModel(v); writeLocal('float_send_to_model', v); }, []);
  const persistAllowImagePaste = useCallback((v: boolean) => { setAllowImagePaste(v); writeLocal('float_allow_image_paste', v); }, []);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState<FloatChatMsg[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);

  // ── Tool mode (Task) ──
  const [toolMode, setToolMode] = useState<ToolMode>(() => readLocal('float_tool_mode', ToolMode.all));
  const [customTools, setCustomTools] = useState<Set<string>>(() => new Set(readLocal<string[]>('float_custom_tools', [])));

  const handleToolModeChange = useCallback((mode: ToolMode) => {
    setToolMode(mode);
    writeLocal('float_tool_mode', mode);
    if (mode === ToolMode.custom && customTools.size === 0) {
      const skill = new DesktopScreenSkill();
      const allNames = new Set(skill.tools.map((t) => t.name));
      setCustomTools(allNames);
      writeLocal('float_custom_tools', [...allNames]);
    }
  }, [customTools]);

  const toggleCustomTool = useCallback((name: string) => {
    setCustomTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      writeLocal('float_custom_tools', [...next]);
      return next;
    });
  }, []);

  // ── Task state (from original float) ──
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [actionLog, setActionLog] = useState<ActionLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAutomating, setIsAutomating] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<AutomationStep[]>([]);
  const [savingSkill, setSavingSkill] = useState(false);
  const saveSkillNameRef = useRef<HTMLInputElement>(null);
  const goalRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll chat ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Auto-capture on mount ──
  useEffect(() => { if (mode === 'task') handleRefresh(); }, [mode]);

  // ── Listen for automation-goal from main window ──
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        unlisten = await getCurrentWebviewWindow().listen<{ goal: string }>('automation-goal', (event) => {
          const { goal } = event.payload;
          persistMode('task');
          // Use setTimeout to ensure mode switch + re-render before setting input
          setTimeout(() => {
            if (goalRef.current) goalRef.current.value = goal;
            document.getElementById('float-go-btn')?.click();
          }, 100);
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { unlisten?.(); };
  }, [persistMode]);

  // ── Task: Refresh ──
  const handleRefresh = useCallback(async () => {
    setIsCapturing(true);
    try {
      const [base64, windowList] = await Promise.all([
        desktopService.screenshot(),
        desktopService.listWindows(),
      ]);
      setScreenshot(base64);
      setWindows(windowList);
    } catch (e) {
      setError(`Refresh failed: ${e}`);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // ── Task: Start Automation ──
  const handleStartAutomation = useCallback(async () => {
    const goal = goalRef.current?.value.trim();
    if (!goal || isAutomating) return;

    setIsAutomating(true);
    setError(null);

    try {
      setActionLog((prev) => [...prev, { action: `Goal: "${goal}"`, success: true }]);

      const { useModelConfigStore } = await import('@/stores/model-config-store');
      await useModelConfigStore.getState().load();
      const config = useModelConfigStore.getState().defaultConfig();
      if (!config) {
        setActionLog((prev) => [...prev, { action: 'No model configured', success: false }]);
        return;
      }

      let apiKey = '';
      try {
        apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
      } catch (e) {
        setActionLog((prev) => [...prev, { action: `Decrypt API key failed: ${e}`, success: false }]);
        return;
      }
      if (!apiKey) {
        setActionLog((prev) => [...prev, { action: 'API key is empty after decrypt', success: false }]);
        return;
      }

      const { ModelCallService } = await import('@/adapters/model-call-service');
      const skill = new DesktopScreenSkill();
      const modelService = new ModelCallService();
      const agent = new DesktopAutomationAgent(modelService, skill);

      // Build tool filter from current mode
      let toolFilter: Set<string> | undefined;
      if (toolMode === ToolMode.none) {
        toolFilter = new Set();
      } else if (toolMode === ToolMode.favorites) {
        toolFilter = useSettingsStore.getState().favoriteTools;
        if (toolFilter.size === 0) toolFilter = undefined; // fall back to all tools if no favorites
      } else if (toolMode === ToolMode.custom) {
        toolFilter = customTools;
      }

      const turns = await agent.executeCommand({
        screenshotBase64: screenshot ?? undefined,
        goal,
        provider: config,
        apiKey,
        windows,
        toolFilter,
        maxTurns: 5,
        onStep: async (event) => {
          switch (event.type) {
            case 'before_tool': {
              const data = event.data as { name: string; arguments: Record<string, unknown> };
              setActionLog((prev) => [...prev, { action: `${data.name}(${JSON.stringify(data.arguments)})`, success: true }]);
              if (automationRecorder.isRecording) {
                automationRecorder.recordStep(data.name, data.arguments);
              }
              return null;
            }
            case 'after_tool': {
              const data = event.data as { name: string; success: boolean; message: string };
              setActionLog((prev) => [...prev, { action: data.success ? data.message : `Failed: ${data.message}`, success: data.success }]);
              if (['desktop_click', 'desktop_type', 'desktop_double_click', 'desktop_right_click', 'desktop_open_app'].includes(data.name)) {
                try {
                  const newScreenshot = await desktopService.screenshot();
                  setScreenshot(newScreenshot);
                } catch { /* ignore */ }
              }
              return null;
            }
            default:
              return null;
          }
        },
      });

      if (!turns || turns.length === 0) {
        setActionLog((prev) => [...prev, { action: 'No actions taken', success: false }]);
      } else {
        const lastTurn = turns[turns.length - 1];
        const lastResult = lastTurn.results[lastTurn.results.length - 1];
        setActionLog((prev) => [...prev, { action: `Done: ${lastResult.message}`, success: lastResult.success }]);
      }
    } catch (e) {
      setError(String(e));
      setActionLog((prev) => [...prev, { action: `Error: ${e}`, success: false }]);
    } finally {
      setIsAutomating(false);
    }
  }, [isAutomating, screenshot, windows, toolMode, customTools]);

  // ── Chat: Send message ──
  const handleChatSend = useCallback(async (content: MessageContent) => {
    const id = crypto.randomUUID();
    const text = typeof content === 'string' ? content : (content.find((p) => p.type === 'text') as { text: string } | undefined)?.text ?? '';
    const imageParts = typeof content === 'string' ? [] : content.filter((p) => p.type === 'image_url') as { image_url: { url: string } }[];
    const images = imageParts.map((p) => p.image_url.url);

    const userMsg: FloatChatMsg = { id, role: 'user', text, images, status: 'done' };
    setChatMessages((prev) => [...prev, userMsg]);

    if (!readLocal('float_send_to_model', true)) return;

    setChatStreaming(true);
    const assistantId = crypto.randomUUID();
    setChatMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '', status: 'streaming' }]);

    try {
      const { useModelConfigStore } = await import('@/stores/model-config-store');
      await useModelConfigStore.getState().load();
      const config = useModelConfigStore.getState().defaultConfig();
      if (!config) throw new Error('No model configured');

      let apiKey = '';
      try {
        apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
      } catch (e) {
        throw new Error(`Decrypt API key failed: ${e}`);
      }
      if (!apiKey) throw new Error('API key is empty after decrypt');

      const { ModelCallService, ModelScenario } = await import('@/adapters/model-call-service');
      const modelService = new ModelCallService();

      // Build LLM messages from history
      const llmMessages: LLMMessage[] = chatMessages.map((m) => {
        const parts: ContentPart[] = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        if (m.images) {
          for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } });
        }
        return {
          role: m.role,
          content: parts.length === 1 && parts[0].type === 'text' ? (parts[0] as { type: 'text'; text: string }).text : parts.length > 0 ? parts : null,
        };
      });

      // Add current message
      const currentParts: ContentPart[] = [];
      if (text) currentParts.push({ type: 'text', text });
      for (const img of images) currentParts.push({ type: 'image_url', image_url: { url: img } });
      llmMessages.push({
        role: 'user',
        content: currentParts.length === 1 && currentParts[0].type === 'text' ? currentParts[0].text : currentParts,
      });

      const stream = modelService.chatStream({
        scenario: ModelScenario.chat,
        messages: llmMessages,
        provider: config,
        apiKey,
      });

      let responseText = '';
      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) {
          throw new Error(chunk.substring(10));
        }
        if (chunk.startsWith('__TOOLS__:')) {
          // Chat mode ignores tool calls
          continue;
        }
        responseText += chunk;
        setChatMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, text: responseText } : m,
        ));
      }

      setChatMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, status: 'done' } : m,
      ));
    } catch (e) {
      setChatMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, status: 'error', text: `Error: ${e}` } : m,
      ));
    } finally {
      setChatStreaming(false);
    }
  }, [sendToModel, chatMessages]);

  // ── Window controls ──
  const handleClose = useCallback(async () => {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().close();
  }, []);

  const handleMinimize = useCallback(async () => {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().hide();
  }, []);

  // ── Render ──
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none">
      {/* Custom title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-zinc-400" />
          <span className="text-[12px] font-semibold text-zinc-600 dark:text-zinc-400">OpenPaw</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={handleMinimize} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500">
            <Minus size={14} />
          </button>
          <button onClick={handleClose} className="p-1 rounded hover:bg-red-500 hover:text-white text-zinc-500">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Mode tabs + toggles */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0 gap-2">
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => persistMode('chat')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
              mode === 'chat' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <MessageSquare size={13} />
            Chat
          </button>
          <button
            onClick={() => persistMode('task')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
              mode === 'task' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Wrench size={13} />
            Task
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" title={sendToModel ? 'Send to model: ON' : 'Send to model: OFF (local save only)'}>
            <Link size={12} className={sendToModel ? 'text-blue-500' : 'text-zinc-400'} />
            <Switch checked={sendToModel} onChange={persistSendToModel} />
          </div>
          <div className="flex items-center gap-1" title={allowImagePaste ? 'Image paste: ON' : 'Image paste: OFF'}>
            <ImageIcon size={12} className={allowImagePaste ? 'text-blue-500' : 'text-zinc-400'} />
            <Switch checked={allowImagePaste} onChange={persistAllowImagePaste} />
          </div>
        </div>
      </div>

      {/* Content area */}
      {mode === 'chat' ? (
        <>
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0 scrollbar-hide">
            {chatMessages.length === 0 && (
              <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-[13px]">
                {sendToModel ? 'Start a conversation' : 'Paste or type content to save locally'}
              </div>
            )}
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : msg.status === 'error'
                    ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                }`}>
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-1 mb-1 flex-wrap">
                      {msg.images.map((img, i) => (
                        <img key={i} src={img} alt="" className="max-w-[120px] max-h-[80px] rounded object-cover" />
                      ))}
                    </div>
                  )}
                  {msg.text && <div className="whitespace-pre-wrap break-words">{msg.text}</div>}
                  {msg.status === 'streaming' && !msg.text && (
                    <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse rounded-sm" />
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <MessageInput
            onSend={handleChatSend}
            enabled={!chatStreaming}
            hintText={sendToModel ? 'Send message...' : 'Type to save locally...'}
            allowImagePaste={allowImagePaste}
          />
        </>
      ) : (
        <>
          {/* Screenshot preview */}
          <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
            {screenshot ? (
              <div className="relative group">
                <img src={screenshot} alt="Desktop" className="w-full h-32 object-cover" />
                <button
                  onClick={handleRefresh}
                  disabled={isCapturing}
                  className="absolute top-1 right-1 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  <Camera size={14} />
                </button>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
                <div className="w-6 h-6 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Action log */}
          <div className="flex-1 overflow-y-auto px-2 py-1 min-h-0">
            {actionLog.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-[12px]">
                Enter a goal and press Go
              </div>
            ) : (
              actionLog.map((log, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                  {log.success ? (
                    <CheckCircle size={10} className="text-green-500 shrink-0" />
                  ) : (
                    <XCircle size={10} className="text-red-500 shrink-0" />
                  )}
                  <span className="text-zinc-600 dark:text-zinc-400 truncate">{log.action}</span>
                </div>
              ))
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-2 px-2 py-1 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-[11px] text-red-700 dark:text-red-300">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          {/* Tool mode bar */}
          <ToolModeBar
            mode={toolMode}
            selectedCount={customTools.size}
            onModeChanged={handleToolModeChange}
          />

          {/* Custom tool selector */}
          {toolMode === ToolMode.custom && (
            <div className="shrink-0 px-2 max-h-32 overflow-y-auto border-t border-zinc-100 dark:border-zinc-800">
              {new DesktopScreenSkill().tools.map((t) => (
                <label key={t.name} className="flex items-center gap-1.5 py-0.5 cursor-pointer text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={customTools.has(t.name)}
                    onChange={() => toggleCustomTool(t.name)}
                    className="w-3 h-3 rounded"
                  />
                  {t.name}
                </label>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="shrink-0 p-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex gap-1.5">
              <input
                ref={goalRef}
                type="text"
                placeholder="Goal... (e.g., click the Start button)"
                className="flex-1 px-2 py-1.5 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleStartAutomation(); }}
              />
              <button
                id="float-go-btn"
                onClick={handleStartAutomation}
                disabled={isAutomating}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
              >
                {isAutomating ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                Go
              </button>
              <button
                onClick={() => {
                  if (isRecording) {
                    const steps = automationRecorder.stop();
                    setRecordedSteps(steps);
                    setShowSaveDialog(true);
                  } else {
                    automationRecorder.start();
                  }
                  setIsRecording(!isRecording);
                }}
                disabled={isAutomating && !isRecording}
                className={`p-1.5 rounded border transition-colors ${
                  isRecording
                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 text-red-500'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-red-500 disabled:opacity-30'
                }`}
                title={isRecording ? 'Stop recording' : 'Record automation'}
              >
                <Circle size={14} fill={isRecording ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => {
                  setIsAutomating(false);
                  if (isRecording) {
                    automationRecorder.cancel();
                    setIsRecording(false);
                  }
                }}
                disabled={!isAutomating}
                className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-red-500 disabled:opacity-30"
              >
                <StopCircle size={14} />
              </button>
            </div>
          </div>

          {/* Save recording dialog */}
          {showSaveDialog && (
            <>
              <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowSaveDialog(false)} />
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                    <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">Save Recording</h3>
                    <button onClick={() => setShowSaveDialog(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{recordedSteps.length} step(s) recorded</p>
                    <input
                      ref={saveSkillNameRef}
                      type="text"
                      placeholder="Skill name..."
                      className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
                    <button onClick={() => setShowSaveDialog(false)} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
                    <button
                      onClick={async () => {
                        const name = saveSkillNameRef.current?.value.trim() || 'Recorded Skill';
                        setSavingSkill(true);
                        try {
                          const tools = [...new Set(recordedSteps.map((s) => s.toolName))].map((name) => ({
                            name,
                            description: `Recorded: ${name}`,
                            parameters: { type: 'object', properties: {} },
                          }));
                          const cfg: UserSkillConfig = {
                            id: crypto.randomUUID(),
                            name,
                            description: `Recorded automation: ${recordedSteps.map((s) => s.description).join(' → ')}`,
                            category: 'user',
                            tools,
                            builtin: false,
                            steps: recordedSteps,
                          };
                          await useSkillStore.getState().createSkill(cfg);
                          setShowSaveDialog(false);
                          setRecordedSteps([]);
                        } catch (e) { console.error('Save skill failed:', e); }
                        setSavingSkill(false);
                      }}
                      disabled={savingSkill}
                      className="px-3 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingSkill ? 'Saving...' : 'Save as Macro'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
