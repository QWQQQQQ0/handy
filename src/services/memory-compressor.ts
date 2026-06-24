// 长期记忆压缩器 —— 每日首次打开时自动压缩未归纳对话 + 前一天摘要，
// 更新 long_term_memory 表，注入 system prompt。
//
// 架构：
//   Layer 0: 原始对话 (messages 表，is_summarized 字段标记)
//   Layer 1: 每日记忆快照 (daily_memory_snapshots 表)
//   Layer 2: 活跃记忆 (long_term_memory 表 → 注入 system prompt)
//
// 分类：
//   user_profile  — 用户画像（持久，LLM 通过 agent_memory_update 写入）
//   task_history  — 任务历史（衰减，每日压缩自动更新）

import { getDB } from '@/db';
import type { ProviderConfig } from '@/types/provider';
import { getModelService } from '@/services/model-service-singleton';
import { ModelScenario } from '@/services/llm-gateway/gateway';

// ── 类型 ──

export interface MemoryEntry {
  id?: string;
  content: string;
  importance: number;
  date?: string;
}

export interface CompressionResult {
  user_profile: MemoryEntry[];
  task_history: MemoryEntry[];
  daily_summary: string;
}

interface DailySnapshotRow {
  id: string;
  date: string;
  summary_json: string;
  compressed_text: string;
  model: string;
  token_count: number;
  conversation_count: number;
  created_at: string;
}

interface LongTermMemoryRow {
  id: string;
  type: 'user_profile' | 'task_history';
  content: string;
  importance: number;
  source_date: string | null;
  hit_count: number;
  last_updated_at: string;
  created_at: string;
}

interface UnsummarizedMessage {
  conversation_id: string;
  conversation_title: string;
  role: string;
  content: string;
  timestamp: string;
}

// ── 预算常量 ──

const USER_PROFILE_CHAR_LIMIT = 1000;
const TASK_HISTORY_CHAR_LIMIT = 3000;
const DAILY_SUMMARY_CHAR_LIMIT = 800;

// ── 压缩 Prompt ──

function buildCompressionPrompt(
  unsummarized: UnsummarizedMessage[],
  previousSummary: string | null,
  existingUserProfile: MemoryEntry[],
): string {
  const conversationText = formatConversationsForPrompt(unsummarized);
  const prevSection = previousSummary
    ? `## 昨天的记忆摘要\n${previousSummary}`
    : '（首次压缩，无前一天的摘要）';

  const profileSection = existingUserProfile.length > 0
    ? `## 现有用户画像（只读，由 agent_memory_update 工具管理，不要修改）\n${existingUserProfile.map((e, i) => `${i + 1}. [importance=${e.importance}] ${e.content}`).join('\n')}`
    : '（暂无用户画像）';

  return `你是一个记忆压缩器。请将输入内容压缩成结构化摘要。

## 输入

${profileSection}

${prevSection}

## 今天的新对话（未归纳）
${conversationText}

## 输出格式（严格 JSON，不要输出其他内容）
{
  "user_profile": [
    {"content": "用户偏好中文交流", "importance": 9},
    {"content": "工作目录是 D:/projects", "importance": 8}
  ],
  "task_history": [
    {"date": "2026-06-21", "importance": 7, "content": "修复了桌面自动化截图颜色问题"},
    {"date": "2026-06-20", "importance": 3, "content": "测试了 Web Agent 功能"}
  ],
  "daily_summary": "今天用户主要做了..."
}

## 压缩规则
- user_profile: 只记录长期有效的用户偏好/事实。已失效的信息要删除。最多 10 条。（你不会被注入 user_profile 内容，你需要从对话中提取新的用户画像信息，并与现有画像合并。现有画像在上面已列出，仅供参考。如果对话中没有新的用户画像信息，返回空数组 []。）
- task_history: 每条必须有 date 和 importance(1-10)。同类话题合并。最多 20 条。
  * importance 1-3: 琐碎信息，可以丢弃
  * importance 4-7: 值得记录，但可被更新的信息替换
  * importance 8-10: 重要信息，长期保留
- daily_summary: 不超过 ${DAILY_SUMMARY_CHAR_LIMIT} 字。用于明天输入。只写今天实际发生的对话内容。
- 丢弃: 调试失败、工具报错、重复操作、空泛对话、系统内部消息
- 总数控制: user_profile ≤ 10 条, task_history ≤ 20 条
- 如果今天没有实质性对话（只有测试、问候等），task_history 和 daily_summary 可以为空`;
}

