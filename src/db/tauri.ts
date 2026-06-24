// Tauri desktop SQLite adapter
// 来源: lib/services/database/database_connection_io.dart

import type { SQLiteAdapter } from './adapter';

interface TauriDb {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
}

let db: TauriDb | null = null;

async function getTauriDb(): Promise<TauriDb> {
  if (!db) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    db = (await Database.load('sqlite:handy.db')) as unknown as TauriDb;
  }
  return db;
}

export const tauriSQLiteAdapter: SQLiteAdapter = {
  async execute(sql: string, params: unknown[] = []) {
    const d = await getTauriDb();
    await d.execute(sql, params);
  },

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const d = await getTauriDb();
    return d.select<T[]>(sql, params);
  },

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const rows = await tauriSQLiteAdapter.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  async close() {
    // Tauri plugin manages connection lifecycle
    db = null;
  },
};
