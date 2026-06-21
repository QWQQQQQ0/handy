import { Sun, Moon, Monitor, Globe, Activity, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useT, setLocale } from '@/i18n/strings';
import { Switch } from '@/components/ui/switch';
import { globalState } from '@/services/global-state';

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
      </div>
    </div>
  );
}
