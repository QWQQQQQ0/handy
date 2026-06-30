// TaskMemory — FreeAgent 任务经验闭环
// Agent finalize 时自主决定是否附带 experience → 存入 long_term_memory → 下次检索注入
//
// 三种分类：
//   agent_heuristic  — 行为风格（跨任务通用准则），常驻注入 system prompt，≤ 8 条
//   task_workflow    — 行为方法（某类任务的具体流程），按需检索，结构化存储
//   agent_artifact   — 执行方法（代码/脚本复用），走 code_registry 表，不在此模块

import { getDB } from '@/db';

// ══════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════

export type ExperienceCategory = 'agent_heuristic' | 'task_workflow' | 'agent_artifact';

export interface WorkflowStep {
  order: number;
  action: string;
  tool: string;
  onFailure?: string;
}

export interface TaskWorkflow {
  goal: string;
  summary: string;
  /** 工具调用序列指纹，检索第一层匹配 */
  toolSignature: string[];
  /** 用户话术触发模式，检索第二层匹配（正则） */
  triggerPatterns: string[];
  /** 领域分类 */
  domain: string;
  tags: string[];
  preconditions: string[];
  workflow: WorkflowStep[];
  pitfalls: string[];
  version: number;
  successRate: number;
  createdAt: string;
}

export interface AgentHeuristic {
  content: string;
  importance: number;
  createdAt: string;
}

/** 旧版兼容类型 */
export interface TaskExperience {
  id: string;
  goal: string;
  success: boolean;
  approach: string;
  pitfalls: string[];
  lessons: string;
  patterns: string[];
  tags: string[];
  importance: number;
  sourceDate: string;
  hitCount: number;
}

// ══════════════════════════════════════════════════════════════════════
// DB helpers
// ══════════════════════════════════════════════════════════════════════

const MAX_HEURISTICS = 8;
const MAX_WORKFLOWS = 50;

// ══════════════════════════════════════════════════════════════════════
// Core API — storeAgentExperience（入口，按 category 路由）
// ══════════════════════════════════════════════════════════════════════

export async function storeAgentExperience(params: {
  category: ExperienceCategory;
  goal: string;
  success: boolean;
  // agent_heuristic 用
  heuristic?: string;
  // task_workflow 用
  workflow?: {
    summary?: string;
    toolSignature?: string[];
    triggerPatterns?: string[];
    domain?: string;
    tags?: string[];
    preconditions?: string[];
    steps?: WorkflowStep[];
    pitfalls?: string[];
  };
  // 旧版兼容
  experience?: {
    approach?: string;
    pitfalls?: string[];
    lessons?: string;
    patterns?: string[];
    tags?: string[];
    importance?: number;
  };
  importance?: number;
}): Promise<void> {
  const importance = Math.min(10, Math.max(1, params.importance ?? 6));
  if (importance < 5) {
    console.log(`[TaskMemory] ✗ 跳过低价值经验: "${params.goal.substring(0, 50)}" importance=${importance}`);
    return;
  }

  switch (params.category) {
    case 'agent_heuristic':
      await storeHeuristic({
        content: params.heuristic ?? params.goal,
        importance,
      });
      break;
    case 'task_workflow':
      await storeWorkflow({
        goal: params.goal,
        summary: params.workflow?.summary ?? params.goal,
        toolSignature: params.workflow?.toolSignature ?? [],
        triggerPatterns: params.workflow?.triggerPatterns ?? [],
        domain: params.workflow?.domain ?? 'general',
        tags: params.workflow?.tags ?? [],
        preconditions: params.workflow?.preconditions ?? [],
        workflow: params.workflow?.steps ?? [],
        pitfalls: params.workflow?.pitfalls ?? [],
        importance,
      });
      break;
    case 'agent_artifact':
      // agent_artifact 走 code_registry 表，这里只记一条轻量引用
      await storeArtifactReference(params.goal, params.workflow?.summary ?? '', importance);
      break;
    default:
      // 旧版兼容：无 category 时走旧逻辑
      await storeLegacyExperience(params);
  }
}

