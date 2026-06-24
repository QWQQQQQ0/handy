// Local (non-LLM) template generation and pattern detection.

import type { RecordingSession, DetectedPattern } from '@/types/recording-session';
import type { AutomationTemplate, TemplateStep, TemplateParameter } from '@/types/automation-template';
import type { DataFlow } from '@/types/unified-data';
import type { SemanticEvent } from '@/types/semantic-event';

// ── Pattern detection ──

export function detectPatternLocally(
  session: RecordingSession,
  dataFlow: DataFlow | null,
): DetectedPattern {
  const events = session.events;

  const loopPattern = detectLoopPattern(events);
  if (loopPattern) return loopPattern;

  if (dataFlow) {
    return {
      type: 'loop',
      confidence: 0.7,
      description: `从 ${dataFlow.source.type} 复制数据到 ${dataFlow.target.type}`,
      dataFlow,
    };
  }

  return {
    type: 'linear',
    confidence: 0.9,
    description: `执行 ${events.length} 个操作`,
  };
}

function detectLoopPattern(events: SemanticEvent[]): DetectedPattern | null {
  if (events.length < 4) return null;

  const significant = events.filter(e => {
    if (e.action.type === 'key_up') return false;
    return true;
  });

  if (significant.length < 4) return null;

  const crossAppPattern = detectCrossAppLoop(significant);
  if (crossAppPattern) return crossAppPattern;

  const sequenceLength = findRepeatingSequence(significant);
  if (sequenceLength === 0) return null;

  const loopCount = Math.floor(significant.length / sequenceLength);
  const loopBody = significant.slice(0, sequenceLength);
  const loopVariable = identifyLoopVariable(loopBody);

  return {
    type: 'loop',
    confidence: 0.8,
    description: `循环 ${loopCount} 次，每次执行 ${sequenceLength} 个操作`,
    loopVariable: loopVariable || 'item',
    loopBody,
  };
}

/** 检测跨应用循环模式：在不同窗口间来回切换的重复操作 */
function detectCrossAppLoop(events: SemanticEvent[]): DetectedPattern | null {
  const windowCounts = new Map<string, number>();
  for (const e of events) {
    const title = e.context?.windowTitle || '';
    if (title) windowCounts.set(title, (windowCounts.get(title) || 0) + 1);
  }

  if (windowCounts.size < 2) return null;

  const windowSeq = events.map(e => e.context?.windowTitle || '').filter(Boolean);
  const patternLen = findWindowSwitchPattern(windowSeq);
  if (patternLen === 0) return null;

  const loopCount = Math.floor(events.length / patternLen);
  if (loopCount < 2) return null;

  const loopBody = events.slice(0, patternLen);
  const windows = [...new Set(windowSeq.slice(0, patternLen))];

  return {
    type: 'loop',
    confidence: 0.85,
    description: `跨应用循环 ${loopCount} 次，涉及窗口: ${windows.join(' → ')}`,
    loopVariable: 'item',
    loopBody,
  };
}

function findWindowSwitchPattern(windowSeq: string[]): number {
  for (let len = 2; len <= Math.floor(windowSeq.length / 2); len++) {
    const first = windowSeq.slice(0, len);
    let matches = true;
    for (let i = len; i < windowSeq.length; i += len) {
      const chunk = windowSeq.slice(i, i + len);
      if (chunk.length !== len) continue;
      let matchCount = 0;
      for (let j = 0; j < len; j++) {
        if (first[j] === chunk[j]) matchCount++;
      }
      if (matchCount < len * 0.6) { matches = false; break; }
    }
    if (matches) return len;
  }
  return 0;
}

function findRepeatingSequence(events: SemanticEvent[]): number {
  for (let len = 2; len <= Math.floor(events.length / 2); len++) {
    if (isRepeatingSequence(events, len)) return len;
  }
  return 0;
}

function isRepeatingSequence(events: SemanticEvent[], sequenceLength: number): boolean {
  const sequence = events.slice(0, sequenceLength);

  for (let i = sequenceLength; i < events.length; i += sequenceLength) {
    const chunk = events.slice(i, i + sequenceLength);
    if (chunk.length !== sequenceLength) continue;

    for (let j = 0; j < sequenceLength; j++) {
      if (sequence[j].action.type !== chunk[j].action.type) return false;
    }
  }
  return true;
}

