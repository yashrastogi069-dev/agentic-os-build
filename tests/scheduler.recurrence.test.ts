import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

/**
 * Covers the markFired recurrence fix (Phase 7 Chunk 4). Before the fix a
 * recurring reminder advanced by exactly ONE occurrence from its old
 * remind_at; after a multi-day gap the new remind_at was still in the past,
 * which permanently wedged the reminder (last_fired_at > a past remind_at
 * blocks it from ever being due again) and, on any revisit path, invited a
 * burst of stale fires. The fix fast-forwards past every missed occurrence so
 * only the single most-recent one fires and remind_at lands in the future.
 *
 * Isolated in-memory DB (no data/agentic-os.db). No Telegram is configured, so
 * runSchedulerTick's push path is skipped and no network call is made.
 */

const DAY_MS = 24 * 60 * 60 * 1000

// Bound in beforeAll (not at top level) so the env var is set before lib/db
// loads AND so this file never uses top-level await (tsconfig targets ES6).
let runSchedulerTick: typeof import("@/lib/scheduler").runSchedulerTick
let getRawDb: typeof import("@/lib/db").getRawDb

beforeAll(async () => {
  process.env.AGENTIC_OS_DB_PATH = ":memory:"
  ;({ runSchedulerTick } = await import("@/lib/scheduler"))
  ;({ getRawDb } = await import("@/lib/db"))
})

function insertTask(input: {
  title: string
  remindAt: number
  recurrence: string | null
}): number {
  const db = getRawDb()
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO tasks (title, notes, status, due_at, remind_at, recurrence, created_at, updated_at)
       VALUES (?, NULL, 'open', NULL, ?, ?, ?, ?)`,
    )
    .run(input.title, input.remindAt, input.recurrence, now, now)
  return Number(result.lastInsertRowid)
}

function taskRow(id: number): { remind_at: number | null; last_fired_at: number | null } {
  return getRawDb()
    .prepare(`SELECT remind_at, last_fired_at FROM tasks WHERE id = ?`)
    .get(id) as { remind_at: number | null; last_fired_at: number | null }
}

function notificationCount(taskId: number): number {
  const row = getRawDb()
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE task_id = ?`)
    .get(taskId) as { c: number }
  return row.c
}

beforeEach(() => {
  const db = getRawDb()
  db.exec(`DELETE FROM tasks; DELETE FROM notifications; DELETE FROM events;`)
})

afterEach(() => {
  const db = getRawDb()
  db.exec(`DELETE FROM tasks; DELETE FROM notifications; DELETE FROM events;`)
})

describe("markFired recurrence fast-forward", () => {
  it("fires a 4-day-overdue daily reminder exactly once and lands remind_at in the future", async () => {
    const now = Date.now()
    const id = insertTask({ title: "Standup", remindAt: now - 4 * DAY_MS, recurrence: "daily" })

    await runSchedulerTick()

    // Fired exactly once — the single most-recent missed occurrence.
    expect(notificationCount(id)).toBe(1)

    // The bug fix: remind_at is fast-forwarded strictly into the future, not
    // left one step past the old (still-overdue) time.
    const after = taskRow(id)
    expect(after.remind_at).not.toBeNull()
    expect(after.remind_at as number).toBeGreaterThan(now)
    // A daily reminder's next future occurrence is within 24h of now.
    expect(after.remind_at as number).toBeLessThanOrEqual(now + DAY_MS + 1000)
    expect(after.last_fired_at as number).toBeGreaterThanOrEqual(now)
  })

  it("does not burst-fire on subsequent ticks after the fast-forward", async () => {
    const now = Date.now()
    const id = insertTask({ title: "Water", remindAt: now - 10 * DAY_MS, recurrence: "daily" })

    await runSchedulerTick()
    await runSchedulerTick()
    await runSchedulerTick()

    // Still exactly one notification — no burst of stale missed occurrences.
    expect(notificationCount(id)).toBe(1)
    expect(taskRow(id).remind_at as number).toBeGreaterThan(now)
  })

  it("leaves a one-shot (non-recurring) reminder's remind_at untouched", async () => {
    const now = Date.now()
    const remindAt = now - 5000
    const id = insertTask({ title: "Call bank", remindAt, recurrence: null })

    await runSchedulerTick()

    expect(notificationCount(id)).toBe(1)
    const after = taskRow(id)
    // One-shot behavior is unchanged: remind_at is NOT advanced, only
    // last_fired_at is set (which stops it re-firing).
    expect(after.remind_at).toBe(remindAt)
    expect(after.last_fired_at as number).toBeGreaterThanOrEqual(now)
  })
})
