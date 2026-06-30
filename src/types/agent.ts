// User-defined agent config — stored in DB, managed via skills page.
// Each agent = system prompt + tool filter + enable/disable toggle.

export interface UserAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolNames: string[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Names reserved for built-in agents — prevents user from overwriting them. */
export const RESERVED_AGENT_NAMES = ['computeruse', 'web', 'document', 'code', 'free'];
