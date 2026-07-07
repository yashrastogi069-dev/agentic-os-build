import { getRawDb } from "@/lib/db"

/** Unified connector feed helpers. */

export interface FeedEvent {
  id: number
  source: string
  title: string
  payload: Record<string, unknown> | null
  externalId: string | null
  createdAt: number
}

/**
 * Insert an event. When externalId is provided, duplicate (source, externalId)
 * pairs are ignored so connector syncs are idempotent.
 */
export function addEvent(input: {
  source: string
  title: string
  payload?: Record<string, unknown>
  externalId?: string
  createdAt?: number
}): boolean {
  const db = getRawDb()
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events (source, title, payload, external_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.source,
      input.title,
      input.payload ? JSON.stringify(input.payload) : null,
      input.externalId ?? null,
      input.createdAt ?? Date.now(),
    )
  return result.changes > 0
}

export function getRecentEvents(limit = 30, source?: string): FeedEvent[] {
  const db = getRawDb()
  const rows = db
    .prepare(
      `SELECT id, source, title, payload, external_id, created_at
       FROM events
       ${source ? "WHERE source = ?" : ""}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...(source ? [source, limit] : [limit])) as Array<{
    id: number
    source: string
    title: string
    payload: string | null
    external_id: string | null
    created_at: number
  }>

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    payload: r.payload ? safeParse(r.payload) : null,
    externalId: r.external_id,
    createdAt: r.created_at,
  }))
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}