// ══════════════════════════════════════════════════════════════════════
// agent_heuristic — 行为风格
// ══════════════════════════════════════════════════════════════════════

async function storeHeuristic(params: {
  content: string;
  importance: number;
}): Promise<void> {
  try {
    const db = await getDB();
    const { content, importance } = params;

    // 去重：检查是否有相似内容
    const existing = await db.query<{ id: string; content: string; importance: number }>(
      "SELECT id, content, importance FROM long_term_memory WHERE type = 'agent_heuristic'",
    );
    const duplicate = existing.find((r) =>
      r.content.includes(content.substring(0, 50)) || content.includes(r.content.substring(0, 50)),
    );
    if (duplicate) {
      // 更新已有条目：取更高 importance，更新内容
      await db.execute(
        `UPDATE long_term_memory SET content = ?, importance = MAX(importance, ?), hit_count = hit_count + 1, last_updated_at = ? WHERE id = ?`,
        [content, importance, new Date().toISOString(), duplicate.id],
      );
      console.log(`[TaskMemory] ✓ 行为准则已合并: "${content.substring(0, 50)}"`);
      return;
    }

    // 硬上限检查
    if (existing.length >= MAX_HEURISTICS) {
      // 淘汰 importance 最低的
      const lowest = existing.reduce((a, b) => (a.importance < b.importance ? a : b));
      await db.execute('DELETE FROM long_term_memory WHERE id = ?', [lowest.id]);
      console.log(`[TaskMemory] 行为准则已满，淘汰: "${lowest.content.substring(0, 50)}"`);
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO long_term_memory (id, type, content, importance, source_date, hit_count)
       VALUES (?, 'agent_heuristic', ?, ?, ?, 1)`,
      [id, content, importance, new Date().toISOString().split('T')[0]],
    );
    console.log(`[TaskMemory] ✓ 行为准则已存储: "${content.substring(0, 50)}" importance=${importance}`);
  } catch (e) {
    console.warn('[TaskMemory] storeHeuristic failed:', e);
  }
}

/** 获取所有行为准则（供 system prompt 注入） */
export async function getHeuristics(): Promise<AgentHeuristic[]> {
  try {
    const db = await getDB();
    const rows = await db.query<{ content: string; importance: number; created_at: string }>(
      "SELECT content, importance, created_at FROM long_term_memory WHERE type = 'agent_heuristic' ORDER BY importance DESC",
    );
    return rows.map((r) => ({
      content: r.content,
      importance: r.importance,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════
// task_workflow — 行为方法（结构化存储 + 三层检索）
// ══════════════════════════════════════════════════════════════════════

async function storeWorkflow(params: {
  goal: string;
  summary: string;
  toolSignature: string[];
  triggerPatterns: string[];
  domain: string;
  tags: string[];
  preconditions: string[];
  workflow: WorkflowStep[];
  pitfalls: string[];
  importance: number;
}): Promise<void> {
  try {
    const db = await getDB();

    // 去重：检查 toolSignature 相似度 ≥ 70% 的已有工作流
    const existing = await db.query<{ id: string; content: string; importance: number; hit_count: number }>(
      "SELECT id, content, importance, hit_count FROM long_term_memory WHERE type = 'task_workflow'",
    );

    let duplicateId: string | null = null;
    for (const row of existing) {
      let parsed: TaskWorkflow | null = null;
      try { parsed = JSON.parse(row.content); } catch { /* ignore */ }
      if (!parsed) continue;

      const similarity = jaccardSimilarity(
        new Set(params.toolSignature),
        new Set(parsed.toolSignature),
      );
      if (similarity >= 0.7) {
        duplicateId = row.id;
        break;
      }
    }

    const now = new Date().toISOString();
    const workflow: TaskWorkflow = {
      goal: params.goal,
      summary: params.summary,
      toolSignature: params.toolSignature,
      triggerPatterns: params.triggerPatterns,
      domain: params.domain,
      tags: params.tags,
      preconditions: params.preconditions,
      workflow: params.workflow,
      pitfalls: params.pitfalls,
      version: 1,
      successRate: 1.0,
      createdAt: now.split('T')[0],
    };

    if (duplicateId) {
      // 合并更新：保留旧版本号 +1，合并 pitfalls/tags/triggerPatterns
      const oldRow = existing.find((r) => r.id === duplicateId);
      let oldWf: TaskWorkflow | null = null;
      if (oldRow) {
        try { oldWf = JSON.parse(oldRow.content); } catch { /* ignore */ }
      }
      if (oldWf) {
        workflow.version = oldWf.version + 1;
        workflow.pitfalls = [...new Set([...oldWf.pitfalls, ...params.pitfalls])];
        workflow.tags = [...new Set([...oldWf.tags, ...params.tags])];
        workflow.triggerPatterns = [...new Set([...oldWf.triggerPatterns, ...params.triggerPatterns])];
        workflow.successRate = oldWf.successRate > 0 ? (oldWf.successRate + 1.0) / 2 : 1.0;
      }

      await db.execute(
        `UPDATE long_term_memory SET content = ?, importance = MAX(importance, ?), hit_count = hit_count + 1, last_updated_at = ? WHERE id = ?`,
        [JSON.stringify(workflow), params.importance, now, duplicateId],
      );
      console.log(`[TaskMemory] ✓ 工作流已合并更新 v${workflow.version}: "${params.goal.substring(0, 50)}"`);
    } else {
      // 数量控制
      if (existing.length >= MAX_WORKFLOWS) {
        // 淘汰 hit_count 最低的
        const sorted = existing.sort((a, b) => (a.hit_count ?? 0) - (b.hit_count ?? 0));
        await db.execute('DELETE FROM long_term_memory WHERE id = ?', [sorted[0].id]);
      }

      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO long_term_memory (id, type, content, importance, source_date, hit_count)
         VALUES (?, 'task_workflow', ?, ?, ?, 1)`,
        [id, JSON.stringify(workflow), params.importance, now.split('T')[0]],
      );
      console.log(`[TaskMemory] ✓ 工作流已存储: "${params.goal.substring(0, 50)}" importance=${params.importance}`);
    }
  } catch (e) {
    console.warn('[TaskMemory] storeWorkflow failed:', e);
  }
}

