/**
 * Agent @ 提及解析器 —— 集中处理所有聊天窗口的 @ 机制。
 *
 * 用法：每个聊天页面在 handleSend 中调用 resolveAgentMention(agentContext)，
 *       根据返回值决定如何发送消息。不再各自散落 agentContext?.startsWith(...) 判断。
 */

export interface ResolvedMention {
  /** 注入 system prompt 的额外内容（追加到系统提示词末尾） */
  systemExtra: string;
  /** 是否使用 FreeAgent 直通（绕过 Chat LLM） */
  useFreeAgent: boolean;
  /** 需要拼到用户消息前面的前缀（如 @agentName），无则为空 */
  textPrefix: string;
}

/**
 * 解析 MessageInput 产出的 agentContext，返回统一的 ResolvedMention。
 * 所有聊天页面（chat.tsx、chat-mode.tsx、free-agent.tsx）都用此函数。
 */
export async function resolveAgentMention(agentContext?: string): Promise<ResolvedMention | null> {
  if (!agentContext) return null;

  // ── @知识技能来源组 ──
  if (agentContext.startsWith('knowledge_source:')) {
    const sourceLabel = agentContext.slice(17);
    try {
      const { useSkillStore } = await import('@/stores/skill-store');
      const allKnowledge = useSkillStore.getState().knowledgeSkills;
      const groupSkills = allKnowledge.filter(ks => ks.sourceLabel === sourceLabel);
      if (groupSkills.length > 0) {
        const skillContext = groupSkills.map(ks => {
          // location 可能是目录路径（需拼接 README.md）或文件路径（AGENTS.md/CLAUDE.md 等）
          const loc = ks.location.replace(/[\\/]+$/, '');
          const isFilePath = /\.(md|MD)$/.test(loc);
          const skillPath = isFilePath ? loc : `${loc}/README.md`;
          return `- **${ks.name}**: ${ks.description}\n  读取: \`read_file("${skillPath}")\``;
        }).join('\n');
        return {
          systemExtra: `\n\n## 可用知识技能 (${sourceLabel})\n以下技能供参考，根据用户任务选择合适的技能：\n${skillContext}`,
          useFreeAgent: true,
          textPrefix: '',
        };
      }
    } catch { /* ignore */ }
    return null;
  }

  // ── @单个知识型技能 ──
  if (agentContext.startsWith('knowledge_skill:')) {
    const skillName = agentContext.slice(16);
    try {
      const { getKnowledgeSkillBody } = await import('@/skills/builtin-executor');
      const skillBody = await getKnowledgeSkillBody(skillName) || '';
      if (skillBody) {
        return {
          systemExtra: `\n\n## 知识技能: ${skillName}\n${skillBody}`,
          useFreeAgent: true,
          textPrefix: '',
        };
      }
    } catch { /* ignore */ }
    return null;
  }

  // ── @自定义 agent / builtin agent ──
  if (agentContext.startsWith('custom_agent:')) {
    const agentName = agentContext.slice(13);
    return {
      systemExtra: '',
      useFreeAgent: false,
      textPrefix: `@${agentName} `,
    };
  }

  // ── @应用 agent（页面能力上下文）──
  if (agentContext.startsWith('Agent "')) {
    return {
      systemExtra: agentContext,
      useFreeAgent: false,
      textPrefix: '',
    };
  }

  return null;
}
