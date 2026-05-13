// 来源: lib/widgets/chat/model_switcher.dart

'use client';

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Star, Plus, Settings, Sparkles, Brain, Lightbulb, ChevronDown } from 'lucide-react';
import { useModelConfigStore } from '@/stores/model-config-store';

const providerIcons: Record<string, React.ReactNode> = {
  openai: <Sparkles size={16} />,
  anthropic: <Brain size={16} />,
  google: <Lightbulb size={16} />,
};

export function ModelSwitcher() {
  const { providers, loading, load, setDefault } = useModelConfigStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (loading) {
    return (
      <div className="w-6 h-6 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <Link
        to="/models?new=true"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-lg"
      >
        <Plus size={16} />
        Add Model
      </Link>
    );
  }

  const defaultConfig = providers.find((p) => p.isDefault) ?? providers[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors"
      >
        {providerIcons[defaultConfig.type] ?? <Sparkles size={16} />}
        <span className="max-w-[100px] truncate">{defaultConfig.name}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 py-1">
          {providers.map((config) => (
            <button
              key={config.id}
              onClick={async () => {
                await setDefault(config.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              {config.isDefault ? (
                <Star size={16} className="text-blue-500 shrink-0" />
              ) : (
                <Star size={16} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{config.name}</div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                  {config.type} - {config.model}
                </div>
              </div>
            </button>
          ))}
          <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1">
            <Link
              to="/models"
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Settings size={14} />
              Manage Models
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
