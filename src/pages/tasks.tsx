import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Play, Trash2, Edit3, Save, X, Plus,
  Mouse, Keyboard, Copy, Clipboard, Repeat, GitBranch, Scroll, Focus,
  ChevronDown, ChevronRight, Settings, Check,
} from 'lucide-react';
import { loadTemporaryTasks, saveTemporaryTask, deleteTemporaryTask } from '@/services/temporary-task-store';
import { unifiedExecutor } from '@/services/unified-executor';
import type { AutomationTemplate, TemplateStep } from '@/types/automation-template';

function getActionIcon(action: string) {
  switch (action) {
    case 'click': case 'double_click': case 'right_click': return <Mouse size={14} />;
    case 'type': case 'key': case 'hotkey': return <Keyboard size={14} />;
    case 'copy': return <Copy size={14} />;
    case 'paste': return <Clipboard size={14} />;
    case 'focus': return <Focus size={14} />;
    case 'scroll': return <Scroll size={14} />;
    case 'loop_start': case 'loop_end': return <Repeat size={14} />;
    case 'if': case 'break': case 'continue': return <GitBranch size={14} />;
    default: return <Mouse size={14} />;
  }
}

export default function TasksPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tasks, setTasks] = useState<AutomationTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Editing state
  const [editTask, setEditTask] = useState<AutomationTemplate | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState<string | null>(null);
  const [execLog, setExecLog] = useState<string[]>([]);

  // ── Step editor dialog ──
  const [showInsert, setShowInsert] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null); // null = new step, string = edit existing
  const [insertAfterIdx, setInsertAfterIdx] = useState(-1);
  const [insertType, setInsertType] = useState<string>('click');
  const [insertToolName, setInsertToolName] = useState('');
  const [insertLLMPrompt, setInsertLLMPrompt] = useState('');
  const [insertDesc, setInsertDesc] = useState('');
  const [insertCoordX, setInsertCoordX] = useState('');
  const [insertCoordY, setInsertCoordY] = useState('');
  const [insertKey, setInsertKey] = useState('');
  const [insertWait, setInsertWait] = useState('');
  const [insertScrollDir, setInsertScrollDir] = useState<'down' | 'up'>('down');
  const [insertScrollAmt, setInsertScrollAmt] = useState('500');
  const [insertCode, setInsertCode] = useState('');
  const [insertToolArgs, setInsertToolArgs] = useState<Record<string, string>>({});
  const [availableTools, setAvailableTools] = useState<Array<{ skillName: string; toolName: string; description: string; parameters: Record<string, unknown> }>>([]);

  useEffect(() => {
    setTasks(loadTemporaryTasks());
    setLoading(false);

    // Auto-open edit if navigated from float window with ?edit=taskId
    const editId = searchParams.get('edit');
    if (editId) {
      const all = loadTemporaryTasks();
      const task = all.find(t => t.id === editId);
      if (task) {
        setEditTask(task);
        // Auto-expand all steps when editing
        setExpandedSteps(new Set(task.steps.map(s => s.id)));
        // Clear the param
        navigate('/tasks', { replace: true });
      }
    }
  }, []);

  // ── Edit handlers ──

  const handleEditStepField = useCallback((stepId: string, field: string, value: unknown) => {
    setEditTask(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map(s => {
          if (s.id !== stepId) return s;
          if (field === 'coordinate_x') {
            return { ...s, target: { ...s.target, coordinate: { ...s.target?.coordinate, x: value as number | string } } };
          }
          if (field === 'coordinate_y') {
            return { ...s, target: { ...s.target, coordinate: { ...s.target?.coordinate, y: value as number | string } } };
          }
          if (field === 'waitBefore') {
            return { ...s, waitBefore: value as number };
          }
          if (field === 'description') {
            return { ...s, description: value as string };
          }
          if (field === 'key') {
            return { ...s, params: { ...s.params, key: value as string } };
          }
          return s;
        }),
      };
    });
  }, []);

  const handleDeleteStep = useCallback((stepId: string) => {
    setEditTask(prev => prev ? { ...prev, steps: prev.steps.filter(s => s.id !== stepId) } : prev);
  }, []);

  const handleOpenInsert = useCallback(async (afterIdx: number, step?: TemplateStep) => {
    setInsertAfterIdx(afterIdx);
    // 加载 tools
    try {
      const { useSkillStore } = await import('@/stores/skill-store');
      const store = useSkillStore.getState();
      if (!store.loaded) await store.initializeSkills();
      const configs = store.allConfigs;
      const tools: Array<{ skillName: string; toolName: string; description: string; parameters: Record<string, unknown> }> = [];
      for (const s of configs) {
        for (const t of s.tools) {
          tools.push({ skillName: s.name, toolName: t.name, description: t.description, parameters: t.parameters });
        }
      }
      setAvailableTools(tools);
    } catch (e) { console.warn('[TasksPage] Failed to load tools:', e); }

    // 初始化 tool 参数
    const args: Record<string, string> = {};
    if (step?.params?.arguments && typeof step.params.arguments === 'object') {
      for (const [k, v] of Object.entries(step.params.arguments as Record<string, unknown>)) {
        args[k] = String(v ?? '');
      }
    }
    setInsertToolArgs(args);

    if (step) {
      // 编辑已有步骤：预填值
      setEditingStepId(step.id);
      setInsertType(step.action);
      setInsertDesc(step.description || '');
      const coord = step.target?.coordinate;
      setInsertCoordX(coord ? String(coord.x) : '');
      setInsertCoordY(coord ? String(coord.y) : '');
      setInsertKey(step.params?.key ? String(step.params.key) : '');
      setInsertWait(step.waitBefore !== undefined ? String(step.waitBefore) : '');
      setInsertToolName(step.params?.toolName ? String(step.params.toolName) : '');
      setInsertLLMPrompt(step.params?.prompt ? String(step.params.prompt) : '');
      setInsertCode(step.params?.code ? String(step.params.code) : '');
      if (step.params?.direction) setInsertScrollDir(step.params.direction as 'down' | 'up');
      if (step.params?.amount) setInsertScrollAmt(String(step.params.amount));
    } else {
      // 新建步骤
      setEditingStepId(null);
      setInsertType('click');
      setInsertDesc('');
      setInsertCoordX('');
      setInsertCoordY('');
      setInsertKey('');
      setInsertWait('');
      setInsertToolName('');
      setInsertLLMPrompt('');
      setInsertCode('');
      setInsertScrollDir('down');
      setInsertScrollAmt('500');
    }
    setShowInsert(true);
  }, []);

  const handleConfirmInsert = useCallback(() => {
    const buildStep = (): TemplateStep => {
      const base: TemplateStep = {
        id: editingStepId || crypto.randomUUID(),
        action: insertType,
        description: insertDesc || insertType,
      };
      // 坐标类
      if (['click', 'double_click', 'right_click', 'long_press'].includes(insertType)) {
        base.target = {
          coordinate: {
            x: insertCoordX ? (isNaN(Number(insertCoordX)) ? insertCoordX : Number(insertCoordX)) : 0,
            y: insertCoordY ? (isNaN(Number(insertCoordY)) ? insertCoordY : Number(insertCoordY)) : 0,
          },
        };
      }
      // 键盘类
      if (insertType === 'hotkey' || insertType === 'key') {
        base.params = { key: insertKey };
      }
      // 等待
      if (insertType === 'wait') {
        base.params = { duration: parseInt(insertWait) || 1000 };
      }
      if (insertWait && insertType !== 'wait') {
        base.waitBefore = parseInt(insertWait) || 0;
      }
      // 滚动
      if (insertType === 'scroll') {
        base.params = { direction: insertScrollDir, amount: parseInt(insertScrollAmt) || 500 };
      }
      // tool call
      if (insertType === 'tool_call') {
        const args: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(insertToolArgs)) {
          if (v) args[k] = isNaN(Number(v)) ? v : Number(v);
        }
        base.params = { toolName: insertToolName, arguments: Object.keys(args).length > 0 ? args : undefined };
      }
      // llm call
      if (insertType === 'llm_call') {
        base.params = { prompt: insertLLMPrompt };
      }
      // code
      if (insertType === 'code') {
        base.params = { code: insertCode };
      }
      return base;
    };

    const step = buildStep();

    setEditTask(prev => {
      if (!prev) return prev;
      if (editingStepId) {
        // 编辑已有步骤：替换
        return { ...prev, steps: prev.steps.map(s => s.id === editingStepId ? step : s) };
      }
      // 新建步骤：插入
      const steps = [...prev.steps];
      if (insertAfterIdx >= 0 && insertAfterIdx < steps.length) {
        steps.splice(insertAfterIdx + 1, 0, step);
      } else {
        steps.push(step);
      }
      return { ...prev, steps };
    });
    setShowInsert(false);
  }, [insertType, insertToolName, insertLLMPrompt, insertDesc, insertAfterIdx, editingStepId, insertCoordX, insertCoordY, insertKey, insertWait, insertScrollDir, insertScrollAmt, insertCode]);

  const handleSaveEdit = useCallback(() => {
    if (!editTask) return;
    saveTemporaryTask(editTask);
    setTasks(loadTemporaryTasks());
    setEditTask(null);
  }, [editTask]);

  // ── Execute ──
  const loopIter = useRef(0);
  const loopTotal = useRef(0);

  // ── 参数对话框 ──
  const [showParams, setShowParams] = useState(false);
  const [pendingTask, setPendingTask] = useState<AutomationTemplate | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const handleExecute = useCallback(async (task: AutomationTemplate) => {
    if (task.parameters && task.parameters.length > 0) {
      const defaults: Record<string, string> = {};
      for (const p of task.parameters) {
        const d = (p as Record<string, unknown>)['default'];
        if (d !== undefined) defaults[p.name] = String(d);
      }
      setParamValues(defaults);
      setPendingTask(task);
      setShowParams(true);
      return;
    }
    doExecute(task, {});
  }, []);

  const doExecute = useCallback(async (task: AutomationTemplate, params: Record<string, unknown>) => {
    setExecuting(task.id);
    setExecLog([]);
    setShowParams(false);
    loopIter.current = 0;
    loopTotal.current = 0;

    // 预扫描 loop_count
    const loopStart = task.steps.find(s => s.action === 'loop_start');
    if (loopStart?.params?.over) {
      const over = String(loopStart.params.over);
      const n = parseInt(over.replace(/[{}]/g, ''), 10);
      if (!isNaN(n)) loopTotal.current = n;
      else loopTotal.current = 0;
    }

    try {
      const ctx = await unifiedExecutor.execute(task, params, {
        dryRun: false,
        verbose: true,
        onStepStart: (step, i) => {
          const parts: string[] = [];
          // Loop iteration indicator
          if (step.action === 'loop_start') {
            loopIter.current = 0;
            parts.push(`🔁 开始循环 (共 ${loopTotal.current || '?'} 轮)`);
          } else if (step.action === 'loop_end') {
            // nothing, handled in onStepEnd
            return;
          } else {
            const iter = loopTotal.current > 0 ? `[${loopIter.current + 1}/${loopTotal.current}] ` : '';
            parts.push(`${iter}▶ ${step.action}`);
          }

          // Description
          if (step.description) parts.push(`— ${step.description}`);

          // Coordinates
          const coord = step.target?.coordinate;
          if (coord) parts.push(`→ (${coord.x}, ${coord.y})`);

          // Hotkey
          if (step.params?.key) parts.push(`🔑 ${step.params.key}`);

          // Tool call
          if (step.action === 'tool_call' && step.params?.toolName) {
            parts.push(`🔧 ${step.params.toolName}`);
            const args = step.params.arguments as Record<string, unknown> | undefined;
            if (args) parts.push(JSON.stringify(args));
          }

          // Wait
          if (step.waitBefore && step.waitBefore > 100) {
            parts.push(`⏳ ${step.waitBefore}ms`);
          }

          setExecLog(prev => [...prev, parts.join(' ')]);
        },
        onStepEnd: (_step, i, ok) => {
          if (_step.action === 'loop_end') {
            loopIter.current++;
            return; // silent
          }
          if (_step.action === 'loop_start') return; // silent
          const dur = _step.waitBefore ? ` (等待${_step.waitBefore}ms)` : '';
          setExecLog(prev => [...prev, `  ${ok ? '✅' : '❌'}${dur}`]);
        },
      });
      setExecLog(prev => [...prev, ctx.status === 'completed' ? '━━━ 执行完成 ✅' : `❌ ${ctx.error?.message || '执行失败'}`]);
    } catch (e) {
      setExecLog(prev => [...prev, `❌ ${(e as Error).message}`]);
    } finally {
      setExecuting(null);
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm('确定删除此任务？')) return;
    deleteTemporaryTask(id);
    setTasks(loadTemporaryTasks());
    if (editTask?.id === id) setEditTask(null);
  }, [editTask]);

  const toggleStep = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) return null;

  return (
    <div className="flex h-full overflow-hidden min-w-0">
      {/* Task List */}
      <div className={`${editTask ? 'w-[360px] shrink-0 border-r border-zinc-200 dark:border-zinc-800' : 'flex-1 min-w-0'} flex flex-col min-h-0`}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">录制任务</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">管理和编辑录制的自动化任务模板</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <Settings size={32} className="mb-2 opacity-30" />
              <p className="text-[12px]">暂无录制任务</p>
              <p className="text-[11px] mt-1">在浮窗助手中完成录制后，任务会出现在这里</p>
            </div>
          ) : (
            tasks.map(task => (
              <div
                key={task.id}
                className={`border-b border-zinc-100 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer ${
                  editTask?.id === task.id ? 'bg-blue-50 dark:bg-blue-950 border-l-2 border-l-blue-500' : ''
                }`}
                onClick={() => {
                  setEditTask(task);
                  setExpandedSteps(new Set(task.steps.map(s => s.id)));
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {task.name || '未命名任务'}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">
                      {task.description}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-400">
                  <span>{task.steps.length} 步</span>
                  {task.parameters.length > 0 && (
                    <span>· {task.parameters.map(p => p.name).join(', ')}</span>
                  )}
                  {task.llmModel && <span>· {task.llmModel}</span>}
                  {task.createdAt > 0 && (
                    <span>· {new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
                <div className="flex gap-1 mt-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleExecute(task)}
                    disabled={executing === task.id}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Play size={11} />
                    {executing === task.id ? '执行中...' : '执行'}
                  </button>
                  <button
                    onClick={() => setEditTask(task)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Edit3 size={11} />
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-500"
                  >
                    <Trash2 size={11} />
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Step Editor */}
      {editTask && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">
                编辑步骤
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {editTask.steps.length} 个步骤
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditTask(null)}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] bg-blue-600 text-white hover:bg-blue-700"
              >
                <Save size={13} />
                保存
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
            <label className="block text-[11px] text-zinc-500 mb-1">任务描述</label>
            <input
              type="text"
              value={editTask.description}
              onChange={e => setEditTask(prev => prev ? { ...prev, description: e.target.value } : prev)}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
            />
          </div>

          {/* Steps */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {editTask.steps.map((step, i) => (
              <div key={step.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                {/* Step header */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-t-lg"
                  onClick={() => toggleStep(step.id)}
                >
                  <span className="text-[11px] text-zinc-400 w-5">{i + 1}</span>
                  <span className="text-zinc-500">{getActionIcon(step.action)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {step.action}
                  </span>
                  <span className="text-[12px] text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                    {step.description || '未命名步骤'}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleOpenInsert(i, step); }}
                    className="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
                    title="编辑"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteStep(step.id); }}
                    className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                  {expandedSteps.has(step.id) ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
                </div>

                {/* Step detail editor */}
                {expandedSteps.has(step.id) && (
                  <div className="px-4 pb-3 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-0.5">描述</label>
                      <input
                        type="text"
                        value={step.description}
                        onChange={e => handleEditStepField(step.id, 'description', e.target.value)}
                        className="w-full px-2 py-1 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                      />
                    </div>

                    {step.target?.coordinate && (
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] text-zinc-500 mb-0.5">X 坐标</label>
                          <input
                            type="text"
                            value={String(step.target.coordinate.x)}
                            onChange={e => {
                              const v = e.target.value;
                              handleEditStepField(step.id, 'coordinate_x', isNaN(parseFloat(v)) ? v : parseFloat(v));
                            }}
                            className="w-full px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-zinc-500 mb-0.5">Y 坐标</label>
                          <input
                            type="text"
                            value={String(step.target.coordinate.y)}
                            onChange={e => {
                              const v = e.target.value;
                              handleEditStepField(step.id, 'coordinate_y', isNaN(parseFloat(v)) ? v : parseFloat(v));
                            }}
                            className="w-full px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {step.waitBefore !== undefined && (
                      <div>
                        <label className="block text-[10px] text-zinc-500 mb-0.5">等待时间 (ms)</label>
                        <input
                          type="number"
                          value={step.waitBefore}
                          onChange={e => handleEditStepField(step.id, 'waitBefore', parseInt(e.target.value) || 0)}
                          className="w-24 px-2 py-1 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    {step.params?.key && (
                      <div>
                        <label className="block text-[10px] text-zinc-500 mb-0.5">按键</label>
                        <input
                          type="text"
                          value={String(step.params.key)}
                          onChange={e => handleEditStepField(step.id, 'key', e.target.value)}
                          className="w-40 px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    {step.params && !step.params.key && step.params.toolName && (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-0.5">工具名</label>
                          <input
                            type="text"
                            value={String(step.params.toolName)}
                            onChange={e => {
                              setEditTask(prev => prev ? {
                                ...prev, steps: prev.steps.map(s =>
                                  s.id === step.id ? { ...s, params: { ...s.params, toolName: e.target.value } } : s
                                )
                              } : prev);
                            }}
                            className="w-full px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                          />
                        </div>
                        {step.params.arguments && typeof step.params.arguments === 'object' && (
                          <div>
                            <label className="block text-[10px] text-zinc-500 mb-0.5">参数</label>
                            {Object.entries(step.params.arguments as Record<string, unknown>).map(([argKey, argVal]) => (
                              <div key={argKey} className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] text-zinc-400 w-20 shrink-0">{argKey}:</span>
                                <input
                                  type="text"
                                  value={String(argVal ?? '')}
                                  onChange={e => {
                                    setEditTask(prev => prev ? {
                                      ...prev, steps: prev.steps.map(s =>
                                        s.id === step.id ? {
                                          ...s,
                                          params: {
                                            ...s.params,
                                            arguments: { ...(s.params?.arguments as Record<string, unknown> || {}), [argKey]: e.target.value }
                                          }
                                        } : s
                                      )
                                    } : prev);
                                  }}
                                  className="flex-1 px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {step.params && Object.keys(step.params).length > 0 && !step.params.key && !step.params.toolName && (
                      <div>
                        <label className="block text-[10px] text-zinc-500 mb-0.5">参数</label>
                        <pre className="text-[11px] p-2 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(step.params, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Add step button */}
            <button
              onClick={() => handleOpenInsert(editTask.steps.length - 1)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-[12px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-400"
            >
              <Plus size={14} />
              插入步骤
            </button>
          </div>

          {/* Execution log */}
          {execLog.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 max-h-[150px] overflow-y-auto">
              <div className="text-[10px] text-zinc-500 mb-1">执行日志</div>
              <pre className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                {execLog.join('\n')}
              </pre>
            </div>
          )}
          {/* Insert Dialog Overlay */}
          {showInsert && (
            <div className="absolute inset-0 z-20 bg-white dark:bg-zinc-950 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-[14px] font-medium">{editingStepId ? '编辑步骤' : '插入步骤'}</span>
                <button onClick={() => setShowInsert(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Action type */}
                <div>
                  <label className="block text-[12px] text-zinc-500 mb-2">动作类型</label>
                  <select
                    value={insertType}
                    onChange={(e) => setInsertType(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="click">🖱️ click — 单击</option>
                    <option value="double_click">🖱️ double_click — 双击</option>
                    <option value="right_click">🖱️ right_click — 右键</option>
                    <option value="drag">🖱️ drag — 拖拽</option>
                    <option value="scroll">🖱️ scroll — 滚动</option>
                    <option value="hotkey">⌨️ hotkey — 组合键</option>
                    <option value="key">⌨️ key — 单键</option>
                    <option value="type">⌨️ type — 输入文本</option>
                    <option value="wait">⏳ wait — 等待</option>
                    <option value="tool_call">🔧 tool_call — 调用 Skill</option>
                    <option value="llm_call">🤖 llm_call — LLM 调用</option>
                    <option value="code">📝 code — 执行代码</option>
                    <option value="loop_start">🔁 loop_start — 循环开始</option>
                    <option value="loop_end">🔁 loop_end — 循环结束</option>
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[12px] text-zinc-500 mb-2">描述</label>
                  <input type="text" value={insertDesc} onChange={e => setInsertDesc(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                </div>

                {/* Coordinate fields for mouse actions */}
                {['click', 'double_click', 'right_click', 'long_press', 'drag'].includes(insertType) && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[12px] text-zinc-500 mb-2">X</label>
                      <input type="text" value={insertCoordX} onChange={e => setInsertCoordX(e.target.value)}
                        placeholder="0" className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[12px] text-zinc-500 mb-2">Y</label>
                      <input type="text" value={insertCoordY} onChange={e => setInsertCoordY(e.target.value)}
                        placeholder="0" className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                    </div>
                  </div>
                )}

                {/* Hotkey/key */}
                {['hotkey', 'key'].includes(insertType) && (
                  <div>
                    <label className="block text-[12px] text-zinc-500 mb-2">按键</label>
                    <input type="text" value={insertKey} onChange={e => setInsertKey(e.target.value)}
                      placeholder="Ctrl+c" className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                  </div>
                )}

                {/* Wait */}
                {insertType === 'wait' && (
                  <div>
                    <label className="block text-[12px] text-zinc-500 mb-2">等待时长 (ms)</label>
                    <input type="number" value={insertWait} onChange={e => setInsertWait(e.target.value)}
                      className="w-32 px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                  </div>
                )}

                {/* Scroll */}
                {insertType === 'scroll' && (
                  <div className="flex gap-3">
                    <div>
                      <label className="block text-[12px] text-zinc-500 mb-2">方向</label>
                      <select value={insertScrollDir} onChange={e => setInsertScrollDir(e.target.value as 'down' | 'up')}
                        className="px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
                        <option value="down">↓ 向下</option>
                        <option value="up">↑ 向上</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-zinc-500 mb-2">距离 (px)</label>
                      <input type="number" value={insertScrollAmt} onChange={e => setInsertScrollAmt(e.target.value)}
                        className="w-24 px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                    </div>
                  </div>
                )}

                {/* Tool call */}
                {insertType === 'tool_call' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[12px] text-zinc-500 mb-2">选择 Tool</label>
                      <select value={insertToolName} onChange={e => { setInsertToolName(e.target.value); setInsertToolArgs({}); }}
                        className="w-full px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
                        <option value="">-- 选择 --</option>
                        {availableTools.map(t => (
                          <option key={`${t.skillName}/${t.toolName}`} value={t.toolName}>
                            [{t.skillName}] {t.toolName} — {t.description.substring(0, 60)}
                          </option>
                        ))}
                      </select>
                      {insertToolName && (
                        <div className="mt-2 text-[11px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900 rounded p-2">
                          {availableTools.find(t => t.toolName === insertToolName)?.description || ''}
                        </div>
                      )}
                    </div>
                    {/* 动态参数 */}
                    {insertToolName && (() => {
                      const tool = availableTools.find(t => t.toolName === insertToolName);
                      const props = (tool?.parameters as any)?.properties as Record<string, { type: string; description?: string }> | undefined;
                      if (!props) return null;
                      return (
                        <div>
                          <label className="block text-[12px] text-zinc-500 mb-2">参数</label>
                          <div className="space-y-2">
                            {Object.entries(props).map(([name, schema]) => (
                              <div key={name}>
                                <label className="block text-[11px] text-zinc-400 mb-0.5">
                                  {name} {schema.type ? `(${schema.type})` : ''}
                                </label>
                                <input
                                  type="text"
                                  value={insertToolArgs[name] || ''}
                                  onChange={e => setInsertToolArgs(prev => ({ ...prev, [name]: e.target.value }))}
                                  placeholder={schema.description || ''}
                                  className="w-full px-2 py-1.5 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* LLM call */}
                {insertType === 'llm_call' && (
                  <div>
                    <label className="block text-[12px] text-zinc-500 mb-2">LLM 提示词</label>
                    <textarea value={insertLLMPrompt} onChange={e => setInsertLLMPrompt(e.target.value)}
                      placeholder="描述 LLM 需要做什么..." rows={5}
                      className="w-full px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-none" />
                  </div>
                )}

                {/* Code */}
                {insertType === 'code' && (
                  <div>
                    <label className="block text-[12px] text-zinc-500 mb-2">代码</label>
                    <textarea value={insertCode} onChange={e => setInsertCode(e.target.value)}
                      placeholder="vars.xxx = ..." rows={5}
                      className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-none" />
                  </div>
                )}

                {/* Loop start */}
                {insertType === 'loop_start' && (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-[12px] text-zinc-500 mb-2">循环次数</label>
                        <input type="text" value={insertToolName} onChange={e => setInsertToolName(e.target.value)}
                          placeholder="{{loop_count}}" className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[12px] text-zinc-500 mb-2">变量名</label>
                        <input type="text" value={insertKey} onChange={e => setInsertKey(e.target.value)}
                          placeholder="loop_index" className="w-full px-3 py-2 text-[13px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                      </div>
                    </div>
                  </div>
                )}

                {/* WaitBefore (for non-wait actions) */}
                {!['wait', 'loop_start', 'loop_end'].includes(insertType) && (
                  <div>
                    <label className="block text-[12px] text-zinc-500 mb-2">等待时间 (ms)</label>
                    <input type="number" value={insertWait} onChange={e => setInsertWait(e.target.value)}
                      className="w-32 px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
                <button onClick={() => setShowInsert(false)}
                  className="flex-1 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-[13px] text-zinc-500">取消</button>
                <button onClick={handleConfirmInsert}
                  className="flex-1 py-2 rounded bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700">
                  {editingStepId ? '保存' : '插入'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Parameter Dialog (page-level) */}
      {showParams && pendingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] max-h-[80vh] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-[14px] font-medium">输入参数 — {pendingTask.description || pendingTask.name}</span>
              <button onClick={() => setShowParams(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {pendingTask.parameters.map((param) => (
                <div key={param.name}>
                  <label className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {param.name}
                    <span className="text-zinc-400 font-normal ml-1">({param.type})</span>
                  </label>
                  <input
                    type="text"
                    value={paramValues[param.name] ?? ''}
                    onChange={(e) => setParamValues({ ...paramValues, [param.name]: e.target.value })}
                    placeholder={param.description}
                    className="w-full px-3 py-2 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
              <button onClick={() => setShowParams(false)}
                className="flex-1 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-[13px] text-zinc-500">取消</button>
              <button onClick={() => {
                const params: Record<string, unknown> = {};
                for (const param of pendingTask.parameters) {
                  const raw = paramValues[param.name]?.trim();
                  if (!raw) continue;
                  if (param.type === 'number') params[param.name] = parseFloat(raw);
                  else if (param.type === 'integer') params[param.name] = parseInt(raw, 10);
                  else params[param.name] = raw;
                }
                doExecute(pendingTask, params);
              }}
                className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700">
                <Play size={14} />执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