function identifyLoopVariable(events: SemanticEvent[]): string | null {
  for (const event of events) {
    if (event.element?.structure?.container) {
      const container = event.element.structure.container;

      if (container.role === 'table' || container.role === 'grid') return 'row';
      if (container.role === 'list') return 'item';
    }
  }
  return null;
}

// ── Template generation ──

function getEventDescription(event: SemanticEvent): string {
  const { action, element } = event;
  const elementName = element?.identity.name ? ` "${element.identity.name}"` : '';

  switch (action.type) {
    case 'click': return `点击${elementName}`;
    case 'double_click': return `双击${elementName}`;
    case 'right_click': return `右键点击${elementName}`;
    case 'long_press': return `长按${elementName}`;
    case 'type': return `输入 "${action.params?.text}"`;
    case 'key':
    case 'hotkey': return `按键 ${action.params?.key}`;
    case 'copy': return '复制';
    case 'paste': return '粘贴';
    case 'focus': return `聚焦${elementName}`;
    case 'scroll': return `滚动 ${action.params?.direction}`;
    case 'drag': return `拖动 (${action.params?.start_x},${action.params?.start_y}) → (${action.params?.end_x},${action.params?.end_y})`;
    default: return action.type;
  }
}

function buildActionTarget(event: SemanticEvent): TemplateStep['target'] {
  const target: TemplateStep['target'] = {};

  if (event.element) {
    target.semantic = {
      role: event.element.identity.role,
      name: event.element.identity.name,
    };
  }

  if (event.action.target?.coordinate) {
    target.coordinate = {
      x: event.action.target.coordinate.x,
      y: event.action.target.coordinate.y,
    };
  }

  if (event.element?.location.precisePath) {
    target.path = event.element.location.precisePath;
  }

  return target;
}

/**
 * 本地生成模板（无需 LLM）
 */
export function generateTemplateLocally(
  session: RecordingSession,
  pattern: DetectedPattern,
  dataFlow: DataFlow | null,
): AutomationTemplate {
  const events = session.events;
  const steps: TemplateStep[] = [];

  if (pattern.type === 'loop' && pattern.loopBody) {
    steps.push({
      id: 'loop_start',
      action: 'loop_start',
      description: '开始循环',
      params: {
        over: pattern.loopSource || '{{items}}',
        variable: pattern.loopVariable || 'item',
      },
      control: {
        type: 'loop',
        over: pattern.loopSource || '{{items}}',
        variable: pattern.loopVariable || 'item',
        body: [],
      },
    });

    for (let i = 0; i < pattern.loopBody.length; i++) {
      const event = pattern.loopBody[i];
      const waitBefore = i > 0 ? event.timestamp - pattern.loopBody[i - 1].timestamp : 0;
      steps.push({
        id: `loop_step_${i}`,
        action: event.action.type,
        description: getEventDescription(event),
        target: buildActionTarget(event),
        waitBefore: waitBefore > 100 ? waitBefore : undefined,
        params: event.action.params,
      });
    }

    steps.push({
      id: 'loop_end',
      action: 'loop_end',
      description: '结束循环',
      control: { type: 'break' },
    });
  } else {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const waitBefore = i > 0 ? event.timestamp - events[i - 1].timestamp : 0;
      steps.push({
        id: `step_${i}`,
        action: event.action.type,
        description: getEventDescription(event),
        target: buildActionTarget(event),
        waitBefore: waitBefore > 100 ? waitBefore : undefined,
        params: event.action.params,
      });
    }
  }

  const parameters: TemplateParameter[] = [];

  if (dataFlow) {
    parameters.push({ name: 'source', description: '数据源', type: 'element', required: true });
    parameters.push({ name: 'target', description: '数据目标', type: 'element', required: true });
  }

  return {
    id: crypto.randomUUID(),
    name: session.metadata.userDescription || 'Recorded Template',
    description: pattern.description,
    version: '1.0.0',
    dataFlow: dataFlow || undefined,
    parameters,
    steps,
    createdAt: Date.now(),
    sourceSession: session.id,
  };
}
