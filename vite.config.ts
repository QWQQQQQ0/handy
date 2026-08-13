import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { agentApiPlugin } from './src/backend/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), agentApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-state': ['zustand', 'immer'],
          'vendor-tauri': ['@tauri-apps/api'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'shiki'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
  server: {
    port: 3000,
    logLevel: 'warn',
    watch: {
      // code agent / doc agent 写入 workspace/ 时不触发 HMR 重载
      // 用绝对路径避免 Windows 上 glob 匹配不可靠的问题
      ignored: [path.resolve(__dirname, 'workspace')],
    },
  },
});
