import { useState, useEffect, useCallback, useMemo } from 'react';
import { Database, ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { desktopService, type AppInfo } from '@/services/desktop-service';
import type { UICacheRow, SkillTemplateRow, StepCacheRow, SubGoalCacheRow, LLMCallCacheRow, SemanticAnnotation } from '@/types/cache';
import { getAllUICacheRows, getAllSkillTemplateRows, getAllStepCacheRows, getAllSubGoalCacheRows, getAllLLMCallCacheRows, getAllGoalDecompositionRows, deleteUICache, deleteSkillTemplate, deleteStepCache, deleteSubGoalCache, deleteLLMCallCache, deleteGoalDecomposition, clearAllCache, testCacheHit } from '@/services/cache-service';

// ── CacheHitTester ──

export function CacheHitTester() {
  const [goal, setGoal] = useState('');
  const [windowFP, setWindowFP] = useState('');
  const [results, setResults] = useState<{ level: string; detail: string; entry?: Record<string, unknown> }[] | null>(null);
  const [testing, setTesting] = useState(false);
  const handleTest = async () => {
    if (!goal.trim()) return;
    setTesting(true);
    try {
      const fp = windowFP.trim() || 'manual_test_fp';
      const res = await testCacheHit(goal.trim(), fp);
      setResults(res);
    } catch (e) {
      setResults([{ level: 'error', detail: String(e) }]);
    }
    setTesting(false);
  };

  const levelColors: Record<string, { bg: string; text: string; border: string }> = {
    l3: { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800' },
    l2: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-800' },
    l1: { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' },
    miss: { bg: 'bg-zinc-50 dark:bg-zinc-900', text: 'text-zinc-500', border: 'border-zinc-200 dark:border-zinc-700' },
    error: { bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-600', border: 'border-red-200 dark:border-red-800' },
  };

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/50 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">Cache Hit Tester</span>
        <span className="text-[11px] text-amber-500">Test which cache level would match</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal text (e.g. 打开qq音乐播放音乐)"
            className="flex-1 px-3 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
            onKeyDown={(e) => e.key === 'Enter' && handleTest()}
          />
          <input
            value={windowFP}
            onChange={(e) => setWindowFP(e.target.value)}
            placeholder="Window fingerprint (optional)"
            className="w-48 px-3 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
          />
          <button
            onClick={handleTest}
            disabled={testing || !goal.trim()}
            className="px-3 py-1.5 text-[12px] rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test'}
          </button>
        </div>

        {results && (
          <div className="space-y-2">
            {results.map((r, i) => {
              const c = levelColors[r.level] || levelColors.miss;
              const isHit = r.detail.startsWith('HIT') || r.detail.startsWith('Matched');
              return (
                <div key={i} className={`px-3 py-2 rounded-lg border ${c.border} ${c.bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-bold uppercase ${c.text}`}>{r.level}</span>
                    {isHit && <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500 text-white">HIT</span>}
                    {!isHit && r.level !== 'error' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-300 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300">MISS</span>}
                  </div>
                  <p className={`text-[11px] mt-1 ${c.text}`}>{r.detail}</p>
                  {r.entry && (
                    <pre className="mt-2 p-2 rounded bg-black/5 dark:bg-white/5 text-[10px] text-zinc-600 dark:text-zinc-400 overflow-x-auto max-h-32 overflow-y-auto">
                      {JSON.stringify(r.entry, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── CacheViewer ──

export function CacheViewer() {
  const [uiCache, setUICache] = useState<UICacheRow[]>([]);
  const [stepCache, setStepCache] = useState<StepCacheRow[]>([]);
  const [subgoalCache, setSubgoalCache] = useState<SubGoalCacheRow[]>([]);
  const [llmCallCache, setLlmCallCache] = useState<LLMCallCacheRow[]>([]);
  const [decompositionCache, setDecompositionCache] = useState<Array<{ normalized_goal: string; subgoals_json: string; hit_count: number; created_at: number }>>([]);
  const [savedApps, setSavedApps] = useState<AppInfo[]>([]);
  const [templates, setTemplates] = useState<SkillTemplateRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ l1: true, l2a: true, 'l2b': true, llm: true, gd: false, l3: true, apps: false });
  const [loading, setLoading] = useState(true);
  const [clearMsg, setClearMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ui, step, sg, llm, gd, tpl, apps] = await Promise.all([
        getAllUICacheRows(),
        getAllStepCacheRows(),
        getAllSubGoalCacheRows(),
        getAllLLMCallCacheRows(),
        getAllGoalDecompositionRows(),
        getAllSkillTemplateRows(),
        desktopService.listApps().catch(() => [] as AppInfo[]),
      ]);
      setUICache(ui);
      setStepCache(step);
      setSubgoalCache(sg);
      setLlmCallCache(llm);
      setDecompositionCache(gd);
      setTemplates(tpl);
      setSavedApps(apps);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleClearAll = async () => {
    if (!confirm('Clear all cache data? This cannot be undone.')) return;
    try {
      await clearAllCache();
      await loadAll();
      setClearMsg({ type: 'ok', text: 'All cache cleared.' });
    } catch (e) {
      setClearMsg({ type: 'err', text: `Clear failed: ${e}` });
      await loadAll();
    }
    setTimeout(() => setClearMsg(null), 4000);
  };

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const fmtTime = (ts: number) => {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString();
  };

  // ── Pre-process rows for display (avoid JSON.parse in render loop) ──
  const uiCacheDisplay = useMemo(() => uiCache.map((row) => {
    let annotations: SemanticAnnotation[] = [];
    try { annotations = JSON.parse(row.semantic_annotations || '[]'); } catch { /* */ }
    const isVision = (row.interactive_nodes === '[]' || row.interactive_nodes === '') && annotations.length > 0;
    const nodesTotalLen = row.interactive_nodes_total_len ?? row.interactive_nodes.length;
    const annTotalLen = row.semantic_annotations_total_len ?? row.semantic_annotations.length;
    return { ...row, _annotations: annotations, _isVision: isVision, _nodesTotalLen: nodesTotalLen, _annTotalLen: annTotalLen };
  }), [uiCache]);

  const subgoalDisplay = useMemo(() => subgoalCache.map((row) => {
    let stepsSummary = '';
    try {
      const steps = JSON.parse(row.template_json) as Array<{ action: string; target?: { name?: string }; params?: Record<string, unknown> }>;
      stepsSummary = steps.map(s => {
        let label = s.action;
        if (s.target?.name) label += `("${s.target.name}")`;
        else if (s.params?.text) label += `("${String(s.params.text).substring(0, 15)}")`;
        return label;
      }).join(' → ');
    } catch { /* */ }
    let params: string[] = [];
    try { params = JSON.parse(row.params_json) as string[]; } catch { /* */ }
    return { ...row, _stepsSummary: stepsSummary, _params: params };
  }), [subgoalCache]);

  const templateDisplay = useMemo(() => templates.map((row) => {
    let templateSummary = '';
    try {
      const steps = JSON.parse(row.template_json) as Array<{ action: string; target?: { name?: string } }>;
      templateSummary = steps.map(s => s.target?.name ? `${s.action}("${s.target.name}")` : s.action).join(' → ');
    } catch { /* */ }
    return { ...row, _templateSummary: templateSummary };
  }), [templates]);

  const decompositionDisplay = useMemo(() => decompositionCache.map((row) => {
    let subgoalsSummary = '';
    try {
      const parsed = JSON.parse(row.subgoals_json) as { subgoals?: Array<{ key?: string; description?: string }> };
      subgoalsSummary = (parsed.subgoals ?? []).map(s => s.key ?? s.description ?? '?').join(' → ');
    } catch { /* */ }
    return { ...row, _subgoalsSummary: subgoalsSummary };
  }), [decompositionCache]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-400">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading cache...
      </div>
    );
  }

  const total = uiCache.length + stepCache.length + subgoalCache.length + llmCallCache.length + decompositionCache.length + templates.length + savedApps.length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database size={18} className="text-blue-500" />
          <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">Cache</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500">{total} entries</span>
        </div>
        <div className="flex items-center gap-2">
          {clearMsg && (
            <span className={`text-[11px] ${clearMsg.type === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{clearMsg.text}</span>
          )}
          <button onClick={loadAll} className="flex items-center gap-1 px-2 py-1 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={handleClearAll} className="flex items-center gap-1 px-2 py-1 text-[12px] rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950">
            <Trash2 size={12} /> Clear All
          </button>
        </div>
      </div>

      {/* Cache Hit Tester */}
      <CacheHitTester />

      {/* L1: UI Cache */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('l1')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.l1 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">L1 — UI Fingerprint Cache</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">{uiCache.length}</span>
        </button>
        {expanded.l1 && (
          <div className="overflow-x-auto">
            {uiCache.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No UI cache entries</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[900px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">App</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Fingerprint</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Window FP</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Page FP</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Class</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Nodes (JSON)</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Annotations (JSON)</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Hits</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">TTL</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Created</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Last Hit</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {uiCacheDisplay.map((row) => (
                      <tr key={row.fingerprint} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                          {row.app_name || '-'}
                          {row._isVision && <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400">Vision</span>}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[100px] truncate" title={row.fingerprint}>{row.fingerprint}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[80px] truncate" title={row.window_fp}>{row.window_fp || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[80px] truncate" title={row.page_fp ?? ''}>{row.page_fp || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{row.window_class || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[160px] truncate" title={row.interactive_nodes}>
                          {row._nodesTotalLen > 200
                            ? row.interactive_nodes + `...(${row._nodesTotalLen})`
                            : row.interactive_nodes || '-'}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[160px] truncate" title={row.semantic_annotations}>
                          {row._annTotalLen > 200
                            ? row.semantic_annotations + `...(${row._annTotalLen})`
                            : row.semantic_annotations || '-'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.hit_count}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{row.ttl_days}d</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.created_at)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.last_hit_at)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={async () => { await deleteUICache(row.fingerprint); await loadAll(); }}
                            className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* L2a: Sub-Goal Cache */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('l2a')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.l2a ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">L2a — Sub-Goal Cache</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400">{subgoalCache.length}</span>
        </button>
        {expanded.l2a && (
          <div className="overflow-x-auto">
            {subgoalCache.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No sub-goal cache entries</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[800px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Sub-Goal Key</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">App</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Window FP</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Params</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Template Steps</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Source Goal</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Hits</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Last Used</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {subgoalDisplay.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300 font-semibold">{row.subgoal_key}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{row.app_name || <span className="text-zinc-400 italic">any</span>}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[80px] truncate" title={row.window_fp ?? ''}>{row.window_fp || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{row._params.length > 0 ? row._params.join(', ') : <span className="text-zinc-400 italic">none</span>}</td>
                        <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400 max-w-[240px] truncate" title={row._stepsSummary}>{row._stepsSummary || <span className="text-zinc-400 italic">empty</span>}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[140px] truncate" title={row.source_goal}>{row.source_goal}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.hit_count}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.last_used_at)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={async () => { await deleteSubGoalCache(row.id); await loadAll(); }}
                            className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* L2b: Step Cache */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('l2b')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded['l2b'] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">L2b — Step Cache (goal fragment → element)</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400">{stepCache.length}</span>
        </button>
        {expanded['l2b'] && (
          <div className="overflow-x-auto">
            {stepCache.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No step cache entries</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[700px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Goal Fragment</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Role</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Name</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">App</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Window FP</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Bounds</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Hits</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Last Used</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stepCache.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{row.goal_fragment}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{row.role}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{row.name}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{row.app_name || '-'}</td>
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[80px] truncate" title={row.window_fp || ''}>{row.window_fp || '-'}</td>
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[120px] truncate" title={row.bounds_json || ''}>{row.bounds_json || '-'}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.hit_count}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.last_used_at)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={async () => { await deleteStepCache(row.id); await loadAll(); }}
                          className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* LLM Call Cache */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('llm')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.llm ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">LLM — Call Cache</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-cyan-100 dark:bg-cyan-900 text-cyan-600 dark:text-cyan-400">{llmCallCache.length}</span>
        </button>
        {expanded.llm && (
          <div className="overflow-x-auto">
            {llmCallCache.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No LLM call cache entries</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[900px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Hash</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Model</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Provider</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Msgs</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Tools</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Request</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Response</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Hits</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Created</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {llmCallCache.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[80px] truncate" title={row.request_hash}>{row.request_hash}</td>
                      <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{row.model}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{row.provider_type}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.message_count}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.tool_count}</td>
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[200px] truncate" title={row.request_text || '(not stored)'}>
                        {row.request_text ? `${row.request_text.substring(0, 150)}${row.request_text.length > 150 ? `...(${row.request_text.length})` : ''}` : <span className="text-zinc-400 italic">-</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{row.response_size ?? row.response_text?.length ?? 0} chars</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.hit_count}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.created_at)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={async () => { await deleteLLMCallCache(row.id); await loadAll(); }}
                          className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Goal Decomposition Cache */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('gd')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.gd ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">L2a Helper — Goal Decomposition Cache</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400">{decompositionCache.length}</span>
        </button>
        {expanded.gd && (
          <div className="overflow-x-auto">
            {decompositionCache.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No goal decomposition entries</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[600px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Normalized Goal</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Sub-Goals</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Hits</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Created</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {decompositionDisplay.map((row) => (
                      <tr key={row.normalized_goal} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={row.normalized_goal}>{row.normalized_goal}</td>
                        <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400 max-w-[300px] truncate" title={row._subgoalsSummary}>{row._subgoalsSummary || <span className="text-zinc-400 italic">empty</span>}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.hit_count}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.created_at)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={async () => { await deleteGoalDecomposition(row.normalized_goal); await loadAll(); }}
                            className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* L3: Skill Templates */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('l3')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.l3 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">L3 — Learned Skill Templates</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400">{templates.length}</span>
        </button>
        {expanded.l3 && (
          <div className="overflow-x-auto">
            {templates.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No learned templates</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[900px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Name</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Description</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Params</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Template</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Preconditions</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Learned</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Created</th>
                    <th className="px-3 py-1.5 text-right text-zinc-500">Last Success</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Enabled</th>
                    <th className="px-3 py-1.5 text-center text-zinc-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {templateDisplay.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300 font-semibold">{row.name}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[160px] truncate" title={row.description}>{row.description || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[100px] truncate" title={row.params_json}>{row.params_json || '-'}</td>
                        <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400 max-w-[200px] truncate" title={row._templateSummary}>{row._templateSummary || <span className="text-zinc-400 italic">-</span>}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[120px] truncate" title={row.preconditions_json}>{row.preconditions_json || '-'}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{row.learned_from}x</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.created_at)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmtTime(row.last_success_at ?? 0)}</td>
                        <td className="px-3 py-1.5 text-center">{row.enabled ? <span className="text-green-500">Y</span> : <span className="text-red-400">N</span>}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={async () => { await deleteSkillTemplate(row.id); await loadAll(); }}
                            className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* App Index */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <button onClick={() => toggle('apps')} className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {expanded.apps ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">App Index (Desktop)</span>
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-cyan-100 dark:bg-cyan-900 text-cyan-600 dark:text-cyan-400">{savedApps.length}</span>
        </button>
        {expanded.apps && (
          <div className="overflow-x-auto">
            {savedApps.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-400">No apps indexed</p>
            ) : (
              <table className="w-full text-[11px] font-mono min-w-[500px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                    <th className="px-3 py-1.5 text-left text-zinc-500">Name</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Source</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">Path</th>
                    <th className="px-3 py-1.5 text-left text-zinc-500">App ID</th>
                  </tr>
                </thead>
                <tbody>
                  {savedApps.map((app, i) => (
                    <tr key={`${app.name}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300 font-semibold">{app.name}</td>
                      <td className="px-3 py-1.5 text-zinc-500">
                        <span className={`px-1 py-0.5 rounded text-[9px] ${
                          app.source === 'registry' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                          : app.source === 'shortcut' ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                        }`}>{app.source}</span>
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[250px] truncate" title={app.path}>{app.path || '-'}</td>
                      <td className="px-3 py-1.5 text-zinc-500 max-w-[100px] truncate" title={app.app_id}>{app.app_id || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
