// Agent API 中间件 —— 请求路由 + JSON/SSE 响应。
// 可挂载到 Vite dev server 或独立 Node HTTP server。

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AgentEndpoint } from '../api/types';
import type { AgentRequestBody, AgentResponseBody } from '../api/types';
import {
  handleIntentClassifier,
  handleVerification,
  handleChat,
  handleCodeGeneration,
  handleCodeIteration,
  handleUIVisionAnalyze,
  handleUIVisionAnnotate,
  handleUIVisionOcrClassify,
  handleScreenAnalysisDiff,
  handleScreenAnalysisRegions,
  handleScreenAnalysisOcr,
  handleScreenAnalysisInterruption,
  handleDesktopAutomation,
  handleDesktopAutomationTools,
  handleRunCommand,
  handleTaskDecomposer,
  handleTaskVerifier,
  handleDocAgent,
  handleWebAgent,
  handleCodeAgent,
  handleFreeAgent,
} from './handlers';

// ── 路由表：端点 → handler → 是否流式 ──

interface RouteEntry {
  handler: (provider: import('@/types/provider').ProviderConfig, apiKey: string, params: unknown) => unknown;
  streaming: boolean;
  /** false = 不要求 provider/apiKey（如 run_command） */
  requiresProvider?: boolean;
}

type HandlerFn = (provider: import('@/types/provider').ProviderConfig, apiKey: string, params: unknown) => unknown;

const routes: Record<string, RouteEntry> = {
  [AgentEndpoint.intentClassifier]:           { handler: handleIntentClassifier as HandlerFn,        streaming: true },
  [AgentEndpoint.verification]:               { handler: handleVerification as HandlerFn,            streaming: false },
  [AgentEndpoint.chat]:                       { handler: handleChat as HandlerFn,                    streaming: true },
  [AgentEndpoint.codeGeneration]:             { handler: handleCodeGeneration as HandlerFn,          streaming: true },
  [AgentEndpoint.codeIteration]:              { handler: handleCodeIteration as HandlerFn,           streaming: true },
  [AgentEndpoint.uiVisionAnalyze]:            { handler: handleUIVisionAnalyze as HandlerFn,         streaming: false },
  [AgentEndpoint.uiVisionAnnotate]:           { handler: handleUIVisionAnnotate as HandlerFn,        streaming: false },
  [AgentEndpoint.uiVisionOcrClassify]:        { handler: handleUIVisionOcrClassify as HandlerFn,     streaming: false },
  [AgentEndpoint.screenAnalysisDiff]:         { handler: handleScreenAnalysisDiff as HandlerFn,      streaming: false },
  [AgentEndpoint.screenAnalysisRegions]:      { handler: handleScreenAnalysisRegions as HandlerFn,   streaming: false },
  [AgentEndpoint.screenAnalysisOcr]:          { handler: handleScreenAnalysisOcr as HandlerFn,       streaming: false },
  [AgentEndpoint.screenAnalysisInterruption]: { handler: handleScreenAnalysisInterruption as HandlerFn, streaming: false },
  [AgentEndpoint.desktopAutomation]:          { handler: handleDesktopAutomation as HandlerFn,       streaming: true },
  [AgentEndpoint.desktopAutomationTools]:     { handler: handleDesktopAutomationTools as HandlerFn,  streaming: true },
  [AgentEndpoint.runCommand]:                 { handler: handleRunCommand as HandlerFn,              streaming: false, requiresProvider: false },
  [AgentEndpoint.taskDecomposer]:             { handler: handleTaskDecomposer as HandlerFn,          streaming: true },
  [AgentEndpoint.taskVerifier]:               { handler: handleTaskVerifier as HandlerFn,            streaming: true },
  [AgentEndpoint.docAgent]:                   { handler: handleDocAgent as HandlerFn,               streaming: true },
  [AgentEndpoint.webAgent]:                   { handler: handleWebAgent as HandlerFn,               streaming: true },
  [AgentEndpoint.codeAgent]:                  { handler: handleCodeAgent as HandlerFn,              streaming: true },
  [AgentEndpoint.freeAgent]:                  { handler: handleFreeAgent as HandlerFn,              streaming: true },
};

// ── 请求体解析 ──

import { existsSync } from 'node:fs';

