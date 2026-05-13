// 来源: lib/screens/skills_screen.dart

'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Monitor, Globe, Smartphone, AppWindow, Code, Eye, EyeOff, Play, CheckCircle, XCircle, Settings } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useT } from '@/i18n/strings';
import { SkillExecutor } from '@/skills/executor';
import { DesktopScreenSkill } from '@/skills/desktop';
import { WebScreenSkill } from '@/skills/web';
import { PhoneScreenSkill } from '@/skills/phone';
import { AppBuilderSkill } from '@/skills/app-builder';
import type { SkillTool } from '@/skills/skill';

const skillIconMap: Record<string, React.ReactNode> = {
  desktop_screen: <Monitor size={20} />,
  web_screen: <Globe size={20} />,
  phone_screen: <Smartphone size={20} />,
  app_builder: <AppWindow size={20} />,
};

function CategoryHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-1">
      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
        {title}
      </span>
      <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-[10px] text-blue-700 dark:text-blue-300">
        {count}
      </span>
    </div>
  );
}

function ParametersSection({ params }: { params: Record<string, unknown> }) {
  const properties = (params['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (params['required'] as string[]) ?? [];

  if (Object.keys(properties).length === 0) {
    return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">No parameters</p>;
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase mb-1">Parameters</p>
      <div className="space-y-1.5">
        {Object.entries(properties).map(([name, schema]) => {
          const isRequired = required.includes(name);
          const type = (schema['type'] as string) ?? 'any';
          const desc = (schema['description'] as string) ?? '';

          return (
            <div key={name} className="flex items-start gap-2">
              <code className="text-[12px] font-mono text-zinc-700 dark:text-zinc-300 min-w-[100px] shrink-0">
                {name}
                {isRequired && <span className="text-red-500 ml-0.5">*</span>}
              </code>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                {type}
              </span>
              {desc && (
                <span className="text-[12px] text-zinc-400 dark:text-zinc-500">{desc}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TestDialog({
  skillId,
  tool,
  onClose,
}: {
  skillId: string;
  tool: SkillTool;
  onClose: () => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; data?: Record<string, unknown> } | null>(null);

  const properties = (tool.parameters['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (tool.parameters['required'] as string[]) ?? [];

  const handleExecute = async () => {
    // Validate required
    for (const r of required) {
      if (!values[r]?.trim()) return;
    }

    setExecuting(true);
    setResult(null);

    const params: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = values[key]?.trim();
      if (!raw) continue;
      const type = (schema['type'] as string) ?? 'string';
      if (type === 'integer') params[key] = parseInt(raw, 10);
      else if (type === 'number') params[key] = parseFloat(raw);
      else params[key] = raw;
    }

    try {
      const executor = new SkillExecutor();
      let skill;
      switch (skillId) {
        case 'desktop_screen': skill = new DesktopScreenSkill(); break;
        case 'web_screen': skill = new WebScreenSkill(); break;
        case 'phone_screen': skill = new PhoneScreenSkill(); break;
        case 'app_builder': skill = new AppBuilderSkill(); break;
      }
      if (skill) {
        executor.register(skill);
        const r = await executor.executeToolCall(tool.name, params);
        setResult(r);
      }
    } catch (e) {
      setResult({ success: false, message: String(e) });
    }
    setExecuting(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">
              Test: {tool.name}
            </h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              ✕
            </button>
          </div>

          <div className="p-4 space-y-3">
            {Object.keys(properties).length === 0 ? (
              <p className="text-zinc-400 dark:text-zinc-500 text-[13px]">No parameters required.</p>
            ) : (
              Object.entries(properties).map(([key, schema]) => {
                const isRequired = required.includes(key);
                const type = (schema['type'] as string) ?? 'string';
                const desc = (schema['description'] as string) ?? '';
                return (
                  <div key={key}>
                    <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {key}{isRequired && ' *'} <span className="text-zinc-400 font-normal">({type})</span>
                    </label>
                    <input
                      type="text"
                      value={values[key] ?? ''}
                      onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                      placeholder={desc}
                      className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
                    />
                  </div>
                );
              })
            )}

            {result && (
              <div className={`p-3 rounded-lg border ${result.success ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'}`}>
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle size={16} className="text-red-600 dark:text-red-400" />
                  )}
                  <span className={`text-[13px] font-semibold ${result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    {result.success ? 'Success' : 'Failed'}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{result.message}</p>
                {result.data && (
                  <pre className="mt-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 overflow-x-auto">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[13px] rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Close
            </button>
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {executing ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Execute
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ToolCard({
  skillId,
  tool,
}: {
  skillId: string;
  tool: SkillTool;
}) {
  const { disabledTools, disableTool, enableTool } = useSettingsStore();
  const t = useT();
  const isDisabled = disabledTools.has(tool.name);
  const [testOpen, setTestOpen] = useState(false);

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
      {/* Tool header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Code size={16} className="text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-200">
              {tool.name}
            </h4>
          </div>
        </div>
        <button
          onClick={() => setTestOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 shrink-0"
        >
          <Play size={12} />
          Test
        </button>
      </div>

      {/* Description */}
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {tool.description}
      </p>

      {/* Parameters */}
      <ParametersSection params={tool.parameters} />

      {/* Enabled toggle */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div>
          <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Expose to AI</p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {isDisabled ? 'Hidden from AI. Still callable via test.' : 'Visible to AI for function calling.'}
          </p>
        </div>
        <button
          onClick={() => isDisabled ? enableTool(tool.name) : disableTool(tool.name)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isDisabled ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-blue-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isDisabled ? 'translate-x-1' : 'translate-x-6'
            }`}
          />
        </button>
      </div>

      {testOpen && <TestDialog skillId={skillId} tool={tool} onClose={() => setTestOpen(false)} />}
    </div>
  );
}

function SkillDetail({ skillId, onBack }: { skillId: string; onBack?: () => void }) {
  const executor = new SkillExecutor();
  executor.register(new DesktopScreenSkill());
  executor.register(new WebScreenSkill());
  executor.register(new PhoneScreenSkill());
  executor.register(new AppBuilderSkill());

  const skill = executor.getSkill(skillId);
  if (!skill) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-3xl">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-4 lg:hidden"
          >
            <ArrowLeft size={16} />
            Back to list
          </button>
        )}

        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950 rounded-xl">
            {skillIconMap[skill.id] ?? <Settings size={28} className="text-blue-500" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{skill.name}</h2>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
              {skill.category}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2 font-mono">ID: {skill.id}</p>

        {/* Description */}
        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-6 mb-2">Description</h3>
        <p className="text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{skill.description}</p>

        {/* Tools */}
        <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 mt-8 mb-3">
          Tools ({skill.tools.length})
        </h3>

        {skill.tools.length === 0 ? (
          <p className="text-[13px] text-zinc-400 dark:text-zinc-500">No tools exposed.</p>
        ) : (
          <div className="space-y-3">
            {skill.tools.map((tool) => (
              <ToolCard key={tool.name} skillId={skillId} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const t = useT();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const executor = new SkillExecutor();
  executor.register(new DesktopScreenSkill());
  executor.register(new WebScreenSkill());
  executor.register(new PhoneScreenSkill());
  executor.register(new AppBuilderSkill());

  const skills = executor.allSkills;
  const grouped = new Map<string, typeof skills>();
  for (const skill of skills) {
    const list = grouped.get(skill.category) ?? [];
    list.push(skill);
    grouped.set(skill.category, list);
  }

  const selectedSkill = selectedSkillId ? executor.getSkill(selectedSkillId) : null;

  if (skills.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
        <Settings size={56} className="mb-4 opacity-30" />
        <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
          {t('skills.empty')}
        </h2>
        <p className="text-[13px] text-center max-w-xs">{t('skills.empty.subtitle')}</p>
      </div>
    );
  }

  // Wide layout: sidebar + detail
  return (
    <div className="flex-1 flex min-h-0">
      {/* Skill list sidebar */}
      <div className={`${selectedSkill ? 'hidden lg:block' : 'flex-1'} w-[260px] border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto shrink-0`}>
        {[...grouped.entries()].map(([category, categorySkills]) => (
          <div key={category}>
            <CategoryHeader title={category} count={categorySkills.length} />
            {categorySkills.map((skill) => (
              <button
                key={skill.id}
                onClick={() => setSelectedSkillId(skill.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  skill.id === selectedSkillId
                    ? 'bg-blue-50 dark:bg-blue-950'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <span className={skill.id === selectedSkillId ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}>
                  {skillIconMap[skill.id] ?? <Settings size={20} />}
                </span>
                <div className="min-w-0">
                  <p className={`text-[13px] font-medium truncate ${skill.id === selectedSkillId ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {skill.name}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {skill.tools.length} tool{skill.tools.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </button>
            ))}
            <div className="border-b border-zinc-100 dark:border-zinc-800 mx-4" />
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selectedSkill ? (
        <SkillDetail skillId={selectedSkill.id} onBack={() => setSelectedSkillId(null)} />
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500">
          <div className="text-center">
            <ArrowLeft size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-[14px]">Select a skill to view details</p>
          </div>
        </div>
      )}
    </div>
  );
}
