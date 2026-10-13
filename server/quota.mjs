import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { QuotaCore } from './quota-core.mjs';

export { ApiError, uuid } from './quota-core.mjs';
export const developmentDatabase = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), 'AutoCalendar', 'development', 'quota.sqlite');

// The local store: usage accounting in one SQLite file (or in memory) on this host.
export class QuotaStore extends QuotaCore {
  constructor({ filename = ':memory:', ...options } = {}) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename, { timeout: 5000 });
    db.exec('PRAGMA journal_mode=WAL');
    super({ ...options, db, transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } });
  }
  close() { this.db.close(); }
}
