// Web SQLite adapter using sql.js + OPFS
// 来源: lib/services/database/database_connection_web.dart

import type { SQLiteAdapter } from './adapter';

let db: import('sql.js').Database | null = null;

async function getWasmDb() {
  if (!db) {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });
    db = new SQL.Database();
  }
  return db;
}

export const wasmSQLiteAdapter: SQLiteAdapter = {
  async execute(sql: string, params: unknown[] = []) {
    const d = await getWasmDb();
    d.run(sql, params as any[]);
  },

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const d = await getWasmDb();
    const stmt = d.prepare(sql);
    if (params.length > 0) stmt.bind(params as any[]);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return rows;
  },

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const rows = await wasmSQLiteAdapter.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  async close() {
    db?.close();
    db = null;
  },
};
