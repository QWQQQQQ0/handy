// 来源: lib/ 中所有 kIsWeb 条件判断

export const isTauri = () =>
  typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

export const isMobile = () =>
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
