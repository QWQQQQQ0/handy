import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Settings, Plus, Trash2, Pencil, Upload, Sparkles, Database, Bot, BookOpen } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useT } from '@/i18n/strings';
import { UserDefinedSkill } from '@/skills/user-defined';
import { parseStandardSkillMd } from '@/skills/standard-md-parser';
import { initBuiltinExecutor, getBuiltinExecutor, getBuiltinSkill, removeRuntimeSkillSource } from '@/skills/builtin-executor';
import { getSkillRegistry } from '@/skills/sources/registry';
import { useAgentStore } from '@/stores/agent-store';
import type { UserAgentConfig } from '@/types/agent';
import type { SkillTool } from '@/skills/skill';
import type { UserSkillConfig } from '@/types/skill';
import { skillIconMap, SkillDetail, KnowledgeSkillDetail } from './skill-detail';
import { CacheViewer } from './cache-viewer';
import { SkillEditorDialog, GenerateSkillDialog, AgentEditorDialog } from './dialogs';

// ── CategoryHeader ──

function CategoryHeader({ title, count, onDelete }: { title: string; count: number; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-1 group">
      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
        {title}
      </span>
      <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-[10px] text-blue-700 dark:text-blue-300">
        {count}
      </span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-950 text-zinc-400 hover:text-red-500 transition-all"
          title="删除此来源"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// ── Main SkillsPage ──

export default function SkillsPage() {
  const t = useT();
  const { loaded, allConfigs, userSkills, initializeSkills, createSkill, updateSkill } = useSkillStore();
  const { agents: userAgents, loaded: agentsLoaded, load: loadAgents, createAgent, updateAgent, deleteAgent, toggleAgent } = useAgentStore();
  const [tab, setTab] = useState<'skills' | 'agents'>('skills');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [editingAgent, setEditingAgent] = useState<UserAgentConfig | null>(null);
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [agentToolNames, setAgentToolNames] = useState<Set<string>>(new Set());
  const [executorReady, setExecutorReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      await initializeSkills();
      const configs = useSkillStore.getState().allConfigs;
      if (configs.length > 0) {
        await initBuiltinExecutor(configs);
        setExecutorReady(true);
      }
    })();
  }, [initializeSkills]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // Build combined list: built-in skills from executor + user skills from store + knowledge skills
  const storeLocale = useSettingsStore((s) => s.locale);
  const isZh = storeLocale === 'zh' || !storeLocale;
  const builtinSkills = getBuiltinExecutor().allSkills;
  const userSkillList = [...userSkills.values()];
  const knowledgeSkills = useSkillStore(s => s.knowledgeSkills);

  // Group by category
  type SkillItem = { id: string; name: string; category: string; toolsLen: number; isBuiltin: boolean; isKnowledge?: boolean };
  const allItems: SkillItem[] = [
    ...builtinSkills.map((s) => ({ id: s.id, name: (isZh && s.nameCn) || s.name, category: (isZh && s.categoryCn) || s.category, toolsLen: s.tools.length, isBuiltin: true })),
    ...userSkillList.map((s) => ({ id: s.id, name: (isZh && s.nameCn) || s.name, category: (isZh && s.categoryCn) || s.category, toolsLen: s.tools.length, isBuiltin: false })),
    ...knowledgeSkills.map((ks) => ({ id: `ks-${ks.name}`, name: ks.name, category: ks.sourceLabel || '知识技能', toolsLen: 0, isBuiltin: false, isKnowledge: true })),
  ];

  const grouped = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  // 可删除的来源：label → sourceId 映射
  const removableSources = new Map<string, string>();
  for (const source of getSkillRegistry().getSources()) {
    if (source.type === 'directory') {
      removableSources.set(source.label, source.id);
    }
  }

  const handleDeleteSource = async (label: string) => {
    const sourceId = removableSources.get(label);
    if (!sourceId) return;
    if (!confirm(`删除来源 "${label}" 及其所有技能？`)) return;
    await removeRuntimeSkillSource(sourceId);
    setSelectedSkillId(null);
    // 重新初始化 executor
    const store = useSkillStore.getState();
    await initBuiltinExecutor(store.allConfigs);
    setExecutorReady(true);
  };

  const selectedSkill = selectedSkillId ? (getBuiltinSkill(selectedSkillId) ?? userSkills.get(selectedSkillId)) : null;
  const isKnowledgeSelected = selectedSkillId?.startsWith('ks-');
  const selectedKnowledgeName = isKnowledgeSelected ? selectedSkillId!.slice(3) : null;

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
        const mdCfg = parseStandardSkillMd(text);
        cfg = {
          id: crypto.randomUUID(),
          name: mdCfg.name,
          description: mdCfg.description,
          category: mdCfg['x-i18n']?.category_cn ?? 'user',
          tools: mdCfg.tools ?? [],
          builtin: false,
          nameCn: mdCfg['x-i18n']?.name_cn,
          descriptionCn: mdCfg['x-i18n']?.description_cn,
          categoryCn: mdCfg['x-i18n']?.category_cn,
          usage: mdCfg.usage,
          usageCn: mdCfg['x-i18n']?.usage_cn,
          license: mdCfg.license,
          compatibility: mdCfg.compatibility,
        };
      }
      await createSkill(cfg);
      const executor2 = getBuiltinExecutor();
      const userDef = new UserDefinedSkill(cfg);
      userDef.setExecutor(executor2);
    } catch { /* ignore */ }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [createSkill]);

  // 导入目录：选择目录 → 扫描 */README.md → 注册为运行时 skill 源
  const handleImportDir = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: '选择 Skill 目录', multiple: false });
      if (!selected || typeof selected !== 'string') return;

      const dirName = selected.replace(/^.*[\\/]/, '');
      const { addRuntimeSkillSource } = await import('@/skills/builtin-executor');
      await addRuntimeSkillSource(selected, dirName);
      await initializeSkills();
      const store = useSkillStore.getState();
      await initBuiltinExecutor(store.allConfigs);
      setExecutorReady(true);
    } catch (err) {
      console.warn('[skills] importDir failed:', err);
    }
  }, [initializeSkills]);

  // ── Agent handlers ──
  const handleAgentSave = async (cfg: UserAgentConfig) => {
    if (cfg.id && userAgents.some(a => a.id === cfg.id)) {
      await updateAgent(cfg);
    } else {
      await createAgent({ ...cfg, id: crypto.randomUUID() });
    }
    setShowAgentEditor(false);
    setEditingAgent(null);
  };

  const handleAgentDelete = async (id: string) => {
    await deleteAgent(id);
    if (selectedAgentId === id) setSelectedAgentId(null);
  };

  const selectedAgent = selectedAgentId ? userAgents.find(a => a.id === selectedAgentId) ?? null : null;
  const allTools: SkillTool[] = getBuiltinExecutor().allTools;

  if (!loaded || !executorReady || !agentsLoaded) {
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
          <Plus size={16} /> {t('skills.createFirst')}
        </button>
        {showNewDialog && <SkillEditorDialog onSave={handleCreate} onClose={() => setShowNewDialog(false)} />}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
          <button onClick={() => { setTab('skills'); setSelectedSkillId(null); }} className={`px-3 py-1 text-[12px] rounded-md font-medium transition-colors ${tab === 'skills' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
            {t('skills.title')}
          </button>
          <button onClick={() => { setTab('agents'); setSelectedAgentId(null); }} className={`px-3 py-1 text-[12px] rounded-md font-medium transition-colors ${tab === 'agents' ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
            Agents
          </button>
        </div>
        <div className="flex-1" />
        {tab === 'skills' ? (<>
          <input ref={fileInputRef} type="file" accept=".md,.json" onChange={handleImport} className="hidden" />
          <button
            onClick={() => {
              if ((window as any).__TAURI_INTERNALS__) handleImportDir();
              else fileInputRef.current?.click();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Upload size={13} /> {t('skills.import')}
          </button>
          <button onClick={() => setShowGenerateDialog(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950">
            <Sparkles size={13} /> {t('skills.generate')}
          </button>
          <button onClick={() => setShowNewDialog(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus size={13} /> {t('skills.new')}
          </button>
        </>) : (
          <button onClick={() => { setEditingAgent(null); setAgentToolNames(new Set()); setShowAgentEditor(true); }} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus size={13} /> 新建 Agent
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── Skills tab ── */}
        {tab === 'skills' && (<>
        {/* Sidebar */}
        <div className={`${selectedSkillId ? 'hidden lg:block' : 'flex-1'} w-[280px] border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto shrink-0 min-h-0 scrollbar-hide`}>
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category}>
              <CategoryHeader
                title={category}
                count={items.length}
                onDelete={removableSources.has(category) ? () => handleDeleteSource(category) : undefined}
              />
              {items.map((item) => (
                <button key={item.id} onClick={() => setSelectedSkillId(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${item.id === selectedSkillId ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
                  <span className={item.id === selectedSkillId ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}>
                    {item.isKnowledge ? <BookOpen size={20} /> : (skillIconMap[item.id] ?? <Settings size={20} />)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-[13px] font-medium truncate ${item.id === selectedSkillId ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{item.name}</p>
                      {item.isKnowledge && <span className="shrink-0 px-1 py-0.5 rounded text-[9px] bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400">知识</span>}
                      {item.isBuiltin && <span className="shrink-0 px-1 py-0.5 rounded text-[9px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">{t('skills.builtin')}</span>}
                    </div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{item.isKnowledge ? '流程知识' : `${t('skills.tools')} (${item.toolsLen})`}</p>
                  </div>
                </button>
              ))}
              <div className="border-b border-zinc-100 dark:border-zinc-800 mx-4" />
            </div>
          ))}
          {/* Cache entry */}
          <div className="border-b border-zinc-100 dark:border-zinc-800 mx-4" />
          <button onClick={() => setSelectedSkillId('__cache__')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedSkillId === '__cache__' ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
            <span className={selectedSkillId === '__cache__' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}>
              <Database size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-medium truncate ${selectedSkillId === '__cache__' ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>Cache</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">L1 / L2 / L3</p>
            </div>
          </button>
        </div>

        {/* Detail */}
        {selectedSkillId === '__cache__' ? (
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
            <CacheViewer />
          </div>
        ) : isKnowledgeSelected ? (
          <KnowledgeSkillDetail name={selectedKnowledgeName!} onBack={() => setSelectedSkillId(null)} />
        ) : selectedSkill ? (
          <SkillDetail skillId={selectedSkill.id} onBack={() => setSelectedSkillId(null)} />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500">
            <div className="text-center">
              <ArrowLeft size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-[14px]">{t('skills.selectHint')}</p>
            </div>
          </div>
        )}
        </>)}

        {/* ── Agents tab ── */}
        {tab === 'agents' && (<>
        <div className={`${selectedAgentId ? 'hidden lg:block' : 'flex-1'} w-[280px] border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto shrink-0 min-h-0 scrollbar-hide`}>
          <div className="px-4 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">
            用户 Agent ({userAgents.length})
          </div>
          {userAgents.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-zinc-400">暂无，点击右上角新建</p>
          ) : (
            userAgents.map((agent) => (
              <button key={agent.id} onClick={() => setSelectedAgentId(agent.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${agent.id === selectedAgentId ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
                <span className={agent.id === selectedAgentId ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}>
                  <Bot size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-[13px] font-medium truncate ${agent.id === selectedAgentId ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{agent.name}</p>
                    <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${agent.enabled ? 'bg-green-400' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                  </div>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">工具 ({agent.toolNames.length}) {agent.enabled ? '· 已启用' : '· 已禁用'}</p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Agent detail */}
        {selectedAgent ? (
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">{selectedAgent.name}</h2>
                  {selectedAgent.description && <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5">{selectedAgent.description}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => toggleAgent(selectedAgent.id, !selectedAgent.enabled)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${selectedAgent.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
                    {selectedAgent.enabled ? '已启用' : '已禁用'}
                  </button>
                  <button onClick={() => { setEditingAgent(selectedAgent); setAgentToolNames(new Set(selectedAgent.toolNames)); setShowAgentEditor(true); }}
                    className="p-1.5 rounded text-zinc-400 hover:text-blue-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => { if (confirm(`确认删除 Agent "${selectedAgent.name}"？`)) handleAgentDelete(selectedAgent.id); }}
                    className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide mb-2">System Prompt</h3>
                <pre className="text-[12px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">{selectedAgent.systemPrompt || '（未设置）'}</pre>
              </div>

              <div>
                <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide mb-2">已选工具 ({selectedAgent.toolNames.length})</h3>
                {selectedAgent.toolNames.length === 0 ? (
                  <p className="text-[12px] text-zinc-400">无</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.toolNames.map((tn) => (
                      <span key={tn} className="px-2 py-0.5 rounded text-[11px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">{tn}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500">
            <div className="text-center">
              <Bot size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-[14px]">选择一个 Agent 查看详情</p>
            </div>
          </div>
        )}
        </>)}
      </div>

      {/* Dialogs */}
      {showNewDialog && <SkillEditorDialog onSave={handleCreate} onClose={() => setShowNewDialog(false)} />}
      {showGenerateDialog && <GenerateSkillDialog onClose={() => setShowGenerateDialog(false)} onGenerated={handleCreate} />}
      {showAgentEditor && (
        <AgentEditorDialog
          config={editingAgent}
          allTools={allTools}
          initialToolNames={agentToolNames}
          onSave={(cfg, toolNames) => { handleAgentSave({ ...cfg, toolNames: [...toolNames] }); }}
          onClose={() => { setShowAgentEditor(false); setEditingAgent(null); }}
        />
      )}
    </div>
  );
}
