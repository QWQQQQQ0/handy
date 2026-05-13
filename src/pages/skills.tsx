import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Monitor, Globe, Smartphone, AppWindow, Code, Eye, EyeOff, Play, CheckCircle, XCircle, Settings, Plus, Trash2, Pencil, Upload, Sparkles, Circle } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useT } from '@/i18n/strings';
import systemPrompts from '@/config/system-prompts.json';
import { SkillExecutor } from '@/skills/executor';
import { DesktopScreenSkill } from '@/skills/desktop';
import { WebScreenSkill } from '@/skills/web';
import { PhoneScreenSkill } from '@/skills/phone';
import { AppBuilderSkill } from '@/skills/app-builder';
import { UserDefinedSkill } from '@/skills/user-defined';
import { parseSkillMarkdown } from '@/skills/loader';
import type { SkillTool } from '@/skills/skill';
import type { Skill } from '@/skills/skill';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';

const skillIconMap: Record<string, React.ReactNode> = {
  desktop_screen: <Monitor size={20} />,
  web_screen: <Globe size={20} />,
  phone_screen: <Smartphone size={20} />,
  app_builder: <AppWindow size={20} />,
};

function getBuiltinExecutor(): SkillExecutor {
  const executor = new SkillExecutor();
  executor.register(new DesktopScreenSkill());
  executor.register(new WebScreenSkill());
  executor.register(new PhoneScreenSkill());
  executor.register(new AppBuilderSkill());
  return executor;
}

function getBuiltinSkill(id: string): Skill | undefined {
  return getBuiltinExecutor().getSkill(id);
}

// ── CategoryHeader ──

function CategoryHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-1">
      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
        {title}
      </span>
      <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-[10px] text-blue-700 dark:text-blue-300">
        {count}
      </span>
    </div>
  );
}

// ── ParametersSection ──