/** 三层检索：工具签名 → 触发模式 → 关键词 */
export async function retrieveWorkflows(
  goal: string,
  availableTools: string[],
  limit = 3,
): Promise<Array<{ workflow: TaskWorkflow; score: number; matchLayer: string }>> {
  const db = await getDB();
  const rows = await db.query<{ id: string; content: string; importance: number; hit_count: number }>(
    "SELECT id, content, importance, hit_count FROM long_term_memory WHERE type = 'task_workflow' ORDER BY importance DESC, hit_count DESC",
  );

  const workflows: TaskWorkflow[] = [];
  for (const row of rows) {
    try { workflows.push(JSON.parse(row.content)); } catch { /* ignore */ }
  }

  if (workflows.length === 0) return [];

  const goalLower = goal.toLowerCase();
  const toolSet = new Set(availableTools.map((t) => t.toLowerCase()));
  const scored: Array<{ workflow: TaskWorkflow; score: number; matchLayer: string }> = [];

  for (const wf of workflows) {
    let score = 0;
    let matchLayer = 'keyword';

    // 第一层：工具签名匹配（Jaccard ≥ 0.4 才有资格）
    const wfTools = new Set(wf.toolSignature.map((t) => t.toLowerCase()));
    const toolSim = jaccardSimilarity(toolSet, wfTools);
    if (toolSim >= 0.4) {
      score += toolSim * 5; // 最高 5 分
      matchLayer = 'tool_signature';
    } else {
      // 工具不匹配，降权
      score += toolSim * 2;
    }

    // 第二层：触发模式匹配
    let triggerMatched = false;
    for (const pattern of wf.triggerPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(goal)) {
          score += 4;
          triggerMatched = true;
          if (matchLayer !== 'tool_signature') matchLayer = 'trigger_pattern';
          break;
        }
      } catch {
        // 非正则时做子串匹配
        if (goalLower.includes(pattern.toLowerCase())) {
          score += 3;
          triggerMatched = true;
          break;
        }
      }
    }

    // 第三层：关键词匹配
    for (const tag of wf.tags) {
      if (goalLower.includes(tag.toLowerCase())) score += 1.5;
    }
    const goalWords = goalLower.split(/\s+/);
    const wfGoalWords = wf.goal.toLowerCase().split(/\s+/);
    for (const w of goalWords) {
      if (w.length < 2) continue;
      if (wfGoalWords.some((ew) => ew.includes(w) || w.includes(ew))) score += 1;
    }
    for (const p of wf.pitfalls) {
      if (goalLower.includes(p.toLowerCase().substring(0, 10))) score += 0.5;
    }
    for (const pre of wf.preconditions) {
      if (goalLower.includes(pre.toLowerCase().substring(0, 10))) score += 0.5;
    }

    // 加成
    score += wf.successRate * 1;
    if (triggerMatched) score += 1; // 触发模式命中的额外奖励

    scored.push({ workflow: wf, score, matchLayer });
  }

  // 取 top-N，score > 1 才算有效
  const top = scored
    .filter((s) => s.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // 更新 hit_count
  if (top.length > 0) {
    for (const { workflow: wf } of top) {
      try {
        await db.execute(
          `UPDATE long_term_memory SET hit_count = hit_count + 1 WHERE type = 'task_workflow' AND content LIKE ?`,
          [`%${wf.goal.substring(0, 30)}%`],
        );
      } catch { /* ignore */ }
    }
  }

  return top;
}

