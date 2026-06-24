/**
 * 插入步骤对话框 — 用于录制后手动添加 tool_call / llm_call / 流程控制步骤
 */

import { useState, useEffect, useMemo } from 'react';
import { X, GitBranch, ArrowRight, Image, CheckSquare, Square as SquareIcon } from 'lucide-react';
import type { ManualStep } from '@/types/semantic-event';
import type { TemplateStep } from '@/types/automation-template';

interface InsertStepDialogProps {
  afterEventId?: string;
  /** 已存在的模板步骤（用于截图选择、变量提示） */
  existingSteps?: TemplateStep[];
  /** 新步骤插入位置的索引（只取此位置之前的步骤） */
  insertIndex?: number;
  onClose: () => void;
  onInsert: (step: ManualStep) => void;
}

export function InsertStepDialog({ afterEventId, existingSteps, insertIndex, onClose, onInsert }: InsertStepDialogProps) {
  const [type, setType] = useState<ManualStep['stepType']>('tool_call');
  const [toolName, setToolName] = useState('');
  const [llmPrompt, setLLMPrompt] = useState('');
  const [desc, setDesc] = useState('');
  const [condition, setCondition] = useState('');
  const [gotoStepId, setGotoStepId] = useState('');
  const [multimodal, setMultimodal] = useState(false);
  const [selectedScreenshots, setSelectedScreenshots] = useState<Set<string>>(new Set());
  const [availableTools, setAvailableTools] = useState<Array<{ skillName: string; toolName: string; description: string }>>([]);

  /** 前序步骤中可产生截图的步骤 */
  const screenshotSteps = useMemo(() => {
    if (!existingSteps) return [];
    const steps = insertIndex !== undefined
      ? existingSteps.slice(0, insertIndex)
      : existingSteps;
    return steps.filter(s =>
      s.action === 'desktop_screenshot' ||
      s.action === 'screenshot' ||
      s.action === 'click' ||
      s.action === 'double_click' ||
      s.action === 'right_click' ||
      s.action === 'drag' ||
      s.action === 'desktop_mouse_down'
    ).map((s, i) => ({
      stepId: s.id,
      label: `Step ${existingSteps.indexOf(s) + 1}: ${s.action}${s.description ? ` — ${s.description.substring(0, 40)}` : ''}`,
    }));
  }, [existingSteps, insertIndex]);

  const toggleScreenshot = (stepId: string) => {
    setSelectedScreenshots(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // 加载可用 tools
  useEffect(() => {
    (async () => {
      try {
        const { useSkillStore } = await import('@/stores/skill-store');
        const store = useSkillStore.getState();
        if (!store.loaded) await store.initializeSkills();
        const configs = store.allConfigs;
        const tools: Array<{ skillName: string; toolName: string; description: string }> = [];
        for (const s of configs) {
          for (const t of s.tools) {
            tools.push({ skillName: s.name, toolName: t.name, description: t.description });
          }
        }
        setAvailableTools(tools);
      } catch (e) {
        console.warn('[InsertStepDialog] Failed to load tools:', e);
      }
    })();
  }, []);

  const handleConfirm = () => {
    const step: ManualStep = {
      id: crypto.randomUUID(),
      stepType: type,
      afterEventId,
      description: desc || getDefaultDescription(),
    };
    if (type === 'tool_call') {
      const tool = availableTools.find(t => t.toolName === toolName);
      step.toolName = toolName;
      step.toolDescription = tool?.description || '';
    } else if (type === 'llm_call') {
      step.llmPrompt = llmPrompt;
      step.multimodal = multimodal;
      if (multimodal && selectedScreenshots.size > 0) {
        step.includeScreenshots = [...selectedScreenshots];
      }
    } else if (type === 'if') {
      step.condition = condition;
    } else if (type === 'goto') {
      step.gotoStepId = gotoStepId;
    }
    onInsert(step);
    onClose();
  };

  const getDefaultDescription = (): string => {
    switch (type) {
      case 'tool_call': return `调用 ${toolName}`;
      case 'llm_call': return 'LLM 调用';
      case 'if': return condition ? `如果 ${condition}` : '条件判断';
      case 'else': return '否则';
      case 'endif': return '条件结束';
      case 'goto': return gotoStepId ? `跳转到 ${gotoStepId}` : '无条件跳转';
      default: return '';
    }
  };

  const canConfirm = (): boolean => {
    switch (type) {
      case 'tool_call': return !!toolName;
      case 'llm_call': return !!llmPrompt;
      case 'if': return !!condition;
      case 'goto': return !!gotoStepId;
      case 'else':
      case 'endif': return true;
      default: return false;
    }
  };

  return (
    <div className="absolute inset-0 z-20 bg-white dark:bg-zinc-950 flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <span className="text-[12px] font-medium">插入步骤</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 类型选择 */}
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">步骤类型</label>
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => setType('tool_call')}
              className={`py-1.5 rounded text-[10px] ${type === 'tool_call' ? 'bg-amber-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              🔧 Skill Tool
            </button>
            <button
              onClick={() => setType('llm_call')}
              className={`py-1.5 rounded text-[10px] ${type === 'llm_call' ? 'bg-purple-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              🤖 LLM
            </button>
            <button
              onClick={() => setType('if')}
              className={`py-1.5 rounded text-[10px] flex items-center justify-center gap-1 ${type === 'if' ? 'bg-blue-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              <GitBranch size={10} /> if
            </button>
            <button
              onClick={() => setType('else')}
              className={`py-1.5 rounded text-[10px] ${type === 'else' ? 'bg-blue-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              else
            </button>
            <button
              onClick={() => setType('endif')}
              className={`py-1.5 rounded text-[10px] ${type === 'endif' ? 'bg-blue-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              endif
            </button>
            <button
              onClick={() => setType('goto')}
              className={`py-1.5 rounded text-[10px] flex items-center justify-center gap-1 ${type === 'goto' ? 'bg-blue-600 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
            >
              <ArrowRight size={10} /> goto
            </button>
          </div>
        </div>

        {type === 'tool_call' && (
          <>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">选择 Tool</label>
              <select
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                className="w-full px-2 py-1.5 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
              >
                <option value="">-- 选择 --</option>
                {availableTools.map(t => (
                  <option key={`${t.skillName}/${t.toolName}`} value={t.toolName}>
                    [{t.skillName}] {t.toolName} — {t.description.substring(0, 50)}
                  </option>
                ))}
              </select>
            </div>
            {toolName && (
              <div className="text-[10px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900 rounded p-2">
                {availableTools.find(t => t.toolName === toolName)?.description || ''}
              </div>
            )}
          </>
        )}

        {type === 'llm_call' && (
          <>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">LLM 提示词</label>
              <textarea
                value={llmPrompt}
                onChange={(e) => setLLMPrompt(e.target.value)}
                placeholder="描述 LLM 需要做什么... 可用 {{变量}} 引用前序步骤的输出"
                rows={4}
                className="w-full px-2 py-1.5 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-none"
              />
            </div>

            {/* 多模态开关 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMultimodal(!multimodal); if (multimodal) setSelectedScreenshots(new Set()); }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] transition-colors ${
                  multimodal
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                    : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                }`}
              >
                {multimodal ? <CheckSquare size={11} /> : <SquareIcon size={11} />}
                多模态（附加上下文截图）
              </button>
            </div>

            {/* 截图选择 */}
            {multimodal && (
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">
                  选择要附加的截图步骤
                  <span className="text-zinc-400 ml-1">（{screenshotSteps.length} 个可用）</span>
                </label>
                {screenshotSteps.length === 0 ? (
                  <div className="text-[10px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900 rounded p-2">
                    当前步骤之前没有截图步骤。请先添加 desktop_screenshot 或点击步骤。
                  </div>
                ) : (
                  <div className="max-h-[120px] overflow-y-auto space-y-0.5 bg-zinc-50 dark:bg-zinc-900 rounded p-1.5">
                    {screenshotSteps.map(ss => (
                      <button
                        key={ss.stepId}
                        onClick={() => toggleScreenshot(ss.stepId)}
                        className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] text-left transition-colors ${
                          selectedScreenshots.has(ss.stepId)
                            ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {selectedScreenshots.has(ss.stepId)
                          ? <CheckSquare size={11} className="text-purple-500 shrink-0" />
                          : <SquareIcon size={11} className="text-zinc-400 shrink-0" />
                        }
                        <Image size={11} className="shrink-0" />
                        <span className="truncate">{ss.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* if 条件输入 */}
        {type === 'if' && (
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">
              条件表达式
              <span className="text-zinc-400 ml-1">如: {"{{clipboard}} != ''"}、{"{{index}} >= 5"}</span>
            </label>
            <input
              type="text"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder='{{clipboard}} != ""'
              className="w-full px-2 py-1.5 text-[11px] rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono"
            />
            <div className="mt-2 text-[10px] text-zinc-400 space-y-0.5">
              <p>支持：<code>{"{{var}}"}</code> 模板引用、<code>==</code> <code>!=</code> <code>&gt;</code> <code>&lt;</code> 比较、<code>and</code>/<code>or</code>/<code>not</code> 逻辑</p>
              <p>示例：<code>{"{{index}} >= 5"}</code>、<code>{"{{clipboard}} == ''"}</code>、<code>{"{{title}} includes '完成'"}</code></p>
            </div>
          </div>
        )}

        {/* goto 目标输入 */}
        {type === 'goto' && (
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">
              目标步骤 ID
              <span className="text-zinc-400 ml-1">（在编辑模板时可看到各步骤的 ID）</span>
            </label>
            <input
              type="text"
              value={gotoStepId}
              onChange={(e) => setGotoStepId(e.target.value)}
              placeholder="步骤的 UUID"
              className="w-full px-2 py-1.5 text-[11px] rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono"
            />
          </div>
        )}

        {/* else/endif 提示 */}
        {(type === 'else' || type === 'endif') && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-2">
            <p className="text-[11px] text-blue-600 dark:text-blue-400">
              {type === 'else'
                ? 'else 步骤将作为 if 条件不成立时的分支起点。请确保对应的 if 步骤已存在。'
                : 'endif 步骤标记条件分支的结束。不需要额外配置。'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">步骤描述（可选）</label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述这一步的目的..."
            className="w-full px-2 py-1.5 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>
      <div className="px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 flex gap-1.5 shrink-0">
        <button
          onClick={onClose}
          className="flex-1 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={!canConfirm()}
          className="flex-1 py-1.5 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          插入
        </button>
      </div>
    </div>
  );
}
