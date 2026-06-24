// Handlers for generate_code and execute_code tools.

import type { SkillResult } from '@/types/skill';
import type { LLMMessage } from '@/types/message';
import { SkillOk, SkillFail } from '../skill';
import { codeSandboxService } from '@/services/code-sandbox';
import { getDB } from '@/db';
import { appEvents, APP_EVENTS } from '@/services/app-events';
import { extractCodeBlocks, buildCodeGenPrompt } from './helpers';

export interface CodeGenEnv {
  getLlmCaller: () => (messages: LLMMessage[]) => AsyncGenerator<string>;
}

/** Auto-save generated HTML to the DB and emit events. Returns the appId on success. */
async function autoSaveHtml(code: string, appName?: string): Promise<string | undefined> {
  try {
    const db = await getDB();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = appName || `Generated App ${new Date().toLocaleTimeString()}`;

    await db.execute(
      'INSERT INTO savedApps (id, name, code, created_at) VALUES (?, ?, ?, ?)',
      [id, name, code, now],
    );

    appEvents.emit(APP_EVENTS.HTML_GENERATED, { appId: id, name, code, autoSave: true });
    appEvents.emit(APP_EVENTS.APP_CREATED, { id, name, code, created_at: now });

    return id;
  } catch (err) {
    console.error('[CodeToolsSkill] Failed to auto-save generated HTML:', err);
    return undefined;
  }
}

export async function handleGenerateCode(params: Record<string, unknown>, env: CodeGenEnv): Promise<SkillResult> {
  const task = params['task'] as string;
  const language = params['language'] as string;
  const context = params['context'] as string | undefined;
  const constraints = params['constraints'] as string | undefined;
  const appName = params['app_name'] as string | undefined;
  const autoSave = (params['auto_save'] as boolean) ?? (language === 'html');

  if (!task) return SkillFail('task is required');
  if (!language) return SkillFail('language is required');

  let llmCaller: (messages: LLMMessage[]) => AsyncGenerator<string>;
  try {
    llmCaller = env.getLlmCaller();
  } catch (e) {
    return SkillFail(e instanceof Error ? e.message : String(e));
  }

  const prompt = buildCodeGenPrompt(task, language, context, constraints);
  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a code generation assistant. Output only code blocks.' },
    { role: 'user', content: prompt },
  ];

  let fullResponse = '';
  const stream = llmCaller(messages);
  for await (const chunk of stream) {
    fullResponse += chunk;
  }

  const codeBlocks = extractCodeBlocks(fullResponse);
  if (codeBlocks.length === 0) {
    return SkillFail('No code blocks found in LLM response', { response: fullResponse });
  }

  const generatedCode = codeBlocks.join('\n\n');

  // For HTML code, auto-save to apps database if requested
  if (language === 'html' && autoSave) {
    const appId = await autoSaveHtml(generatedCode, appName);
    if (appId) {
      return SkillOk(`Generated and saved HTML app "${appName || 'Untitled'}"`, {
        code: generatedCode,
        allBlocks: codeBlocks,
        language,
        task,
        appId,
        appName: appName || 'Untitled',
        saved: true,
      });
    }
  }

  return SkillOk(`Generated ${codeBlocks.length} code block(s)`, {
    code: generatedCode,
    allBlocks: codeBlocks,
    language,
    task,
  });
}

export async function handleExecuteCode(params: Record<string, unknown>): Promise<SkillResult> {
  const code = params['code'] as string;
  const language = params['language'] as string;
  const timeoutMs = (params['timeout_ms'] as number) ?? 30000;
  const appName = params['app_name'] as string | undefined;
  const autoSave = (params['auto_save'] as boolean) ?? (language === 'html');

  if (!code) return SkillFail('code is required');
  if (!language) return SkillFail('language is required');

  const result = await codeSandboxService.execute(
    language as Parameters<typeof codeSandboxService.execute>[0],
    code,
    undefined,
    { timeoutMs },
  );

  // For HTML code, auto-save to apps database if requested
  if (language === 'html' && result.success && autoSave) {
    const appId = await autoSaveHtml(code, appName);
    if (appId) {
      return SkillOk('HTML code executed and saved to apps', {
        success: true,
        output: result.output,
        result: result.result,
        durationMs: result.durationMs,
        truncated: result.truncated,
        htmlContent: result.htmlContent,
        isolatedDocument: result.isolatedDocument,
        appId,
        appName: appName || 'Untitled',
        saved: true,
      });
    }
  }

  return SkillOk(
    result.success ? 'Code executed successfully' : 'Code execution failed',
    {
      success: result.success,
      output: result.output,
      error: result.error,
      result: result.result,
      durationMs: result.durationMs,
      truncated: result.truncated,
      htmlContent: result.htmlContent,
      isolatedDocument: result.isolatedDocument,
    },
  );
}
