// Handler for run_command tool.

import type { SkillResult } from '@/types/skill';
import { SkillOk, SkillFail } from '../skill';
import { checkCommandSafety, tryRunCommand } from './shell-utils';

export async function handleRunCommand(params: Record<string, unknown>): Promise<SkillResult> {
  const command = params['command'] as string;
  if (!command) return SkillFail('command is required');

  // Dangerous command check — block outright
  const dangerReason = checkCommandSafety(command);
  if (dangerReason) {
    return SkillFail(`⚠️ 命令被拦截：${dangerReason}。出于安全考虑，此命令需要你在终端中手动执行。`);
  }

  const cwd = params['cwd'] as string | undefined;
  const timeoutMs = (params['timeout_ms'] as number) ?? 30000;

  const result = await tryRunCommand(command, cwd, timeoutMs);

  return SkillOk(
    result.ok ? `Command exited with code ${result.exitCode}` : `Command failed with code ${result.exitCode}`,
    {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      method: result.method,
    },
  );
}
