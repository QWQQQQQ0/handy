// Backend server entry — starts Agent API on a local port.
// Bundled by esbuild → dist-backend/server.cjs for production sidecar.

import { createServer } from 'node:http';
import { handleRequest } from './middleware';

const PORT = Number(process.env.BACKEND_PORT) || 5174;

// ── 全局错误处理：防止进程静默崩溃 ──
process.on('uncaughtException', (err) => {
  console.error('[backend] UNCAUGHT EXCEPTION:', err.message);
  console.error('[backend] stack:', err.stack ?? '(no stack)');
  // 不退出进程，保持服务运行（但记录完整错误供排查）
});

process.on('unhandledRejection', (reason) => {
  console.error('[backend] UNHANDLED REJECTION:', reason);
  if (reason instanceof Error) {
    console.error('[backend] stack:', reason.stack ?? '(no stack)');
  }
  // 不退出进程
});

const server = createServer(async (req, res) => {
  // CORS — allow Tauri WebView (tauri:// / https://tauri.localhost) to call this server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const handled = await handleRequest(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (e) {
    console.error('[backend] request error:', e instanceof Error ? e.message : String(e));
    if (e instanceof Error && e.stack) {
      console.error('[backend] stack:', e.stack);
    }
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
});

server.on('error', (err) => {
  console.error('[backend] server error:', err.message);
});

server.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`);
});
