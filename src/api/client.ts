// Agent API Client —— 前端调用后端 Agent 端点的统一入口。
// 替代直接 import LlmGateway，所有 Agent API 通过此 client 发 HTTP 请求到 Vite 中间件后端。
// 支持普通 JSON 响应和 SSE 流式响应。

import type { AgentRequestBody, AgentResponseBody, SSEEvent } from './types';
import { AgentEndpoint } from './types';
import type { ProviderConfig } from '@/types/provider';
import { computeLLMRequestHash, splitCachedResponse } from '@/services/llm-gateway/gateway';
import { getLLMCallCache, storeLLMCallCache } from '@/services/cache-service';
import type { LLMMessage } from '@/types/message';
import systemPrompts from '@/config/system-prompts.json';
import { getMemoryCompressor } from '@/services/memory-compressor';
import { compressImage } from '@/utils/image';

// ── 系统提示词（前端注入，用户可编辑） ──

const ENDPOINT_PROMPT_KEY: Record<string, keyof typeof systemPrompts> = {
  [AgentEndpoint.chat]: 'chat',
  [AgentEndpoint.desktopAutomation]: 'desktopAutomation',
  [AgentEndpoint.desktopAutomationTools]: 'desktopAutomation',
  [AgentEndpoint.codeGeneration]: 'codeGeneration',
  [AgentEndpoint.codeIteration]: 'codeIteration',
  [AgentEndpoint.docAgent]: 'docAgent',
  [AgentEndpoint.webAgent]: 'webAutomation',
  [AgentEndpoint.codeAgent]: 'codeAgent',
  [AgentEndpoint.freeAgent]: 'freeAgent',
};

async function injectSystemPrompt(
  endpoint: string,
  messages: LLMMessage[],
  goal?: string,
  systemExtra?: string,
): Promise<LLMMessage[]> {
  const key = ENDPOINT_PROMPT_KEY[endpoint];
  if (!key) return messages;
  let prompt = systemPrompts[key] as string;
  if (goal) prompt = prompt.replaceAll('{goal}', goal);

  // 动态注入工具菜单（FreeAgent 渐进式披露）
  if (prompt.includes('{menu}')) {
    try {
      const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
      const { ToolDisclosure, FREE_AGENT_TOOLS } = await import('@/skills/tool-disclosure');
      const executor = getBuiltinExecutor();
      if (executor.allTools.length > 0) {
        const disclosure = new ToolDisclosure({ executor, tools: FREE_AGENT_TOOLS });
        const menuText = disclosure.buildMenuText();
        prompt = prompt.replaceAll('{menu}', menuText);
      } else {
        prompt = prompt.replaceAll('{menu}', '（工具列表加载中，请先调用 tool_detail 查看可用工具）');
      }
    } catch {
      prompt = prompt.replaceAll('{menu}', '');
    }
  }

  // 注入长期记忆（只给 Chat 和 Free agent，doc/code/web 等专职 agent 不需要）
  if (endpoint === AgentEndpoint.chat || endpoint === AgentEndpoint.freeAgent) {
    try {
      const longTermMem = await getMemoryCompressor().buildSystemPromptMemory();
      if (longTermMem) prompt += longTermMem;
    } catch { /* 非致命 — 记忆加载失败不影响对话 */ }
  }

  // 注入知识技能上下文
  if (systemExtra) {
    prompt += systemExtra;
  }

  return [{ role: 'system', content: prompt }, ...messages];
}

// ── 集中截图压缩 ──
// 所有发给 LLM 的 messages 都必须经过此函数。
// 任何代码路径注入的截图都不可能跳过。
//
// ⚠️ 只压缩画质（BMP→JPEG / JPEG 重编码），不裁剪尺寸。
// 尺寸裁剪 + 坐标还原是 computer agent 自己的职责（runner.ts、desktop-automation-agent.ts），
// 外部 skill 不知道坐标还原机制，裁剪会导致坐标错位。

const QUALITY_ONLY_MAX_DIM = 10000; // 远大于任何屏幕分辨率，确保不触发尺寸裁剪

async function compressMessageImages(messages: LLMMessage[]): Promise<number> {
  let count = 0;
  for (const msg of messages) {
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
        try {
          const compressed = await compressImage(part.image_url.url, QUALITY_ONLY_MAX_DIM, 0.45);
          part.image_url.url = compressed.dataUrl;
          count++;
        } catch {
          // 压缩失败保留原始 URL — 比不发图好
        }
      }
    }
  }
  if (count > 0) {
    console.log(`[apiClient] 🗜 compressed ${count} screenshot(s) before LLM call (quality only, no resize)`);
  }
  return count;
}

