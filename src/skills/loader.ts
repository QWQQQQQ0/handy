// 来源: lib/skills/skill_config.dart

import type { ToolDefinition } from '@/types/skill';

interface SkillConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: ToolDefinition[];
}

function parseYaml(yaml: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim();
    let value = line.substring(colon + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    if (key) map[key] = value;
  }
  return map;
}

export function parseSkillMarkdown(md: string): SkillConfig {
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(md);
  if (!fmMatch) throw new Error('Missing YAML frontmatter');

  const fm = parseYaml(fmMatch[1]);
  const id = fm['id'] ?? '';
  const name = fm['name'] ?? '';
  const category = fm['category'] ?? '';

  const afterFM = md.substring(fmMatch.index! + fmMatch[0].length);
  const jsonMatch = /```json\s*\n([\s\S]*?)\n```/.exec(afterFM);
  const description = jsonMatch
    ? afterFM.substring(0, jsonMatch.index).trim()
    : afterFM.trim();

  let tools: ToolDefinition[] = [];
  if (jsonMatch) {
    const list = JSON.parse(jsonMatch[1]);
    tools = list.map((t: Record<string, unknown>) => ({
      name: t['name'] as string,
      description: t['description'] as string,
      parameters: (t['parameters'] as Record<string, unknown>) ?? {},
    }));
  }

  return { id, name, category, description, tools };
}

const skillFiles = ['desktop_screen', 'web_screen', 'phone_screen', 'app_builder'];

export async function loadSkills(): Promise<SkillConfig[]> {
  const skills: SkillConfig[] = [];
  for (const name of skillFiles) {
    try {
      const res = await fetch(`/skills/${name}.md`);
      if (!res.ok) continue;
      const text = await res.text();
      skills.push(parseSkillMarkdown(text));
    } catch {
      console.debug(`Failed to load skill: ${name}`);
    }
  }
  return skills;
}

export async function loadSkill(name: string): Promise<SkillConfig | null> {
  try {
    const res = await fetch(`/skills/${name}.md`);
    if (!res.ok) return null;
    const text = await res.text();
    return parseSkillMarkdown(text);
  } catch {
    return null;
  }
}
