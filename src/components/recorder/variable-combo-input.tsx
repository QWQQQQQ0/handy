/**
 * VariableComboInput — 支持变量选择的输入框
 *
 * 既可直接输入文字，也可通过下方变量 chip 将 {{var}} 插入到光标位置。
 * 解决目前只能先复制变量再粘贴的低效问题。
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import { Variable, ChevronDown, ChevronUp, Image, Copy, Terminal, Keyboard, MousePointer } from 'lucide-react';
import type { TemplateStep } from '@/types/automation-template';

export interface VariableSuggestion {
  expr: string;   // 如 {{clipboard}}
  label: string;  // 如 clipboard
  source: string; // 如 "剪贴板文本"
}

export interface VariableComboInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 设为 true 渲染为 textarea */
  multiline?: boolean;
  rows?: number;
  className?: string;
  /** 前序步骤，用于自动提取可用变量 */
  previousSteps?: TemplateStep[];
  /** 额外的自定义变量建议 */
  extraVariables?: VariableSuggestion[];
}

/** 已知的常驻变量 */
const BUILTIN_VARS: VariableSuggestion[] = [
  { expr: '{{clipboard}}', label: 'clipboard', source: '剪贴板文本' },
  { expr: '{{llm_result}}', label: 'llm_result', source: '上一步 llm_call 返回' },
  { expr: '{{index}}', label: 'index', source: '循环轮次索引' },
  { expr: '{{loop_index}}', label: 'loop_index', source: '循环变量名' },
];

/** 从步骤列表中提取可用变量建议 */
function extractStepVariables(steps: TemplateStep[]): VariableSuggestion[] {
  const result: VariableSuggestion[] = [];
  for (const step of steps) {
    if (step.action === 'tool_call') {
      const toolName = (step.params?.toolName as string) || 'unknown';
      // 截图工具 → 提供截图变量
      if (toolName === 'desktop_screenshot' || toolName === 'screenshot') {
        result.push({
          expr: `{{_screenshots['${step.id}']}}`,
          label: 'screenshot',
          source: `${toolName} → 截图 (data URL)`,
        });
      }
      // tool_call 的返回值键
      const keys = parseToolReturnsKeys(step.params?._returns as string | undefined);
      for (const key of keys) {
        if (key === 'success' || key === 'message') continue;
        result.push({ expr: `{{${key}}}`, label: key, source: `${toolName} → ${key}` });
      }
    } else if (step.action === 'llm_call') {
      result.push({ expr: '{{llm_result}}', label: 'llm_result', source: `llm_call 返回文本 (step)` });
    } else if (step.action === 'copy') {
      result.push({ expr: '{{clipboard}}', label: 'clipboard', source: '复制操作的文本' });
    }
  }
  return result;
}

function parseToolReturnsKeys(returns?: string): string[] {
  if (!returns) return [];
  try {
    const keys: string[] = [];
    const keyRe = /"(\w+)"\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(returns)) !== null) {
      if (!keys.includes(m[1])) keys.push(m[1]);
    }
    return keys;
  } catch {
    return [];
  }
}

export function VariableComboInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  className = '',
  previousSteps = [],
  extraVariables = [],
}: VariableComboInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [showVars, setShowVars] = useState(false);

  /** 从 previousSteps 自动提取的变量 */
  const stepVars = useMemo(() => extractStepVariables(previousSteps), [previousSteps]);

  /** 全部可用变量（去重） */
  const allVars = useMemo(() => {
    const seen = new Set<string>();
    const result: VariableSuggestion[] = [];
    for (const v of [...stepVars, ...extraVariables, ...BUILTIN_VARS]) {
      if (!seen.has(v.expr)) {
        seen.add(v.expr);
        result.push(v);
      }
    }
    return result;
  }, [stepVars, extraVariables]);

  /** 在光标位置插入文本 */
  const insertAtCursor = useCallback((text: string) => {
    const el = inputRef.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const newValue = value.slice(0, start) + text + value.slice(end);
    onChange(newValue);

    // 恢复光标位置（放在插入文本之后）
    requestAnimationFrame(() => {
      el.focus();
      const newPos = start + text.length;
      el.setSelectionRange(newPos, newPos);
    });
  }, [value, onChange]);

  const totalVars = allVars.length;

  const Tag = multiline ? 'textarea' : 'input';

  return (
    <div className={`variable-combo-input ${className}`}>
      {/* 输入区 */}
      <Tag
        ref={inputRef as any}
        type={multiline ? undefined : 'text'}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={multiline ? rows : undefined}
        onFocus={() => setShowVars(true)}
        onBlur={() => {
          // 延迟关闭，让 chip 点击事件先触发
          setTimeout(() => setShowVars(false), 200);
        }}
        className="w-full px-2 py-1.5 text-[13px] rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-none"
      />

      {/* 变量提示 bar */}
      {showVars && totalVars > 0 && (
        <div className="mt-1.5 p-1.5 rounded border border-blue-200 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30">
          <div className="flex items-center gap-1 mb-1">
            <Variable size={10} className="text-blue-500 shrink-0" />
            <span className="text-[10px] text-blue-600 dark:text-blue-400">
              点击插入变量 ({totalVars})
            </span>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
            {allVars.map(v => (
              <button
                key={v.expr}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // 防止 blur 先触发
                  insertAtCursor(v.expr);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors cursor-pointer"
                title={v.source}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
