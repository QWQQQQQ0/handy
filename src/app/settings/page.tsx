// 来源: Phase 10.1 — Settings page: theme, language, defaults

'use client';

import { Sun, Moon, Monitor, Globe } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useT, setLocale } from '@/i18n/strings';

export default function SettingsPage() {
  const t = useT();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const locale = useSettingsStore((s) => s.locale);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const setLocaleState = useSettingsStore((s) => s.setLocale);

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
      </div>
    </div>
  );
}
