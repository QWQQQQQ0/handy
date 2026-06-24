/**
 * 变量提示面板 — 在模板编辑器中展示前序步骤的输出变量
 * 点击可插入 {{var}} 模板表达式
 */

import { useState, useMemo } from 'react';
import { Variable, Image, ChevronDown, ChevronUp, Copy, Type, MousePointer, Keyboard, Terminal, Globe, Eye } from 'lucide-react';
import type { TemplateStep } from '@/types/automation-template';

interface VariableHintsProps {
  /** 当前步骤之前的所有步骤 */
  previousSteps: TemplateStep[];
  /** 插入变量时的回调 */
  onInsertVariable: (expression: string) => void;
  /** 最大高度 */
  maxHeight?: number;
}

/** 从 returns 描述文本中解析出顶层 key */
function parseReturnsKeys(returns?: string): string[] {
  if (!returns) return [];
  // 匹配 JSON 格式 {\"key\":...} 中的顶层 key
  const match = returns.match(/^\{(["\\]|\w)/);
  if (!match) return [];
  try {
    // 尝试提取键名：匹配 "key": 模式
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

/** 已知的常驻变量 */
const BUILTIN_VARS = [
  { name: 'clipboard', desc: '剪贴板文本 (copy/paste 操作后可用)' },
  { name: 'llm_result', desc: '上一步 llm_call 的返回文本' },
  { name: 'index', desc: '循环中的当前轮次索引' },
  { name: 'loop_index', desc: '循环变量名（由 loop_start 定义）' },
];

/** 步骤图标 */
function stepIcon(action: string) {
  switch (action) {
    case 'tool_call': return <Terminal size={10} />;
    case 'llm_call': return <Variable size={10} />;
    case 'click': case 'double_click': case 'right_click': return <MousePointer size={10} />;
    case 'type': case 'key': case 'hotkey': return <Keyboard size={10} />;
    case 'copy': case 'paste': return <Copy size={10} />;
    case 'screenshot': case 'desktop_screenshot': return <Image size={10} />;
    case 'if': case 'else': case 'endif': case 'goto': return <Variable size={10} />;
    default: return <MousePointer size={10} />;
  }
}

export function VariableHints({ previousSteps, onInsertVariable, maxHeight = 200 }: VariableHintsProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  /** 生成工具调用的建议变量 */
  const stepVariables = useMemo(() => {
    return previousSteps
      .map((step, index) => {
        const vars: Array<{ expr: string; label: string; source: string }> = [];

        if (step.action === 'tool_call') {
          const toolName = (step.params?.toolName as string) || 'unknown';
          const keys = parseReturnsKeys(step.params?._returns as string);
          for (const key of keys) {
            if (key === 'success' || key === 'message') continue;
            vars.push({
              expr: `{{${key}}}`,
              label: key,
              source: `${toolName} → ${key}`,
            });
          }
          // 常用访问模式
          if (keys.includes('windows')) {
            vars.push({
              expr: `{{windows[0].title}}`,
              label: 'windows[0].title',
              source: `${toolName} → 第一个窗口标题`,
            });
          }
          if (keys.includes('count')) {
            vars.push({
              expr: `{{count}}`,
              label: 'count',
              source: `${toolName} → 数量`,
            });
          }
        } else if (step.action === 'desktop_screenshot' || step.action === 'screenshot') {
          vars.push({
            expr: `{{_screenshots['${step.id}']}}`,
            label: 'screenshot',
            source: '截图 (data URL)',
          });
        } else if (step.action === 'copy') {
          vars.push({
            expr: `{{clipboard}}`,
            label: 'clipboard',
            source: '复制操作的文本',
          });
        } else if (step.action === 'llm_call') {
          vars.push({
            expr: `{{llm_result}}`,
            label: 'llm_result',
            source: `LLM 返回文本 (step ${index + 1})`,
          });
        }

        return { step, index, vars };
      })
      .filter(s => s.vars.length > 0);
  }, [previousSteps]);

  const handleCopy = (expr: string) => {
    onInsertVariable(expr);
    setCopied(expr);
    setTimeout(() => setCopied(null), 1500);
  };

  if (previousSteps.length === 0) return null;

  return (
    <div className="border border-blue-200 dark:border-blue-700 rounded-lg overflow-hidden shrink-0">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
      >
        <Variable size={11} className="text-blue-500 shrink-0" />
        <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
          可用变量 ({stepVariables.reduce((sum, s) => sum + s.vars.length, 0)})
        </span>
        <span className="flex-1" />
        {expanded ? <ChevronUp size={10} className="text-blue-400" /> : <ChevronDown size={10} className="text-blue-400" />}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="p-2 space-y-2" style={{ maxHeight, overflowY: 'auto' }}>
          {/* 步骤变量 */}
          {stepVariables.map(({ step, index, vars }) => (
            <div key={step.id}>
              <div className="flex items-center gap-1 text-[10px] text-zinc-400 mb-1">
                {stepIcon(step.action)}
                <span className="truncate">Step {index + 1}: {step.action}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {vars.map(v => (
                  <button
                    key={v.expr}
                    onClick={() => handleCopy(v.expr)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      copied === v.expr
                        ? 'bg-green-200 dark:bg-green-900 text-green-700 dark:text-green-300'
                        : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
                    }`}
                    title={v.source}
                  >
                    {v.label}
                    {copied === v.expr && <span className="ml-1 text-[9px]">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* 常驻变量 */}
          <div className="pt-1.5 border-t border-zinc-200 dark:border-zinc-700">
            <div className="text-[10px] text-zinc-400 mb-1">常驻变量</div>
            <div className="flex flex-wrap gap-1">
              {BUILTIN_VARS.map(v => (
                <button
                  key={v.name}
                  onClick={() => handleCopy(`{{${v.name}}}`)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    copied === `{{${v.name}}}`
                      ? 'bg-green-200 dark:bg-green-900 text-green-700 dark:text-green-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                  title={v.desc}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