// ══════════════════════════════════════════════════════════════════════
// agent_artifact — 执行方法（轻量引用）
// ══════════════════════════════════════════════════════════════════════

async function storeArtifactReference(goal: string, description: string, importance: number): Promise<void> {
  try {
    const db = await getDB();
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO long_term_memory (id, type, content, importance, source_date, hit_count)
       VALUES (?, 'agent_artifact', ?, ?, ?, 1)`,
      [id, JSON.stringify({ goal, description }), importance, new Date().toISOString().split('T')[0]],
    );
    console.log(`[TaskMemory] ✓ 产物引用已存储: "${goal.substring(0, 50)}"`);
  } catch (e) {
    console.warn('[TaskMemory] storeArtifactReference failed:', e);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 旧版兼容
// ══════════════════════════════════════════════════════════════════════

async function storeLegacyExperience(params: {
  goal: string;
  success: boolean;
  experience?: {
    approach?: string;
    pitfalls?: string[];
    lessons?: string;
    patterns?: string[];
    tags?: string[];
    importance?: number;
  };
  importance?: number;
}): Promise<void> {
  const { goal, success, experience: exp } = params;
  const importance = params.importance ?? exp?.importance ?? 6;
  if (importance < 5) return;

  // 尝试根据内容自动推断分类
  const hasSteps = exp?.patterns?.some((p) => p.includes('步骤') || p.includes('step') || p.includes('先') || p.includes('再'));
  const isHeuristic = exp?.lessons && !exp?.patterns?.length && !exp?.pitfalls?.length;

  if (isHeuristic && exp?.lessons) {
    await storeHeuristic({ content: exp.lessons, importance });
    return;
  }

  if (hasSteps) {
    const steps: WorkflowStep[] = (exp?.patterns ?? []).map((p, i) => ({
      order: i + 1,
      action: p,
      tool: '',
    }));
    await storeWorkflow({
      goal,
      summary: exp?.approach ?? goal,
      toolSignature: [],
      triggerPatterns: [],
      domain: 'general',
      tags: exp?.tags ?? [],
      preconditions: [],
      workflow: steps,
      pitfalls: exp?.pitfalls ?? [],
      importance,
    });
    return;
  }

  // 默认存为旧版 task_experience
  const record: TaskExperience = {
    id: crypto.randomUUID(),
    goal,
    success,
    approach: exp?.approach ?? '',
    pitfalls: exp?.pitfalls ?? [],
    lessons: exp?.lessons ?? '',
    patterns: exp?.patterns ?? [],
    tags: exp?.tags ?? [],
    importance,
    sourceDate: new Date().toISOString().split('T')[0],
    hitCount: 1,
  };

  try {
    const db = await getDB();
    const content = JSON.stringify({
      goal: record.goal,
      success: record.success,
      approach: record.approach,
      pitfalls: record.pitfalls,
      lessons: record.lessons,
      patterns: record.patterns,
      tags: record.tags,
    });
    await db.execute(
      `INSERT INTO long_term_memory (id, type, content, importance, source_date, hit_count)
       VALUES (?, 'task_experience', ?, ?, ?, ?)`,
      [record.id, content, record.importance, record.sourceDate, record.hitCount],
    );

    // 淘汰旧数据
    const all = await db.query<{ id: string; importance: number }>(
      "SELECT id, importance FROM long_term_memory WHERE type = 'task_experience' ORDER BY importance DESC",
    );
    if (all.length > 50) {
      const toRemove = all.slice(50);
      for (const e of toRemove) {
        await db.execute('DELETE FROM long_term_memory WHERE id = ?', [e.id]);
      }
    }
    console.log(`[TaskMemory] ✓ 旧版经验已存储: "${goal.substring(0, 50)}" importance=${importance}`);
  } catch { /* non-critical */ }
}

// ══════════════════════════════════════════════════════════════════════
// 旧版检索 API（兼容现有调用方）
// ══════════════════════════════════════════════════════════════════════

async function getExperiences(): Promise<TaskExperience[]> {
  try {
    const db = await getDB();
    const rows = await db.query<{
      id: string; content: string; importance: number;
      source_date: string; hit_count: number;
    }>(
      `SELECT id, content, importance, source_date, hit_count
       FROM long_term_memory WHERE type = 'task_experience' ORDER BY importance DESC, hit_count DESC`,
    );
    return rows.map((r) => {
      let parsed: TaskExperience | null = null;
      try { parsed = JSON.parse(r.content); } catch { /* ignore */ }
      return {
        id: r.id,
        goal: parsed?.goal ?? '',
        success: parsed?.success ?? false,
        approach: parsed?.approach ?? '',
        pitfalls: parsed?.pitfalls ?? [],
        lessons: parsed?.lessons ?? '',
        patterns: parsed?.patterns ?? [],
        tags: parsed?.tags ?? [],
        importance: r.importance,
        sourceDate: r.source_date ?? '',
        hitCount: r.hit_count,
      };
    });
  } catch {
    return [];
  }
}

/** 根据新任务目标检索相关历史经验（旧版，仅查 task_experience 和 task_workflow） */
export async function retrieveRelevantExperiences(
  goal: string,
  limit = 3,
): Promise<TaskExperience[]> {
  // 新旧一起查，合并结果
  const [oldExps, workflowResults] = await Promise.all([
    getExperiences(),
    retrieveWorkflows(goal, [], limit),
  ]);

  // 转换 workflow 为 TaskExperience 格式
  const fromWorkflows: TaskExperience[] = workflowResults.map((r) => ({
    id: '',
    goal: r.workflow.goal,
    success: true,
    approach: r.workflow.summary,
    pitfalls: r.workflow.pitfalls,
    lessons: '',
    patterns: r.workflow.workflow.map((s) => s.action),
    tags: r.workflow.tags,
    importance: 7, // workflows are always important enough
    sourceDate: r.workflow.createdAt,
    hitCount: 1,
  }));

  // 合并去重（按 goal 相似度）
  const merged = [...fromWorkflows, ...oldExps];
  const deduped: TaskExperience[] = [];
  for (const exp of merged) {
    const isDup = deduped.some((d) =>
      d.goal.substring(0, 20) === exp.goal.substring(0, 20) ||
      (d.approach && exp.approach && d.approach.substring(0, 30) === exp.approach.substring(0, 30)),
    );
    if (!isDup) deduped.push(exp);
  }

  // 简单打分排序
  const goalLower = goal.toLowerCase();
  const scored = deduped.map((e) => {
    let score = 0;
    for (const tag of e.tags) {
      if (goalLower.includes(tag.toLowerCase())) score += 3;
    }
    const goalWords = goalLower.split(/\s+/);
    const expWords = e.goal.toLowerCase().split(/\s+/);
    for (const w of goalWords) {
      if (w.length < 2) continue;
      if (expWords.some((ew) => ew.includes(w) || w.includes(ew))) score += 2;
    }
    for (const p of e.patterns) {
      if (goalLower.includes(p.toLowerCase())) score += 1;
    }
    score += e.importance * 0.5;
    if (e.success) score += 1;
    return { exp: e, score };
  });

  const top = scored
    .filter((s) => s.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // 更新 hit_count
  if (top.length > 0) {
    try {
      const db = await getDB();
      for (const { exp } of top) {
        if (!exp.id) continue;
        await db.execute(
          'UPDATE long_term_memory SET hit_count = hit_count + 1 WHERE id = ?',
          [exp.id],
        );
      }
    } catch { /* ignore */ }
  }

  return top.map((s) => s.exp);
}

// ══════════════════════════════════════════════════════════════════════
// 格式化
// ══════════════════════════════════════════════════════════════════════

/** 将行为准则格式化为注入 system prompt 的文本 */
export function formatHeuristicsForPrompt(heuristics: AgentHeuristic[]): string {
  if (heuristics.length === 0) return '';
  const lines = ['\n## 行为准则（从历史任务中学习的通用规则）'];
  for (const h of heuristics) {
    lines.push(`- ${h.content}`);
  }
  return lines.join('\n');
}

/** 将工作流检索结果格式化为注入 system prompt 的文本 */
export function formatWorkflowsForPrompt(
  results: Array<{ workflow: TaskWorkflow; score: number; matchLayer: string }>,
): string {
  if (results.length === 0) return '';

  const lines = ['\n## 相关历史经验（根据当前任务自动匹配）'];

  for (const { workflow: wf, matchLayer } of results) {
    const layerLabel = matchLayer === 'tool_signature' ? '工具匹配' :
      matchLayer === 'trigger_pattern' ? '话术匹配' : '关键词匹配';
    lines.push(`\n### ${wf.goal}（${layerLabel}，成功率 ${Math.round(wf.successRate * 100)}%）`);
    if (wf.summary && wf.summary !== wf.goal) lines.push(`> ${wf.summary}`);
    if (wf.preconditions.length > 0) {
      lines.push(`- 前置条件: ${wf.preconditions.join('、')}`);
    }
    if (wf.workflow.length > 0) {
      lines.push('- 执行步骤:');
      for (const step of wf.workflow) {
        const failNote = step.onFailure ? `（失败时: ${step.onFailure}）` : '';
        lines.push(`  ${step.order}. [${step.tool}] ${step.action} ${failNote}`);
      }
    }
    if (wf.pitfalls.length > 0) {
      lines.push(`- ⚠️ 注意事项: ${wf.pitfalls.map((p) => `「${p}」`).join('、')}`);
    }
  }

  return lines.join('\n');
}

/** 旧版兼容：将 TaskExperience 格式化为注入 system prompt 的文本 */
export function formatExperiencesForPrompt(experiences: TaskExperience[]): string {
  if (experiences.length === 0) return '';

  const lines = ['\n## 历史任务经验（参考以下经验提升效率）'];

  for (const e of experiences) {
    const status = e.success ? '✅' : '❌';
    lines.push(`\n### ${status} ${e.goal}`);
    if (e.approach) lines.push(`- 方法: ${e.approach}`);
    if (e.pitfalls.length > 0) {
      lines.push(`- 避免: ${e.pitfalls.map((p) => `「${p}」`).join('、')}`);
    }
    if (e.lessons) lines.push(`- 教训: ${e.lessons}`);
    if (e.patterns.length > 0) {
      lines.push(`- 可用模式: ${e.patterns.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
