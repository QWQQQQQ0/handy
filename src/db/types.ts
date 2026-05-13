// DB row types (snake_case matching SQLite columns)
// 来源: lib/services/database/tables.dart

export interface ModelProviderRow {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  model: string;
  encrypted_api_key: string;
  is_default: number;
  supports_tools: number;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  model_provider_id: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string;
}

export interface SavedAppRow {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  schema_json: string;
  enabled: number;
  builtin: number;
  steps_json: string | null;
  implementation: string | null;
  created_at: string;
  updated_at: string;
}
