// Agent 长期记忆 —— LLM 通过 agent_memory_update 工具更新，
// buildSystemPrompt 自动注入到对应 agent 的系统提示词中。

export interface AgentMemory {
  id: string;
  content: string;
  reason: string;
  time: string;       // e.g. "2026-06-16"
  createdAt: string;  // ISO timestamp
}

const STORAGE_KEY = 'openpaw_agent_memories';

function loadAll(): Record<string, AgentMemory[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, AgentMemory[]>;
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, AgentMemory[]>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Get memories for a specific agent. */
export function getMemories(agentName: string): AgentMemory[] {
  const all = loadAll();
  return all[agentName] ?? [];
}

/** Add a memory for an agent. */
export function addMemory(
  agentName: string,
  content: string,
  reason: string,
  time: string,
): AgentMemory {
  const all = loadAll();
  const list = all[agentName] ?? [];
  const entry: AgentMemory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    reason,
    time,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  // Keep at most 20 memories per agent
  if (list.length > 20) list.splice(0, list.length - 20);
  all[agentName] = list;
  saveAll(all);
  return entry;
}

/** Remove a specific memory by id. */
export function removeMemory(agentName: string, memoryId: string): boolean {
  const all = loadAll();
  const list = all[agentName];
  if (!list) return false;
  const idx = list.findIndex((m) => m.id === memoryId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  all[agentName] = list;
  saveAll(all);
  return true;
}

/** Format memories for injection into system prompt. */
export function formatMemoriesForPrompt(agentName: string): string {
  const memories = getMemories(agentName);
  if (memories.length === 0) return '';
  const lines = memories.map((m) =>
    `- [${m.time}] ${m.content}（原因：${m.reason}）`
  );
  return `\n\n## Agent 长期记忆\n以下是之前记录的重要信息，请在与用户对话时参考：\n${lines.join('\n')}`;
}
