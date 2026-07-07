import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

/**
 * Local-first SQLite database. Single file at ./data/agentic-os.db.
 * Self-initializes on first run — no migration step needed.
 *
 * sqlite-vec provides the vec_memories virtual table for vector search.
 * EMBEDDING_DIM matches Ollama's nomic-embed-text (768 dimensions).
 */
export const EMBEDDING_DIM = 768

const DB_DIR = path.join(process.cwd(), "data")
const DB_PATH = process.env.AGENTIC_OS_DB_PATH ?? path.join(DB_DIR, "agentic-os.db")

/**
 * Bump SCHEMA_VERSION whenever tables are added — the cached connection
 * (surviving HMR via globalThis) re-runs the idempotent DDL on mismatch.
 */
const SCHEMA_VERSION = 2

type GlobalWithDb = typeof globalThis & {
  __agenticOsDb?: Database.Database
  __agenticOsDrizzle?: BetterSQLite3Database<typeof schema>
  __agenticOsVecAvailable?: boolean
  __agenticOsSchemaVersion?: number
}

const g = globalThis as GlobalWithDb

function initDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")

  let vecAvailable = false
  try {
    sqliteVec.load(db)
    vecAvailable = true
  } catch (error) {
    console.error(
      "[agentic-os] sqlite-vec failed to load — memory recall will fall back to keyword search.",
      error,
    )
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      source TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      payload TEXT,
      external_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_external
      ON events (source, external_id);

    CREATE TABLE IF NOT EXISTS connector_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connector TEXT NOT NULL UNIQUE,
      config_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      source_task TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'built',
      version INTEGER NOT NULL DEFAULT 1,
      deployed_to TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      skill_version INTEGER NOT NULL DEFAULT 1,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      feedback TEXT,
      created_at INTEGER NOT NULL
    );
  `)

  if (vecAvailable) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        embedding float[${EMBEDDING_DIM}]
      );
    `)
  }

  g.__agenticOsVecAvailable = vecAvailable
  return db
}

export function getRawDb(): Database.Database {
  if (!g.__agenticOsDb) {
    g.__agenticOsDb = initDb()
    g.__agenticOsSchemaVersion = SCHEMA_VERSION
  } else if (g.__agenticOsSchemaVersion !== SCHEMA_VERSION) {
    // Schema changed since this connection was cached (HMR) — close and re-init
    // so the idempotent DDL creates any new tables.
    try {
      g.__agenticOsDb.close()
    } catch {
      // already closed
    }
    g.__agenticOsDb = initDb()
    g.__agenticOsDrizzle = undefined
    g.__agenticOsSchemaVersion = SCHEMA_VERSION
  }
  return g.__agenticOsDb
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!g.__agenticOsDrizzle) {
    g.__agenticOsDrizzle = drizzle(getRawDb(), { schema })
  }
  return g.__agenticOsDrizzle
}

export function isVecAvailable(): boolean {
  getRawDb()
  return g.__agenticOsVecAvailable ?? false
}

export { schema }
