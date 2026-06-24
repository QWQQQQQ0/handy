import { useEffect } from 'react';
import { ThemeProvider } from './theme-provider';
import { useSettingsStore } from '@/stores/settings-store';
import { useModelConfigStore } from '@/stores/model-config-store';
import { setLocale } from '@/i18n/strings';
import { appLogger } from '@/services/app-logger';
import { watcherManager } from '@/services/watcher';
import { getMemoryCompressor } from '@/services/memory-compressor';

export function AppInitWrapper() {
  const loadSettings = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadConfigs = useModelConfigStore((s) => s.load);
  const locale = useSettingsStore((s) => s.locale);

  useEffect(() => {
    const init = async () => {
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
      console.log('[MemoryCompressor] No compression needed today');
      return;
    }

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
