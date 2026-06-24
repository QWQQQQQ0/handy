// Handlers for save_code, list_code, and generate_project tools.

import type { SkillResult } from '@/types/skill';
import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';
import { SkillOk, SkillFail } from '../skill';
import { CodeRegistryDB } from '@/services/code-registry';
import { tryReadFile } from './helpers';

type CodeEntryLanguage = 'javascript' | 'python' | 'sql' | 'html';

const codeRegistry = new CodeRegistryDB();

export interface RegistryEnv {
  modelService: IModelService | null;
  provider: ProviderConfig | null;
  apiKey: string | null;
}

export async function handleSaveCode(params: Record<string, unknown>): Promise<SkillResult> {
  const name = params['name'] as string;
  const code = params['code'] as string;
  const language = params['language'] as string;
  const description = (params['description'] as string) ?? '';
  const tags = (params['tags'] as string[]) ?? [];

  if (!name) return SkillFail('name is required');
  if (!code) return SkillFail('code is required');
  if (!language) return SkillFail('language is required');

  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await codeRegistry.save({
      id,
      name,
      description,
      language: language as CodeEntryLanguage,
      code,
      params: [],
      tags,
      createdAt: now,
      updatedAt: now,
      hitCount: 0,
    });

    return SkillOk(`Code "${name}" saved successfully`, { id, name, language });
  } catch (e) {
    return SkillFail(`Failed to save code: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleListCode(params: Record<string, unknown>): Promise<SkillResult> {
  const search = params['search'] as string | undefined;
  const language = params['language'] as string | undefined;
  const tag = params['tag'] as string | undefined;

  try {
    const entries = await codeRegistry.list({ search, language, tag });
    return SkillOk(`Found ${entries.length} code entr${entries.length === 1 ? 'y' : 'ies'}`, {
      entries: entries.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        language: e.language,
        tags: e.tags,
        createdAt: e.createdAt,
        hitCount: e.hitCount,
      })),
      count: entries.length,
    });
  } catch (e) {
    return SkillFail(`Failed to list code: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleGenerateProject(params: Record<string, unknown>, env: RegistryEnv): Promise<SkillResult> {
  const request = params['request'] as string;
  if (!request) return SkillFail('request is required');

  if (!env.modelService || !env.provider || !env.apiKey) {
    return SkillFail('ModelService is not configured. Call setModelService() first.');
  }

  const rawName = (params['project_name'] as string) ?? '';
  const projectName = rawName.trim() || `project-${Date.now().toString(36)}`;

  try {
    // Dynamic import: codeGateway → Orchestrator → AgentRunner → node:fs/promises
    // Must not be statically imported or Vite externalizes it for browser.
    const { codeGateway } = await import('@/services/code-gateway');
    const result = await codeGateway.handleRequest({
      userRequest: request,
      projectName,
      modelService: env.modelService,
      provider: env.provider,
      apiKey: env.apiKey,
    });

    if (!result.success) {
      return SkillFail(`Project generation failed: ${result.error}`, {
        project_name: projectName,
        error: result.error,
      });
    }

    const files = Array.isArray(result.result) ? result.result as string[] : [];
    const textResult = typeof result.result === 'object' && result.result !== null && 'type' in result.result
      ? (result.result as { type: string; content?: string; blocks?: unknown[] })
      : null;

    // Try to read generated file contents
    const fileContents: Array<{ path: string; content: string }> = [];
    for (const f of files) {
      const readResult = await tryReadFile(f);
      if (readResult.ok) {
        fileContents.push({ path: f, content: readResult.content });
      }
    }

    if (fileContents.length > 0) {
      return SkillOk(`Project "${projectName}" generated successfully with ${fileContents.length} file(s)`, {
        project_name: projectName,
        files: fileContents.map(f => f.path),
        file_contents: fileContents,
        complexity: files.length > 1 ? 'complex' : 'simple',
      });
    }

    if (textResult?.type === 'code' && textResult.blocks) {
      return SkillOk(`Code generated for project "${projectName}"`, {
        project_name: projectName,
        blocks: textResult.blocks,
      });
    }

    if (textResult?.type === 'text' && textResult.content) {
      return SkillOk(`Response for project "${projectName}"`, {
        project_name: projectName,
        content: textResult.content,
      });
    }

    return SkillOk(`Project "${projectName}" generation completed`, {
      project_name: projectName,
      result: result.result,
    });
  } catch (e) {
    return SkillFail(`Project generation error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
