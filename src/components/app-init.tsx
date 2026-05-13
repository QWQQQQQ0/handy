// 来源: Phase 10.1 — Initializes app-level state (theme, settings, locale)

'use client';

import { useEffect } from 'react';
import { ThemeProvider } from './theme-provider';
import { useSettingsStore } from '@/stores/settings-store';
import { useModelConfigStore } from '@/stores/model-config-store';
import { setLocale } from '@/i18n/strings';

declare global {
  interface Window {
    __mark_react_ready?: () => void;
  }
}

export function AppInit() {
  const loadSettings = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadConfigs = useModelConfigStore((s) => s.load);
  const locale = useSettingsStore((s) => s.locale);

  useEffect(() => {
    loadSettings();
    loadConfigs();
  }, [loadSettings, loadConfigs]);

  useEffect(() => {
    if (loaded) {
      setLocale(locale ? (locale === 'zh' ? 'zh' : 'en') : 'zh');
    }
  }, [loaded, locale]);

  useEffect(() => {
    window.__mark_react_ready?.();
  }, []);

  return <ThemeProvider />;
}
