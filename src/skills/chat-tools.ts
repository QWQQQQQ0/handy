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
    // ── delete_chat_messages ──
    {
      name: 'delete_chat_messages',
      description: 'Delete specific chat messages or clear an entire conversation. Use message_ids to delete specific messages, or conversation_id + mode="conversation" to clear all messages in a conversation. Use with caution — this is irreversible.',
      nameCn: '删除聊天记录',
      descriptionCn: '删除指定的聊天消息或清空整个会话。使用 message_ids 删除特定消息，或使用 conversation_id + mode="conversation" 清空整个会话。操作不可逆，请谨慎使用。',
      returns: '{"deleted_count":number}',
      parameters: {
        type: 'object',
        properties: {
          message_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of messages to delete. Use with mode="messages" (default).' },
          conversation_id: { type: 'string', description: 'Conversation ID to clear. Use with mode="conversation" to delete all messages in that conversation.' },
          mode: { type: 'string', enum: ['messages', 'conversation'], description: 'Delete mode: "messages" to delete specific message IDs, "conversation" to clear all messages in a conversation. Default: "messages".' },
        },
      },
    },
    // ── recall_memory ──
    {
      name: 'recall_memory',
      description: '搜索长期记忆。用于查找用户画像信息（偏好、习惯、个人信息）、任务历史（过去的项目、完成的修复）、行为准则（跨任务的通用做事规则）、工作流经验（某类任务的具体操作流程、注意事项）、或任务经验（FreeAgent 试错总结、教训、可用模式）。当需要回忆用户之前说过的话、做过的项目、之前的经验教训时使用。',
      nameCn: '回忆长期记忆',
      descriptionCn: '搜索长期记忆中的用户画像、任务历史、行为准则、工作流经验和任务经验。用于查找用户的偏好、习惯、个人信息，或过去的项目、修复记录、经验教训等。',
      returns: '{"memories":[{"type":"user_profile/task_history/agent_heuristic/task_workflow/task_experience","content":"...","importance":number,"source_date":"..."}],"total":number}',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词，匹配记忆内容（模糊匹配）' },
          type: { type: 'string', enum: ['user_profile', 'task_history', 'agent_heuristic', 'task_workflow', 'task_experience', 'all'], description: '记忆类型：user_profile=用户画像, task_history=任务历史, agent_heuristic=行为准则, task_workflow=工作流经验, task_experience=任务经验(旧版), all=全部（默认）' },
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
    // ── store_experience（仅 FreeAgent 可用，由 FREE_AGENT_TOOLS 白名单控制） ──
    {
      name: 'store_experience',
      description: 'Store lessons learned from this task. Two categories — choose ONE:\n'
        + '1. "agent_heuristic" (行为风格): A GENERAL rule about HOW to work effectively. Applies across ALL tasks. Examples: "修改代码前先用 read_file 确认当前内容", "遇到报错先看错误日志不要盲目重试". Only for rules that would help in ANY future task. importance >= 8 required. Max 8 rules total — rare, high-quality only.\n'
        + '2. "task_workflow" (行为方法): A specific workflow for a TYPE of task. Examples: "抓取 SPA 网页时先用 web_fetch 试，失败则用 Playwright", "处理 Excel 文件应先 office_detect→sync→com_read→处理后→com_edit→save". Fill workflow steps, toolSignature, triggerPatterns, tags carefully — these determine whether the workflow can be FOUND later.\n'
        + 'If unsure which category or whether to store at all — skip. Most tasks should just finalize.',
      nameCn: '存储经验',
      descriptionCn: '存储任务中学到的经验。两种类型选一：\n'
        + '1. agent_heuristic（行为风格）：通用的做事准则，跨所有任务适用。如"修改代码前先 read_file"、"遇到报错先看日志不盲目重试"。只存最重要的，importance 需 ≥ 8，总共最多 8 条。\n'
        + '2. task_workflow（行为方法）：某类任务的具体操作流程。如"抓取 SPA 网页：先 web_fetch 试 → 失败则 Playwright"。务必认真填写 triggerPatterns（用户会怎么描述这类任务）、toolSignature（涉及哪些工具）、workflow steps —— 这些字段决定了以后能否检索到。\n'
        + '不确定该不该存或该选哪个类型 → 直接跳过，大多数任务只需 finalize。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['agent_heuristic', 'task_workflow'], description: 'Experience category. agent_heuristic=general behavior rule (cross-task), task_workflow=specific task workflow.' },
          // ── 通用字段 ──
          goal: { type: 'string', description: 'One-line summary of what this task accomplished (used as the experience title for retrieval)' },
          importance: { type: 'number', description: '1-10. agent_heuristic requires >= 8. task_workflow >= 5.', minimum: 1, maximum: 10 },
          tags: { type: 'array', items: { type: 'string' }, description: 'Keywords for retrieval. Be specific: use domain terms like "网页抓取", "Excel处理", "文件批量". At least 2 tags for task_workflow.' },
          // ── agent_heuristic 字段 ──
          heuristic: { type: 'string', description: '[agent_heuristic only] A concise behavioral rule, e.g. "修改任何文件前先 read_file 确认当前内容，避免基于猜测编辑"' },
          // ── task_workflow 字段 ──
          summary: { type: 'string', description: '[task_workflow only] Brief summary of the workflow (1 sentence)' },
          toolSignature: { type: 'array', items: { type: 'string' }, description: '[task_workflow only] List of tools used in this workflow, e.g. ["web_fetch", "execute_code:python", "write_file"]. THIS IS CRITICAL for retrieval — the system matches by tool overlap.' },
          triggerPatterns: { type: 'array', items: { type: 'string' }, description: '[task_workflow only] User query patterns that should trigger this workflow (supports regex). CRITICAL for retrieval. Cover multiple phrasings, e.g. ["抓取.*网页.*数据", "爬.*网站", "网页.*采集", "scrape.*web"]. At least 2 patterns.' },
          domain: { type: 'string', description: '[task_workflow only] Domain: "web", "file", "data", "document", "system", "code".' },
          preconditions: { type: 'array', items: { type: 'string' }, description: '[task_workflow only] Prerequisites for this workflow, e.g. ["需要 JS 渲染", "需要登录态"]' },
          workflowSteps: { type: 'array', items: { type: 'object', properties: { order: { type: 'number' }, action: { type: 'string' }, tool: { type: 'string' }, onFailure: { type: 'string' } } }, description: '[task_workflow only] Ordered steps. Each step: {order, action, tool, onFailure?}' },
          pitfalls: { type: 'array', items: { type: 'string' }, description: 'Pitfalls or issues to watch out for. For task_workflow, be specific about what can go wrong at which step.' },
          // ── 旧版兼容字段 ──
          approach: { type: 'string', description: '[legacy] One-sentence summary of the method used' },
          lessons: { type: 'string', description: '[legacy] Key lessons and suggestions' },
          patterns: { type: 'array', items: { type: 'string' }, description: '[legacy] Reusable patterns or techniques' },
        },
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
        case 'delete_chat_messages':
          return this.handleDeleteChatMessages(params);
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
        case 'store_experience': {
          const { storeAgentExperience } = await import('@/services/task-memory');
          const category = (params['category'] as string) ?? 'agent_heuristic';
          const importance = (params['importance'] as number) ?? 6;

          // agent_heuristic 门槛：importance >= 8
          if (category === 'agent_heuristic' && importance < 8) {
            return SkillOk('行为准则 importance 需 >= 8，当前 importance 过低，跳过存储。');
          }
          if (importance < 5) return SkillOk('经验重要性过低，跳过存储。');

          // 提取 workflow steps
          const steps = params['workflowSteps'] as Array<{ order: number; action: string; tool: string; onFailure?: string }> | undefined;

          storeAgentExperience({
            category: category as 'agent_heuristic' | 'task_workflow',
            goal: (params['goal'] as string) ?? (params['approach'] as string)?.substring(0, 200) ?? 'task experience',
            success: true,
            heuristic: params['heuristic'] as string | undefined,
            workflow: {
              summary: params['summary'] as string | undefined,
              toolSignature: params['toolSignature'] as string[] | undefined,
              triggerPatterns: params['triggerPatterns'] as string[] | undefined,
              domain: params['domain'] as string | undefined,
              tags: params['tags'] as string[] | undefined,
              preconditions: params['preconditions'] as string[] | undefined,
              steps: steps?.map((s) => ({
                order: s.order,
                action: s.action,
                tool: s.tool,
                onFailure: s.onFailure,
              })),
              pitfalls: params['pitfalls'] as string[] | undefined,
            },
            // 旧版兼容
            experience: {
              approach: params['approach'] as string | undefined,
              pitfalls: params['pitfalls'] as string[] | undefined,
              lessons: params['lessons'] as string | undefined,
              patterns: params['patterns'] as string[] | undefined,
              tags: params['tags'] as string[] | undefined,
              importance,
            },
            importance,
          }).catch(() => { /* 非致命 */ });

          const catLabel = category === 'agent_heuristic' ? '行为准则' : '工作流';
          return SkillOk(`${catLabel}经验已存储。`);
        }
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
        // 尝试删除用户画像，失败则尝试通用删除（task_experience 等）
        const deleted = await compressor.deleteMemory(memoryId);
        if (!deleted) return SkillFail(`未找到 ID 为 ${memoryId} 的记忆`);
        const remaining = await compressor.getUserProfileEntries();
        const formatted = remaining.map((m) => `- [${m.source_date ?? '?'}] ${m.content}`).join('\n');
        return SkillOk(
          `记忆 ${memoryId} 已删除。\n\n当前用户画像：\n${formatted || '（无）'}`,
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
        id: r.id,
        conversation_id: r.conversation_id,
        conversation_title: r.conversation_title,
        role: r.role,
        content: r.content.length > 500 ? r.content.substring(0, 500) + '...' : r.content,
        timestamp: r.timestamp,
      }));

      const summary = `Found ${rows.length} message(s):\n` +
        formatted.map((r) =>
          `[${r.id}] [${r.timestamp}] (${r.role}) [${r.conversation_title}]\n${r.content}`
        ).join('\n---\n');

      return SkillOk(summary, { messages: formatted, total: rows.length });
    } catch (e) {
      return SkillFail(`search_chat_history failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── delete_chat_messages handler ──

  private async handleDeleteChatMessages(params: Record<string, unknown>): Promise<SkillResult> {
    try {
      const mode = (params['mode'] as string) || 'messages';
      const db = await getDB();

      if (mode === 'conversation') {
        const conversationId = params['conversation_id'] as string;
        if (!conversationId) return SkillFail('conversation_id is required for conversation mode');
        await db.execute('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
        return SkillOk(`Cleared all messages in conversation ${conversationId}`);
      }

      // mode === 'messages' (default)
      const messageIds = params['message_ids'] as string[] | undefined;
      if (!messageIds || messageIds.length === 0) return SkillFail('message_ids is required (non-empty array)');

      let deletedCount = 0;
      for (const id of messageIds) {
        await db.execute('DELETE FROM messages WHERE id = ?', [id]);
        deletedCount++;
      }
      return SkillOk(`Deleted ${deletedCount} message(s)`, { deleted_count: deletedCount });
    } catch (e) {
      return SkillFail(`delete_chat_messages failed: ${e instanceof Error ? e.message : String(e)}`);
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
        const [profiles, tasks, experiences, heuristics, workflows] = await Promise.all([
          compressor.getUserProfileEntries(),
          compressor.getTaskHistory(),
          compressor.getTaskExperiences(),
          compressor.getHeuristics?.(),
          compressor.getWorkflows?.(),
        ]);

        const allEntries = [
          ...profiles.map((r) => ({ ...r, type: 'user_profile' as const })),
          ...tasks.map((t) => ({ ...t, type: 'task_history' as const })),
          ...experiences.map((e) => ({ ...e, type: 'task_experience' as const })),
          ...(heuristics ?? []).map((h: { id?: string; content: string; importance: number; source_date?: string }) => ({ id: h.id ?? '', type: 'agent_heuristic' as const, content: h.content, importance: h.importance, source_date: h.source_date ?? null })),
          ...(workflows ?? []).map((w: { id?: string; content: string; importance: number; source_date?: string }) => ({ id: w.id ?? '', type: 'task_workflow' as const, content: w.content, importance: w.importance, source_date: w.source_date ?? null })),
        ];

        const filtered = type === 'all'
          ? allEntries
          : allEntries.filter((r) => r.type === type);

        results = filtered.slice(0, limit).map((r) => ({
          id: r.id,
          type: r.type,
          content: r.content,
          importance: r.importance,
          source_date: r.source_date ?? null,
        }));
      } else {
        // searchMemories 已经是 LIKE 查询，type 直接传给 DB
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

      const typeLabel = (t: string) => {
        switch (t) {
          case 'user_profile': return '用户画像';
          case 'agent_heuristic': return '行为准则';
          case 'task_workflow': return '工作流经验';
          case 'task_experience': return '任务经验';
          case 'task_history': return '任务历史';
          default: return t;
        }
      };
      const summary = `找到 ${results.length} 条记忆：\n` +
        results.map((r: Record<string, unknown>) =>
          `[${typeLabel(r.type as string)}] [importance=${r.importance}] ${r.source_date ? `(${r.source_date}) ` : ''}${typeof r.content === 'string' && r.content.length > 500 ? (r.content as string).substring(0, 500) + '...' : r.content}`
        ).join('\n');

      return SkillOk(summary, { memories: results, total: results.length });
    } catch (e) {
      return SkillFail(`recall_memory failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
