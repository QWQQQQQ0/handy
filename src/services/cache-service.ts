// Agent Runtime Cache Service — Phase 2
//
// Three-level cache for desktop automation:
//   L1: UI fingerprint → interactive nodes (skip UIA call)
//   L2: task hash + fingerprint → semantic action sequence (skip LLM)
//   L3: action sequence → Skill template (Phase 3, automatic learning)

import { getDB } from '@/db';
import type {
  UICacheRow,
  StepCacheRow,
  StepCacheEntry,
  SubGoalCacheRow,
  SubGoalCacheEntry,
  LLMCallCacheRow,
  GoalDecomposition,
  InteractiveNode,
  SemanticAction,
  SemanticAnnotation,
  SkillTemplateRow,
} from '@/types/cache';
import type { TriggerInfo } from '@/types/page-component';
import type { ICacheService, CacheHitResult } from '@/interfaces/cache-service';

// ── Task hash (simple FNV-1a style) ──

/** Normalize goal text for cache key: strip spaces/punctuation, lowercase. */
export function normalizeGoal(goal: string): string {
  return goal
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')     // remove all whitespace (ASCII + Chinese full-width)
    .replace(/[，。！？、；：""''【】（）《》,.!?;:'"()[\]{}]/g, ''); // remove punctuation
}


// ── L1: UI fingerprint → interactive nodes ──

export async function storeUICache(
  fingerprint: string,
  windowFP: string,
  pageFP: string | null,
  appName: string,
  windowClass: string,
  nodes: InteractiveNode[],
  semanticAnnotations?: SemanticAnnotation[],
  parentFingerprint?: string | null,
  trigger?: TriggerInfo | null,
  screenshotPath?: string | null,
): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT OR REPLACE INTO ui_cache
     (fingerprint, window_fp, page_fp, app_name, window_class, interactive_nodes, semantic_annotations, ocr_texts, created_at, last_hit_at, hit_count, ttl_days, parent_fingerprint, trigger_json, screenshot_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 30, ?, ?, ?)`,
    [fingerprint, windowFP, pageFP, appName, windowClass, JSON.stringify(nodes), JSON.stringify(semanticAnnotations ?? []), '[]', now, now, parentFingerprint ?? null, trigger ? JSON.stringify(trigger) : null, screenshotPath ?? null],
  );
}

export async function getUICache(
  fingerprint: string,
): Promise<{ nodes: InteractiveNode[]; annotations: SemanticAnnotation[]; row: UICacheRow } | null> {
  const db = await getDB();
  const row = await db.get<UICacheRow>(
    'SELECT * FROM ui_cache WHERE fingerprint = ?',
    [fingerprint],
  );
  if (!row) {
    return null;
  }

  // Check TTL
  const now = Math.floor(Date.now() / 1000);
  if (now > row.created_at + row.ttl_days * 86400) {
    await db.execute('DELETE FROM ui_cache WHERE fingerprint = ?', [fingerprint]);
    return null;
  }

  // Bump hit stats
  await db.execute(
    'UPDATE ui_cache SET last_hit_at = ?, hit_count = hit_count + 1 WHERE fingerprint = ?',
    [now, fingerprint],
  );

  try {
    const nodes = JSON.parse(row.interactive_nodes) as InteractiveNode[];
    const annotations: SemanticAnnotation[] = row.semantic_annotations
      ? JSON.parse(row.semantic_annotations)
      : [];
    return { nodes, annotations, row };
  } catch {
    return null;
  }
}

// ── L1 OCR: OCR text cache (used when UIA unavailable, e.g. WeChat) ──

interface OcrCacheItem {
  text: string;
  confidence: number;
  bbox: { left: number; top: number; right: number; bottom: number };
}

export async function getOcrFromUICache(
  fingerprint: string,
): Promise<OcrCacheItem[] | null> {
  const db = await getDB();
  const row = await db.get<{ ocr_texts: string; created_at: number }>(
    'SELECT ocr_texts, created_at FROM ui_cache WHERE fingerprint = ?',
    [fingerprint],
  );
  if (!row) return null;
  // OCR cache uses a 10-min TTL (stored with ttl_days=0)
  const elapsedMs = (Date.now() / 1000 - row.created_at) * 1000;
  if (elapsedMs > OCR_CACHE_TTL_MINUTES * 60 * 1000) {
    // Expired — delete stale row
    await db.execute('DELETE FROM ui_cache WHERE fingerprint = ?', [fingerprint]).catch(() => {});
    return null;
  }
  try {
    return JSON.parse(row.ocr_texts) as OcrCacheItem[];
  } catch {
    return null;
  }
}

export async function storeOcrToUICache(
  fingerprint: string,
  windowFP: string,
  appName: string,
  ocrItems: OcrCacheItem[],
): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  // Short TTL (10 min) — OCR content changes frequently within same app
  await db.execute(
    `INSERT OR REPLACE INTO ui_cache
     (fingerprint, window_fp, app_name, window_class, interactive_nodes, semantic_annotations, ocr_texts, created_at, last_hit_at, hit_count, ttl_days)
     VALUES (?, ?, ?, '', '[]', '[]', ?, ?, ?, 1, 0)`,
    [fingerprint, windowFP, appName, JSON.stringify(ocrItems), now, now],
  );
}

const OCR_CACHE_TTL_MINUTES = 10;

/** Compute OCR content fingerprint — hash of sorted text lines. */
export function computeOcrFingerprint(items: OcrCacheItem[], appName: string): string {
  const sorted = [...items].map(i => i.text).sort().join('\n');
  const input = `${appName}:${sorted}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `ocr_${Math.abs(hash).toString(36)}`;
}

// ── L1 helper: best matching fingerprint from a set of page fingerprints ──

export function resolveFingerprint(
  windowFP: string,
  pageFPs: Record<string, string>,
  preferredPage?: string,
): { fingerprint: string; isExactPage: boolean } {
  // If we have a preferred page and it exists, use that exact page fingerprint
  if (preferredPage && pageFPs[preferredPage]) {
    return { fingerprint: pageFPs[preferredPage], isExactPage: true };
  }
  // Otherwise use the window-level fingerprint
  return { fingerprint: windowFP, isExactPage: false };
}

// ── Web page fingerprinting ──

/** Hash DOM structure (tags + hierarchy) for fingerprint stability across content changes */
export function hashDOMStructure(nodes: Array<{ tag?: string; children?: unknown[] }>): string {
  const structural = nodes.slice(0, 100).map(n => {
    const childCount = n.children?.length ?? 0;
    return `${n.tag ?? '?'}:${childCount}`;
  }).join('|');
  let hash = 0;
  for (let i = 0; i < structural.length; i++) {
    hash = ((hash << 5) - hash + structural.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compute a fingerprint for a web page based on URL origin + path + DOM structure hash.
 * This enables L1 caching for web pages without UIA.
 */
export function computeWebFingerprint(url: string, domNodeCount: number, domStructureHash?: string): string {
  try {
    const parsed = new URL(url);
    const key = `${parsed.origin}${parsed.pathname}:${domNodeCount}`;
    const input = domStructureHash ? `${key}:${domStructureHash}` : key;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `web_${Math.abs(hash).toString(36)}`;
  } catch {
    let hash = 0;
    const input = `${url}:${domNodeCount}`;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `web_${Math.abs(hash).toString(36)}`;
  }
}

// ── L3: Skill template CRUD ──

export async function storeSkillTemplate(
  name: string,
  description: string,
  params: string[],
  template: SemanticAction[],
  preconditions: string[],
): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  // Check if already exists — if learned_from is high enough, update it
  const existing = await db.get<{ learned_from: number }>(
    'SELECT learned_from FROM skill_templates WHERE name = ?',
    [name],
  );
  const learnedFrom = (existing?.learned_from ?? 0) + 1;

  await db.execute(
    `INSERT OR REPLACE INTO skill_templates
     (name, description, params_json, template_json, preconditions_json, learned_from, last_success_at, created_at, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      name,
      description,
      JSON.stringify(params),
      JSON.stringify(template),
      JSON.stringify(preconditions),
      learnedFrom,
      now,
      existing ? undefined : now,
    ],
  );
}

export async function getSkillTemplateRows(): Promise<import('@/types/cache').SkillTemplateRow[]> {
  const db = await getDB();
  return db.query<import('@/types/cache').SkillTemplateRow>(
    'SELECT * FROM skill_templates WHERE enabled = 1 ORDER BY learned_from DESC',
  );
}

// ── Bulk query for cache viewer ──

export async function getAllUICacheRows(): Promise<UICacheRow[]> {
  const db = await getDB();
  // 只取前 200 字符的 JSON 摘要 + 长度信息，避免拉取超大 JSON 导致页面卡顿
  return db.query<UICacheRow>(
    `SELECT fingerprint, window_fp, page_fp, app_name, window_class,
            substr(interactive_nodes, 1, 200) AS interactive_nodes,
            length(interactive_nodes) AS interactive_nodes_total_len,
            substr(semantic_annotations, 1, 200) AS semantic_annotations,
            length(semantic_annotations) AS semantic_annotations_total_len,
            ocr_texts, created_at, last_hit_at, hit_count, ttl_days,
            parent_fingerprint, trigger_json, screenshot_path
     FROM ui_cache ORDER BY last_hit_at DESC LIMIT 200`,
  );
}

export async function getAllSkillTemplateRows(): Promise<import('@/types/cache').SkillTemplateRow[]> {
  const db = await getDB();
  return db.query<import('@/types/cache').SkillTemplateRow>('SELECT * FROM skill_templates ORDER BY learned_from DESC LIMIT 200');
}

export async function deleteUICache(fingerprint: string): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM ui_cache WHERE fingerprint = ?', [fingerprint]);
}


export async function deleteSkillTemplate(id: number): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM skill_templates WHERE id = ?', [id]);
}

// ── L2a: Sub-goal cache (sub-goal key → parameterized action template) ──

export async function storeSubGoalCache(entry: SubGoalCacheEntry): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT OR REPLACE INTO subgoal_cache
     (subgoal_key, app_name, window_fp, params_json, template_json, source_goal, hit_count, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [entry.subgoalKey, entry.appName || null, entry.windowFP || null, JSON.stringify(entry.params), JSON.stringify(entry.template), entry.sourceGoal, now],
  );
}

export async function getSubGoalCache(
  subgoalKey: string,
  appName?: string,
): Promise<SubGoalCacheEntry | null> {
  const db = await getDB();
  const normalized = normalizeGoal(subgoalKey);

  // ① 精确匹配：subgoal_key + app_name
  if (appName) {
    const exact = await db.get<SubGoalCacheRow>(
      'SELECT * FROM subgoal_cache WHERE subgoal_key = ? AND app_name = ? ORDER BY hit_count DESC LIMIT 1',
      [normalized, appName],
    );
    if (exact) {
      await bumpSubGoalCacheHit(exact.id);
      return rowToSubGoalEntry(exact);
    }
  }

  // ② 模糊匹配：仅 subgoal_key（app_name 为 NULL 的通用缓存）
  const fuzzy = await db.get<SubGoalCacheRow>(
    'SELECT * FROM subgoal_cache WHERE subgoal_key = ? AND app_name IS NULL ORDER BY hit_count DESC LIMIT 1',
    [normalized],
  );
  if (fuzzy) {
    await bumpSubGoalCacheHit(fuzzy.id);
    return rowToSubGoalEntry(fuzzy);
  }

  return null;
}

export async function getAllSubGoalCacheRows(): Promise<SubGoalCacheRow[]> {
  const db = await getDB();
  return db.query<SubGoalCacheRow>('SELECT * FROM subgoal_cache ORDER BY hit_count DESC LIMIT 200');
}

export async function deleteSubGoalCache(id: number): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM subgoal_cache WHERE id = ?', [id]);
}

export async function deleteSubGoalCacheByKey(subgoalKey: string, appName?: string): Promise<void> {
  const db = await getDB();
  const normalized = normalizeGoal(subgoalKey);
  if (appName) {
    await db.execute('DELETE FROM subgoal_cache WHERE subgoal_key = ? AND app_name = ?', [normalized, appName]);
  } else {
    await db.execute('DELETE FROM subgoal_cache WHERE subgoal_key = ? AND app_name IS NULL', [normalized]);
  }
}

export async function clearSubGoalCache(): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM subgoal_cache');
}

async function bumpSubGoalCacheHit(id: number): Promise<void> {
  const db = await getDB();
  await db.execute(
    'UPDATE subgoal_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?',
    [Math.floor(Date.now() / 1000), id],
  );
}

function rowToSubGoalEntry(row: SubGoalCacheRow): SubGoalCacheEntry {
  return {
    subgoalKey: row.subgoal_key,
    appName: row.app_name || undefined,
    windowFP: row.window_fp || undefined,
    params: JSON.parse(row.params_json) as string[],
    template: JSON.parse(row.template_json) as SemanticAction[],
    sourceGoal: row.source_goal,
  };
}

// ── LLM 调用缓存 (request hash → response text) ──

export async function getLLMCallCache(requestHash: string): Promise<LLMCallCacheRow | null> {
  const db = await getDB();
  const row = await db.get<LLMCallCacheRow>(
    'SELECT * FROM llm_call_cache WHERE request_hash = ?',
    [requestHash],
  );
  if (!row) return null;
  await db.execute(
    'UPDATE llm_call_cache SET hit_count = hit_count + 1 WHERE id = ?',
    [row.id],
  );
  console.log(`[Cache:LLM] HIT — hash=${requestHash.substring(0, 12)}..., model=${row.model}, hits=${row.hit_count}`);
  return row;
}

export async function storeLLMCallCache(
  requestHash: string,
  responseText: string,
  model: string,
  providerType: string,
  messageCount: number,
  toolCount: number,
  requestText?: string,
): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT OR REPLACE INTO llm_call_cache
     (request_hash, request_text, response_text, model, provider_type, message_count, tool_count, created_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [requestHash, requestText ?? '', responseText, model, providerType, messageCount, toolCount, now],
  );
  console.log(`[Cache:LLM] STORE — hash=${requestHash.substring(0, 12)}..., model=${model}, responseLen=${responseText.length}, requestLen=${(requestText ?? '').length}`);
}

export async function getAllLLMCallCacheRows(): Promise<LLMCallCacheRow[]> {
  const db = await getDB();
  // 不拉全量 response_text（可能很大），只取前 200 字符 + 长度
  return db.query<LLMCallCacheRow>(
    `SELECT id, request_hash,
            substr(request_text, 1, 200) AS request_text,
            model, provider_type, message_count, tool_count,
            created_at, hit_count,
            length(response_text) AS response_size
     FROM llm_call_cache ORDER BY hit_count DESC LIMIT 100`,
  );
}

export async function deleteLLMCallCache(id: number): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM llm_call_cache WHERE id = ?', [id]);
}

export async function clearAllCache(): Promise<void> {
  const db = await getDB();
  // action_cache: 旧版 DDL 有 FK → ui_cache, 虽已从 schema 移除但数据库可能仍存在
  // ui_cache 放最后: 子表先删, 避免 FK 约束冲突
  const tables = ['action_cache', 'step_cache', 'subgoal_cache', 'llm_call_cache', 'goal_decomposition_cache', 'skill_templates', 'ui_cache'];
  const errors: string[] = [];

  // Multi-pass: FK 链可能跨多表, 每轮清掉所有无依赖的表, 直到全部清空或无进展
  let remaining = [...tables];
  for (let pass = 0; pass < tables.length && remaining.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of remaining) {
      try {
        await db.execute(`DELETE FROM ${table}`);
      } catch (e) {
        const msg = String(e);
        // 表不存在则跳过, 不再重试
        if (msg.includes('no such table') || msg.includes('does not exist')) continue;
        failed.push(table);
        if (pass === tables.length - 1) {
          errors.push(`${table}: ${e}`);
        }
      }
    }
    if (failed.length === remaining.length) break; // no progress
    remaining = failed;
  }

  if (errors.length > 0) {
    throw new Error(`Failed to clear some tables:\n${errors.join('\n')}`);
  }
}

// ── Cache hit test ──

export type { CacheHitResult } from '@/interfaces/cache-service';

export async function testCacheHit(goal: string, windowFP: string, pageFP?: string): Promise<CacheHitResult[]> {
  const results: CacheHitResult[] = [];
  const { matchGoal } = await import('@/core/skill-resolver');

  // L3: skill template match
  const l3Match = await matchGoal(goal);
  if (l3Match) {
    results.push({
      level: 'l3',
      detail: `Matched template "${l3Match.skill.name}" (score=${l3Match.score.toFixed(2)}, params=[${l3Match.skill.params.join(', ')}])`,
      entry: { name: l3Match.skill.name, description: l3Match.skill.description, params: l3Match.skill.params, template_steps: l3Match.skill.template.length },
    });
  } else {
    results.push({ level: 'l3', detail: 'No skill template matched' });
  }

  // L1: UI cache with semantic annotations
  const l1Hit = await getUICache(windowFP);
  if (l1Hit) {
    const annCount = l1Hit.annotations.length;
    const annSummary = annCount > 0
      ? `, annotations=${annCount}: ${l1Hit.annotations.slice(0, 5).map(a => a.label).join(', ')}${annCount > 5 ? '...' : ''}`
      : ', annotations=0 (not yet annotated)';
    results.push({
      level: 'l1',
      detail: `HIT — windowFP=${windowFP}, nodes=${l1Hit.nodes.length}${annSummary}, hits=${l1Hit.row.hit_count}`,
      entry: { windowFP, app_name: l1Hit.row.app_name, nodes_count: l1Hit.nodes.length, annotations_count: annCount, hit_count: l1Hit.row.hit_count },
    });
  } else {
    results.push({ level: 'l1', detail: `MISS — windowFP=${windowFP}` });
  }

  return results;
}

// ── Semantic annotation helpers ──

/** Update semantic_annotations for an existing ui_cache entry. */
export async function updateSemanticAnnotations(
  fingerprint: string,
  annotations: SemanticAnnotation[],
): Promise<void> {
  const db = await getDB();
  await db.execute(
    'UPDATE ui_cache SET semantic_annotations = ? WHERE fingerprint = ?',
    [JSON.stringify(annotations), fingerprint],
  );
}

// ── Page Knowledge: parent-child relationships ──

/** 获取某组件的所有子组件 */
export async function getChildrenOf(parentFingerprint: string): Promise<UICacheRow[]> {
  const db = await getDB();
  return db.query<UICacheRow>(
    'SELECT * FROM ui_cache WHERE parent_fingerprint = ? ORDER BY last_hit_at DESC',
    [parentFingerprint],
  );
}

/** 更新组件的父组件和触发方式 */
export async function updatePageComponent(
  fingerprint: string,
  parentFp: string | null,
  trigger: TriggerInfo | null,
): Promise<void> {
  const db = await getDB();
  await db.execute(
    'UPDATE ui_cache SET parent_fingerprint = ?, trigger_json = ? WHERE fingerprint = ?',
    [parentFp, trigger ? JSON.stringify(trigger) : null, fingerprint],
  );
}

export async function updateScreenshotPath(
  fingerprint: string,
  screenshotPath: string,
): Promise<void> {
  const db = await getDB();
  await db.execute(
    'UPDATE ui_cache SET screenshot_path = ? WHERE fingerprint = ?',
    [screenshotPath, fingerprint],
  );
}

/** 获取某个应用的全部页面组件 */
export async function getAppPageGraph(appName: string): Promise<UICacheRow[]> {
  const db = await getDB();
  return db.query<UICacheRow>(
    'SELECT * FROM ui_cache WHERE app_name = ? ORDER BY parent_fingerprint NULLS FIRST, last_hit_at DESC',
    [appName],
  );
}

// ── L2: Step cache (goal fragment → element location) ──

/**
 * 查询步骤缓存
 * 优先级：精确匹配(windowFP) > 应用匹配(appName) > 模糊匹配(仅 goalFragment)
 */
export async function getStepCache(
  goalFragment: string,
  windowFP?: string,
  appName?: string,
): Promise<StepCacheEntry | null> {
  const db = await getDB();
  const normalized = normalizeGoal(goalFragment);

  // ① 精确匹配：goalFragment + windowFP
  if (windowFP) {
    const exact = await db.get<StepCacheRow>(
      'SELECT * FROM step_cache WHERE goal_fragment = ? AND window_fp = ? ORDER BY hit_count DESC LIMIT 1',
      [normalized, windowFP],
    );
    if (exact) {
      await bumpStepCacheHit(exact.id);
      return rowToStepEntry(exact);
    }
  }

  // ② 应用匹配：goalFragment + appName
  if (appName) {
    const appMatch = await db.get<StepCacheRow>(
      'SELECT * FROM step_cache WHERE goal_fragment = ? AND app_name = ? ORDER BY hit_count DESC LIMIT 1',
      [normalized, appName],
    );
    if (appMatch) {
      await bumpStepCacheHit(appMatch.id);
      return rowToStepEntry(appMatch);
    }
  }

  // ③ 模糊匹配：仅 goalFragment
  const fuzzy = await db.get<StepCacheRow>(
    'SELECT * FROM step_cache WHERE goal_fragment = ? ORDER BY hit_count DESC LIMIT 1',
    [normalized],
  );
  if (fuzzy) {
    await bumpStepCacheHit(fuzzy.id);
    return rowToStepEntry(fuzzy);
  }

  return null;
}

/**
 * 存储步骤缓存
 */
export async function storeStepCache(entry: StepCacheEntry): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeGoal(entry.goalFragment);

  // 检查是否已存在（相同 goalFragment + windowFP 或 goalFragment + appName）
  let existing: StepCacheRow | null = null;
  if (entry.windowFP) {
    existing = await db.get<StepCacheRow>(
      'SELECT * FROM step_cache WHERE goal_fragment = ? AND window_fp = ?',
      [normalized, entry.windowFP],
    );
  }
  if (!existing && entry.appName) {
    existing = await db.get<StepCacheRow>(
      'SELECT * FROM step_cache WHERE goal_fragment = ? AND app_name = ?',
      [normalized, entry.appName],
    );
  }

  if (existing) {
    // 更新已有记录
    await db.execute(
      'UPDATE step_cache SET role = ?, name = ?, bounds_json = ?, hit_count = hit_count + 1, last_used_at = ? WHERE id = ?',
      [entry.role, entry.name, entry.bounds ? JSON.stringify(entry.bounds) : null, now, existing.id],
    );
  } else {
    // 插入新记录
    await db.execute(
      'INSERT INTO step_cache (goal_fragment, role, name, bounds_json, window_fp, app_name, hit_count, last_used_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      [normalized, entry.role, entry.name, entry.bounds ? JSON.stringify(entry.bounds) : null, entry.windowFP || null, entry.appName || null, now],
    );
  }
}

/**
 * 删除步骤缓存
 */
export async function deleteStepCache(id: number): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM step_cache WHERE id = ?', [id]);
}

/**
 * 清空所有步骤缓存
 */
export async function clearStepCache(): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM step_cache');
}

/**
 * 获取所有步骤缓存（用于调试/查看）
 */
export async function getAllStepCacheRows(): Promise<StepCacheRow[]> {
  const db = await getDB();
  return db.query<StepCacheRow>('SELECT * FROM step_cache ORDER BY hit_count DESC LIMIT 200');
}

// ── Scheduled task CRUD ──

import type { TaskConfig, ScreenChangeTriggerConfig, TimerTriggerConfig } from '@/types/scheduler';

export async function storeScheduledTask(config: TaskConfig): Promise<void> {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  const triggerJson = JSON.stringify(config.trigger);
  const taskType = config.trigger.type;
  const action = config.action;

  // Extract screen-specific fields from trigger
  const sc = config.trigger.type === 'screen_change' ? config.trigger as ScreenChangeTriggerConfig : null;
  const timer = config.trigger.type === 'timer' ? config.trigger as TimerTriggerConfig : null;

  await db.execute(
    `INSERT OR REPLACE INTO scheduled_tasks
     (id, name, enabled, task_type, trigger_json, action_json, context,
      monitor_target_json, region_json, poll_interval_ms, diff_strategy,
      debounce_ms, cooldown_ms, min_confidence, region_mode, region_description,
      preparation_goal, action_goal, tool_mode, custom_tools, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      config.id,
      config.name,
      config.enabled ? 1 : 0,
      taskType,
      triggerJson,
      JSON.stringify(action),
      config.context ?? null,
      JSON.stringify(sc?.monitorTarget ?? { type: 'fullscreen' }),
      JSON.stringify(sc?.region ?? { x: 0, y: 0, width: 1, height: 1 }),
      sc?.pollIntervalMs ?? timer?.intervalMs ?? 2000,
      sc?.diffStrategy ?? 'fast_visual',
      sc?.debounceMs ?? 0,
      timer?.cooldownMs ?? sc?.cooldownMs ?? 5000,
      sc?.minConfidence ?? 0.9,
      sc?.regionMode ?? 'manual',
      sc?.regionDescription ?? null,
      sc?.preparationGoal ?? null,
      sc?.actionGoal ?? null,
      (action.type === 'agent_execute' ? action.toolMode : null) ?? 'all',
      (action.type === 'agent_execute' ? JSON.stringify(action.customTools ?? []) : null),
      config.createdAt,
      now,
    ],
  );
}

export async function getScheduledTask(id: string): Promise<TaskConfig | null> {
  const db = await getDB();
  const row = await db.get<{
    id: string; name: string; enabled: number;
    task_type: string; trigger_json: string; action_json: string;
    context: string | null; created_at: number; updated_at: number;
    monitor_target_json?: string | null;
    region_json?: string | null;
    poll_interval_ms?: number | null;
    diff_strategy?: string | null;
    debounce_ms?: number | null;
    cooldown_ms?: number | null;
    min_confidence?: number | null;
    region_mode?: string | null;
    region_description?: string | null;
    preparation_goal?: string | null;
    action_goal?: string | null;
    tool_mode?: string | null;
    custom_tools?: string | null;
  }>('SELECT * FROM scheduled_tasks WHERE id = ?', [id]);
  if (!row) return null;
  return rowToScheduledTask(row);
}

export async function getAllScheduledTasks(): Promise<TaskConfig[]> {
  const db = await getDB();
  const rows = await db.query<{
    id: string; name: string; enabled: number;
    task_type: string; trigger_json: string; action_json: string;
    context: string | null; created_at: number; updated_at: number;
    monitor_target_json?: string | null;
    region_json?: string | null;
    poll_interval_ms?: number | null;
    diff_strategy?: string | null;
    debounce_ms?: number | null;
    cooldown_ms?: number | null;
    min_confidence?: number | null;
    region_mode?: string | null;
    region_description?: string | null;
    preparation_goal?: string | null;
    action_goal?: string | null;
    tool_mode?: string | null;
    custom_tools?: string | null;
  }>('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
  return rows.map(rowToScheduledTask);
}

export async function deleteScheduledTask(id: string): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
}

function rowToScheduledTask(row: {
  id: string; name: string; enabled: number;
  task_type: string; trigger_json: string; action_json: string;
  context: string | null; created_at: number; updated_at: number;
  monitor_target_json?: string | null;
  region_json?: string | null;
  poll_interval_ms?: number | null;
  diff_strategy?: string | null;
  debounce_ms?: number | null;
  cooldown_ms?: number | null;
  min_confidence?: number | null;
  region_mode?: string | null;
  region_description?: string | null;
  preparation_goal?: string | null;
  action_goal?: string | null;
  tool_mode?: string | null;
  custom_tools?: string | null;
}): TaskConfig {
  const triggerJson = row.trigger_json ? JSON.parse(row.trigger_json) : {};
  const actionJson = JSON.parse(row.action_json) as Record<string, unknown>;

  // Build trigger from stored JSON or fall back to individual columns
  const trigger = Object.keys(triggerJson).length > 0
    ? triggerJson as TaskConfig['trigger']
    : buildTriggerFromColumns(row, actionJson);

  // Build action
  const action = buildActionFromRow(actionJson, row);

  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    trigger,
    action,
    context: row.context ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTriggerFromColumns(row: {
  task_type: string; poll_interval_ms?: number | null; cooldown_ms?: number | null;
  debounce_ms?: number | null; min_confidence?: number | null;
  monitor_target_json?: string | null; region_json?: string | null;
  diff_strategy?: string | null; region_mode?: string | null;
  region_description?: string | null; preparation_goal?: string | null;
  action_goal?: string | null;
}, actionJson: Record<string, unknown>): TaskConfig['trigger'] {
  if (row.task_type === 'timer') {
    return {
      type: 'timer',
      intervalMs: row.poll_interval_ms ?? 60000,
      cooldownMs: row.cooldown_ms ?? 0,
    };
  }

  const monitorTarget = row.monitor_target_json
    ? JSON.parse(row.monitor_target_json)
    : { type: 'fullscreen' };
  const region = row.region_json
    ? JSON.parse(row.region_json)
    : { x: 0, y: 0, width: 1, height: 1 };

  return {
    type: 'screen_change',
    pollIntervalMs: row.poll_interval_ms ?? 2000,
    cooldownMs: row.cooldown_ms ?? 5000,
    debounceMs: row.debounce_ms ?? 300,
    minConfidence: row.min_confidence ?? 0.9,
    monitorTarget,
    region,
    diffStrategy: (row.diff_strategy as ScreenChangeTriggerConfig['diffStrategy']) ?? 'fast_visual',
    regionMode: (row.region_mode as ScreenChangeTriggerConfig['regionMode']) ?? 'manual',
    regionDescription: row.region_description ?? undefined,
    preparationGoal: row.preparation_goal ?? undefined,
    actionGoal: row.action_goal ?? undefined,
  };
}

function buildActionFromRow(actionJson: Record<string, unknown>, row: {
  tool_mode?: string | null; custom_tools?: string | null;
}): TaskConfig['action'] {
  const type = (actionJson['type'] as string) || 'agent_execute';

  switch (type) {
    case 'notify':
      return {
        type: 'notify',
        notifyTemplate: (actionJson['notifyTemplate'] as string) || '',
      };
    case 'workflow':
      return {
        type: 'workflow',
        steps: (actionJson['steps'] as any[]) || [],
        goalTemplate: actionJson['goalTemplate'] as string | undefined,
      };
    case 'script':
      return {
        type: 'script',
        language: (actionJson['language'] as 'javascript' | 'python') || 'javascript',
        code: (actionJson['code'] as string) || '',
        timeoutMs: actionJson['timeoutMs'] as number | undefined,
      };
    case 'custom':
      return {
        type: 'custom',
        handler: (actionJson['handler'] as string) || '',
      };
    default:
      return {
        type: 'agent_execute',
        goalTemplate: (actionJson['goalTemplate'] as string) || '',
        toolMode: row.tool_mode ?? 'all',
        customTools: row.custom_tools ? JSON.parse(row.custom_tools) : undefined,
      };
  }
}

// ── App log CRUD ──

import type { AppLogEntry, AppEventSource, AppEventLevel } from '@/types/events';

export async function storeAppLog(entry: Omit<AppLogEntry, 'id'>): Promise<void> {
  const db = await getDB();
  await db.execute(
    `INSERT INTO app_logs (source, source_id, source_name, level, event, message, detail, snapshot_path, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.source,
      entry.source_id ?? null,
      entry.source_name ?? null,
      entry.level,
      entry.event,
      entry.message,
      entry.detail ?? null,
      entry.snapshot_path ?? null,
      entry.timestamp,
    ],
  );
}

export async function queryAppLogs(filter: {
  source?: AppEventSource;
  sourceId?: string;
  level?: AppEventLevel;
  since?: number;
  limit?: number;
} = {}): Promise<AppLogEntry[]> {
  const db = await getDB();
  let sql = 'SELECT * FROM app_logs WHERE 1=1';
  const params: unknown[] = [];

  if (filter.source) {
    sql += ' AND source = ?';
    params.push(filter.source);
  }
  if (filter.sourceId) {
    sql += ' AND source_id = ?';
    params.push(filter.sourceId);
  }
  if (filter.level) {
    sql += ' AND level = ?';
    params.push(filter.level);
  }
  if (filter.since) {
    sql += ' AND timestamp >= ?';
    params.push(filter.since);
  }
  sql += ' ORDER BY timestamp DESC';
  sql += ` LIMIT ${filter.limit ?? 100}`;

  return db.query<AppLogEntry>(sql, params);
}

export async function cleanupOldLogs(keepDays = 7): Promise<void> {
  const db = await getDB();
  const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
  await db.execute('DELETE FROM app_logs WHERE timestamp < ?', [cutoff]);
}

// ── Step cache helpers ──

async function bumpStepCacheHit(id: number): Promise<void> {
  const db = await getDB();
  await db.execute(
    'UPDATE step_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?',
    [Math.floor(Date.now() / 1000), id],
  );
}

function rowToStepEntry(row: StepCacheRow): StepCacheEntry {
  return {
    goalFragment: row.goal_fragment,
    role: row.role,
    name: row.name,
    bounds: row.bounds_json ? JSON.parse(row.bounds_json) : undefined,
    windowFP: row.window_fp || undefined,
    appName: row.app_name || undefined,
  };
}

// ── Goal decomposition cache (goal → subgoals[]) ──

export async function getGoalDecomposition(normalizedGoal: string): Promise<GoalDecomposition | null> {
  const db = await getDB();
  const row = await db.get<{ subgoals_json: string; hit_count: number }>(
    'SELECT subgoals_json, hit_count FROM goal_decomposition_cache WHERE normalized_goal = ?',
    [normalizedGoal],
  );
  if (!row) return null;
  await db.execute('UPDATE goal_decomposition_cache SET hit_count = hit_count + 1 WHERE normalized_goal = ?', [normalizedGoal]);
  return JSON.parse(row.subgoals_json) as GoalDecomposition;
}

export async function storeGoalDecomposition(normalizedGoal: string, decomposition: GoalDecomposition): Promise<void> {
  const db = await getDB();
  await db.execute(
    'INSERT OR REPLACE INTO goal_decomposition_cache (normalized_goal, subgoals_json) VALUES (?, ?)',
    [normalizedGoal, JSON.stringify(decomposition)],
  );
}

export async function getAllGoalDecompositionRows(): Promise<Array<{ normalized_goal: string; subgoals_json: string; hit_count: number; created_at: number }>> {
  const db = await getDB();
  return db.query<{ normalized_goal: string; subgoals_json: string; hit_count: number; created_at: number }>('SELECT * FROM goal_decomposition_cache ORDER BY created_at DESC LIMIT 100');
}

export async function deleteGoalDecomposition(normalizedGoal: string): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM goal_decomposition_cache WHERE normalized_goal = ?', [normalizedGoal]);
}

export async function clearGoalDecompositionCache(): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM goal_decomposition_cache');
}

// ── Multi-agent task tree queries ──

export async function getAllTaskTreeProjects(): Promise<Array<{ project_name: string; task_count: number; latest_updated: string }>> {
  const db = await getDB();
  return db.query<{ project_name: string; task_count: number; latest_updated: string }>(
    `SELECT project_name, COUNT(*) AS task_count, MAX(updated_at) AS latest_updated
     FROM task_tree GROUP BY project_name ORDER BY latest_updated DESC`,
  );
}

export async function getTaskTreeByProject(projectName: string): Promise<import('@/db/types').TaskTreeRow[]> {
  const db = await getDB();
  return db.query<import('@/db/types').TaskTreeRow>(
    'SELECT * FROM task_tree WHERE project_name = ? ORDER BY depth ASC, sort_order ASC',
    [projectName],
  );
}

export async function getAgentProcessLogsByTask(taskId: string): Promise<import('@/db/types').AgentProcessLogRow[]> {
  const db = await getDB();
  return db.query<import('@/db/types').AgentProcessLogRow>(
    'SELECT * FROM agent_process_log WHERE task_id = ? ORDER BY step_order ASC',
    [taskId],
  );
}

export async function getAgentMessagesByTask(taskId: string): Promise<import('@/db/types').AgentMessageRow[]> {
  const db = await getDB();
  return db.query<import('@/db/types').AgentMessageRow>(
    'SELECT * FROM agent_messages WHERE task_id = ? ORDER BY created_at ASC',
    [taskId],
  );
}

export async function deleteTaskTreeProject(projectName: string): Promise<void> {
  const db = await getDB();
  // Get all task IDs for this project
  const tasks = await db.query<{ id: string }>('SELECT id FROM task_tree WHERE project_name = ?', [projectName]);
  const ids = tasks.map(t => t.id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(`DELETE FROM agent_process_log WHERE task_id IN (${placeholders})`, ids);
    await db.execute(`DELETE FROM agent_messages WHERE task_id IN (${placeholders})`, ids);
    await db.execute('DELETE FROM task_tree WHERE project_name = ?', [projectName]);
  }
}

// ── CacheServiceImpl: ICacheService 实现类，委托给模块级函数 ──

class CacheServiceImpl implements ICacheService {
  normalizeGoal = normalizeGoal;
  resolveFingerprint = resolveFingerprint;
  storeUICache = storeUICache;
  getUICache = getUICache;
  updateSemanticAnnotations = updateSemanticAnnotations;
  getChildrenOf = getChildrenOf;
  updatePageComponent = updatePageComponent;
  getAppPageGraph = getAppPageGraph;
  storeSubGoalCache = storeSubGoalCache;
  getSubGoalCache = getSubGoalCache;
  deleteSubGoalCacheByKey = deleteSubGoalCacheByKey;
  storeStepCache = storeStepCache;
  getStepCache = getStepCache;
  getLLMCallCache = getLLMCallCache;
  storeLLMCallCache = storeLLMCallCache;
  storeSkillTemplate = storeSkillTemplate;
  getSkillTemplateRows = getSkillTemplateRows;
  getAllUICacheRows = getAllUICacheRows;
  getAllSkillTemplateRows = getAllSkillTemplateRows;
  getAllSubGoalCacheRows = getAllSubGoalCacheRows;
  getAllStepCacheRows = getAllStepCacheRows;
  getAllLLMCallCacheRows = getAllLLMCallCacheRows;
  deleteUICache = deleteUICache;
  deleteSkillTemplate = deleteSkillTemplate;
  deleteSubGoalCache = deleteSubGoalCache;
  deleteStepCache = deleteStepCache;
  deleteLLMCallCache = deleteLLMCallCache;
  clearAllCache = clearAllCache;
  clearSubGoalCache = clearSubGoalCache;
  clearStepCache = clearStepCache;
  getGoalDecomposition = getGoalDecomposition;
  storeGoalDecomposition = storeGoalDecomposition;
  getAllGoalDecompositionRows = getAllGoalDecompositionRows;
  deleteGoalDecomposition = deleteGoalDecomposition;
  clearGoalDecompositionCache = clearGoalDecompositionCache;
  testCacheHit = testCacheHit;
  storeScheduledTask = storeScheduledTask;
  getScheduledTask = getScheduledTask;
  getAllScheduledTasks = getAllScheduledTasks;
  deleteScheduledTask = deleteScheduledTask;
  storeAppLog = storeAppLog;
  queryAppLogs = queryAppLogs;
  cleanupOldLogs = cleanupOldLogs;
}

export function createCacheService(): ICacheService {
  return new CacheServiceImpl();
}
