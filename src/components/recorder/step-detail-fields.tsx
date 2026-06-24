/**
 * 步骤详情字段 — 在模板编辑器中展开步骤后显示的可编辑字段
 *
 * recorder-mode 和 tasks.tsx 共用此组件渲染 if/goto/llm_call/坐标/等待/按键等字段。
 * 各自可通过 children 在前后追加自定义内容（如步骤 ID、tool 参数编辑等）。
 */
import { Image, Square as SquareIcon } from 'lucide-react';
import type { TemplateStep } from '@/types/automation-template';
import { VariableHints } from './variable-hints';
import { VariableComboInput } from './variable-combo-input';

export interface StepDetailFieldsProps {
  step: TemplateStep;
  stepIndex: number;
  /** 前序步骤（用于变量提示） */
  previousSteps: TemplateStep[];
  /** 字段变更回调 */
  onEditField: (stepId: string, field: string, value: unknown) => void;
  /** 变量插入回调（点击 VariableHints 的 chip 时触发） */
  onInsertVariable?: (expr: string) => void;
  /** 是否在顶部显示步骤 ID（tasks.tsx 需要） */
  showStepId?: boolean;
  /** 在此组件之后插入的自定义内容 */
  children?: React.ReactNode;
}

export function StepDetailFields({
  step,
  stepIndex,
  previousSteps,
  onEditField,
  onInsertVariable,
  showStepId = false,
  children,
}: StepDetailFieldsProps) {
  const handleInsert = onInsertVariable || ((expr: string) => {
    navigator.clipboard.writeText(expr).catch(() => {});
  });

  return (
    <>
      {/* 步骤 ID */}
      {showStepId && (
        <div className="flex items-center gap-1 text-[9px] text-zinc-400 font-mono">
          <span>ID:</span>
          <span className="select-all" title={step.id}>{step.id}</span>
        </div>
      )}

      {/* 描述 */}
      <div>
        <label className="block text-[10px] text-zinc-500 mb-0.5">描述</label>
        <input
          type="text"
          value={step.description}
          onChange={e => onEditField(step.id, 'description', e.target.value)}
          className="w-full px-2 py-1 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
        />
      </div>

      {/* if 条件编辑 */}
      {step.action === 'if' && (
        <div>
          <label className="block text-[10px] text-zinc-500 mb-0.5">条件表达式</label>
          <VariableComboInput
            value={step.condition || ''}
            onChange={(v) => onEditField(step.id, 'condition', v)}
            placeholder="如: {{index}} >= 5"
            previousSteps={previousSteps}
          />
        </div>
      )}

      {/* goto 目标编辑 */}
      {step.action === 'goto' && (
        <div>
          <label className="block text-[10px] text-zinc-500 mb-0.5">目标步骤 ID</label>
          <input
            type="text"
            value={step.params?.stepId ? String(step.params.stepId) : ''}
            onChange={e => onEditField(step.id, 'stepId', e.target.value)}
            placeholder="步骤 UUID"
            className="w-full px-2 py-1 text-[12px] font-mono rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* llm_call 提示词编辑 */}
      {step.action === 'llm_call' && (
        <div className="space-y-2">
          <div>
            <label className="block text-[10px] text-zinc-500 mb-0.5">系统提示词（可选）</label>
            <input
              type="text"
              value={step.params?.systemPrompt ? String(step.params.systemPrompt) : ''}
              onChange={e => onEditField(step.id, 'systemPrompt', e.target.value)}
              placeholder="系统提示词..."
              className="w-full px-2 py-1 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 mb-0.5">LLM 提示词</label>
            <VariableComboInput
              value={step.params?.prompt ? String(step.params.prompt) : ''}
              onChange={(v) => onEditField(step.id, 'prompt', v)}
              placeholder="发送给 LLM 的提示词... 可用 {{变量}} 模板语法"
              multiline
              rows={3}
              previousSteps={previousSteps}
            />
          </div>
          {step.params?.multimodal && (() => {
            const screenshotIds = (step.params?.include_screenshots || []) as string[];
            return (
              <div className="space-y-1 px-2 py-1.5 rounded bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800">
                <div className="flex items-center gap-1.5">
                  <Image size={12} className="text-purple-500 shrink-0" />
                  <span className="text-[10px] text-purple-600 dark:text-purple-400">
                    多模态 · 附加 {screenshotIds.length} 张截图
                  </span>
                </div>
                {screenshotIds.length > 0 && (
                  <div className="space-y-0.5">
                    {screenshotIds.map(sid => {
                      const src = previousSteps.find(s => s.id === sid);
                      const label = src
                        ? `Step: ${src.action}${src.description ? ' — ' + src.description.substring(0, 30) : ''}`
                        : `(未找到: ${sid.substring(0, 8)}...)`;
                      return (
                        <div key={sid} className="text-[9px] text-purple-500/70 dark:text-purple-400/60 font-mono pl-5">
                          {label}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* else / endif 信息 */}
      {step.action === 'else' && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-2">
          <p className="text-[10px] text-blue-600 dark:text-blue-400">
            else 分支 — 条件不成立时执行此步骤和后续步骤直到 endif。
          </p>
        </div>
      )}
      {step.action === 'endif' && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-2">
          <p className="text-[10px] text-blue-600 dark:text-blue-400">
            endif — 条件分支结束，此后步骤无条件执行。
          </p>
        </div>
      )}

      {/* 坐标 */}
      {step.target?.coordinate && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[10px] text-zinc-500 mb-0.5">X 坐标</label>
            <input
              type="text"
              value={String(step.target.coordinate.x)}
              onChange={e => {
                const v = e.target.value;
                onEditField(step.id, 'coordinate_x', isNaN(parseFloat(v)) ? v : parseFloat(v));
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
                onEditField(step.id, 'coordinate_y', isNaN(parseFloat(v)) ? v : parseFloat(v));
              }}
              className="w-full px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* 等待时间 */}
      {step.waitBefore !== undefined && (
        <div>
          <label className="block text-[10px] text-zinc-500 mb-0.5">等待时间 (ms)</label>
          <input
            type="number"
            value={step.waitBefore}
            onChange={e => onEditField(step.id, 'waitBefore', parseInt(e.target.value) || 0)}
            className="w-24 px-2 py-1 text-[12px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* 按键 */}
      {step.params?.key && (
        <div>
          <label className="block text-[10px] text-zinc-500 mb-0.5">按键</label>
          <input
            type="text"
            value={String(step.params.key)}
            onChange={e => onEditField(step.id, 'key', e.target.value)}
            className="w-40 px-2 py-1 text-[12px] font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* 步骤级变量提示（if / llm_call 有前序步骤时显示） */}
      {(step.action === 'if' || step.action === 'llm_call') && previousSteps.length > 0 && (
        <div className="pt-1">
          <VariableHints
            previousSteps={previousSteps}
            onInsertVariable={handleInsert}
            maxHeight={80}
          />
        </div>
      )}

      {/* 调用方自定义追加内容 */}
      {children}
    </>
  );
}
