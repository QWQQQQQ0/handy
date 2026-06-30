// Handlers for write_file and read_file tools.

import type { SkillResult } from '@/types/skill';
import { SkillOk, SkillFail } from '../skill';
import { tryWriteFile, tryReadFile } from './helpers';

export async function handleWriteFile(params: Record<string, unknown>): Promise<SkillResult> {
  const filePath = params['file_path'] as string;
  const content = params['content'] as string;

  if (!filePath) return SkillFail('file_path is required');
  if (content === undefined) return SkillFail('content is required');

  const result = await tryWriteFile(filePath, content);

  if (result.method === 'memory-cache') {
    return SkillOk(`File written to memory cache: ${filePath}`, {
      file_path: filePath,
      method: result.method,
      note: 'Tauri file-system plugin is not available. Content is cached in memory only.',
    });
  }

  return SkillOk(`File written successfully: ${filePath} (via ${result.method})`, {
    file_path: filePath,
    method: result.method,
  });
}

export async function handleReadFile(params: Record<string, unknown>): Promise<SkillResult> {
  const filePath = params['file_path'] as string;
  if (!filePath) return SkillFail('file_path is required');

  const offset = (params['offset'] as number) ?? 0;
  const limit = (params['limit'] as number) ?? 2000;

  const result = await tryReadFile(filePath);
  if (!result.ok) {
    return SkillFail(result.error || `File not found: ${filePath}`, { file_path: filePath });
  }

  const lines = result.content.split('\n');
  const totalLines = lines.length;
  const sliced = lines.slice(offset, offset + limit);

  return SkillOk(`File read: ${filePath} (lines ${offset}-${offset + sliced.length} of ${totalLines})`, {
    file_path: filePath,
    content: sliced.join('\n'),
    total_line_count: totalLines,
    offset,
    limit,
    method: result.method,
  });
}
