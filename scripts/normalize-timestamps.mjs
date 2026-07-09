#!/usr/bin/env node
/**
 * One-time, idempotent timestamp normalization (PLAN 1.4).
 *
 * Background: Drizzle tables that used `mode: "timestamp"` stored epoch SECONDS,
 * while the raw-SQL paths (events/memory/settings) store epoch MILLISECONDS.
 * The schema now standardizes on `timestamp_ms`. This script rewrites any stray
 * seconds values to ms so old rows render correctly under the new schema.
 *
 * Rule: for each timestamp column, `value < 1e12` (a seconds-scale epoch) is
 * multiplied by 1000; `value >= 1e12` (already ms) is left untouched. Running it
 * repeatedly is a no-op after the first pass.
 *
 * Safety:
 * - Backs up data/agentic-os.db (+ -wal, -shm) to data/backup-pre-ts-<date>.db
 *   before touching anything.
 * - Checkpoints the WAL so the backup is consistent.
 * - If the DB file does not exist yet (fresh install), it is a clean no-op.
 *
 * Usage:  node scripts/normalize-timestamps.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const DB_PATH = process.env.AGENTIC_OS_DB_PATH ?? path.join(ROOT, "data", "agentic-os.db")

/** table -> timestamp columns to normalize. */
const TARGETS = {
  memories: ["created_at", "updated_at"],
  events: ["created_at"],
  connector_settings: ["updated_at"],
  skills: ["created_at", "updated_at"],
  skill_runs: ["created_at"],
  agent_runs: ["created_at"],
}

const MS_THRESHOLD = 1_000_000_000_000 // 1e12 — anything below is seconds-scale.

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[normalize-ts] no DB at ${DB_PATH} — fresh install, nothing to do (no-op).`)
    return
  }

  // 1. Backup (db + WAL sidecars) with a date stamp.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const backupPath = path.join(path.dirname(DB_PATH), `backup-pre-ts-${stamp}.db`)
  fs.copyFileSync(DB_PATH, backupPath)
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + suffix)) fs.copyFileSync(DB_PATH + suffix, backupPath + suffix)
  }
  console.log(`[normalize-ts] backup written: ${backupPath}`)

  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")
  db.pragma("wal_checkpoint(TRUNCATE)")

  const tableExists = (name) =>
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined

  let totalUpdated = 0
  const tx = db.transaction(() => {
    for (const [table, columns] of Object.entries(TARGETS)) {
      if (!tableExists(table)) {
        console.log(`[normalize-ts] table ${table} absent — skipped.`)
        continue
      }
      for (const col of columns) {
        const info = db
          .prepare(
            `UPDATE ${table} SET ${col} = ${col} * 1000 WHERE ${col} IS NOT NULL AND ${col} > 0 AND ${col} < ?`,
          )
          .run(MS_THRESHOLD)
        if (info.changes > 0) {
          console.log(`[normalize-ts] ${table}.${col}: converted ${info.changes} seconds-scale row(s) -> ms`)
        }
        totalUpdated += info.changes
      }
    }
  })
  tx()

  // Spot-check: report min/max rendered dates per table so a human can eyeball sanity.
  console.log(`[normalize-ts] total rows updated: ${totalUpdated}`)
  for (const table of Object.keys(TARGETS)) {
    if (!tableExists(table)) continue
    const col = TARGETS[table][0]
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(${col}) AS lo, MAX(${col}) AS hi FROM ${table} WHERE ${col} IS NOT NULL`,
      )
      .get()
    if (!row || row.n === 0) {
      console.log(`[normalize-ts] ${table}: 0 rows`)
      continue
    }
    const fmt = (v) => (v ? new Date(Number(v)).toISOString() : "n/a")
    console.log(
      `[normalize-ts] ${table}: ${row.n} row(s), ${col} range ${fmt(row.lo)} .. ${fmt(row.hi)}`,
    )
  }

  db.pragma("wal_checkpoint(TRUNCATE)")
  db.close()
  console.log("[normalize-ts] done.")
}

main()
