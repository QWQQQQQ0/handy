/**
 * 参数输入对话框 — 模板执行前填写参数
 */

import { useState } from 'react';
import { Play } from 'lucide-react';
import type { AutomationTemplate } from '@/types/automation-template';

interface ParamDialogProps {
  template: AutomationTemplate;
  onCancel: () => void;
  onExecute: (params: Record<string, unknown>) => void;
}

export function ParamDialog({ template, onCancel, onExecute }: ParamDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const p of template.parameters) {
      const d = (p as Record<string, unknown>)['default'];
      if (d !== undefined) defaults[p.name] = String(d);
    }
    return defaults;
  });

  const handleExecute = () => {
    const params: Record<string, unknown> = {};
    for (const param of template.parameters) {
      const raw = values[param.name]?.trim();
      const defaultVal = (param as Record<string, unknown>)['default'];
      const value = raw || (defaultVal !== undefined ? String(defaultVal) : '');
      if (!value) continue;
      if (param.type === 'integer') params[param.name] = parseInt(value, 10);
      else if (param.type === 'number') params[param.name] = parseFloat(value);
      else params[param.name] = value;
    }
    onExecute(params);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="text-[12px] font-medium">输入参数</div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
        {template.parameters.map((param) => (
          <div key={param.name}>
            <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-0.5">
              {param.name}
              {param.required && <span className="text-red-500 ml-0.5">*</span>}
              <span className="text-zinc-400 font-normal ml-1">({param.type})</span>
            </label>
            <input
              type="text"
              value={values[param.name] ?? ''}
              onChange={(e) => setValues({ ...values, [param.name]: e.target.value })}
              placeholder={param.description}
              className="w-full px-2 py-1 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
      <div className="px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 flex gap-1.5 shrink-0">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500"
        >
          取消
        </button>
        <button
          onClick={handleExecute}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
        >
          <Play size={12} />
          执行测试
        </button>
      </div>
    </div>
  );
}