function ParametersSection({ params }: { params: Record<string, unknown> }) {
  const properties = (params['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (params['required'] as string[]) ?? [];

  if (Object.keys(properties).length === 0) {
    return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">No parameters</p>;
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase mb-1">Parameters</p>
      <div className="space-y-1.5">
        {Object.entries(properties).map(([name, schema]) => {
          const isRequired = required.includes(name);
          const type = (schema['type'] as string) ?? 'any';
          const desc = (schema['description'] as string) ?? '';
          return (
            <div key={name} className="flex items-start gap-2">
              <code className="text-[12px] font-mono text-zinc-700 dark:text-zinc-300 min-w-[100px] shrink-0">
                {name}{isRequired && <span className="text-red-500 ml-0.5">*</span>}
              </code>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">{type}</span>
              {desc && <span className="text-[12px] text-zinc-400 dark:text-zinc-500">{desc}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TestDialog ──

function TestDialog({ skillId, tool, onClose, isBuiltin }: { skillId: string; tool: SkillTool; onClose: () => void; isBuiltin: boolean }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; data?: Record<string, unknown> } | null>(null);

  const properties = (tool.parameters['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (tool.parameters['required'] as string[]) ?? [];

  const handleExecute = async () => {
    for (const r of required) { if (!values[r]?.trim()) return; }
    setExecuting(true);
    setResult(null);
    const params: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = values[key]?.trim();
      if (!raw) continue;
      const type = (schema['type'] as string) ?? 'string';
      if (type === 'integer') params[key] = parseInt(raw, 10);
      else if (type === 'number') params[key] = parseFloat(raw);
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
            <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">Test: {tool.name}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
          </div>
          <div className="p-4 space-y-3">
            {Object.keys(properties).length === 0 ? (
              <p className="text-zinc-400 dark:text-zinc-500 text-[13px]">No parameters required.</p>
            ) : (
              Object.entries(properties).map(([key, schema]) => {
                const isRequired = required.includes(key);
                const type = (schema['type'] as string) ?? 'string';
                const desc = (schema['description'] as string) ?? '';
                return (
                  <div key={key}>
                    <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {key}{isRequired && ' *'} <span className="text-zinc-400 font-normal">({type})</span>
                    </label>
                    <input
                      type="text" value={values[key] ?? ''}
                      onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                      placeholder={desc}
                      className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                    />
                  </div>
                );
              })
            )}
            {result && (
              <div className={`p-3 rounded-lg border ${result.success ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'}`}>
                <div className="flex items-center gap-2">
                  {result.success ? <CheckCircle size={16} className="text-green-600 dark:text-green-400" /> : <XCircle size={16} className="text-red-600 dark:text-red-400" />}
                  <span className={`text-[13px] font-semibold ${result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{result.success ? 'Success' : 'Failed'}</span>
                </div>
                <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{result.message}</p>
                {result.data && <pre className="mt-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 overflow-x-auto">{JSON.stringify(result.data, null, 2)}</pre>}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Close</button>
            <button onClick={handleExecute} disabled={executing} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {executing ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play size={14} />}
              Execute
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── ToolCard ──

function ToolCard({ skillId, tool, isBuiltin }: { skillId: string; tool: SkillTool; isBuiltin: boolean }) {
  const { disabledTools, disableTool, enableTool } = useSettingsStore();
  const isDisabled = disabledTools.has(tool.name);
  const [testOpen, setTestOpen] = useState(false);

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Code size={16} className="text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
          <div><h4 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-200">{tool.name}</h4></div>
        </div>
        <button onClick={() => setTestOpen(true)} className="flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 shrink-0">
          <Play size={12} /> Test
        </button>
      </div>
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{tool.description}</p>
      <ParametersSection params={tool.parameters} />
      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div>
          <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Expose to AI</p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{isDisabled ? 'Hidden from AI.' : 'Visible to AI for function calling.'}</p>
        </div>
        <button onClick={() => isDisabled ? enableTool(tool.name) : disableTool(tool.name)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDisabled ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-blue-600'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDisabled ? 'translate-x-1' : 'translate-x-6'}`} />
        </button>
      </div>
      {testOpen && <TestDialog skillId={skillId} tool={tool} onClose={() => setTestOpen(false)} isBuiltin={isBuiltin} />}
    </div>
  );
}

// ── SkillEditorDialog (new / edit) ──

function SkillEditorDialog({ config, onSave, onClose }: { config?: UserSkillConfig; onSave: (cfg: UserSkillConfig) => void; onClose: () => void }) {
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

function GenerateSkillDialog({ onClose, onGenerated }: { onClose: () => void; onGenerated: (cfg: UserSkillConfig) => void }) {
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

      const { ModelCallService, ModelScenario } = await import('@/adapters/model-call-service');
      const modelService = new ModelCallService();

      const systemPrompt = systemPrompts.skillGenerator;

      const stream = modelService.chatStream({
        scenario: ModelScenario.chat,
        messages: [
          { role: 'user', content: systemPrompt },
          { role: 'user', content: `Generate a skill that: ${prompt}` },
        ],
        provider: config,
        apiKey,
      });

      let text = '';
      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) throw new Error(chunk.substring(10));
        if (chunk.startsWith('__TOOLS__:')) continue;
        text += chunk;
      }

      // Try to extract JSON from response
      const jsonMatch = /\{[\s\S]*\}/.exec(text);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const parsed = JSON.parse(jsonMatch[0]);

      const cfg: UserSkillConfig = {
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

// ── SkillDetail ──

function SkillDetail({ skillId, onBack }: { skillId: string; onBack?: () => void }) {
  const { allConfigs, deleteSkill } = useSkillStore();
  const [showEditor, setShowEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check built-in first
  const builtinSkill = getBuiltinSkill(skillId);
  const cfg = allConfigs.find((c) => c.id === skillId);
  const isBuiltin = !!builtinSkill;
  const name = builtinSkill?.name ?? cfg?.name ?? '';
  const description = builtinSkill?.description ?? cfg?.description ?? '';
  const category = builtinSkill?.category ?? cfg?.category ?? '';
  const tools = builtinSkill?.tools ?? cfg?.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) ?? [];

  const handleDelete = async () => {
    await deleteSkill(skillId);
    setShowDeleteConfirm(false);
    onBack?.();
  };

  const handleUpdate = async (updated: UserSkillConfig) => {
    const { updateSkill } = useSkillStore.getState();
    await updateSkill({ ...updated, id: skillId });
    setShowEditor(false);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-3xl">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-4 lg:hidden">
            <ArrowLeft size={16} /> Back to list
          </button>
        )}

        <div className="flex items-start gap-4 mb-4">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950 rounded-xl">
            {skillIconMap[skillId] ?? <Settings size={28} className="text-blue-500" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{name}</h2>
              {isBuiltin && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">Built-in</span>}
              {!isBuiltin && (
                <div className="flex gap-1">
                  <button onClick={() => setShowEditor(true)} className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><Pencil size={14} /></button>
                  <button onClick={() => setShowDeleteConfirm(true)} className="p-1 rounded text-zinc-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">{category}</span>
          </div>
        </div>

        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2 font-mono">ID: {skillId}</p>
        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-6 mb-2">Description</h3>
        <p className="text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{description}</p>

        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-8 mb-3">Tools ({tools.length})</h3>
        {tools.length === 0 ? (
          <p className="text-[13px] text-zinc-400 dark:text-zinc-500">No tools exposed.</p>
        ) : (
          <div className="space-y-3">
            {tools.map((tool: SkillTool) => <ToolCard key={tool.name} skillId={skillId} tool={tool} isBuiltin={isBuiltin} />)}
          </div>
        )}

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <>
            <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm p-6">
                <p className="text-[14px] text-zinc-800 dark:text-zinc-200 mb-4">Delete "{name}"? This cannot be undone.</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
                  <button onClick={handleDelete} className="px-3 py-1.5 text-[13px] rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
                </div>
              </div>
            </div>
          </>
        )}

        {showEditor && cfg && (
          <SkillEditorDialog config={cfg} onSave={handleUpdate} onClose={() => setShowEditor(false)} />
        )}
      </div>
    </div>
  );
}

// ── Main SkillsPage ──

export default function SkillsPage() {
  const t = useT();
  const { loaded, allConfigs, userSkills, initializeSkills, createSkill, updateSkill } = useSkillStore();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { initializeSkills(); }, [initializeSkills]);

  // Build combined list: built-in skills from executor + user skills from store
  const executor = getBuiltinExecutor();
  const builtinSkills = executor.allSkills;
  const userSkillList = [...userSkills.values()];

  // Group by category
  const allItems: Array<{ id: string; name: string; category: string; toolsLen: number; isBuiltin: boolean }> = [
    ...builtinSkills.map((s) => ({ id: s.id, name: s.name, category: s.category, toolsLen: s.tools.length, isBuiltin: true })),
    ...userSkillList.map((s) => ({ id: s.id, name: s.name, category: s.category, toolsLen: s.tools.length, isBuiltin: false })),
  ];

  const grouped = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const selectedSkill = selectedSkillId ? (getBuiltinSkill(selectedSkillId) ?? userSkills.get(selectedSkillId)) : null;

  const handleCreate = async (cfg: UserSkillConfig) => {
    await createSkill(cfg);
    const executor2 = getBuiltinExecutor();
    const userDef = new UserDefinedSkill(cfg);
    userDef.setExecutor(executor2);
    setShowNewDialog(false);
  };

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let cfg: UserSkillConfig;
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        cfg = { id: crypto.randomUUID(), ...parsed, builtin: false, tools: parsed.tools ?? [] };
      } else {
        const mdCfg = parseSkillMarkdown(text);
        cfg = { ...mdCfg, id: crypto.randomUUID(), builtin: false, tools: mdCfg.tools ?? [] };
      }
      await createSkill(cfg);
      const executor2 = getBuiltinExecutor();
      const userDef = new UserDefinedSkill(cfg);
      userDef.setExecutor(executor2);
    } catch (err) { console.error('Import failed:', err); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [createSkill]);

  if (!loaded && allConfigs.length === 0 && builtinSkills.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
        <Settings size={56} className="mb-4 opacity-30" />
        <p className="text-[13px]">Loading skills...</p>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
        <Settings size={56} className="mb-4 opacity-30" />
        <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">{t('skills.empty')}</h2>
        <p className="text-[13px] text-center max-w-xs mb-4">{t('skills.empty.subtitle')}</p>
        <button onClick={() => setShowNewDialog(true)} className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 text-white text-[14px] font-medium hover:bg-blue-700">
          <Plus size={16} /> Create First Skill
        </button>
        {showNewDialog && <SkillEditorDialog onSave={handleCreate} onClose={() => setShowNewDialog(false)} />}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <h1 className="flex-1 text-[14px] font-semibold text-zinc-800 dark:text-zinc-200">Skills</h1>
        <input ref={fileInputRef} type="file" accept=".md,.json" onChange={handleImport} className="hidden" />
        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <Upload size={13} /> Import
        </button>
        <button onClick={() => setShowGenerateDialog(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950">
          <Sparkles size={13} /> Generate
        </button>
        <button onClick={() => setShowNewDialog(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          <Plus size={13} /> New
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className={`${selectedSkill ? 'hidden lg:block' : 'flex-1'} w-[280px] border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto shrink-0`}>
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category}>
              <CategoryHeader title={category} count={items.length} />
              {items.map((item) => (
                <button key={item.id} onClick={() => setSelectedSkillId(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${item.id === selectedSkillId ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
                  <span className={item.id === selectedSkillId ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}>
                    {skillIconMap[item.id] ?? <Settings size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-[13px] font-medium truncate ${item.id === selectedSkillId ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{item.name}</p>
                      {item.isBuiltin && <span className="shrink-0 px-1 py-0.5 rounded text-[9px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">Built-in</span>}
                    </div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{item.toolsLen} tool{item.toolsLen !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              ))}
              <div className="border-b border-zinc-100 dark:border-zinc-800 mx-4" />
            </div>
          ))}
        </div>

        {/* Detail */}
        {selectedSkill ? (
          <SkillDetail skillId={selectedSkill.id} onBack={() => setSelectedSkillId(null)} />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500">
            <div className="text-center">
              <ArrowLeft size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-[14px]">Select a skill to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showNewDialog && <SkillEditorDialog onSave={handleCreate} onClose={() => setShowNewDialog(false)} />}
      {showGenerateDialog && <GenerateSkillDialog onClose={() => setShowGenerateDialog(false)} onGenerated={handleCreate} />}
    </div>
  );
}
