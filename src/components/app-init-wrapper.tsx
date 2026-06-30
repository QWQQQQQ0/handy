import { useEffect } from 'react';
import { ThemeProvider } from './theme-provider';
import { useSettingsStore } from '@/stores/settings-store';
import { useModelConfigStore } from '@/stores/model-config-store';
import { setLocale } from '@/i18n/strings';
import { appLogger } from '@/services/app-logger';
import { watcherManager } from '@/services/watcher';
import { getMemoryCompressor } from '@/services/memory-compressor';
import { setApiBaseUrl } from '@/api/client';
import { isTauri } from '@/utils/platform';

export function AppInitWrapper() {
  const loadSettings = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadConfigs = useModelConfigStore((s) => s.load);
  const locale = useSettingsStore((s) => s.locale);

  useEffect(() => {
    const init = async () => {
      // Production Tauri: point API calls to local backend server
      // (Vite dev marks import.meta.env.DEV, so skip there — the Vite middleware handles it)
      if (isTauri() && !(import.meta as any).env?.DEV) {
        setApiBaseUrl('http://localhost:5174');
      }
      loadSettings();
      await loadConfigs();
      appLogger.start();
      watcherManager.restore().catch(() => {});
      watcherManager.initSync().catch(() => {});

      // ── 长期记忆每日压缩（后台静默执行，不阻塞 UI） ──
      scheduleDailyCompression();

    };
    init();
  }, [loadSettings, loadConfigs]);

  useEffect(() => {
    if (loaded) {
      setLocale(locale ? (locale === 'zh' ? 'zh' : 'en') : 'zh');
    }
  }, [loaded, locale]);

  // ── 生产环境 devtools 快捷键：Ctrl+Shift+I 打开 WebView 控制台 ──
  useEffect(() => {
    if (!isTauri()) return;
    const handler = async (e: KeyboardEvent) => {
      // Ctrl+Shift+I (标准 devtools 快捷键) 或 F12
      const isF12 = e.key === 'F12';
      const isCtrlShiftI = e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i');
      if (isF12 || isCtrlShiftI) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          getCurrentWindow().openDevTools();
        } catch (err) {
          console.warn('[devtools] openDevTools failed:', err);
        }
      }
    };
    // 使用 capture 阶段，在 WebView 拦截之前捕获
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  return <ThemeProvider />;
}

/**
 * 检查是否需要执行每日记忆压缩，如果需要则在后台静默执行。
 * 延迟 3 秒启动，避免与应用初始化竞速。
 */
async function scheduleDailyCompression() {
  try {
    const compressor = getMemoryCompressor();
    const needs = await compressor.needsCompression();
    if (!needs) {
      console.log('[MemoryCompressor] No compression needed today — ' +
        `(already done, or < 3 unsummarized messages)`);
      return;
    }

    console.log('[MemoryCompressor] Daily compression needed, starting...');

    // 延迟执行，让 UI 先渲染完毕
    setTimeout(async () => {
      try {
        const modelStore = useModelConfigStore.getState();
        const provider = modelStore.defaultConfig();
        if (!provider) {
          console.log('[MemoryCompressor] No model provider configured, skipping daily compression');
          return;
        }
        // 尝试解密 API key（后台静默执行，无密码时传空字符串）
        const apiKey = await modelStore.getApiKey(provider.id, '');
        if (!apiKey) {
          console.log('[MemoryCompressor] No API key available (可能需要密码解密), skipping daily compression');
          return;
        }
        console.log('[MemoryCompressor] Executing compression with provider:', provider.id);
        await compressor.compress(provider, apiKey);
        console.log('[MemoryCompressor] Daily compression completed successfully');
      } catch (err) {
        console.warn('[MemoryCompressor] Daily compression failed:', err);
      }
    }, 3000);
  } catch (err) {
    console.warn('[MemoryCompressor] needsCompression check failed:', err);
  }
}
