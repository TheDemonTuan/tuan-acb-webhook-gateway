import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

export type DatabaseInstance = Database.Database;

let dbInstance: DatabaseInstance | null = null;

export function initDatabase(dbPath: string): DatabaseInstance {
  if (dbInstance) {
    return dbInstance;
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  logger.info({ path: dbPath }, 'Opening SQLite database');

  const db = new Database(dbPath, {
    // verbose: logger.debug.bind(logger)
  });

  // Enable WAL mode and durability pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL'); // maximum financial durability
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  dbInstance = db;
  return db;
}

export function getDatabase(): DatabaseInstance {
  if (!dbInstance) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance && dbInstance.open) {
    logger.info('Closing SQLite database');
    dbInstance.close();
    dbInstance = null;
  }
}