function formatConversationsForPrompt(msgs: UnsummarizedMessage[]): string {
  if (msgs.length === 0) return '（无新对话）';

  // Group by conversation
  const groups = new Map<string, UnsummarizedMessage[]>();
  for (const m of msgs) {
    if (!groups.has(m.conversation_id)) groups.set(m.conversation_id, []);
    groups.get(m.conversation_id)!.push(m);
  }

  const parts: string[] = [];
  for (const [convId, convMsgs] of groups) {
    const title = convMsgs[0].conversation_title || convId;
    // Only include user and assistant messages, skip tool/internal
    const dialog = convMsgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const role = m.role === 'user' ? '用户' : '助手';
        const text = m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content;
        return `[${role}] ${text}`;
      })
      .join('\n');
    if (dialog.trim()) {
      parts.push(`### 会话: ${title}\n${dialog}`);
    }
  }
  return parts.join('\n\n') || '（无新对话）';
}

// ── 单例 ──

let _instance: MemoryCompressor | null = null;

export function getMemoryCompressor(): MemoryCompressor {
  if (!_instance) _instance = new MemoryCompressor();
  return _instance;
}

// ── 主类 ──

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

export class MemoryCompressor {
  private _migrationDone = false;
  private _promptCache: { text: string; ts: number } | null = null;

  // ── 每日压缩判断 ──

