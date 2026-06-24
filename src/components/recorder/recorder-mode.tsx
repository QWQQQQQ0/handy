/**
 * 录制模式组件 - 用于浮窗
 *
 * 集成完整的录制流程：
 * 1. 录制用户操作
 * 2. LLM 分析
 * 3. 生成模板
 * 4. 预览/编辑模板
 * 5. 测试执行
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Circle,
  Square,
  Play,
  Pause,
  Undo2,
  Save,
  ArrowRight,
  Wand2,
  Eye,
  Trash2,
  Check,
  Loader2,
  Keyboard,
  Mouse,
  Globe,
  AlertCircle,
  X,
  Edit3,
  Plus,
  MessageSquare,
  Image,
} from 'lucide-react';
import { unifiedRecorder } from '@/services/unified-recorder';
import { unifiedAnalyzer } from '@/services/unified-analyzer';
import { unifiedExecutor } from '@/services/unified-executor';
import { webRecorder } from '@/services/web-recorder';
import { applyStepFieldEdit } from '@/services/template-edit-utils';
import type { SemanticEvent, EventTag, ManualStep } from '@/types/semantic-event';
import type { RecordingSession } from '@/types/recording-session';
import type { AutomationTemplate } from '@/types/automation-template';
import type { DetectedPattern } from '@/types/recording-session';
import { EventList } from './event-list';
import { TemplatePreview } from './template-preview';
import { ManualRecorder } from './manual-recorder';
import { InsertStepDialog } from './insert-step-dialog';
import { VariableHints } from './variable-hints';
import { StepDetailFields } from './step-detail-fields';
import { ParamDialog } from './param-dialog';
import { RefinePanel } from './refine-panel';
import { loadTemporaryTasks, saveTemporaryTask, deleteTemporaryTask } from '@/services/temporary-task-store';
import { Zap, History, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

type RecorderMode =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'recorded'
  | 'analyzing'
  | 'preview'
  | 'executing'
  | 'completed'
  | 'editing-template';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function RecorderMode() {
  // ── 状态 ──
  const [mode, setMode] = useState<RecorderMode>('idle');
  const [events, setEvents] = useState<SemanticEvent[]>([]);
  const [duration, setDuration] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [description, setDescription] = useState('');
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [template, setTemplate] = useState<AutomationTemplate | null>(null);
  const [pattern, setPattern] = useState<DetectedPattern | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showParamDialog, setShowParamDialog] = useState(false);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  const [webBrowserLoading, setWebBrowserLoading] = useState(false);
  const [eventLoading, setEventLoading] = useState(false);
  const [taskType, setTaskType] = useState<'temporary' | 'reusable'>('temporary');
  const [temporaryTasks, setTemporaryTasks] = useState<AutomationTemplate[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // ── 手动插入步骤 ──
  const [manualSteps, setManualSteps] = useState<ManualStep[]>([]);
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [insertAfterEventId, setInsertAfterEventId] = useState<string | undefined>();

  // ── 模板编辑 ──
  const [editTemplate, setEditTemplate] = useState<AutomationTemplate | null>(null);

  // ── 多轮对话微调 ──
  const [refineMessages, setRefineMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineReasoning, setRefineReasoning] = useState('');

  // ── 定时器 & 退订 ──
  const [durationTimer, setDurationTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [analyzeProgress, setAnalyzeProgress] = useState('');
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ── 初始化 ──
  useEffect(() => {
    unifiedRecorder.initialize().catch(() => {});
    setTemporaryTasks(loadTemporaryTasks());

    return () => {
      if (durationTimer) {
        clearInterval(durationTimer);
      }
      unsubscribeRef.current?.();
    };
  }, []);

  // ── 手动步骤管理 ──

  const handleOpenInsertDialog = useCallback((afterEventId?: string, insertAt?: number) => {
    setInsertAfterEventId(afterEventId);
    setShowInsertDialog(true);
  }, []);

  const handleInsertManualStep = useCallback((step: ManualStep) => {
    setManualSteps(prev => [...prev, step]);
  }, []);

  const handleInsertToTemplate = useCallback((step: ManualStep) => {
    // 转换为 TemplateStep 并插入到 editTemplate
    const templateStep: import('@/types/automation-template').TemplateStep = {
      id: crypto.randomUUID(),
      action: step.stepType,
      description: step.description || '',
      params: {},
    };

    // 按步骤类型填充字段
    if (step.stepType === 'tool_call') {
      templateStep.params = { toolName: step.toolName };
    } else if (step.stepType === 'llm_call') {
      templateStep.params = {
        prompt: step.llmPrompt,
        multimodal: step.multimodal || false,
        include_screenshots: step.includeScreenshots || [],
        systemPrompt: '',
      };
    } else if (step.stepType === 'if') {
      templateStep.condition = step.condition;
    } else if (step.stepType === 'goto') {
      templateStep.params = { stepId: step.gotoStepId };
    }
    // else/endif: 不需要额外参数

    setEditTemplate(prev => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      const afterIdx = parseInt(insertAfterEventId || '0', 10);
      if (!isNaN(afterIdx) && afterIdx >= 0 && afterIdx < steps.length) {
        steps.splice(afterIdx + 1, 0, templateStep);
      } else {
        steps.push(templateStep);
      }
      return { ...prev, steps };
    });
  }, [insertAfterEventId]);

  const handleDeleteManualStep = useCallback((stepId: string) => {
    setManualSteps(prev => prev.filter(s => s.id !== stepId));
  }, []);

  // ── 录制控制 ──

  const handleStartRecording = useCallback(async () => {
    try {
      setError(null);
      setEvents([]);
      setDuration(0);

      unsubscribeRef.current?.();
      unsubscribeRef.current = null;

      const newSession = await unifiedRecorder.startRecording({
        description,
        taskType,
        autoTag: true,
      });

      setSession(newSession);
      setMode('recording');

      const timer = setInterval(() => {
        setDuration(prev => prev + 1000);
      }, 1000);
      setDurationTimer(timer);

      const unsubscribeGlobal = unifiedRecorder.onEvent((event) => {
        setEvents(prev => [...prev, event]);
      });

      const unsubscribeRemove = unifiedRecorder.onEventRemove((eventId) => {
        setEvents(prev => prev.filter(e => e.id !== eventId));
      });

      const unsubscribeRecorder = unifiedRecorder.onRecorderEvent((type) => {
        if (type === 'event-loading') {
          setEventLoading(true);
        } else if (type === 'event-loading-end') {
          setEventLoading(false);
        }
      });

      let unsubscribeWeb: (() => void) | null = null;
      if (webBrowserOpen) {
        try {
          await webRecorder.startRecording();
          unsubscribeWeb = webRecorder.onEvent((event) => {
            unifiedRecorder.addExternalEvent(event);
          });
        } catch {
          // ignore
        }
      }

      unsubscribeRef.current = () => {
        unsubscribeGlobal();
        unsubscribeRemove();
        unsubscribeRecorder();
        unsubscribeWeb?.();
      };

    } catch (err) {
      setError(`启动录制失败: ${err}`);
    }
  }, [description, webBrowserOpen, taskType]);

  const handleStopRecording = useCallback(async () => {
    try {
      if (webRecorder.isRecording) {
        await webRecorder.stopRecording();
      }

      const completedSession = await unifiedRecorder.stopRecording();
      setSession(completedSession);
      setMode('recorded');

      if (durationTimer) {
        clearInterval(durationTimer);
        setDurationTimer(null);
      }

      unsubscribeRef.current?.();
      unsubscribeRef.current = null;

    } catch (err) {
      setError(`停止录制失败: ${err}`);
    }
  }, [durationTimer]);

  const handlePauseRecording = useCallback(async () => {
    await unifiedRecorder.pauseRecording();
    webRecorder.pauseRecording();
    setMode('paused');
  }, []);

  const handleResumeRecording = useCallback(async () => {
    await unifiedRecorder.resumeRecording();
    await webRecorder.resumeRecording();
    setMode('recording');
  }, []);

  const handleUndoLastEvent = useCallback(() => {
    unifiedRecorder.undoLastEvent();
    setEvents(prev => prev.slice(0, -1));
  }, []);

  const handleDeleteEvent = useCallback((eventId: string) => {
    unifiedRecorder.deleteEvent(eventId);
    setEvents(prev => prev.filter(e => e.id !== eventId));
  }, []);

  const handleTagEvent = useCallback((eventId: string, tag: EventTag) => {
    unifiedRecorder.tagEvent(eventId, tag);
    setEvents(prev => prev.map(e =>
      e.id === eventId
        ? { ...e, tags: [...(e.tags || []), tag] }
        : e
    ));
  }, []);

  const handleUntagEvent = useCallback((eventId: string, tag: EventTag) => {
    unifiedRecorder.untagEvent(eventId, tag);
    setEvents(prev => prev.map(e =>
      e.id === eventId
        ? { ...e, tags: (e.tags || []).filter(t => t !== tag) }
        : e
    ));
  }, []);

  // ── 受控浏览器 ──

  const handleOpenBrowser = useCallback(async () => {
    try {
      setWebBrowserLoading(true);
      setError(null);
      await webRecorder.openBrowser();
      setWebBrowserOpen(true);
    } catch (err) {
      setError(`打开浏览器失败: ${err}`);
    } finally {
      setWebBrowserLoading(false);
    }
  }, []);

  const handleCloseBrowser = useCallback(async () => {
    try {
      await webRecorder.closeBrowser();
      setWebBrowserOpen(false);
    } catch (err) {
      setError(`关闭浏览器失败: ${err}`);
    }
  }, []);

  // ── 分析 ──

  const handleAnalyze = useCallback(async () => {
    if (!session) return;

    try {
      setMode('analyzing');
      setError(null);

      let llmConfigured = false;
      try {
        const { useModelConfigStore } = await import('@/stores/model-config-store');
        await useModelConfigStore.getState().load();
        const config = useModelConfigStore.getState().defaultConfig();
        if (config) {
          const apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
          if (apiKey) {
            const { getModelService } = await import('@/services/model-service-singleton');
            unifiedAnalyzer.configure(getModelService(), config, apiKey);
            llmConfigured = true;
          }
        }
      } catch (e) {
        console.warn('[RecorderMode] Failed to configure LLM for analysis:', e);
      }

      if (!llmConfigured) {
        setError('未配置 LLM，将使用本地分析（结果可能不够智能）');
      }

      if (description !== session.metadata.userDescription) {
        session.metadata.userDescription = description;
      }

      if (manualSteps.length > 0) {
        session.manualSteps = manualSteps;
      }

      if (session) {
        session.events = [...events];
      }

      setReasoning('');
      setAnalyzeProgress('正在分析操作模式...');
      const result = await unifiedAnalyzer.analyze(session, {
        onReasoning: (text) => setReasoning(text),
        onProgress: (text) => setAnalyzeProgress(text),
      });

      setTemplate(result);
      // 从 LLM 分析结果中提取模式信息
      if (result.dataFlow) {
        setPattern({
          type: (result as any).pattern?.type || 'mixed',
          confidence: (result as any).pattern?.confidence || 0.8,
          description: (result as any).pattern?.description || `从 ${result.dataFlow.source.type} 复制数据到 ${result.dataFlow.target.type}`,
          dataFlow: result.dataFlow,
        });
      }

      initRefineConversation(result);

      setMode('preview');

    } catch (err) {
      setError(`分析失败: ${err}`);
      setMode('recorded');
    }
  }, [session, description, events]);

  // ── 多轮对话微调 ──

  const initRefineConversation = useCallback((t: AutomationTemplate) => {
    const summary = `已生成模板「${t.name}」，共 ${t.steps.length} 步${
      t.parameters.length > 0 ? `，${t.parameters.length} 个参数` : ''
    }。你可以让我修改这个模板，例如：
- "把第3步改成语义定位"
- "加一个循环次数的参数"
- "用 desktop_focus_window 来切换窗口"`;
    setRefineMessages([{ role: 'assistant', content: summary }]);
    setRefineReasoning('');
  }, []);

  /** 发送微调消息（由 RefinePanel 调用，msg 已由子组件管理） */
  const handleRefineSend = useCallback(async (msg: string) => {
    if (!template || refineLoading) return;

    const userMsg = { role: 'user' as const, content: msg };
    const newMessages = [...refineMessages, userMsg];
    setRefineMessages(newMessages);
    setRefineLoading(true);
    setRefineReasoning('');

    try {
      const result = await unifiedAnalyzer.refine(
        template,
        refineMessages,
        msg,
        {
          onReasoning: (text) => setRefineReasoning(text),
          onProgress: (text) => setRefineReasoning(text),
        },
      );

      setTemplate(result);

      const changesSummary = `已更新模板「${result.name}」，现在共 ${result.steps.length} 步${
        result.parameters.length > 0 ? `，${result.parameters.length} 个参数` : ''
      }。${result.description ? `\n\n${result.description}` : ''}`;
      setRefineMessages([...newMessages, { role: 'assistant', content: changesSummary }]);

      if (editTemplate) {
        setEditTemplate(result);
      }
    } catch (err) {
      const errMsg = `微调失败: ${err instanceof Error ? err.message : String(err)}`;
      setRefineMessages([...newMessages, { role: 'assistant', content: errMsg }]);
      setError(errMsg);
    } finally {
      setRefineLoading(false);
    }
  }, [template, refineMessages, refineLoading, editTemplate]);

  const handleEditTemplate = useCallback((t: AutomationTemplate) => {
    setEditTemplate(t);
    setMode('editing-template');
    if (refineMessages.length === 0) {
      initRefineConversation(t);
    }
  }, [refineMessages.length, initRefineConversation]);

  // ── 执行 ──

  const doTestExecute = useCallback(async (params: Record<string, unknown>) => {
    if (!template) return;

    try {
      setMode('executing');
      setError(null);
      setShowParamDialog(false);

      await unifiedExecutor.execute(template, params, {
        dryRun: false,
        verbose: true,
        onStepStart: (step, index) => {
          console.log(`[TestExecute] step ${index}: ${step.action} ${step.target?.name ?? ''}`);
        },
        onStepEnd: (step, index, success) => {
          console.log(`[TestExecute] step ${index} ${success ? '✓' : '✗'}`);
        },
      });

      setMode('preview');
    } catch (err) {
      setError(`执行失败: ${err}`);
      setMode('preview');
    }
  }, [template]);

  const handleTestExecute = useCallback(() => {
    if (!template) return;
    if (template.parameters && template.parameters.length > 0) {
      setShowParamDialog(true);
      return;
    }
    doTestExecute({});
  }, [template, doTestExecute]);

  const handleExecuteFromHistory = useCallback((t: AutomationTemplate) => {
    setTemplate(t);
    if (t.parameters && t.parameters.length > 0) {
      setShowParamDialog(true);
    } else {
      doTestExecute({});
    }
  }, [doTestExecute]);

  // ── 保存 ──

  const handleSaveTemplate = useCallback(async () => {
    if (!template) return;

    try {
      const toolName = template.name
        .replace(/[\s\-]+/g, '_')
        .replace(/[^a-zA-Z0-9_一-鿿]/g, '')
        .toLowerCase() || 'recorded_task';

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const p of template.parameters) {
        properties[p.name] = {
          type: p.type === 'array' ? 'array' : p.type === 'number' ? 'number' : 'string',
          description: p.description,
          ...(p.constraints?.enum ? { enum: p.constraints.enum } : {}),
        };
        if (p.required) required.push(p.name);
      }

      const { useSkillStore } = await import('@/stores/skill-store');
      await useSkillStore.getState().createSkill({
        id: template.id,
        name: template.name,
        description: template.description,
        category: 'recorded',
        tools: [{
          name: toolName,
          description: template.description,
          parameters: { type: 'object', properties, required: required.length > 0 ? required : undefined },
        }],
        builtin: false,
        exposedToAI: false,
        steps: template.steps.map(step => ({
          toolName,
          arguments: step.params || {},
          description: step.description,
        })),
      });

      setMode('completed');
    } catch (err) {
      setError(`保存失败: ${err}`);
    }
  }, [template]);

  const handleSaveToHistory = useCallback(() => {
    if (!template) return;
    saveTemporaryTask(template);
    setTemporaryTasks(loadTemporaryTasks());
    setMode('completed');
  }, [template]);

  const handleDeleteHistoryTask = useCallback((id: string) => {
    deleteTemporaryTask(id);
    setTemporaryTasks(loadTemporaryTasks());
  }, []);

  const handleEditFromHistory = useCallback(async (t: AutomationTemplate) => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('navigate-main', { path: `/tasks?edit=${t.id}` });
    } catch {
      setEditTemplate(t);
      setMode('editing-template');
      if (refineMessages.length === 0) {
        initRefineConversation(t);
      }
    }
  }, [refineMessages.length, initRefineConversation]);

  const handleEditStepField = useCallback((stepId: string, field: string, value: unknown) => {
    setEditTemplate(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map(s => s.id === stepId ? applyStepFieldEdit(s, field, value) : s),
      };
    });
  }, []);

  const handleDeleteEditStep = useCallback((stepId: string) => {
    setEditTemplate(prev => {
      if (!prev) return prev;
      return { ...prev, steps: prev.steps.filter(s => s.id !== stepId) };
    });
  }, []);

  const handleInsertEditStep = useCallback((afterIndex: number) => {
    setInsertAfterEventId(String(afterIndex));
    setShowInsertDialog(true);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editTemplate) return;
    saveTemporaryTask(editTemplate);
    setTemporaryTasks(loadTemporaryTasks());
    setEditTemplate(null);
    setMode('idle');
  }, [editTemplate]);

  const handleCancelEdit = useCallback(() => {
    setEditTemplate(null);
    setMode('idle');
  }, []);

  // ── 重置 ──

  const handleReset = useCallback(() => {
    setMode('idle');
    setEvents([]);
    setDuration(0);
    setSelectedEventId(undefined);
    setSession(null);
    setTemplate(null);
    setPattern(null);
    setError(null);
    setShowParamDialog(false);
    setManualSteps([]);
    setShowInsertDialog(false);
    setEditTemplate(null);
    setRefineMessages([]);
    setRefineLoading(false);
    setRefineReasoning('');
    setTemporaryTasks(loadTemporaryTasks());
  }, []);

  // ── 渲染 ──

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Circle
            size={12}
            className={`shrink-0 ${mode === 'recording' ? 'text-red-500 animate-pulse' : 'text-zinc-400'}`}
            fill={mode === 'recording' ? 'currentColor' : 'none'}
          />
          <span className="text-[12px] font-medium truncate">
            {mode === 'idle' && '语义化录制'}
            {mode === 'recording' && `⚡ 录制中 ${formatDuration(duration)}`}
            {mode === 'paused' && '已暂停'}
            {mode === 'recorded' && `已录制 ${events.length} 个事件`}
            {mode === 'analyzing' && '分析中...'}
            {mode === 'preview' && '模板预览'}
            {mode === 'executing' && '执行中...'}
            {mode === 'completed' && '完成'}
            {mode === 'editing-template' && '编辑模板'}
          </span>
        </div>

        {mode !== 'idle' && (
          <button
            onClick={handleReset}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 shrink-0"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-2 mt-1 px-2 py-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-[11px] text-red-600 dark:text-red-400 shrink-0 flex items-center gap-1">
          <span className="truncate flex-1">{error}</span>
          <button onClick={() => setError(null)} className="underline shrink-0">关闭</button>
        </div>
      )}

      {/* ── 插入步骤对话框 ── */}
      {showInsertDialog && (
        <InsertStepDialog
          afterEventId={insertAfterEventId}
          existingSteps={mode === 'editing-template' ? editTemplate?.steps : undefined}
          insertIndex={mode === 'editing-template' && insertAfterEventId ? parseInt(insertAfterEventId, 10) + 1 : undefined}
          onClose={() => setShowInsertDialog(false)}
          onInsert={mode === 'editing-template' ? handleInsertToTemplate : handleInsertManualStep}
        />
      )}

      {/* ── 参数输入对话框 ── */}
      {showParamDialog && template && (
        <ParamDialog
          template={template}
          onCancel={() => setShowParamDialog(false)}
          onExecute={doTestExecute}
        />
      )}

      {/* ── idle ── */}
      {mode === 'idle' && (
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide p-3 space-y-3">
          <div className="flex gap-1.5">
            <button
              onClick={() => setTaskType('temporary')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                taskType === 'temporary'
                  ? 'bg-amber-600 text-white'
                  : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <Zap size={13} />
              临时任务
            </button>
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[12px] text-zinc-400 cursor-not-allowed"
              title="可复用任务开发中"
            >
              <RotateCcw size={13} />
              可复用（开发中）
            </button>
          </div>

          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-2">
            <p className="text-[11px] text-green-600 dark:text-green-400 truncate" title="支持录制跨应用操作（浏览器复制到 Word 等）">
              <strong>全局监听：</strong>支持录制跨应用操作（浏览器复制到 Word 等）
            </p>
          </div>

          {!webBrowserOpen ? (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-2 space-y-1.5">
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle size={12} className="shrink-0" />
                如果操作涉及浏览器，请先打开受控浏览器
              </p>
              <button
                onClick={handleOpenBrowser}
                disabled={webBrowserLoading}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {webBrowserLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Globe size={12} />
                )}
                打开受控浏览器
              </button>
            </div>
          ) : (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-2 flex items-center justify-between">
              <p className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <Check size={12} className="shrink-0" />
                受控浏览器已连接
              </p>
              <button
                onClick={handleCloseBrowser}
                className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">
              录制描述（可选）
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述这次录制的意图..."
              className="w-full px-2 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleStartRecording}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 transition-colors"
          >
            <Circle size={14} fill="white" />
            开始录制
          </button>

          {temporaryTasks.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 w-full"
              >
                <History size={12} />
                <span>历史任务 ({temporaryTasks.length})</span>
                {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showHistory && (
                <div className="mt-1.5 space-y-1 max-h-[150px] overflow-y-auto scrollbar-hide">
                  {temporaryTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {t.name || t.description || '未命名任务'}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {t.parameters.length > 0
                            ? `参数: ${t.parameters.map(p => p.name).join(', ')}`
                            : '无参数'}
                          {t.steps.length > 0 && ` · ${t.steps.length} 步`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleExecuteFromHistory(t)}
                        className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900 text-green-600 dark:text-green-400 shrink-0"
                        title="执行"
                      >
                        <Play size={12} />
                      </button>
                      <button
                        onClick={() => handleEditFromHistory(t)}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 shrink-0"
                        title="编辑"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteHistoryTask(t.id)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-400 shrink-0"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── recording / paused ── */}
      {(mode === 'recording' || mode === 'paused') && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <EventList
              events={events}
              onTagEvent={handleTagEvent}
              onUntagEvent={handleUntagEvent}
              onDeleteEvent={handleDeleteEvent}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
            {eventLoading && (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500">
                <div className="w-3 h-3 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                <span>正在获取事件信息...</span>
              </div>
            )}
          </div>

          <div className="px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="flex gap-1.5">
              {mode === 'recording' ? (
                <button
                  onClick={handlePauseRecording}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px]"
                >
                  <Pause size={12} />
                  暂停
                </button>
              ) : (
                <button
                  onClick={handleResumeRecording}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px]"
                >
                  <Play size={12} />
                  恢复
                </button>
              )}

              <button
                onClick={handleUndoLastEvent}
                disabled={events.length === 0}
                className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 disabled:opacity-30"
              >
                <Undo2 size={12} />
              </button>

              <button
                onClick={handleStopRecording}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[11px] font-medium"
              >
                <Square size={12} />
                停止录制
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── recorded ── */}
      {mode === 'recorded' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
            <EventList
              events={events}
              onTagEvent={handleTagEvent}
              onUntagEvent={handleUntagEvent}
              onDeleteEvent={handleDeleteEvent}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </div>

          {manualSteps.length > 0 && (
            <div className="px-2 pt-1 shrink-0">
              <div className="text-[10px] text-zinc-500 mb-1">手动添加的步骤:</div>
              {manualSteps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-1.5 px-2 py-1 mb-1 rounded bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 shrink-0">
                    {step.stepType === 'tool_call' ? '🔧' : '🤖'}
                  </span>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate flex-1">
                    {step.stepType === 'tool_call' ? step.toolName : (step.llmPrompt?.substring(0, 30) || 'LLM')}
                  </span>
                  <button onClick={() => handleDeleteManualStep(step.id)} className="text-[9px] text-red-400 hover:text-red-600 shrink-0">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="px-2 shrink-0">
            <button
              onClick={() => handleOpenInsertDialog(undefined)}
              className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-zinc-300 dark:border-zinc-600 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-400"
            >
              + 插入步骤（Skill Tool / LLM 调用）
            </button>
          </div>

          <div className="px-2 py-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5 shrink-0">
            <div>
              <label className="block text-[10px] text-zinc-500 mb-0.5">录制描述</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述这次录制的意图..."
                className="w-full px-2 py-1 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
              />
            </div>

            <div className="text-[10px] text-zinc-500 text-center">
              已录制 {events.length} 个操作
            </div>

            <button
              onClick={handleAnalyze}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700"
            >
              <Wand2 size={13} />
              AI 分析生成模板
            </button>

            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500"
            >
              重新录制
            </button>
          </div>
        </div>
      )}

      {/* ── analyzing ── */}
      {mode === 'analyzing' && (
        <div className="flex-1 flex flex-col min-h-0 p-3">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 size={18} className="animate-spin text-blue-500" />
            <div className="text-[13px] font-medium">{analyzeProgress || '正在分析...'}</div>
          </div>
          {reasoning && (
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              <div className="text-[11px] font-semibold text-zinc-400 uppercase mb-1">思考过程</div>
              <pre className="text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words font-mono leading-relaxed bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 border border-zinc-200 dark:border-zinc-800">
                {reasoning}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── preview ── */}
      {mode === 'preview' && template && (
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          <div className="mx-2 mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-1.5">
              <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                <p className="font-medium">请检查模板准确性</p>
                <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                  建议先「测试运行」验证坐标和步骤是否正确。如发现问题，点击「保存」后可在主应用的「任务」页中编辑修正。
                </p>
              </div>
            </div>
          </div>
          <TemplatePreview
            template={template}
            pattern={pattern || undefined}
            onSave={taskType === 'temporary' ? handleSaveToHistory : handleSaveTemplate}
            onTest={handleTestExecute}
            onEdit={handleEditTemplate}
            onClose={handleReset}
          />

          <RefinePanel
            messages={refineMessages}
            loading={refineLoading}
            reasoning={refineReasoning}
            onSend={handleRefineSend}
            maxHeight={150}
          />
        </div>
      )}

      {/* ── executing ── */}
      {mode === 'executing' && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <Loader2 size={28} className="animate-spin text-green-500 mb-3" />
          <div className="text-[13px] font-medium">正在执行...</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">试运行模板</div>
        </div>
      )}

      {/* ── editing-template ── */}
      {mode === 'editing-template' && editTemplate && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="px-2 py-1.5 shrink-0">
            <input
              type="text"
              value={editTemplate.description}
              onChange={(e) => setEditTemplate(prev => prev ? { ...prev, description: e.target.value } : prev)}
              placeholder="任务描述..."
              className="w-full px-2 py-1 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none"
            />
          </div>

          {/* 变量提示面板（展示所有步骤的输出变量） */}
          <div className="px-2 shrink-0">
            <VariableHints
              previousSteps={editTemplate.steps.filter(s => s.action === 'tool_call' || s.action === 'llm_call' || s.action === 'copy')}
              onInsertVariable={(expr) => {
                navigator.clipboard.writeText(expr).catch(() => {});
              }}
              maxHeight={100}
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-2 space-y-1">
            {editTemplate.steps.map((step, i) => {
              // 当前步骤之前的步骤（用于条件/LLM 输入中的变量提示）
              const prevSteps = editTemplate.steps.slice(0, i);
              return (
              <div key={step.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] text-zinc-400 w-4 shrink-0">{i + 1}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    step.action === 'if' || step.action === 'else' || step.action === 'endif' || step.action === 'goto'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                  }`}>
                    {step.action}
                  </span>
                  {/* if 条件显示 */}
                  {step.action === 'if' && step.condition && (
                    <span className="text-[10px] text-blue-500 dark:text-blue-400 font-mono truncate flex-1" title={step.condition}>
                      {step.condition}
                    </span>
                  )}
                  {/* goto 目标显示 */}
                  {step.action === 'goto' && step.params?.stepId && (
                    <span className="text-[10px] text-blue-500 dark:text-blue-400 font-mono truncate flex-1">
                      → {String(step.params.stepId).substring(0, 8)}...
                    </span>
                  )}
                  <button
                    onClick={() => handleDeleteEditStep(step.id)}
                    className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-400 shrink-0 ml-auto"
                    title="删除步骤"
                  >
                    <X size={11} />
                  </button>
                </div>
                <StepDetailFields
                  step={step}
                  stepIndex={i}
                  previousSteps={prevSteps}
                  onEditField={handleEditStepField}
                  onInsertVariable={(expr) => {
                    navigator.clipboard.writeText(expr).catch(() => {});
                  }}
                />
                <button
                  onClick={() => handleInsertEditStep(i)}
                  className="w-full mt-1 flex items-center justify-center gap-0.5 py-0.5 rounded border border-dashed border-zinc-200 dark:border-zinc-700 text-[9px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-400"
                >
                  <Plus size={10} />
                  在此后插入步骤
                </button>
              </div>
            );
            })}
          </div>

          <div className="px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 flex gap-1.5 shrink-0">
            <button
              onClick={handleCancelEdit}
              className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500"
            >
              取消
            </button>
            <button
              onClick={handleSaveEdit}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
            >
              <Save size={12} />
              保存修改
            </button>
          </div>

          <RefinePanel
            messages={refineMessages}
            loading={refineLoading}
            reasoning={refineReasoning}
            onSend={handleRefineSend}
            placeholder="微调模板..."
            maxHeight={120}
          />
        </div>
      )}

      {/* ── completed ── */}
      {mode === 'completed' && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 p-3">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-3">
            <Check size={24} className="text-green-500" />
          </div>
          <div className="text-[13px] font-medium mb-1">完成</div>
          <div className="text-[11px] text-zinc-500 text-center mb-3">
            {taskType === 'temporary'
              ? '任务已保存到历史，可以重复执行'
              : '模板已保存为技能，可以在技能页面查看和使用'}
          </div>
          <div className="flex gap-2 w-full">
            {taskType === 'temporary' && template && (
              <button
                onClick={() => handleExecuteFromHistory(template)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-green-600 text-white text-[12px] font-medium hover:bg-green-700"
              >
                <Play size={12} />
                再次执行
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[12px] font-medium"
            >
              返回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
