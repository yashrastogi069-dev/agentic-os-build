import { getRawDb } from "@/lib/db"

/**
 * THE one notification queue (MASTER_PLAN_V2 §1.1). Raw-SQL helper module,
 * mirroring lib/events.ts's style. `dedupeKey` is UNIQUE — enqueue is
 * insert-or-ignore so an event can never be double-queued.
 */

export interface Notification {
  id: number
  kind: string
  title: string
  body: string | null
  dedupeKey: string
  taskId: number | null
  payload: Record<string, unknown> | null
  deliverAt: number
  channels: Record<string, number>
  ackedAt: number | null
  snoozedUntil: number | null
  createdAt: number
}

type NotificationRow = {
  id: number
  kind: string
  title: string
  body: string | null
  dedupe_key: string
  task_id: number | null
  payload: string | null
  deliver_at: number
  channels: string
  acked_at: number | null
  snoozed_until: number | null
  created_at: number
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    dedupeKey: row.dedupe_key,
    taskId: row.task_id,
    payload: row.payload ? safeParse(row.payload) : null,
    deliverAt: row.deliver_at,
    channels: safeParse(row.channels) as Record<string, number>,
    ackedAt: row.acked_at,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function enqueueNotification(input: {
  kind: string
  title: string
  body?: string
  dedupeKey: string
  taskId?: number
  payload?: Record<string, unknown>
  deliverAt: number
}): { id: number; created: boolean } {
  const db = getRawDb()
  const now = Date.now()

  const result = db
    .prepare(
      `INSERT INTO notifications (kind, title, body, dedupe_key, task_id, payload, deliver_at, channels, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .run(
      input.kind,
      input.title,
      input.body ?? null,
      input.dedupeKey,
      input.taskId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.deliverAt,
      now,
    )

  const row = db
    .prepare(`SELECT id FROM notifications WHERE dedupe_key = ?`)
    .get(input.dedupeKey) as { id: number } | undefined

  if (!row) {
    // Should not happen (we just inserted or it already existed), but keep the
    // failure path honest instead of returning a fabricated id.
    throw new Error(`Failed to enqueue or locate notification for dedupeKey ${input.dedupeKey}`)
  }

  return { id: row.id, created: result.changes > 0 }
}

export function listPendingNotifications(now: number): Notification[] {
  const db = getRawDb()
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       WHERE acked_at IS NULL
         AND deliver_at <= ?
         AND (snoozed_until IS NULL OR snoozed_until <= ?)
       ORDER BY deliver_at ASC`,
    )
    .all(now, now) as NotificationRow[]
  return rows.map(rowToNotification)
}

export function markChannelDelivered(id: number, channel: string): void {
  const db = getRawDb()
  const row = db.prepare(`SELECT channels FROM notifications WHERE id = ?`).get(id) as
    | { channels: string }
    | undefined
  if (!row) throw new Error(`Notification ${id} not found`)

  const channels = safeParse(row.channels) as Record<string, number>
  channels[channel] = Date.now()

  db.prepare(`UPDATE notifications SET channels = ? WHERE id = ?`).run(
    JSON.stringify(channels),
    id,
  )
}

export function ackNotification(id: number): void {
  const db = getRawDb()
  const result = db
    .prepare(`UPDATE notifications SET acked_at = ? WHERE id = ?`)
    .run(Date.now(), id)
  if (result.changes === 0) throw new Error(`Notification ${id} not found`)
}

export function snoozeNotification(id: number, minutes: number): void {
  const db = getRawDb()
  const snoozedUntil = Date.now() + minutes * 60 * 1000
  const result = db
    .prepare(`UPDATE notifications SET snoozed_until = ? WHERE id = ?`)
    .run(snoozedUntil, id)
  if (result.changes === 0) throw new Error(`Notification ${id} not found`)
}
