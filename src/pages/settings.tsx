import { Sun, Moon, Monitor, Globe, Activity, Clock, Brain, Trash2, RefreshCw, Edit3, X, Check } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useT, setLocale } from '@/i18n/strings';
import { Switch } from '@/components/ui/switch';
import { globalState } from '@/services/global-state';
import { getMemoryCompressor } from '@/services/memory-compressor';
import type { MemoryEntry } from '@/services/memory-compressor';

export default function SettingsPage() {
  const t = useT();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const locale = useSettingsStore((s) => s.locale);
  const enableGlobalListener = useSettingsStore((s) => s.enableGlobalListener);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const setLocaleState = useSettingsStore((s) => s.setLocale);
  const setEnableGlobalListener = useSettingsStore((s) => s.setEnableGlobalListener);

  // 最近状态变更记录
  const [recentChanges, setRecentChanges] = useState<Array<{ keys: string[]; timestamp: number; state: unknown }>>([]);

  useEffect(() => {
    const loadRecentChanges = async () => {
      const changes = await globalState.getRecentChanges();
      setRecentChanges(changes);
    };
    loadRecentChanges();

    const unsubscribe = globalState.addListener(() => {
      loadRecentChanges();
    });
    return unsubscribe;
  }, []);

  const themes = [
    { id: 'system' as const, label: t('settings.theme.auto'), icon: <Monitor size={18} /> },
    { id: 'light' as const, label: t('settings.theme.light'), icon: <Sun size={18} /> },
    { id: 'dark' as const, label: t('settings.theme.dark'), icon: <Moon size={18} /> },
  ];

  const languages = [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
  ];

  const handleLocaleChange = (l: 'zh' | 'en') => {
    setLocaleState(l);
    setLocale(l);
  };

  const handleToggleGlobalListener = async (enable: boolean) => {
    setEnableGlobalListener(enable);

    // 动态启停全局监听
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (enable) {
        await invoke('start_global_listener');
      } else {
        await invoke('stop_global_listener');
      }
    } catch (e) {
      console.warn('切换全局监听失败:', e);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <h1 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
          {t('settings.title')}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Theme */}
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {t('settings.theme')}
          </h2>
          <div className="flex gap-2">
            {themes.map((th) => (
              <button
                key={th.id}
                onClick={() => setThemeMode(th.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-medium transition-colors ${
                  themeMode === th.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {th.icon}
                {th.label}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {t('settings.language')}
          </h2>
          <div className="flex gap-2">
            {languages.map((lang) => (
              <button
                key={lang.id}
                onClick={() => handleLocaleChange(lang.id as 'zh' | 'en')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-medium transition-colors ${
                  (locale === lang.id || (!locale && lang.id === 'zh'))
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Globe size={18} />
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Global Listener */}
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            数据采集
          </h2>
          <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <Activity size={18} className={enableGlobalListener ? 'text-green-500' : 'text-zinc-400'} />
              <div>
                <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                  全局输入监听
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  记录鼠标点击和键盘操作，用于分析用户行为
                </div>
              </div>
            </div>
            <Switch
              checked={enableGlobalListener}
              onChange={handleToggleGlobalListener}
            />
          </div>
          {enableGlobalListener && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-[11px] text-zinc-500 dark:text-zinc-400">
              💡 关闭后将停止记录用户操作历史，控制台不会再输出输入事件日志
            </div>
          )}

          {/* 最近状态变更 */}
          {recentChanges.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-zinc-400" />
                <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-400">
                  最近状态变更
                </span>
              </div>
              <div className="space-y-2">
                {recentChanges.map((change, i) => (
                  <div
                    key={`${change.timestamp}-${i}`}
                    className="px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800/50 text-[11px]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {change.keys.join(', ')}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-500">
                        {new Date(change.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="text-[10px] text-zinc-500 dark:text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {JSON.stringify(change.state, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 工作目录 ── */}
        <WorkspacePathSetting />

        {/* ── 长期记忆管理 ── */}
        <MemoryManager />
      </div>
    </div>
  );
}

// ── 工作目录设置 ──

function WorkspacePathSetting() {
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const setWorkspacePath = useSettingsStore((s) => s.setWorkspacePath);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(workspacePath || '');
  const [actualPath, setActualPath] = useState('');

  useEffect(() => {
    // Resolve the actual workspace path (user-configured or default)
    const resolveActual = async () => {
      try {
        const { resolveSearchPath } = await import('@/skills/code-tools/shell-utils');
        const path = await resolveSearchPath('workspace');
        setActualPath(path);
      } catch {
        setActualPath(workspacePath || '(默认位置)');
      }
    };
    resolveActual();
  }, [workspacePath]);

  const handleSave = () => {
    const trimmed = inputValue.trim();
    setWorkspacePath(trimmed || null);
    setEditing(false);
    // 更新所有已注册 skill 的工具描述 + 清除路径缓存
    import('@/skills/builtin-executor').then(m => m.updateWorkspacePath?.()).catch(() => {});
  };

  const handleReset = () => {
    setWorkspacePath(null);
    setInputValue('');
    setEditing(false);
    import('@/skills/builtin-executor').then(m => m.updateWorkspacePath?.()).catch(() => {});
  };

  const handleCancel = () => {
    setInputValue(workspacePath || '');
    setEditing(false);
  };

  // Select directory via native dialog (Tauri)
  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: '选择工作目录' });
      if (selected && typeof selected === 'string') {
        setInputValue(selected);
      }
    } catch {
      // Fallback: manual input only
    }
  };

  return (
    <div>
      <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
        工作目录
      </h2>

      <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-500 shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {actualPath || '加载中...'}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {workspacePath ? '自定义路径' : '默认路径（项目根目录/workspace）'} — write_file/read_file/glob 的执行位置
              </div>
            </div>
          </div>
          {!editing && (
            <button
              onClick={() => { setInputValue(workspacePath || ''); setEditing(true); }}
              className="shrink-0 px-3 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              更改
            </button>
          )}
        </div>

        {editing && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="留空使用默认位置，或输入路径如 D:\handy-workspace"
                className="flex-1 px-3 py-2 text-[12px] rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              />
              <button
                onClick={handleBrowse}
                className="shrink-0 px-3 py-2 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="浏览选择目录"
              >
                浏览...
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-blue-500 text-white hover:bg-blue-600"
              >
                保存
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                恢复默认
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-[12px] rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                取消
              </button>
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
              💡 建议选择非 C 盘目录。修改后所有文件操作（write_file、read_file、glob_files 等）将使用新路径。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 记忆管理面板 ──

function MemoryManager() {
  const [profiles, setProfiles] = useState<Array<{ id: string; content: string; importance: number; source_date: string | null }>>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; content: string; importance: number; source_date: string | null }>>([]);
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const compressor = getMemoryCompressor();
      const [p, t] = await Promise.all([
        compressor.getUserProfileEntries(),
        compressor.getTaskHistory(),
      ]);
      const snap = await compressor.getLatestSnapshot();
      setProfiles(p.map((r) => ({ id: r.id, content: r.content, importance: r.importance, source_date: r.source_date })));
      setTasks(t.map((r) => ({ id: r.id ?? '', content: r.content, importance: r.importance, source_date: r.date ?? null })));
      setLastSnapshot(snap);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await getMemoryCompressor().deleteUserProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(String(e));
    }
  };

  const handleEditStart = (item: { id: string; content: string }) => {
    setEditingId(item.id);
    setEditContent(item.content);
  };

  const handleEditSave = async (id: string) => {
    try {
      await getMemoryCompressor().upsertUserProfile(editContent);
      setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, content: editContent } : p));
      setEditingId(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleManualCompress = async () => {
    setCompressing(true);
    setError(null);
    try {
      const { useModelConfigStore } = await import('@/stores/model-config-store');
      const modelStore = useModelConfigStore.getState();
      const provider = modelStore.defaultConfig();
      if (!provider) { setError('没有配置模型'); setCompressing(false); return; }
      const apiKey = await modelStore.getApiKey(provider.id, '');
      if (!apiKey) { setError('无法获取 API Key（可能需要密码解密）'); setCompressing(false); return; }

      const result = await getMemoryCompressor().compress(provider, apiKey);
      if (result) {
        await load(); // Reload after compression
      } else {
        setError('压缩失败，请查看控制台日志');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCompressing(false);
    }
  };

  const importanceColor = (v: number) => {
    if (v >= 8) return 'text-green-600 dark:text-green-400';
    if (v >= 5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-zinc-400 dark:text-zinc-500';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          长期记忆
        </h2>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={handleManualCompress}
            disabled={compressing}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Brain size={12} className={compressing ? 'animate-pulse' : ''} />
            {compressing ? '压缩中...' : '手动压缩'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950 text-[11px] text-red-600 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">关闭</button>
        </div>
      )}

      {lastSnapshot && (
        <div className="mb-3 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-[11px] text-zinc-500 dark:text-zinc-400">
          📅 最近压缩: {lastSnapshot.substring(0, 80)}{lastSnapshot.length > 80 ? '...' : ''}
        </div>
      )}

      <div className="space-y-3">
        {/* 用户画像 */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain size={14} className="text-blue-500" />
            <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              用户画像 ({profiles.length}/10)
            </span>
          </div>
          {profiles.length === 0 ? (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 pl-6">
              暂无。LLM 会在对话中通过 agent_memory_update 自动记录你的偏好。
            </p>
          ) : (
            <div className="space-y-1 pl-6">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between group px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  {editingId === p.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="flex-1 px-2 py-1 text-[12px] rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(p.id); if (e.key === 'Escape') setEditingId(null); }}
                      />
                      <button onClick={() => handleEditSave(p.id)} className="p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-950 rounded"><Check size={14} /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"><X size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-zinc-800 dark:text-zinc-200">{p.content}</span>
                        <span className={`ml-2 text-[10px] ${importanceColor(p.importance)}`}>
                          ★{p.importance}
                        </span>
                      </div>
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button onClick={() => handleEditStart(p)} className="p-1 text-zinc-400 hover:text-blue-500 rounded"><Edit3 size={12} /></button>
                        <button onClick={() => handleDelete(p.id)} className="p-1 text-zinc-400 hover:text-red-500 rounded"><Trash2 size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 任务历史 */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-zinc-400" />
            <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              任务历史 ({tasks.length}/20)
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">每日自动压缩</span>
          </div>
          {tasks.length === 0 ? (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 pl-6">
              暂无。应用每天首次打开时会自动压缩对话生成任务历史。
            </p>
          ) : (
            <div className="space-y-1 pl-6">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-start gap-2 px-2 py-1 rounded-lg">
                  <span className={`mt-0.5 text-[10px] shrink-0 ${importanceColor(t.importance)}`}>
                    ★{t.importance}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[12px] text-zinc-600 dark:text-zinc-400">{t.content}</span>
                    {t.source_date && (
                      <span className="ml-2 text-[10px] text-zinc-400 dark:text-zinc-500">{t.source_date}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
