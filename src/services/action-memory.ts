// ActionMemory — 自动追踪每轮工具执行结果，防止 LLM 重复已完成的动作。
//
// 核心问题：LLM 每轮从截图+聊天历史重新推断状态，导致反复执行相同动作（如选笔刷→选颜色→选笔刷）。
// 解决方案：自动记录每次工具调用的结果，每轮注入结构化上下文到 LLM，明确告知"已经做了什么"。

/** 记录的动作条目 */
interface ActionEntry {
  tool: string;
  /** 关键参数摘要（过滤掉 window_hwnd, _scale 等内部字段） */
  keyArgs: string;
  /** 是否成功 */
  success: boolean;
  /** 结果摘要（截断） */
  summary: string;
  /** 首次执行的 turn */
  firstTurn: number;
  /** 最后一次执行的 turn */
  lastTurn: number;
  /** 执行次数 */
  count: number;
}

/** 不记录到 memory 的工具（内部/元操作） */
const SKIP_TOOLS = new Set([
  'task_progress_mark',
  'desktop_screenshot',
  'desktop_list_windows',
  'uia_fingerprint',
]);

/** 用于构建 keyArgs 的有意义参数名 */
const KEY_ARG_NAMES = new Set([
  'name', 'role', 'text', 'x', 'y', 'start_x', 'start_y', 'end_x', 'end_y',
  'hwnd', 'app', 'key', 'keys', 'url', 'path', 'message', 'milliseconds',
]);

/** 重复失败阈值：同名工具连续失败 N 次触发强警告 */
const REPEAT_FAILURE_THRESHOLD = 2;

export class ActionMemory {
  private successes: ActionEntry[] = [];
  private failures: ActionEntry[] = [];
  private currentTurn = 0;

  /** 设置当前 turn 编号（每轮开始时调用） */
  setTurn(turn: number): void {
    this.currentTurn = turn;
  }

  /** 是否有任何记忆 */
  hasMemory(): boolean {
    return this.successes.length > 0 || this.failures.length > 0;
  }

  /**
   * 记录一次工具执行结果。
   * 相同 tool + 相同 keyArgs 的成功动作会合并（更新 lastTurn/count）。
   */
  record(tool: string, args: Record<string, unknown>, success: boolean, result?: Record<string, unknown>): void {
    if (SKIP_TOOLS.has(tool)) return;

    const keyArgs = this.extractKeyArgs(tool, args);
    const summary = this.extractSummary(result);

    if (success) {
      // 成功：合并相同动作
      const existing = this.successes.find(s => s.tool === tool && s.keyArgs === keyArgs);
      if (existing) {
        existing.lastTurn = this.currentTurn;
        existing.count++;
        // 更新摘要（可能有新信息）
        if (summary) existing.summary = summary;
      } else {
        this.successes.push({
          tool, keyArgs, success: true, summary,
          firstTurn: this.currentTurn, lastTurn: this.currentTurn, count: 1,
        });
      }
      // 成功后从失败列表中移除同名工具
      this.failures = this.failures.filter(f => f.tool !== tool || f.keyArgs !== keyArgs);
    } else {
      // 失败：追加或合并
      const existing = this.failures.find(f => f.tool === tool && f.keyArgs === keyArgs);
      if (existing) {
        existing.lastTurn = this.currentTurn;
        existing.count++;
        if (summary) existing.summary = summary;
      } else {
        this.failures.push({
          tool, keyArgs, success: false, summary,
          firstTurn: this.currentTurn, lastTurn: this.currentTurn, count: 1,
        });
      }
    }
  }

  /**
   * 构建注入 LLM 的上下文消息。
   * 无记忆时返回 null。
   */
  buildContext(): string | null {
    if (!this.hasMemory()) return null;

    const parts: string[] = [];

    // 成功动作
    if (this.successes.length > 0) {
      const lines = this.successes.map((s, i) => {
        const args = s.keyArgs ? `(${s.keyArgs})` : '';
        const count = s.count > 1 ? ` ×${s.count}` : '';
        const detail = s.summary ? ` → ${s.summary}` : '';
        return `  ${i + 1}. ✅ ${s.tool}${args}${count}${detail}`;
      });
      parts.push(`📊 Actions already completed (do NOT repeat unless state changed):\n${lines.join('\n')}`);
    }

    // 失败动作
    if (this.failures.length > 0) {
      const lines = this.failures.map((f, i) => {
        const args = f.keyArgs ? `(${f.keyArgs})` : '';
        const count = f.count > 1 ? ` ×${f.count}` : '';
        const warn = f.count >= REPEAT_FAILURE_THRESHOLD ? ' ⚠️ REPEATEDLY FAILED — SWITCH STRATEGY' : '';
        const detail = f.summary ? ` → ${f.summary}` : '';
        return `  ${i + 1}. ❌ ${f.tool}${args}${count}${detail}${warn}`;
      });
      parts.push(`⚠️ Failed actions (avoid repeating the same approach):\n${lines.join('\n')}`);
    }

    // 重复失败强警告
    const repeatedFailures = this.failures.filter(f => f.count >= REPEAT_FAILURE_THRESHOLD);
    if (repeatedFailures.length > 0) {
      const names = repeatedFailures.map(f => `${f.tool}(${f.keyArgs})`).join(', ');
      parts.push(`🚨 REPEATED FAILURES: ${names}\nYou have tried the same action ${REPEAT_FAILURE_THRESHOLD}+ times and it keeps failing. You MUST try a completely different approach (e.g., use coordinates instead of UIA, use a different tool, or change the element you're targeting).`);
    }

    return parts.join('\n\n');
  }

  /** 提取关键参数摘要 */
  private extractKeyArgs(tool: string, args: Record<string, unknown>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(args)) {
      if (key.startsWith('_')) continue; // 跳过内部字段
      if (!KEY_ARG_NAMES.has(key)) continue;
      if (value == null) continue;

      // 坐标四舍五入到整数
      if ((key === 'x' || key === 'y' || key === 'start_x' || key === 'start_y' || key === 'end_x' || key === 'end_y') && typeof value === 'number') {
        parts.push(`${key}=${Math.round(value)}`);
      }
      // 字符串截断
      else if (typeof value === 'string') {
        parts.push(`${key}="${value.length > 30 ? value.substring(0, 30) + '...' : value}"`);
      }
      // 其他类型
      else {
        parts.push(`${key}=${JSON.stringify(value).substring(0, 40)}`);
      }
    }

    return parts.join(', ');
  }

  /** 提取结果摘要 */
  private extractSummary(result?: Record<string, unknown>): string {
    if (!result) return '';

    // 优先使用 message
    const msg = result['message'] as string | undefined;
    if (msg) return msg.length > 100 ? msg.substring(0, 100) + '...' : msg;

    // 其次使用 error
    const err = result['error'] as string | undefined;
    if (err) return `error: ${err.length > 80 ? err.substring(0, 80) + '...' : err}`;

    // 截取 data 的前几个字段
    const keys = Object.keys(result).filter(k => k !== 'image_data' && k !== 'region_screenshot' && k !== 'nodes');
    if (keys.length === 0) return '';

    const preview = keys.slice(0, 3).map(k => {
      const v = result[k];
      if (typeof v === 'string') return `${k}="${v.substring(0, 30)}"`;
      return `${k}=${JSON.stringify(v).substring(0, 30)}`;
    }).join(', ');

    return preview.length > 100 ? preview.substring(0, 100) + '...' : preview;
  }
}
