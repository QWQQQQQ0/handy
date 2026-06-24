// LLM calling, response parsing, and JSON repair.

import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';
import type { LLMAnalysisResult } from './types';
import { ModelScenario } from '@/services/llm-gateway/gateway';

/**
 * 逐字符修复 LLM 返回的 JSON 中未转义的双引号
 */
export function fixUnescapedQuotes(jsonStr: string): string {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < jsonStr.length) {
    const ch = jsonStr[i];

    if (ch === '\\' && inString) {
      result += ch;
      i++;
      if (i < jsonStr.length) {
        result += jsonStr[i];
        i++;
      }
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        const next = i + 1 < jsonStr.length ? jsonStr[i + 1] : '';
        if (next === '' || next === ',' || next === ':' || next === ']' || next === '}' || next === '\n' || next === '\r' || next === ' ' || next === '\t') {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
    i++;
  }

  return result;
}

/**
 * 调用 LLM 并返回完整响应文本
 */
export async function callLLM(
  modelService: IModelService,
  provider: ProviderConfig,
  apiKey: string,
  prompt: string,
  timeoutMs = 600000,
  callbacks?: {
    onReasoning?: (text: string) => void;
    onProgress?: (text: string) => void;
  },
): Promise<string> {
  const stream = modelService.chatStream({
    scenario: ModelScenario.recorderAnalysis,
    messages: [{ role: 'user', content: prompt }],
    provider,
    apiKey,
  });

  let result = '';
  let reasoningBuffer = '';
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`LLM request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });

  try {
    const streamIter = (async function* () {
      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) {
          throw new Error(chunk.substring(10));
        }
        if (chunk.startsWith('__REASONING__:')) {
          const reasoning = chunk.substring(14);
          reasoningBuffer += reasoning;
          callbacks?.onReasoning?.(reasoningBuffer);
          continue;
        }
        yield chunk;
      }
    })();

    const consume = async () => {
      for await (const chunk of streamIter) {
        result += chunk;
        callbacks?.onProgress?.(`正在生成模板... (${result.length} 字符)`);
      }
    };

    await Promise.race([consume(), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if (timedOut) {
    throw new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
  }

  return result;
}

/**
 * 从 LLM 响应中提取 JSON 的通用逻辑
 */
function extractJsonFromResponse(response: string): string {
  const trimmed = response.trim();

  let jsonStr = '';
  const fenceStart = trimmed.indexOf('```');
  if (fenceStart !== -1) {
    const contentStart = trimmed.indexOf('\n', fenceStart);
    if (contentStart !== -1) {
      const fenceEnd = trimmed.indexOf('```', contentStart);
      if (fenceEnd !== -1) {
        jsonStr = trimmed.substring(contentStart + 1, fenceEnd).trim();
      }
    }
  }
  if (!jsonStr) {
    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }
  if (!jsonStr) jsonStr = trimmed;

  return jsonStr;
}

/**
 * 解析 LLM 分析响应（含 pattern/dataFlow/parameters/steps）
 */
export function parseLLMResponse(response: string): LLMAnalysisResult {
  const jsonStr = extractJsonFromResponse(response);

  // 第 1 次尝试：直接解析
  try {
    return JSON.parse(jsonStr);
  } catch { /* fall through */ }

  // 第 2 次尝试：修复未转义的引号后解析
  try {
    const fixed = fixUnescapedQuotes(jsonStr);
    return JSON.parse(fixed);
  } catch { /* fall through */ }

  // 第 3 次尝试：正则提取 json 代码块
  const jsonBlockMatch = response.trim().match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch { /* fall through */ }
  }

  console.error('[UnifiedAnalyzer] LLM 返回的完整内容:\n', response);
  throw new Error('Failed to parse LLM response as JSON');
}

/**
 * 解析 refine 响应（简化的模板结构，无 pattern/dataFlow）
 */
export function parseSimpleTemplateResponse(response: string): {
  name?: string;
  description?: string;
  parameters: Array<{ name: string; description?: string; type?: string; required?: boolean; label?: string; default?: unknown }>;
  steps: Array<{ action?: string; description?: string; target?: { semantic?: { role: string; name: string }; path?: string; coordinate?: { x: number | string; y: number | string } }; waitBefore?: number; params?: Record<string, unknown>; control?: { type: string; over?: string; variable?: string; body?: string[] } }>;
} {
  const jsonStr = extractJsonFromResponse(response);

  try { return JSON.parse(jsonStr); } catch { /* fall through */ }

  try {
    const fixed = fixUnescapedQuotes(jsonStr);
    return JSON.parse(fixed);
  } catch { /* fall through */ }

  const jsonBlockMatch = response.trim().match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) {
    try { return JSON.parse(jsonBlockMatch[1].trim()); } catch { /* fall through */ }
  }

  console.error('[UnifiedAnalyzer] refine LLM response parse failed:\n', response);
  throw new Error('Failed to parse refine LLM response as JSON');
}
