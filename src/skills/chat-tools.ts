// Built-in skill: Chat utility tools — memory, history search, recall.
// These are Chat-level tools (not code-generation tools), used by the Chat LLM directly.
// Separated from code-tools/ to keep responsibilities clean:
//   code-tools  → code / file / shell / web
//   chat-tools  → memory / history / recall

import type { Skill, SkillTool, SkillResult } from './skill';
import { SkillOk, SkillFail } from './skill';
import { getDB } from '@/db';
import { getMemoryCompressor } from '@/services/memory-compressor';

// ── Row types ──

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string;
  conversation_title: string;
}

// ── Skill class ──

export class ChatToolsSkill implements Skill {
  id = 'chat_tools';
  name = 'Chat Tools';
  nameCn = '对话工具';
  category = 'System';
  categoryCn = '系统';
  description = 'Chat utility tools: memory management, history search, long-term recall, and agent control (think, request_user_input, finalize)';
  descriptionCn = '对话辅助工具：记忆管理、历史搜索、长期记忆回忆，以及智能体控制（think、request_user_input、finalize）';

  tools: SkillTool[] = [
    // ── agent_memory_update ──
    {
      name: 'agent_memory_update',
      description: 'Update the agent long-term memory. Use this to remember user preferences, facts, and important context for future conversations. Records are stored as user_profile type and persist permanently.',
      nameCn: '更新记忆',
      descriptionCn: '更新 Agent 长期记忆。用于记住用户的偏好、个人信息和重要上下文，供未来对话参考。',
      returns: '{"memory":{"id":"...","content":"...","importance":number}}',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['update', 'delete'], description: 'Action: update (add/update memory) or delete (remove memory). Default is update.' },
          content: { type: 'string', description: 'Memory content describing the user preference or fact' },
          reason: { type: 'string', description: 'Why this memory is important to record' },
          importance: { type: 'number', description: 'Importance score 1-10 (default 8). 8-10 for core user facts/preferences, 4-7 for useful context, 1-3 for minor details.' },
          memory_id: { type: 'string', description: 'Required for delete action: the memory ID to remove' },
        },
      },
    },
    // ── search_chat_history ──
    {
      name: 'search_chat_history',
      description: 'Search historical chat messages across all conversations. Use this to find what the user said before, recall previous discussions, or look up past context. At least one filter (keyword, conversation_id, days, or date) is required.',
      nameCn: '搜索历史聊天记录',
      descriptionCn: '搜索所有会话的历史聊天消息。用于查找用户之前说过的话、回顾之前的讨论或查找过去的上下文。至少需要一个过滤条件（keyword、conversation_id、days 或 date）。',
      returns: '{"messages":[{"conversation_title":"...","role":"user/assistant","content":"...","timestamp":"..."}],"total":number}',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Search keyword to match against message content (fuzzy LIKE match)' },
          conversation_id: { type: 'string', description: 'Filter by specific conversation ID' },
          role: { type: 'string', description: 'Filter by message role: "user" or "assistant"', enum: ['user', 'assistant'] },
          days: { type: 'number', description: 'Only include messages from the last N days' },
          date: { type: 'string', description: 'Search messages from a specific date, e.g. "2026-06-22"' },
          date_from: { type: 'string', description: 'Search messages from this date onwards, e.g. "2026-06-01"' },
          date_to: { type: 'string', description: 'Search messages up to this date, e.g. "2026-06-30". Used with date_from for range queries.' },
          limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
        },
      },
    },
    // ── recall_memory ──
    {
      name: 'recall_memory',
      description: '搜索长期记忆。用于查找用户画像信息（偏好、习惯、个人信息）或任务历史（过去的项目、完成的修复、经验教训）。当需要回忆用户之前说过的话、做过的项目、或任何被记录到长期记忆中的内容时使用。',
      nameCn: '回忆长期记忆',
      descriptionCn: '搜索长期记忆中的用户画像和任务历史。用于查找用户的偏好、习惯、个人信息，或过去的项目、修复记录、经验教训等。',
      returns: '{"memories":[{"type":"user_profile/task_history","content":"...","importance":number,"source_date":"..."}],"total":number}',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词，匹配记忆内容（模糊匹配）' },
          type: { type: 'string', enum: ['user_profile', 'task_history', 'all'], description: '记忆类型：user_profile=用户画像, task_history=任务历史, all=全部（默认）' },
          days: { type: 'number', description: '只搜索最近 N 天的记忆' },
          limit: { type: 'number', description: '返回条数（默认 10，最大 30）' },
        },
      },
    },
    // ── think ──
    {
      name: 'think',
      description: 'Record your internal reasoning before taking action. Use this to plan multi-step tasks, evaluate options, or verify your approach before executing tools.',
      nameCn: '思考',
      descriptionCn: '在执行操作前记录内部推理。用于规划多步骤任务、评估选项或验证方案。',
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Your internal reasoning and analysis.' },
        },
        required: ['thought'],
      },
    },
    // ── request_user_input ──
    {
      name: 'request_user_input',
      description: 'Ask the user for input when you encounter a login form, password prompt, captcha, payment page, or any situation requiring information only the user can provide. Do NOT use this if the user already told you what to enter.',
      nameCn: '请求用户输入',
      descriptionCn: '遇到登录、密码、验证码、支付等需要用户提供信息的场景时，暂停并请求用户输入。如果用户已在原始请求中明确告知了要输入的内容，则不要使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Explain what input is needed and why.' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Field label (e.g. "Email", "Password")' },
                key: { type: 'string', description: 'Field identifier for the response' },
                type: { type: 'string', enum: ['text', 'password'], description: 'Input type' },
              },
              required: ['label', 'key'],
            },
            description: 'Fields to present to the user.',
          },
        },
        required: ['message'],
      },
    },
    // ── finalize ──
    {
      name: 'finalize',
      description: 'Mark the current task as complete and provide a summary of what was accomplished. Always call this when you have finished the user\'s request.',
      nameCn: '完成任务',
      descriptionCn: '标记当前任务完成并提供总结。完成用户请求后务必调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary of what was accomplished, including key results and any important context for future reference.' },
        },
        required: ['summary'],
      },
    },
  ];

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        case 'agent_memory_update':
          return this.handleAgentMemoryUpdate(params);
        case 'search_chat_history':
          return this.handleSearchChatHistory(params);
        case 'recall_memory':
          return this.handleRecallMemory(params);
        case 'think':
          return SkillOk(`Thought recorded: ${(params['thought'] as string)?.substring(0, 200) ?? '(empty)'}`);
        case 'request_user_input':
          return SkillOk('User input requested. The agent loop will prompt the user.', {
            needs_user_input: true,
            message: params['message'] as string,
            fields: params['fields'],
          });
        case 'finalize':
          return SkillOk((params['summary'] as string) ?? 'Task completed.', { finalized: true });
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── agent_memory_update handler ──

  private async handleAgentMemoryUpdate(params: Record<string, unknown>): Promise<SkillResult> {
    const action = (params['action'] as string) ?? 'update';

    try {
      const compressor = getMemoryCompressor();

      if (action === 'delete') {
        const memoryId = params['memory_id'] as string;
        if (!memoryId) return SkillFail('memory_id is required for delete action');
        await compressor.deleteUserProfile(memoryId);
        const remaining = await compressor.getUserProfileEntries();
        const formatted = remaining.map((m) => `- [${m.source_date ?? '?'}] ${m.content}`).join('\n');
        return SkillOk(
          `Memory ${memoryId} deleted.\n\n当前用户画像记忆：\n${formatted || '（无）'}`,
        );
      }

      // action === 'update' (default)
      const content = params['content'] as string;
      const reason = params['reason'] as string;
      const importance = (params['importance'] as number) ?? 8;

      if (!content) return SkillFail('content is required for update');
      if (!reason) return SkillFail('reason is required for update');

      const id = await compressor.upsertUserProfile(content, importance);
      const all = await compressor.getUserProfileEntries();
      const formatted = all.map((m) => `- [importance=${m.importance}] ${m.content}`).join('\n');

      return SkillOk(
        `用户画像已更新。ID: ${id}\n原因：${reason}\n\n当前用户画像：\n${formatted}`,
        { memory: { id, content, reason, importance } },
      );
    } catch (e) {
      return SkillFail(`agent_memory_update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── search_chat_history handler ──

  private async handleSearchChatHistory(params: Record<string, unknown>): Promise<SkillResult> {
    const keyword = params['keyword'] as string | undefined;
    const conversationId = params['conversation_id'] as string | undefined;
    const role = params['role'] as string | undefined;
    const days = params['days'] as number | undefined;
    const date = params['date'] as string | undefined;
    const dateFrom = params['date_from'] as string | undefined;
    const dateTo = params['date_to'] as string | undefined;
    const limit = Math.min(Math.max(Number(params['limit']) || 20, 1), 50);

    if (!keyword && !conversationId && !days && !date && !dateFrom) {
      return SkillFail('At least one of keyword, conversation_id, days, date, or date_from is required.');
    }

    try {
      const db = await getDB();

      const conditions: string[] = [];
      const args: unknown[] = [];

      if (keyword) {
        conditions.push('m.content LIKE ?');
        args.push(`%${keyword}%`);
      }
      if (conversationId) {
        conditions.push('m.conversation_id = ?');
        args.push(conversationId);
      }
      if (role) {
        conditions.push('m.role = ?');
        args.push(role);
      }
      if (days && days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        conditions.push('m.timestamp >= ?');
        args.push(cutoff);
      }
      if (date) {
        conditions.push('m.timestamp >= ? AND m.timestamp < ?');
        args.push(`${date}T00:00:00`);
        args.push(`${date}T23:59:59.999Z`);
      }
      if (dateFrom) {
        conditions.push('m.timestamp >= ?');
        args.push(`${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        conditions.push('m.timestamp <= ?');
        args.push(`${dateTo}T23:59:59.999Z`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      args.push(limit);

      const sql = `
        SELECT m.id, m.conversation_id, m.role, m.content, m.timestamp,
               COALESCE(c.title, '(unknown)') AS conversation_title
        FROM messages m
        LEFT JOIN conversations c ON c.id = m.conversation_id
        ${where}
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;

      const rows = await db.query<MessageRow>(sql, args);

      if (rows.length === 0) {
        return SkillOk('No matching chat history found.');
      }

      const formatted = rows.map((r) => ({
        conversation_title: r.conversation_title,
        role: r.role,
        content: r.content.length > 500 ? r.content.substring(0, 500) + '...' : r.content,
        timestamp: r.timestamp,
      }));

      const summary = `Found ${rows.length} message(s):\n` +
        formatted.map((r) =>
          `[${r.timestamp}] (${r.role}) [${r.conversation_title}]\n${r.content}`
        ).join('\n---\n');

      return SkillOk(summary, { messages: formatted, total: rows.length });
    } catch (e) {
      return SkillFail(`search_chat_history failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── recall_memory handler ──

  private async handleRecallMemory(params: Record<string, unknown>): Promise<SkillResult> {
    const keyword = (params['keyword'] as string) ?? '';
    const type = (params['type'] as string) ?? 'all';
    const days = params['days'] as number | undefined;
    const limit = Math.min(Math.max(Number(params['limit']) || 10, 1), 30);

    try {
      const compressor = getMemoryCompressor();

      let results;
      if (!keyword && !days) {
        const [profiles, tasks] = await Promise.all([
          compressor.getUserProfileEntries(),
          compressor.getTaskHistory(),
        ]);

        const filtered = type === 'user_profile'
          ? profiles
          : type === 'task_history'
            ? tasks
            : [...profiles, ...tasks.map((t) => ({ ...t, type: 'task_history' as const }))];

        results = filtered.slice(0, limit).map((r) => ({
          id: 'id' in r ? r.id : undefined,
          type: 'type' in r ? r.type : 'user_profile',
          content: r.content,
          importance: r.importance,
          source_date: 'source_date' in r ? r.source_date : (r.date ?? null),
        }));
      } else {
        const rows = await compressor.searchMemories(keyword, type, limit);

        results = rows
          .filter((r) => {
            if (!days || days <= 0) return true;
            if (!r.source_date) return true;
            const entryDate = new Date(r.source_date);
            const cutoff = new Date(Date.now() - days * 86400000);
            return entryDate >= cutoff;
          })
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            type: r.type,
            content: r.content,
            importance: r.importance,
            source_date: r.source_date,
          }));
      }

      if (results.length === 0) {
        return SkillOk('未找到匹配的长期记忆。');
      }

      const typeLabel = (t: string) => t === 'user_profile' ? '用户画像' : '任务历史';
      const summary = `找到 ${results.length} 条记忆：\n` +
        results.map((r: Record<string, unknown>) =>
          `[${typeLabel(r.type as string)}] [importance=${r.importance}] ${r.source_date ? `(${r.source_date}) ` : ''}${r.content}`
        ).join('\n');

      return SkillOk(summary, { memories: results, total: results.length });
    } catch (e) {
      return SkillFail(`recall_memory failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
