import { useState } from 'react';
import { Play, CheckCircle, XCircle, Sparkles, X } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useT } from '@/i18n/strings';
import systemPrompts from '@/config/system-prompts.json';
import { UserDefinedSkill } from '@/skills/user-defined';
import { parseStandardSkillMd } from '@/skills/standard-md-parser';
import { getBuiltinExecutor } from '@/skills/builtin-executor';
import { RESERVED_AGENT_NAMES, type UserAgentConfig } from '@/types/agent';
import { ToolSelectorPanel } from '@/components/chat/tool-selector-panel';
import type { SkillTool } from '@/skills/skill';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';

// ── DataView: smart renderer for structured results ──

export function DataView({ data }: { data: Record<string, unknown> }) {
  // Find any array that looks like a list of items (nodes, windows, apps, etc.)
  const arrayKeys = Object.entries(data).filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0);
  const bestKey = arrayKeys.find(([k]) => k === 'nodes' || k === 'windows' || k === 'apps' || k === 'texts')
    ?? arrayKeys[0];

  if (bestKey) {
    const [key, arr] = bestKey;
    const items = arr as Record<string, unknown>[];
    const columns = items.length > 0 ? Object.keys(items[0]).filter(c => c !== '__typename') : [];

    return (
      <div className="mt-2">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">{key} ({items.length})</p>
        <div className="max-h-48 overflow-auto rounded border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                {columns.map(c => (
                  <th key={c} className="px-2 py-1 text-left text-zinc-500 dark:text-zinc-400 font-medium whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 50).map((item, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  {columns.map(c => {
                    const val = item[c];
                    const str = typeof val === 'object' && val !== null
                      ? JSON.stringify(val)
                      : String(val ?? '');
                    return (
                      <td key={c} className="px-2 py-0.5 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={str}>{str}</td>
                    );
                  })}
                </tr>
              ))}
              {items.length > 50 && (
                <tr><td colSpan={columns.length} className="px-2 py-1 text-zinc-400 text-center">... and {items.length - 50} more items</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <pre className="mt-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 overflow-x-auto max-h-48">{JSON.stringify(data, null, 2)}</pre>
  );
}

// ── TestDialog ──

