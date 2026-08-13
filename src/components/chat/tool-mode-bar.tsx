'use client';

import { useState, useRef, useEffect } from 'react';
import { Wrench, ChevronDown, X } from 'lucide-react';
import { ToolMode } from '@/stores/chat-store';
import { useT } from '@/i18n/strings';
import type { ToolGroup } from '@/pages/float/types';

interface ToolModeBarProps {
  mode: ToolMode;
  selectedCount: number;
  onModeChanged: (mode: ToolMode) => void;
  onFavoritesDoubleClick?: () => void;
  compact?: boolean;
  groups?: ToolGroup[];
  selectedGroupId?: string | null;
  onGroupSelect?: (groupId: string) => void;
  onDeleteGroup?: (groupId: string) => void;
}

function ModeChip({ label, selected, onClick, onDoubleClick, compact, suffix }: {
  label: string; selected: boolean; onClick: () => void; onDoubleClick?: () => void;
  compact?: boolean; suffix?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`inline-flex items-center gap-0.5 rounded-full font-medium transition-colors ${
        compact
          ? 'px-2 py-0.5 text-[11px]'
          : 'px-2.5 py-1 text-[12px]'
      } ${
        selected
          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
      }`}
    >
      {label}
      {suffix}
    </button>
  );
}

export function ToolModeBar({ mode, selectedCount, onModeChanged, onFavoritesDoubleClick, compact, groups, selectedGroupId, onGroupSelect, onDeleteGroup }: ToolModeBarProps) {
  const t = useT();
  const [showGroups, setShowGroups] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showGroups) return;
    const onDown = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setShowGroups(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showGroups]);

  const hasGroups = groups && groups.length > 0;

  const chip = (toolMode: ToolMode, label: string, extra?: { onDoubleClick?: () => void; suffix?: React.ReactNode }) => (
    <ModeChip
      key={toolMode}
      label={label}
      selected={mode === toolMode && !selectedGroupId}
      compact={compact}
      onClick={() => onModeChanged(mode === toolMode ? ToolMode.basic : toolMode)}
      onDoubleClick={extra?.onDoubleClick}
      suffix={extra?.suffix}
    />
  );

  const customLabel = (() => {
    if (selectedGroupId) {
      const g = groups?.find(g => g.id === selectedGroupId);
      if (g) return g.name;
    }
    if (mode === ToolMode.custom && selectedCount > 0) {
      return `${t('toolmode.custom')} (${selectedCount})`;
    }
    return t('toolmode.custom');
  })();

  const customSelected = mode === ToolMode.custom;

  return (
    <div className={`flex items-center border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black ${compact ? 'gap-1 px-2 py-1' : 'gap-2 px-3 py-1.5'}`}>
      {!compact && <Wrench size={14} className="text-zinc-400 dark:text-zinc-500 shrink-0" />}
      <div className="flex items-center gap-1.5">
        {chip(ToolMode.basic, t('toolmode.basic'))}
        {chip(ToolMode.all, t('toolmode.all'))}
        {chip(ToolMode.none, t('toolmode.none'))}
        {chip(ToolMode.favorites, t('toolmode.favorites'), { onDoubleClick: onFavoritesDoubleClick })}

        {/* Custom chip with inline group dropdown */}
        <div ref={groupRef} className="relative inline-flex items-center">
          <button
            onClick={() => onModeChanged(mode === ToolMode.custom && !selectedGroupId ? ToolMode.basic : ToolMode.custom)}
            className={`inline-flex items-center gap-0.5 rounded-full font-medium transition-colors ${
              compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'
            } ${
              customSelected
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            {customLabel}
          </button>
          {hasGroups && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowGroups(!showGroups); }}
              className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-colors ${
                compact ? 'w-4 h-4' : 'w-4 h-4'
              } text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300`}
              style={{ right: compact ? 1 : 2 }}
            >
              <ChevronDown size={compact ? 9 : 10} />
            </button>
          )}
          {showGroups && (
            <div className={`absolute bottom-full left-0 mb-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden z-20 ${compact ? 'w-40' : 'w-48'}`}>
              <div className="max-h-[160px] overflow-y-auto">
                {groups!.map(g => (
                  <div
                    key={g.id}
                    className={`flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}
                  >
                    <button
                      onClick={() => { onGroupSelect?.(g.id); setShowGroups(false); }}
                      className={`flex-1 text-left truncate ${compact ? 'text-[11px]' : 'text-[12px]'} ${
                        selectedGroupId === g.id
                          ? 'font-semibold text-purple-600 dark:text-purple-400'
                          : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {g.name}
                      <span className="text-zinc-400 ml-1">({g.tools.length})</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteGroup?.(g.id); }}
                      className="shrink-0 p-0.5 text-zinc-400 hover:text-red-500"
                      title={t('toolmode.deleteGroup')}
                    >
                      <X size={compact ? 10 : 12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