async function parseBody(req: IncomingMessage): Promise<AgentRequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      reject(new Error('Request body timeout (30s)'));
    }, 30000);
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      clearTimeout(timeout);
      try {
        const buf = Buffer.concat(chunks);
        console.log(`[parseBody] raw=${buf.length}B`);

        const tryDecode = (encoding: 'utf8' | 'gbk'): string => {
          if (encoding === 'utf8') return buf.toString('utf-8');
          return new TextDecoder('gbk').decode(buf);
        };

        // Decode with both encodings and try JSON.parse
        const utf8Body = tryDecode('utf8');
        const gbkBody = tryDecode('gbk');

        let utf8Obj: any = null;
        let gbkObj: any = null;
        try { utf8Obj = JSON.parse(utf8Body); } catch { /* ignore */ }
        try { gbkObj = JSON.parse(gbkBody); } catch { /* ignore */ }

        // Helper: check if a cwd path exists on disk (used as tiebreaker)
        const cwdExists = (obj: any): boolean => {
          const cwd = obj?.params?.cwd;
          if (!cwd || typeof cwd !== 'string' || cwd.length === 0) return true; // no cwd → can't use as tiebreaker, assume ok
          return existsSync(cwd);
        };

        // ── Resolution ──
        // Case 1: only UTF-8 parses → use it (most common: pure ASCII or correct UTF-8)
        if (utf8Obj && !gbkObj) {
          console.log(`[parseBody] ✓ UTF-8 only (${utf8Body.length} chars)`);
          resolve(utf8Obj as AgentRequestBody);
          return;
        }
        // Case 2: only GBK parses → use it (GBK-encoded Chinese)
        if (gbkObj && !utf8Obj) {
          console.log(`[parseBody] ✓ GBK only (${gbkBody.length} chars)`);
          resolve(gbkObj as AgentRequestBody);
          return;
        }
        // Case 3: both parse successfully → use cwd existence as tiebreaker
        if (utf8Obj && gbkObj) {
          const utf8Ok = cwdExists(utf8Obj);
          const gbkOk = cwdExists(gbkObj);
          if (utf8Ok && !gbkOk) {
            console.log(`[parseBody] ✓ UTF-8 (cwd tiebreaker, ${utf8Body.length} chars)`);
            resolve(utf8Obj as AgentRequestBody);
            return;
          }
          if (gbkOk && !utf8Ok) {
            console.log(`[parseBody] ✓ GBK (cwd tiebreaker, ${gbkBody.length} chars)`);
            resolve(gbkObj as AgentRequestBody);
            return;
          }
          // Both or neither cwd exists → prefer UTF-8
          console.log(`[parseBody] ✓ UTF-8 (default, ${utf8Body.length} chars)`);
          resolve(utf8Obj as AgentRequestBody);
          return;
        }

        // Case 4: neither parses → error
        throw new Error(
          `Neither encoding produced valid JSON. ` +
          `UTF-8 preview: "${utf8Body.slice(0, 80)}" | ` +
          `GBK preview: "${gbkBody.slice(0, 80)}"`
        );
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e}`));
      }
    });
    req.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ── JSON 响应 ──

function sendJson(res: ServerResponse, status: number, body: AgentResponseBody): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── SSE 响应 ──

function sendSSE(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

function sendSSEEvent(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ── 主入口：处理请求 ──

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '';
  const method = req.method?.toUpperCase() ?? '';

  // 只处理 POST 请求
  if (method !== 'POST') return false;

  // 匹配路由
  const route = routes[url];
  if (!route) return false;

  try {
    const body = await parseBody(req);
    const { provider, apiKey, params } = body;

    // 某些端点（如 run_command）不需要 provider/apiKey
    if (route.requiresProvider !== false && (!provider || !apiKey)) {
      sendJson(res, 400, { ok: false, error: 'Missing provider or apiKey' });
      return true;
    }

    if (route.streaming) {
      // 流式响应 (SSE)
      sendSSE(res);

      try {
        const stream = route.handler(provider!, apiKey!, params) as AsyncGenerator<string>;
        for await (const chunk of stream) {
          if (chunk.startsWith('__TOOLS__:')) {
            try {
              const tools = JSON.parse(chunk.substring(10));
              sendSSEEvent(res, { type: 'tools', content: tools });
            } catch {
              sendSSEEvent(res, { type: 'text', content: chunk });
            }
          } else if (chunk.startsWith('__ERROR__:')) {
            sendSSEEvent(res, { type: 'error', content: chunk.substring(10) });
          } else if (chunk.startsWith('__REASONING__:')) {
            sendSSEEvent(res, { type: 'reasoning', content: chunk.substring(14) });
          } else {
            sendSSEEvent(res, { type: 'text', content: chunk });
          }
        }
        sendSSEEvent(res, { type: 'done' });
      } catch (e) {
        sendSSEEvent(res, { type: 'error', content: String(e) });
        sendSSEEvent(res, { type: 'done' });
      }
      res.end();
    } else {
      // 非流式响应 (JSON)
      try {
        const data = await (route.handler(provider!, apiKey!, params) as Promise<unknown>);
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    }
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e) });
  }

  return true;
}
