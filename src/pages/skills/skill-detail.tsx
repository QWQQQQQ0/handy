import { useState, useEffect } from 'react';
import { ArrowLeft, Monitor, Globe, Smartphone, AppWindow, Code, Play, Trash2, Pencil, Settings, BookOpen } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useT } from '@/i18n/strings';
import { getBuiltinExecutor, getBuiltinSkill } from '@/skills/builtin-executor';
import type { SkillTool } from '@/skills/skill';
import type { UserSkillConfig } from '@/types/skill';
import { TestDialog, SkillEditorDialog } from './dialogs';

// ── skillIconMap ──

export const skillIconMap: Record<string, React.ReactNode> = {
  desktop_screen: <Monitor size={20} />,
  web_screen: <Globe size={20} />,
  phone_screen: <Smartphone size={20} />,
  app_builder: <AppWindow size={20} />,
};

// ── ParametersSection ──

export function ParametersSection({ params, t }: { params: Record<string, unknown>; t: (key: string) => string }) {
  const properties = (params['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (params['required'] as string[]) ?? [];

  if (Object.keys(properties).length === 0) {
    return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">{t('skills.noParams')}</p>;
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase mb-1">{t('skills.parameters')}</p>
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

// ── ToolCard ──

export function ToolCard({ skillId, tool, isBuiltin, skillConfig }: { skillId: string; tool: SkillTool; isBuiltin: boolean; skillConfig?: UserSkillConfig }) {
  const { disabledTools, disableTool, enableTool } = useSettingsStore();
  const t = useT();
  const storeLocale = useSettingsStore((s) => s.locale);
  const isZh = storeLocale === 'zh' || !storeLocale;
  // For user-defined skills: use exposedToAI from config; for built-in: use disabledTools
  const isDisabled = isBuiltin ? disabledTools.has(tool.name) : skillConfig?.exposedToAI === false;
  const [testOpen, setTestOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const displayName = (isZh && tool.nameCn) || tool.name;
  const displayDesc = (isZh && tool.descriptionCn) || tool.description;

  const handleToggleExpose = async () => {
    if (isBuiltin) {
      isDisabled ? enableTool(tool.name) : disableTool(tool.name);
    } else if (skillConfig) {
      const { updateSkill } = useSkillStore.getState();
      await updateSkill({ ...skillConfig, exposedToAI: isDisabled });
    }
  };

  const handleDelete = async () => {
    if (isBuiltin) {
      // 内置 tool：永久禁用（从 LLM 工具列表中移除）
      disableTool(tool.name);
    } else if (skillConfig) {
      // 用户自定义 skill：从 tools 数组中移除该 tool
      const newTools = skillConfig.tools.filter(t => t.name !== tool.name);
      if (newTools.length === 0) {
        // 如果删光了，至少保留一个空占位
        return;
      }
      const { updateSkill } = useSkillStore.getState();
      await updateSkill({ ...skillConfig, tools: newTools });
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className={`border rounded-lg p-4 space-y-3 ${isDisabled ? 'border-zinc-200 dark:border-zinc-700 opacity-70' : 'border-zinc-200 dark:border-zinc-700'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Code size={16} className="text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-200">{displayName}</h4>
            {isZh && tool.nameCn && <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">{tool.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setTestOpen(true)} className="flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <Play size={12} /> {t('skills.test')}
          </button>
          <button onClick={() => setShowDeleteConfirm(true)} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950" title={t('skills.delete')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{displayDesc}</p>
      <ParametersSection params={tool.parameters} t={t} />
      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div>
          <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{t('skills.expose')}</p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{isDisabled ? t('skills.exposeOff') : t('skills.exposeOn')}</p>
        </div>
        <button onClick={handleToggleExpose}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDisabled ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-blue-600'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDisabled ? 'translate-x-1' : 'translate-x-6'}`} />
        </button>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-6 max-w-sm w-full">
              <p className="text-[14px] text-zinc-800 dark:text-zinc-200 mb-1 font-semibold">
                {isBuiltin ? `禁用工具 "${displayName}"？` : `从 Skill 中删除 "${displayName}"？`}
              </p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mb-4">
                {isBuiltin
                  ? '该工具将不再发送给 AI，可在设置中恢复。'
                  : '该工具将从 Skill 定义中永久移除。'}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t('skills.cancel')}</button>
                <button onClick={handleDelete} className="px-3 py-1.5 text-[13px] rounded-lg bg-red-600 text-white hover:bg-red-700">删除</button>
              </div>
            </div>
          </div>
        </>
      )}

      {testOpen && <TestDialog skillId={skillId} tool={tool} onClose={() => setTestOpen(false)} isBuiltin={isBuiltin} />}
    </div>
  );
}

// ── KnowledgeSkillDetail ──

export function KnowledgeSkillDetail({ name, onBack }: { name: string; onBack?: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { getKnowledgeSkillBody } = await import('@/skills/builtin-executor');
        const text = await getKnowledgeSkillBody(name);
        setBody(text || '(无内容)');
      } catch {
        setBody('加载失败');
      }
      setLoading(false);
    })();
  }, [name]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 lg:hidden">
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-emerald-500" />
              <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">{name}</h2>
              <span className="px-1 py-0.5 rounded text-[9px] bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400">知识技能</span>
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">流程知识</p>
          </div>
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-800" />

        {loading ? (
          <p className="text-[12px] text-zinc-400">加载中...</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800">
            {body}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SkillDetail ──

export function SkillDetail({ skillId, onBack }: { skillId: string; onBack?: () => void }) {
  const { allConfigs, deleteSkill } = useSkillStore();
  const t = useT();
  const storeLocale = useSettingsStore((s) => s.locale);
  const [showEditor, setShowEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check built-in first
  const builtinSkill = getBuiltinSkill(skillId);
  const cfg = allConfigs.find((c) => c.id === skillId);
  const isBuiltin = !!builtinSkill;
  const isZh = storeLocale === 'zh' || !storeLocale;
  const name = (isZh && (builtinSkill?.nameCn || cfg?.nameCn)) || builtinSkill?.name || cfg?.name || '';
  const description = (isZh && (builtinSkill?.descriptionCn || cfg?.descriptionCn)) || builtinSkill?.description || cfg?.description || '';
  const category = (isZh && (builtinSkill?.categoryCn || cfg?.categoryCn)) || builtinSkill?.category || cfg?.category || '';
  const usage = (isZh && (builtinSkill?.usageCn || cfg?.usageCn)) || builtinSkill?.usage || cfg?.usage || '';
  const tools = builtinSkill?.tools ?? cfg?.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, nameCn: t.nameCn, descriptionCn: t.descriptionCn })) ?? [];

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
    <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
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
              {isBuiltin && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">{t('skills.builtin')}</span>}
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

        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2 font-mono">{t('skills.id')}: {skillId}</p>
        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-6 mb-2">{t('skills.description')}</h3>
        <p className="text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{description}</p>

        {usage && (
          <>
            <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-8 mb-2">{t('skills.usage')}</h3>
            <div className="prose prose-sm dark:prose-invert max-w-none text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{usage}</div>
          </>
        )}

        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-8 mb-3">{t('skills.tools')} ({tools.length})</h3>
        {tools.length === 0 ? (
          <p className="text-[13px] text-zinc-400 dark:text-zinc-500">{t('skills.noTools')}</p>
        ) : (
          <div className="space-y-3">
            {tools.map((tool: SkillTool) => <ToolCard key={tool.name} skillId={skillId} tool={tool} isBuiltin={isBuiltin} skillConfig={cfg} />)}
          </div>
        )}

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <>
            <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm p-6">
                <p className="text-[14px] text-zinc-800 dark:text-zinc-200 mb-4">{t('skills.deleteTitle', { name })} {t('skills.deleteConfirm')}</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t('skills.cancel')}</button>
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