export function TestDialog({ skillId, tool, onClose, isBuiltin }: { skillId: string; tool: SkillTool; onClose: () => void; isBuiltin: boolean }) {
  const t = useT();
  const storeLocale = useSettingsStore((s) => s.locale);
  const isZh = storeLocale === 'zh' || !storeLocale;
  const [values, setValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; data?: Record<string, unknown> } | null>(null);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  const properties = (tool.parameters['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (tool.parameters['required'] as string[]) ?? [];

  const handleExecute = async () => {
    // Validate required params
    const missing = required.filter(r => !values[r]?.trim());
    if (missing.length > 0) {
      setResult({ success: false, message: t('skills.missingParams', { params: missing.join(', ') }) });
      return;
    }

    // Validate JSON for object/array types
    const newJsonErrors: Record<string, string> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = values[key]?.trim();
      if (!raw) continue;
      const type = (schema['type'] as string) ?? 'string';
      if (type === 'object' || type === 'array') {
        try {
          JSON.parse(raw);
        } catch (e) {
          newJsonErrors[key] = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }
    setJsonErrors(newJsonErrors);
    if (Object.keys(newJsonErrors).length > 0) return;

    setExecuting(true);
    setResult(null);
    const params: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = values[key]?.trim();
      if (!raw) continue;
      const type = (schema['type'] as string) ?? 'string';
      if (type === 'integer') params[key] = parseInt(raw, 10);
      else if (type === 'number') params[key] = parseFloat(raw);
      else if (type === 'object' || type === 'array') params[key] = JSON.parse(raw);
      else params[key] = raw;
    }
    try {
      let r;
      if (isBuiltin) {
        const executor = getBuiltinExecutor();
        r = await executor.executeToolCall(tool.name, params);
      } else {
        const configs = useSkillStore.getState().allConfigs;
        const cfg = configs.find((c) => c.id === skillId);
        if (cfg) {
          const skill = new UserDefinedSkill(cfg);
          const executor = getBuiltinExecutor();
          skill.setExecutor(executor);
          r = await skill.execute(tool.name, params);
        } else {
          r = { success: false, message: 'Skill not found' };
        }
      }
      setResult(r);
    } catch (e) {
      setResult({ success: false, message: String(e) });
    }
    setExecuting(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">{t('skills.test')}: {(isZh && tool.nameCn) || tool.name}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
          </div>
          <div className="p-4 space-y-3">
            {Object.keys(properties).length === 0 ? (
              <p className="text-zinc-400 dark:text-zinc-500 text-[13px]">{t('skills.noParams')}</p>
            ) : (
              Object.entries(properties).map(([key, schema]) => {
                const isRequired = required.includes(key);
                const type = (schema['type'] as string) ?? 'string';
                const desc = (schema['description'] as string) ?? '';
                const isJsonType = type === 'object' || type === 'array';
                return (
                  <div key={key}>
                    <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {key}{isRequired && ' *'} <span className="text-zinc-400 font-normal">({type})</span>
                    </label>
                    {isJsonType ? (
                      <>
                        <textarea
                          value={values[key] ?? ''}
                          onChange={(e) => { setValues({ ...values, [key]: e.target.value }); setJsonErrors(prev => { const n = { ...prev }; delete n[key]; return n; }); }}
                          placeholder={desc || `Enter ${type} as JSON`}
                          rows={4}
                          className="w-full px-3 py-1.5 text-[12px] font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-y"
                        />
                        {jsonErrors[key] && <p className="text-[11px] text-red-500 mt-1">{jsonErrors[key]}</p>}
                      </>
                    ) : (
                      <input
                        type="text" value={values[key] ?? ''}
                        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                        placeholder={desc}
                        className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                      />
                    )}
                  </div>
                );
              })
            )}
            {result && (
              <div className={`p-3 rounded-lg border ${result.success ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'}`}>
                <div className="flex items-center gap-2">
                  {result.success ? <CheckCircle size={16} className="text-green-600 dark:text-green-400" /> : <XCircle size={16} className="text-red-600 dark:text-red-400" />}
                  <span className={`text-[13px] font-semibold ${result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{result.success ? t('skills.success') : t('skills.failed')}</span>
                </div>
                <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{result.message}</p>
                {result.data && <DataView data={result.data} />}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t('skills.close')}</button>
            <button onClick={handleExecute} disabled={executing} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {executing ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play size={14} />}
              {t('skills.execute')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── SkillEditorDialog (new / edit) ──

export function SkillEditorDialog({ config, onSave, onClose }: { config?: UserSkillConfig; onSave: (cfg: UserSkillConfig) => void; onClose: () => void }) {
  const [name, setName] = useState(config?.name ?? '');
  const [desc, setDesc] = useState(config?.description ?? '');
  const [toolsJson, setToolsJson] = useState(() => JSON.stringify(config?.tools ?? [{ name: '', description: '', parameters: { type: 'object', properties: {} } }], null, 2));
  const [impl, setImpl] = useState(config?.implementation ?? '');
  const [jsonError, setJsonError] = useState('');

  const handleSave = () => {
    try {
      const tools = JSON.parse(toolsJson) as ToolDefinition[];
      if (!Array.isArray(tools) || tools.length === 0) { setJsonError('Tools must be a non-empty array'); return; }
      setJsonError('');
      onSave({
        id: config?.id ?? crypto.randomUUID(),
        name: name || 'Untitled Skill',
        description: desc,
        category: config?.category ?? 'user',
        tools,
        builtin: config?.builtin ?? false,
        implementation: impl || undefined,
      });
    } catch (e) {
      setJsonError(`Invalid JSON: ${e}`);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">{config ? 'Edit Skill' : 'New Skill'}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Skill" className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="What this skill does..." className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-none" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tools (JSON Schema array)</label>
              <textarea value={toolsJson} onChange={(e) => { setToolsJson(e.target.value); setJsonError(''); }} rows={8} className="w-full px-3 py-2 text-[12px] font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-none" />
              {jsonError && <p className="text-[12px] text-red-500 mt-1">{jsonError}</p>}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">Implementation (JS function body, optional)</label>
              <textarea value={impl} onChange={(e) => setImpl(e.target.value)} rows={6} placeholder="// params: the tool call arguments&#10;// skill: { ok(msg, data?), fail(msg, data?) }&#10;// executor: SkillExecutor for sub-calls&#10;return skill.ok('done', { result: params.x + params.y });" className="w-full px-3 py-2 text-[12px] font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
            <button onClick={handleSave} className="px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save Skill</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── GenerateSkillDialog (LLM) ──

export function GenerateSkillDialog({ onClose, onGenerated }: { onClose: () => void; onGenerated: (cfg: UserSkillConfig) => void }) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<UserSkillConfig | null>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const { useModelConfigStore } = await import('@/stores/model-config-store');
      await useModelConfigStore.getState().load();
      const config = useModelConfigStore.getState().defaultConfig();
      if (!config) throw new Error('No model configured');

      let apiKey = '';
      try { apiKey = await useModelConfigStore.getState().getApiKey(config.id, ''); } catch { /* ignore */ }
      if (!apiKey) throw new Error('API key not configured');

      // 确保 executor 已初始化（code 沙箱工具可用）
      const { initBuiltinExecutor } = await import('@/skills/builtin-executor');
      const skillStore = useSkillStore.getState();
      if (getBuiltinExecutor().allSkills.length === 0) {
        await skillStore.initializeSkills();
        await initBuiltinExecutor(skillStore.allConfigs.filter((c) => c.builtin));
      }
      const executor = getBuiltinExecutor();

      // 注入 model service（供 generate_code 等工具使用）
      try {
        const { getModelService } = await import('@/services/model-service-singleton');
        const { setCodeToolsModelService } = await import('@/skills/builtin-executor');
        setCodeToolsModelService(getModelService(), config, apiKey);
      } catch { /* ignore */ }

      // 复用 code agent 工具集（文件 I/O + 代码沙箱 + Shell + 联网），跳过用户手动选工具
      const { getAgentToolFilter } = await import('@/stores/chat/tool-config');
      const toolFilter = new Set(getAgentToolFilter('code'));

      const { TaskAgentRunner } = await import('@/services/task-agent/runner');
      const { TaskTreeDB } = await import('@/services/multi-agent/task-tree-db');
      const runner = new TaskAgentRunner(executor);
      const taskDB = new TaskTreeDB();
      const taskId = await taskDB.createRoot(prompt, runner.generateAgentId('code'));

      const result = await runner.runAgent({
        taskId,
        agentType: 'code',
        goal: prompt,
        provider: config,
        apiKey,
        maxTurns: 20,
        toolFilter,
        customSystemPrompt: systemPrompts.skillGeneratorAgent,
        onConfirm: async (command) => {
          // execute_code 沙箱已禁 os/subprocess，自动放行；run_command 用系统对话框确认
          if (command.startsWith('[')) return true;
          try {
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            return await confirm(`是否执行命令？\n${command}`, { title: '命令确认', kind: 'warning' });
          } catch {
            return window.confirm(`是否执行命令？\n${command}`);
          }
        },
        onUserInput: async (message, fields) => {
          const values: Record<string, string> = {};
          for (const f of fields) {
            try {
              values[f.key] = window.prompt(`${message}\n${f.label}`) ?? '';
            } catch {
              values[f.key] = '';
            }
          }
          return values;
        },
      });

      // 提取 SKILL.md 文本：优先 finalize 的 summary，其次 lastResponseText / 最后成功工具结果
      let text = (result.summary || result.lastResponseText || result.lastSuccessfulToolResult || '').trim();
      if (!text) throw new Error('Agent 未产出有效结果');

      // 去掉可能的 ``` 代码块围栏
      text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      // 提取 ---...--- frontmatter 块（容忍前后杂文）
      const m = text.match(/---[\s\S]*?---/);
      if (!m) throw new Error('Agent 输出中未找到 SKILL.md frontmatter');
      text = m[0];

      // Parse the response as standard SKILL.md format
      let cfg: UserSkillConfig;
      try {
        const sc = parseStandardSkillMd(text);
        cfg = {
          id: crypto.randomUUID(),
          name: sc.name,
          description: sc.description,
          category: sc['x-i18n']?.category_cn ?? 'user',
          tools: (sc.tools || []).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? { type: 'object', properties: {} },
            returns: t.returns,
            nameCn: t.nameCn,
            descriptionCn: t.descriptionCn,
          })),
          builtin: false,
          nameCn: sc['x-i18n']?.name_cn,
          descriptionCn: sc['x-i18n']?.description_cn,
          categoryCn: sc['x-i18n']?.category_cn,
          usage: sc.usage,
          usageCn: sc['x-i18n']?.usage_cn,
          license: sc.license,
          compatibility: sc.compatibility,
          implementation: sc.implementation,
        };
      } catch {
        // Fallback: try old JSON format for backward compatibility
        const jsonMatch = /\{[\s\S]*\}/.exec(text);
        if (!jsonMatch) throw new Error('No valid SKILL.md or JSON found in response');
        const parsed = JSON.parse(jsonMatch[0]);
        cfg = {
          id: crypto.randomUUID(),
          name: parsed.name || 'Generated Skill',
          description: parsed.description || '',
          category: parsed.category || 'user',
          tools: (parsed.tools || []).map((t: Record<string, unknown>) => ({
            name: t.name as string,
            description: t.description as string,
            parameters: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
          })),
          builtin: false,
          implementation: parsed.implementation as string | undefined,
        };
      }

      setPreview(cfg);
    } catch (e) {
      setError(String(e));
    }
    setGenerating(false);
  };

  if (preview) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">Preview: {preview.name}</h3>
              <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="text-[13px] text-zinc-600 dark:text-zinc-400">{preview.description}</p>
              <p className="text-[12px] font-semibold text-zinc-500">Tools ({preview.tools.length})</p>
              {preview.tools.map((t, i) => (
                <div key={i} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <code className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{t.name}</code>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1">{t.description}</p>
                </div>
              ))}
              {preview.implementation && <pre className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 overflow-x-auto">{preview.implementation}</pre>}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Back</button>
              <button onClick={() => onGenerated(preview)} className="px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save Skill</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">Generate Skill with AI</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
          </div>
          <div className="p-4 space-y-3">
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Describe the skill you want</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="e.g., open Notepad, type hello world, take a screenshot" className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-none" />
            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
            <button onClick={handleGenerate} disabled={generating || !prompt.trim()} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {generating ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Sparkles size={14} />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── AgentEditorDialog ──

export function AgentEditorDialog({ config, allTools, initialToolNames, onSave, onClose }: {
  config: UserAgentConfig | null;
  allTools: SkillTool[];
  initialToolNames: Set<string>;
  onSave: (cfg: UserAgentConfig, toolNames: Set<string>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(config?.name ?? '');
  const [description, setDescription] = useState(config?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? '');
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [toolNames, setToolNames] = useState<Set<string>>(initialToolNames);
  const [showTools, setShowTools] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) { setError('名称为必填项'); return; }
    if (RESERVED_AGENT_NAMES.includes(name.trim().toLowerCase())) {
      setError(`"${name}" 是保留名称，请换一个`);
      return;
    }
    onSave({
      id: config?.id ?? '',
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      toolNames: [...toolNames],
      enabled,
    }, toolNames);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-zinc-950 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-200">
            {config?.id ? '编辑 Agent' : '新建 Agent'}
          </h2>
          <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><XCircle size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-[12px] text-red-600 dark:text-red-400">{error}</div>}

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
              placeholder="如：数据分析师、爬虫助手" />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">描述</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
              placeholder="简短描述这个 Agent 的用途" />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">System Prompt</label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3 py-2 text-[12px] font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 resize-y"
              rows={8}
              placeholder="定义 Agent 的行为规则、能力范围和工作流程..." />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">工具选择 ({toolNames.size})</label>
              <button onClick={() => setShowTools(!showTools)}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">
                {showTools ? '收起' : '展开选择'}
              </button>
            </div>
            {showTools && allTools.length > 0 && (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-[300px] overflow-y-auto">
                <ToolSelectorPanel
                  tools={allTools}
                  selected={toolNames}
                  setSelected={setToolNames}
                  onClose={() => setShowTools(false)}
                  compact
                />
              </div>
            )}
            {toolNames.size > 0 && !showTools && (
              <div className="flex flex-wrap gap-1">
                {[...toolNames].map((tn) => (
                  <span key={tn} className="px-2 py-0.5 rounded text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">{tn}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">允许被系统调用（加入 request_agent 列表）</label>
            <button onClick={() => setEnabled(!enabled)}
              className={`relative w-8 h-5 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">取消</button>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700">保存</button>
        </div>
      </div>
    </div>
  );
}
