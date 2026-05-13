// Platform-aware database factory
// 来源: lib/services/database/app_database.dart

import { isTauri } from '@/utils/platform';
import type { SQLiteAdapter } from './adapter';
import { tauriSQLiteAdapter } from './tauri';
import { wasmSQLiteAdapter } from './wasm';

const DDL = `
CREATE TABLE IF NOT EXISTS modelProviders (
  id TEXT PRIMARY KEY, name TEXT, provider_type TEXT,
  base_url TEXT, model TEXT, encrypted_api_key TEXT,
  is_default INTEGER DEFAULT 0, supports_tools INTEGER DEFAULT 1, created_at TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT, model_provider_id TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT,
  content TEXT, timestamp TEXT
);

CREATE TABLE IF NOT EXISTS savedApps (
  id TEXT PRIMARY KEY, name TEXT, code TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT DEFAULT 'user', schema_json TEXT NOT NULL,
  enabled INTEGER DEFAULT 1, builtin INTEGER DEFAULT 0,
  steps_json TEXT, implementation TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_model_providers_default ON modelProviders(is_default);
`;

let _adapter: SQLiteAdapter | null = null;
let _initialized = false;

export async function getDB(): Promise<SQLiteAdapter> {
  if (_adapter) return _adapter;
  _adapter = isTauri() ? tauriSQLiteAdapter : wasmSQLiteAdapter;
  if (!_initialized) {
    // Run DDL in individual execute calls (sql.js doesn't support multi-statement)
    const stmts = DDL.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await _adapter.execute(stmt);
    }
    // Migration: add supports_tools column for existing databases
    try {
      await _adapter.execute('ALTER TABLE modelProviders ADD COLUMN supports_tools INTEGER DEFAULT 1');
    } catch { /* column already exists */ }
    // Migration: add new skills columns (category, builtin, steps_json, implementation, timestamps)
    const skillMigrations = [
      'ALTER TABLE skills ADD COLUMN category TEXT DEFAULT \'user\'',
      'ALTER TABLE skills ADD COLUMN builtin INTEGER DEFAULT 0',
      'ALTER TABLE skills ADD COLUMN steps_json TEXT',
      'ALTER TABLE skills ADD COLUMN implementation TEXT',
      'ALTER TABLE skills ADD COLUMN created_at TEXT DEFAULT (datetime(\'now\'))',
      'ALTER TABLE skills ADD COLUMN updated_at TEXT DEFAULT (datetime(\'now\'))',
    ];
    for (const stmt of skillMigrations) {
      try { await _adapter.execute(stmt); } catch { /* column already exists */ }
    }
    _initialized = true;
  }
  return _adapter;
}

export type { SQLiteAdapter } from './adapter';
export type {
  ModelProviderRow,
  ConversationRow,
  MessageRow,
  SavedAppRow,
  SkillRow,
} from './types';