  /** 检查今天是否已经压缩过 */
  async needsCompression(): Promise<boolean> {
    // 检查是否有未归纳的消息（快速判断）
    try {
      const db = await getDB();
      const rows = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM messages WHERE is_summarized = 0 AND role IN ('user', 'assistant') AND (agent_internal IS NULL OR agent_internal = 0)",
      );
      const unsummarizedCount = rows[0]?.cnt ?? 0;
      // 至少要有 3 条用户/助手消息才值得压缩
      if (unsummarizedCount < 3) return false;

      // 检查今天是否已有快照
      const today = todayStr();
      const snapRows = await db.query<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM daily_memory_snapshots WHERE date = ?',
        [today],
      );
      return (snapRows[0]?.cnt ?? 0) === 0;
    } catch {
      return false;
    }
  }

  // ── 数据查询 ──

  /** 获取未归纳的对话消息 */
  async getUnsummarizedMessages(): Promise<UnsummarizedMessage[]> {
    const db = await getDB();
    return db.query<UnsummarizedMessage>(
      `SELECT m.conversation_id, COALESCE(c.title, '(未命名)') AS conversation_title,
              m.role, m.content, m.timestamp
       FROM messages m
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE m.is_summarized = 0 AND m.role IN ('user', 'assistant') AND (m.agent_internal IS NULL OR m.agent_internal = 0)
       ORDER BY m.timestamp ASC`,
    );
  }

  /** 获取最近一条每日快照 */
  async getLatestSnapshot(): Promise<string | null> {
    const db = await getDB();
    const rows = await db.query<DailySnapshotRow>(
      'SELECT * FROM daily_memory_snapshots ORDER BY date DESC LIMIT 1',
    );
    if (rows.length === 0) return null;
    return rows[0].compressed_text;
  }

  /** 获取现有用户画像（来自 long_term_memory） */
  async getUserProfile(): Promise<MemoryEntry[]> {
    const db = await getDB();
    const rows = await db.query<LongTermMemoryRow>(
      "SELECT * FROM long_term_memory WHERE type = 'user_profile' ORDER BY importance DESC",
    );
    return rows.map((r) => ({
      content: r.content,
      importance: r.importance,
      date: r.source_date ?? undefined,
    }));
  }

  /** 获取所有任务历史（含 id，供 UI 管理） */
  async getTaskHistory(): Promise<MemoryEntry[]> {
    const db = await getDB();
    const rows = await db.query<LongTermMemoryRow>(
      "SELECT * FROM long_term_memory WHERE type = 'task_history' ORDER BY importance DESC, last_updated_at DESC",
    );
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      importance: r.importance,
      date: r.source_date ?? undefined,
    }));
  }

  // ── LLM 压缩 ──

  /** 执行每日压缩 */
  async compress(provider: ProviderConfig, apiKey: string): Promise<CompressionResult | null> {
    // 1. Ensure migration has run
    await this.ensureMigration();

    // 2. Fetch data
    const unsummarized = await this.getUnsummarizedMessages();
    const previousSummary = await this.getLatestSnapshot();
    const existingProfile = await this.getUserProfile();

    // 3. Build prompt
    const prompt = buildCompressionPrompt(unsummarized, previousSummary, existingProfile);

    // 4. Call LLM (non-streaming)
    const modelService = getModelService();
    let responseText = '';
    try {
      const stream = modelService.chatStream({
        scenario: ModelScenario.chat,
        messages: [{ role: 'user', content: prompt }],
        provider,
        apiKey,
        tools: undefined,
        skipCache: true,
      });

      for await (const chunk of stream) {
        // Skip metadata chunks
        if (chunk.startsWith('__REASONING__:') || chunk.startsWith('__ERROR__:') || chunk.startsWith('__TOOLS__:')) continue;
        responseText += chunk;
      }
    } catch (e) {
      console.error('[MemoryCompressor] LLM call failed:', e);
      return null;
    }

    // 5. Parse JSON
    let result: CompressionResult;
    try {
      result = this.parseCompressionResult(responseText);
    } catch (e) {
      console.error('[MemoryCompressor] Failed to parse LLM output:', e, 'Raw:', responseText.substring(0, 500));
      return null;
    }

    // 6. Save snapshot + update long_term_memory + mark messages
    const db = await getDB();
    const today = todayStr();
    const snapshotId = crypto.randomUUID();

    await db.execute(
      `INSERT OR REPLACE INTO daily_memory_snapshots (id, date, summary_json, compressed_text, model, conversation_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [snapshotId, today, JSON.stringify(result), result.daily_summary, provider.model, unsummarized.length],
    );

    // 7. Update long_term_memory: merge task_history
    // Clear old task_history and insert new ones
    await db.execute("DELETE FROM long_term_memory WHERE type = 'task_history'");

    // Apply time decay to task_history
    const now = new Date();
    for (const entry of result.task_history) {
      if (entry.date) {
        const entryDate = new Date(entry.date);
        const daysAgo = Math.floor((now.getTime() - entryDate.getTime()) / 86400000);
        if (daysAgo > 30) entry.importance = Math.max(1, entry.importance - 5);
        else if (daysAgo > 7) entry.importance = Math.max(1, entry.importance - 2);
      }
    }

    // Sort by importance desc, then by date desc, keep top 20
    const sorted = result.task_history
      .filter((e) => e.importance >= 3)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20);

    for (const entry of sorted) {
      await db.execute(
        `INSERT INTO long_term_memory (id, type, content, importance, source_date)
         VALUES (?, 'task_history', ?, ?, ?)`,
        [crypto.randomUUID(), entry.content, entry.importance, entry.date ?? today],
      );
    }

    // 8. Mark messages as summarized
    const convIds = [...new Set(unsummarized.map((m) => m.conversation_id))];
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      await db.execute(
        `UPDATE messages SET is_summarized = 1 WHERE conversation_id IN (${placeholders}) AND (agent_internal IS NULL OR agent_internal = 0)`,
        convIds,
      );
    }

    // Invalidate prompt cache so next request picks up fresh memories
    this.invalidatePromptCache();

    console.log(`[MemoryCompressor] Daily compression done: ${unsummarized.length} messages → ${sorted.length} task_history entries`);
    return result;
  }

  // ── JSON 解析 ──

  private parseCompressionResult(raw: string): CompressionResult {
    let cleaned = raw.trim();
    // Remove markdown code fences
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const obj = JSON.parse(cleaned);

    return {
      user_profile: Array.isArray(obj.user_profile) ? obj.user_profile : [],
      task_history: Array.isArray(obj.task_history) ? obj.task_history : [],
      daily_summary: typeof obj.daily_summary === 'string' ? obj.daily_summary : '',
    };
  }

  // ── System Prompt 注入 ──

  /**
   * 构建注入 system prompt 的长期记忆文本。
   * 格式：
   *   ## 用户画像
   *   - [偏好] ...
   *   ## 近期活动
   *   - [2026-06-21] ...
   */
  async buildSystemPromptMemory(): Promise<string> {
    // Return cached result if still fresh (avoids DB query on every message)
    if (this._promptCache && Date.now() - this._promptCache.ts < CACHE_TTL_MS) {
      return this._promptCache.text;
    }

    const db = await getDB();
    const [rows, runDayInfo] = await Promise.all([
      db.query<LongTermMemoryRow>(
        "SELECT * FROM long_term_memory ORDER BY type ASC, importance DESC, last_updated_at DESC",
      ),
      this.getRunDayInfo(),
    ]);

    const profiles = rows.filter((r) => r.type === 'user_profile');
    const tasks = rows.filter((r) => r.type === 'task_history');

    // 无数据则跳过
    if (!runDayInfo && profiles.length === 0 && tasks.length === 0) {
      this._promptCache = { text: '', ts: Date.now() };
      return '';
    }

    const lines: string[] = [];
    lines.push('\n\n## 以下为运行收集的长期记忆，协助回答用户的指令，无需主动提及');

    // ── 运行天数 ──
    if (runDayInfo) {
      lines.push(`- ${runDayInfo}`);
    }

    // ── 用户画像 ──
    if (profiles.length > 0) {
      let charCount = 0;
      for (const p of profiles) {
        const line = `- ${p.content}`;
        if (charCount + line.length > USER_PROFILE_CHAR_LIMIT) break;
        lines.push(line);
        charCount += line.length;
      }
    }

    // ── 近期活动 ──
    if (tasks.length > 0) {
      let charCount = 0;
      for (const t of tasks) {
        const datePrefix = t.source_date ? `[${t.source_date}] ` : '';
        const line = `- ${datePrefix}${t.content}`;
        if (charCount + line.length > TASK_HISTORY_CHAR_LIMIT) break;
        lines.push(line);
        charCount += line.length;
      }
    }

    const result = lines.join('\n');

    // Cache the result
    this._promptCache = { text: result, ts: Date.now() };

    return result;
  }

  /**
   * 从 daily_memory_snapshots 表获取运行天数信息。
   * 用最早日期和今天的天数差作为运行天数。返回单行文本。
   */
  private async getRunDayInfo(): Promise<string | null> {
    try {
      const db = await getDB();
      const rows = await db.query<{ first_date: string; total_days: number }>(
        "SELECT MIN(date) AS first_date, COUNT(*) AS total_days FROM daily_memory_snapshots",
      );
      const firstDate = rows[0]?.first_date;
      const snapshotDays = rows[0]?.total_days ?? 0;
      if (!firstDate) return null;

      const today = todayStr();
      const dayDiff = Math.floor(
        (new Date(today).getTime() - new Date(firstDate).getTime()) / 86400000 + 1,
      );

      return `用户使用 Handy 第 ${dayDiff} 天（首次运行: ${firstDate}，累计活跃 ${snapshotDays} 天）`;
    } catch {
      return null;
    }
  }

  /** 清除缓存（压缩后调用，强制下次注入重新读取） */
  invalidatePromptCache(): void {
    this._promptCache = null;
  }

  // ── 用户画像更新（由 agent_memory_update 调用） ──

  /** 添加或更新用户画像条目 */
  async upsertUserProfile(content: string, importance: number = 8): Promise<string> {
    const db = await getDB();
    // Check for near-duplicate (content similarity — simple substring check)
    const existing = await db.query<LongTermMemoryRow>(
      "SELECT * FROM long_term_memory WHERE type = 'user_profile'",
    );
    const duplicate = existing.find((r) =>
      r.content.includes(content) || content.includes(r.content),
    );
    if (duplicate) {
      // Update existing
      await db.execute(
        `UPDATE long_term_memory SET content = ?, importance = MAX(importance, ?), hit_count = hit_count + 1, last_updated_at = ? WHERE id = ?`,
        [content, importance, new Date().toISOString(), duplicate.id],
      );
      return duplicate.id;
    }

    // Enforce cap: max 10 profiles
    if (existing.length >= 10) {
      const lowest = existing.reduce((a, b) => (a.importance < b.importance ? a : b));
      await db.execute('DELETE FROM long_term_memory WHERE id = ?', [lowest.id]);
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO long_term_memory (id, type, content, importance, source_date)
       VALUES (?, 'user_profile', ?, ?, ?)`,
      [id, content, importance, todayStr()],
    );
    this.invalidatePromptCache(); // Update system prompt immediately
    return id;
  }

  /** 删除用户画像条目 */
  async deleteUserProfile(memoryId: string): Promise<boolean> {
    const db = await getDB();
    // 先查出要删除的内容，用于后续按内容清理 localStorage
    const rows = await db.query<{ content: string }>(
      "SELECT content FROM long_term_memory WHERE id = ? AND type = 'user_profile'",
      [memoryId],
    );
    const deletedContent = rows[0]?.content;

    await db.execute(
      "DELETE FROM long_term_memory WHERE id = ? AND type = 'user_profile'",
      [memoryId],
    );
    // 同步清理 localStorage 中的旧数据（防止重启时迁移重新搬回）
    if (deletedContent) {
      try {
        const raw = localStorage.getItem('handy_agent_memories');
        if (raw) {
          const data = JSON.parse(raw) as Record<string, Array<{ id: string; content: string }>>;
          let changed = false;
          for (const agentName of Object.keys(data)) {
            const before = data[agentName].length;
            data[agentName] = data[agentName].filter((m) => m.content !== deletedContent);
            if (data[agentName].length !== before) changed = true;
          }
          if (changed) localStorage.setItem('handy_agent_memories', JSON.stringify(data));
        }
      } catch { /* 非致命 */ }
    }
    this.invalidatePromptCache();
    return true;
  }

  /** 获取所有用户画像（供 agent_memory_update 展示） */
  async getUserProfileEntries(): Promise<LongTermMemoryRow[]> {
    const db = await getDB();
    return db.query<LongTermMemoryRow>(
      "SELECT * FROM long_term_memory WHERE type = 'user_profile' ORDER BY importance DESC",
    );
  }

  /** 按关键词搜索记忆 */
  async searchMemories(keyword: string, type: string, limit: number = 10): Promise<LongTermMemoryRow[]> {
    const db = await getDB();
    let sql: string;
    const args: unknown[] = [];

    if (type === 'all' || !type) {
      sql = 'SELECT * FROM long_term_memory WHERE content LIKE ? ORDER BY importance DESC, last_updated_at DESC LIMIT ?';
      args.push(`%${keyword}%`, Math.min(limit, 30));
    } else {
      sql = 'SELECT * FROM long_term_memory WHERE type = ? AND content LIKE ? ORDER BY importance DESC, last_updated_at DESC LIMIT ?';
      args.push(type, `%${keyword}%`, Math.min(limit, 30));
    }

    return db.query<LongTermMemoryRow>(sql, args);
  }

  // ── 迁移 ──

  /** 确保 localStorage 旧数据已迁移 */
  private async ensureMigration(): Promise<void> {
    if (this._migrationDone) return;
    this._migrationDone = true;
    await this.migrateFromLocalStorage();
  }

  /** 将 localStorage 中的 agent_memory_update 记忆迁移到 SQLite */
  async migrateFromLocalStorage(): Promise<void> {
    try {
      const raw = localStorage.getItem('handy_agent_memories');
      if (!raw) return;

      const data = JSON.parse(raw) as Record<string, Array<{
        id: string;
        content: string;
        reason: string;
        time: string;
        createdAt: string;
      }>>;

      const db = await getDB();
      let migrated = 0;

      for (const [agentName, memories] of Object.entries(data)) {
        if (agentName !== 'chat') continue; // Only migrate chat memories
        for (const mem of memories) {
          // Check if already exists (by content match)
          const existing = await db.query<LongTermMemoryRow>(
            "SELECT * FROM long_term_memory WHERE type = 'user_profile' AND content = ?",
            [mem.content],
          );
          if (existing.length > 0) continue;

          await db.execute(
            `INSERT INTO long_term_memory (id, type, content, importance, source_date)
             VALUES (?, 'user_profile', ?, ?, ?)`,
            [crypto.randomUUID(), mem.content, 7, mem.time],
          );
          migrated++;
        }
      }

      if (migrated > 0) {
        console.log(`[MemoryCompressor] Migrated ${migrated} memories from localStorage to SQLite`);
        // 迁移完成后清除 localStorage，防止下次启动重新搬回已删除的数据
        localStorage.removeItem('handy_agent_memories');
      }
    } catch (e) {
      console.warn('[MemoryCompressor] localStorage migration failed:', e);
    }
  }
}

// ── 辅助函数 ──

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