// ── 配置 ──

let _baseUrl = '';

/** 设置后端 API 的 base URL（在 app-init 中调用）。默认空字符串 = 同源。 */
export function setApiBaseUrl(url: string): void {
  _baseUrl = url;
}

export function getApiBaseUrl(): string {
  return _baseUrl;
}

// ── 普通 JSON 请求 ──

export async function apiPost<T = unknown>(
  endpoint: AgentEndpoint,
  provider: ProviderConfig,
  apiKey: string,
  params: Record<string, unknown>,
): Promise<T> {
  // 前端注入系统提示词
  const rawMessages = (params['messages'] as LLMMessage[]) ?? [];
  const goal = params['goal'] as string | undefined;
  if (rawMessages.length > 0) {
    params = { ...params, messages: await injectSystemPrompt(endpoint, rawMessages, goal) };
  }
  // 集中压缩所有截图 — 确保任何代码路径注入的图片都不会跳过压缩
  const postMessages = (params['messages'] as LLMMessage[]) ?? [];
  await compressMessageImages(postMessages);

  // ── 多模态校验 ──
  if (provider.supportsMultimodal === false) {
    const hasAnyImage = postMessages.some((m) => {
      if (typeof m.content === 'string' || !Array.isArray(m.content)) return false;
      return (m.content as Array<{ type: string }>).some((p) => p.type === 'image_url');
    });
    if (hasAnyImage) {
      console.warn(`[apiClient] ⚠️ "${provider.name}" (${provider.model}) 不支持多模态，已自动剥离图片`);
      params = {
        ...params,
        messages: postMessages.map((m) => {
          if (typeof m.content === 'string' || !Array.isArray(m.content)) return m;
          const textParts = (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('\n');
          return { ...m, content: textParts || '(图片已移除：当前模型不支持多模态)' };
        }),
      };
    }
  }

  const url = `${_baseUrl}${endpoint}`;
  const body: AgentRequestBody = { provider, apiKey, params };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`Agent API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as AgentResponseBody<T>;
  if (!json.ok) {
    throw new Error(json.error ?? 'Unknown error');
  }

  return json.data as T;
}

// ── SSE 流式请求 → 兼容旧的 AsyncGenerator<string> 格式 ──

/**
 * 流式请求，返回旧格式的字符串块（向后兼容）。
 * - text → 直接 yield
 * - tools → yield "__TOOLS__:{json}"
 * - error → yield "__ERROR__:{msg}"
 * - reasoning → yield "__REASONING__:{text}"
 */
export async function* apiStreamCompat(
  endpoint: AgentEndpoint,
  provider: ProviderConfig,
  apiKey: string,
  params: Record<string, unknown>,
): AsyncGenerator<string> {
  // 前端注入系统提示词（noSystemPrompt 时跳过）
  const rawMessages = (params['messages'] as LLMMessage[]) ?? [];
  const goal = params['goal'] as string | undefined;
  const systemExtra = params['systemPromptExtra'] as string | undefined;
  const skipPrompt = params['noSystemPrompt'] === true;
  if (rawMessages.length > 0 && !skipPrompt) {
    params = { ...params, messages: await injectSystemPrompt(endpoint, rawMessages, goal, systemExtra) };
  }
  const messages = (params['messages'] as LLMMessage[]) ?? [];
  // 集中压缩所有截图 — 确保任何代码路径注入的图片都不会跳过压缩
  await compressMessageImages(messages);

  // ── 多模态校验：消息含图但 provider 不支持多模态时，剥离图片防止 API 报错 ──
  if (provider.supportsMultimodal === false) {
    const hasAnyImage = messages.some((m) => {
      if (typeof m.content === 'string' || !Array.isArray(m.content)) return false;
      return (m.content as Array<{ type: string }>).some((p) => p.type === 'image_url');
    });
    if (hasAnyImage) {
      console.warn(`[apiClient] ⚠️ "${provider.name}" (${provider.model}) 不支持多模态，已自动剥离图片。请配置支持多模态的模型或关闭图片透传。`);
      params = {
        ...params,
        messages: messages.map((m) => {
          if (typeof m.content === 'string' || !Array.isArray(m.content)) return m;
          const textParts = (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('\n');
          return { ...m, content: textParts || '(图片已移除：当前模型不支持多模态)' };
        }),
      };
    }
  }

  // LLM 缓存已全局禁用（前端 + 后端）
  // 如需重新启用，将 false 改为 params['skipCache'] !== true
  const skipCache = true;

  if (!skipCache) {
    try {
      const tools = (params['tools'] as Record<string, unknown>[]) ?? [];
      const { hash } = computeLLMRequestHash(messages, tools.length > 0 ? tools : undefined, provider.model, provider.type);
      const cached = await getLLMCallCache(hash);
      if (cached) {
        console.log(`[apiStreamCompat] ✓ cache HIT — hash=${hash.substring(0, 12)}`);
        for (const part of splitCachedResponse(cached.response_text)) yield part;
        return;
      }
    } catch { /* 非致命 */ }
  }

  const chunks: string[] = [];
  // 缓冲连续 text 事件，避免极小块（单字/单词）导致频繁渲染和 markdown 解析异常
  let textBuffer = '';
  let lastFlushTime = Date.now();
  const MIN_FLUSH_SIZE = 24;   // 积累 24+ 字符时刷新
  const MAX_FLUSH_MS = 100;    // 或距上次刷新超过 100ms 时刷新（保证低延迟）

  function flushTextBuffer(): string | null {
    if (!textBuffer) return null;
    const chunk = textBuffer;
    textBuffer = '';
    lastFlushTime = Date.now();
    chunks.push(chunk);
    return chunk;
  }

  for await (const event of apiStream(endpoint, provider, apiKey, params)) {
    // 连续 text 事件：先积累缓冲
    if (event.type === 'text') {
      textBuffer += event.content;
      const elapsed = Date.now() - lastFlushTime;
      if (textBuffer.length >= MIN_FLUSH_SIZE || elapsed >= MAX_FLUSH_MS) {
        yield flushTextBuffer()!;
      }
      continue;
    }

    // 非 text 事件：先 flush 已缓冲的 text
    const pending = flushTextBuffer();
    if (pending) yield pending;

    let chunk: string;
    switch (event.type) {
      case 'tools':
        chunk = `__TOOLS__:${JSON.stringify(event.content)}`;
        break;
      case 'error':
        chunk = `__ERROR__:${event.content}`;
        break;
      case 'reasoning':
        chunk = `__REASONING__:${(event as import('./types').SSEReasoningEvent).content}`;
        break;
      case 'done':
        // 流结束：将完整响应写入前端数据库
        try {
          const fullResponse = chunks.join('');
          if (fullResponse.length > 0 && !fullResponse.startsWith('__ERROR__:')) {
            const tools = (params['tools'] as Record<string, unknown>[]) ?? [];
            const { hash: storeHash, requestText } = computeLLMRequestHash(messages, tools.length > 0 ? tools : undefined, provider.model, provider.type);
            await storeLLMCallCache(storeHash, fullResponse, provider.model, provider.type, messages.length, tools.length, requestText);
          }
        } catch { /* 非致命 */ }
        return;
    }
    chunks.push(chunk);
    yield chunk;
  }

  // 流异常结束时 flush 剩余 buffer
  const trailing = flushTextBuffer();
  if (trailing) yield trailing;
}

// ── SSE 流式请求（原始事件） ──

export async function* apiStream(
  endpoint: AgentEndpoint,
  provider: ProviderConfig,
  apiKey: string,
  params: Record<string, unknown>,
): AsyncGenerator<SSEEvent> {
  const url = `${_baseUrl}${endpoint}`;
  const body: AgentRequestBody = { provider, apiKey, params };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`Agent API error ${response.status}: ${text}`);
  }

  if (!response.body) {
    throw new Error('Agent API response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    // SSE format: "data: {...}\n\n"
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.substring(6).trim();
      if (data === '[DONE]') return;

      try {
        const event = JSON.parse(data) as SSEEvent;
        yield event;
      } catch {
        // Skip malformed events
      }
    }

    if (done) {
      if (buffer.trim().length > 0) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed.substring(6).trim() !== '[DONE]') {
          try {
            yield JSON.parse(trimmed.substring(6).trim()) as SSEEvent;
          } catch { /* skip */ }
        }
      }
      break;
    }
  }
}
