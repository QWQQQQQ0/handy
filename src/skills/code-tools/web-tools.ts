// Handlers for web_search and web_fetch tools.

import type { SkillResult } from '@/types/skill';
import { SkillOk, SkillFail } from '../skill';

export async function handleWebSearch(params: Record<string, unknown>): Promise<SkillResult> {
  const query = params['query'] as string;
  if (!query) return SkillFail('query is required');

  const maxResults = Math.min((params['max_results'] as number) ?? 10, 20);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{
      success: boolean;
      query?: string;
      results?: Array<{ title: string; url: string; snippet: string }>;
      count?: number;
      error?: string;
    }>('web_search', { query, maxResults });

    if (!result.success) {
      return SkillFail(result.error ?? 'Search failed');
    }

    const results = result.results ?? [];
    // Format as readable text for LLM consumption
    const textResults = results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
      .join('\n\n');

    return SkillOk(
      `Found ${results.length} result(s) for "${result.query ?? query}"${textResults ? ':\n\n' + textResults : ''}`,
      {
        query: result.query ?? query,
        results,
        count: results.length,
      },
    );
  } catch (e) {
    return SkillFail(`web_search failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleWebFetch(params: Record<string, unknown>): Promise<SkillResult> {
  const url = params['url'] as string;
  if (!url) return SkillFail('url is required');

  const timeout = (params['timeout'] as number) ?? 25;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{
      success: boolean;
      url?: string;
      status_code?: number;
      content?: string;
      content_length?: number;
      truncated?: boolean;
      error?: string;
    }>('web_fetch', { url, timeout });

    if (!result.success) {
      return SkillFail(result.error ?? 'Fetch failed');
    }

    const truncatedNote = result.truncated ? '\n[Content truncated at 50000 characters]' : '';

    return SkillOk(
      `Fetched ${result.url ?? url} (${result.content_length ?? 0} chars)${truncatedNote}\n\n${result.content ?? ''}`,
      {
        url: result.url ?? url,
        status_code: result.status_code,
        content_length: result.content_length,
        truncated: result.truncated,
        content: result.content,
      },
    );
  } catch (e) {
    return SkillFail(`web_fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
