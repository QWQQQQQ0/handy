// Handlers for grep_files and glob_files tools.

import type { SkillResult } from '@/types/skill';
import { SkillOk, SkillFail } from '../skill';
import { trySearchFiles, tryGlob } from './shell-utils';

export async function handleSearchFiles(params: Record<string, unknown>): Promise<SkillResult> {
  const pattern = params['pattern'] as string;
  if (!pattern) return SkillFail('pattern is required');

  const searchPath = params['path'] as string | undefined;
  const glob = params['glob'] as string | undefined;
  const caseSensitive = (params['case_sensitive'] as boolean) ?? false;
  const maxResults = (params['max_results'] as number) ?? 100;
  const contextLines = (params['context_lines'] as number) ?? 2;

  const result = await trySearchFiles(pattern, searchPath, glob, caseSensitive, maxResults, contextLines);
  if (!result.ok) return SkillFail(`Search failed${result.error ? `: ${result.error}` : ''}`);

  return SkillOk(`Found ${result.matches.length} match(es) for pattern "${pattern}"`, {
    matches: result.matches,
    count: result.matches.length,
    method: result.method,
  });
}

export async function handleGlob(params: Record<string, unknown>): Promise<SkillResult> {
  const pattern = params['pattern'] as string;
  if (!pattern) return SkillFail('pattern is required');

  const searchPath = (params['path'] as string) ?? undefined; // undefined → home dir in tryGlob

  const result = await tryGlob(pattern, searchPath);
  if (!result.ok) return SkillFail(`Glob search failed${result.error ? `: ${result.error}` : ''}`);

  return SkillOk(`Found ${result.files.length} file(s) matching "${pattern}" (via ${result.method})`, {
    files: result.files.slice(0, 200),
    count: result.files.length,
    method: result.method,
  });
}
