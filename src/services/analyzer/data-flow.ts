// Data flow extraction from event sequences.

import type { SemanticEvent } from '@/types/semantic-event';
import type { UnifiedAction } from '@/types/unified-action';
import type { DataFlow, DataSource, DataTarget, FieldMapping, DataField } from '@/types/unified-data';

function isCopyAction(action: UnifiedAction): boolean {
  return (
    action.type === 'copy' ||
    (action.type === 'hotkey' && (action.params?.key === 'Ctrl+c' || action.params?.key === 'Ctrl+C'))
  );
}

function isPasteAction(action: UnifiedAction): boolean {
  return (
    action.type === 'paste' ||
    (action.type === 'hotkey' && (action.params?.key === 'Ctrl+v' || action.params?.key === 'Ctrl+V'))
  );
}

function analyzeDataSource(event: SemanticEvent): DataSource {
  const element = event.element;

  if (element?.structure?.container) {
    const container = element.structure.container;

    if (container.role === 'table' || container.role === 'grid') {
      return {
        type: 'table',
        location: { semantic: { role: container.role, name: container.name || '' } },
        fields: (container.columns || []).map(col => ({ name: col, type: 'text' as const })),
      };
    }

    if (container.role === 'list') {
      return {
        type: 'list',
        location: { semantic: { role: container.role, name: container.name || '' } },
        fields: [{ name: 'item', type: 'text' as const }],
      };
    }
  }

  return {
    type: 'custom',
    location: event.action.target || {},
    fields: [{ name: 'value', type: 'text' as const }],
  };
}

function analyzeDataTarget(event: SemanticEvent): DataTarget {
  const element = event.element;

  if (element?.structure?.container) {
    const container = element.structure.container;

    if (container.role === 'table' || container.role === 'grid') {
      return {
        type: 'table',
        location: { semantic: { role: container.role, name: container.name || '' } },
        fields: (container.columns || []).map(col => ({ name: col, type: 'text' as const })),
      };
    }
  }

  return {
    type: 'custom',
    location: event.action.target || {},
    fields: [{ name: 'value', type: 'text' as const }],
  };
}

function inferFieldMapping(
  sources: DataSource[],
  targets: DataTarget[],
  copyEvents: SemanticEvent[],
  pasteEvents: SemanticEvent[],
): FieldMapping[] {
  const mapping: FieldMapping[] = [];

  if (sources.length === 1 && targets.length === 1) {
    const sourceFields = sources[0].fields;
    const targetFields = targets[0].fields;

    for (let i = 0; i < Math.min(sourceFields.length, targetFields.length); i++) {
      mapping.push({ source: sourceFields[i].name, target: targetFields[i].name });
    }
  }

  if (mapping.length === 0 && copyEvents.length === pasteEvents.length) {
    for (let i = 0; i < copyEvents.length; i++) {
      const sourceName = copyEvents[i].element?.identity.name || `field_${i}`;
      const targetName = pasteEvents[i].element?.identity.name || `field_${i}`;
      mapping.push({ source: sourceName, target: targetName });
    }
  }

  return mapping;
}

function mergeSources(sources: DataSource[]): DataSource {
  if (sources.length === 0) {
    return { type: 'custom', location: {}, fields: [] };
  }

  const allFields: DataField[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const field of source.fields) {
      if (!seen.has(field.name)) {
        seen.add(field.name);
        allFields.push(field);
      }
    }
  }

  return { type: sources[0].type, location: sources[0].location, fields: allFields };
}

function mergeTargets(targets: DataTarget[]): DataTarget {
  if (targets.length === 0) {
    return { type: 'custom', location: {}, fields: [] };
  }

  const allFields: DataField[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    for (const field of target.fields) {
      if (!seen.has(field.name)) {
        seen.add(field.name);
        allFields.push(field);
      }
    }
  }

  return { type: targets[0].type, location: targets[0].location, fields: allFields };
}

/**
 * 从事件序列中提取数据流
 */
export function extractDataFlow(events: SemanticEvent[]): DataFlow | null {
  const copyEvents = events.filter(e => isCopyAction(e.action));
  const pasteEvents = events.filter(e => isPasteAction(e.action));

  if (copyEvents.length === 0 || pasteEvents.length === 0) {
    return null;
  }

  const sources = copyEvents.map(e => analyzeDataSource(e));
  const targets = pasteEvents.map(e => analyzeDataTarget(e));
  const mapping = inferFieldMapping(sources, targets, copyEvents, pasteEvents);

  return {
    source: mergeSources(sources),
    target: mergeTargets(targets),
    mapping,
  };
}
