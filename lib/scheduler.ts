import { getRawDb } from "@/lib/db"
import { addEvent } from "@/lib/events"
import { enqueueNotification, markChannelDelivered } from "@/lib/db/notifications"
import { getTelegramSettings, sendTelegramMessage } from "@/lib/connectors/telegram"
import { isQuietHours } from "@/lib/assist/calendar-notify"
import type { Task, TaskRecurrence } from "@/lib/tasks"

/**
 * Reminder scheduler (Phase 6E). globalThis-guarded singleton (same pattern
 * as lib/db/index.ts and lib/voice/piper.ts) so Next.js HMR / multiple
 * imports never start two intervals. Ticks every 30s, finds due tasks,
 * enqueues a notification (dedupe-keyed so the same remindAt never fires
 * twice), logs to the feed, best-effort pushes Telegram, and advances
 * recurrence.
 */

const TICK_INTERVAL_MS = 30_000

type GlobalWithScheduler = typeof globalThis & {
  __jarvisSchedulerTimer?: NodeJS.Timeout
}

const g = globalThis as GlobalWithScheduler

type DueTaskRow = {
  id: number
  title: string
  notes: string | null
  status: string
  due_at: number | null
  remind_at: number | null
  recurrence: string | null
  last_fired_at: number | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

function rowToTask(row: DueTaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status as Task["status"],
    dueAt: row.due_at,
    remindAt: row.remind_at,
    recurrence: (row.recurrence as TaskRecurrence | null) ?? null,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000
}

function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

/** Mirrors lib/tasks.ts's nextOccurrence — kept local since that helper isn't exported. */
function nextOccurrence(ms: number, recurrence: TaskRecurrence): number {
  switch (recurrence) {
    case "daily":
      return addDays(ms, 1)
    case "weekly":
      return addDays(ms, 7)
    case "monthly":
      return addMonths(ms, 1)
    case "weekdays": {
      let next = addDays(ms, 1)
      const day = new Date(next).getDay() // 0 = Sunday, 6 = Saturday
      if (day === 6) next = addDays(next, 2)
      else if (day === 0) next = addDays(next, 1)
      return next
    }
  }
}

function findDueTasks(now: number): Task[] {
  const db = getRawDb()
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE status = 'open'
         AND remind_at IS NOT NULL
         AND remind_at <= ?
         AND (last_fired_at IS NULL OR last_fired_at < remind_at)
       ORDER BY remind_at ASC`,
    )
    .all(now) as DueTaskRow[]
  return rows.map(rowToTask)
}

function markFired(task: Task, now: number): void {
  const db = getRawDb()
  if (task.recurrence) {
    // Advance to the next occurrence, then FAST-FORWARD past every occurrence
    // that is already in the past. Previously this advanced by exactly one
    // step from the old remind_at: after a multi-day gap the new remind_at was
    // still overdue, which both left the recurring reminder permanently wedged
    // (last_fired_at > a past remind_at blocks it forever) and, on any path
    // that revisits it, invited a burst of stale fires. Looping until the new
    // remind_at is strictly in the future means only the single most-recent
    // missed occurrence fires (this call) and the rest are silently skipped.
    let nextRemindAt: number | null = null
    if (task.remindAt) {
      nextRemindAt = nextOccurrence(task.remindAt, task.recurrence)
      // Bounded guard: even a decade of missed daily occurrences is < 4000
      // iterations; the cap only exists so a bad clock can never spin forever.
      let guard = 0
      while (nextRemindAt <= now && guard < 100_000) {
        nextRemindAt = nextOccurrence(nextRemindAt, task.recurrence)
        guard++
      }
    }
    db.prepare(`UPDATE tasks SET last_fired_at = ?, remind_at = ?, updated_at = ? WHERE id = ?`).run(
      now,
      nextRemindAt,
      now,
      task.id,
    )
  } else {
    // One-shot reminder: unchanged — record the fire, never touch remind_at.
    db.prepare(`UPDATE tasks SET last_fired_at = ?, updated_at = ? WHERE id = ?`).run(now, now, task.id)
  }
}

/**
 * One scheduler pass. Exported (not just wired to the interval) so it's
 * directly testable and an API route can trigger it on demand. Never throws
 * — a failed tick must not kill the interval it's running inside.
 *
 * Because the query is `remind_at <= now` (not `remind_at == now`), a
 * reminder whose time passed while the app was closed fires once on the
 * next tick after startup ("announce once on restart"); the dedupeKey still
 * prevents a double-fire if it had already fired before shutdown.
 */
export async function runSchedulerTick(): Promise<void> {
  try {
    const now = Date.now()
    const due = findDueTasks(now)

    for (const task of due) {
      const remindAt = task.remindAt ?? now
      const { id: notificationId, created } = enqueueNotification({
        kind: "reminder",
        title: task.title,
        body: task.notes ?? undefined,
        dedupeKey: `reminder:task:${task.id}:${remindAt}`,
        taskId: task.id,
        deliverAt: now,
      })

      if (created) {
        addEvent({ source: "reminder", title: `Reminder: ${task.title}` })

        try {
          // Quiet hours (23:00-08:00 local): queue instead of buzzing the
          // phone. The row stays pending and still shows in-app; the Telegram
          // channel just isn't marked delivered this fire. Not a new mechanism
          // — a single time check in front of the existing push.
          if (getTelegramSettings() && !isQuietHours(now)) {
            await sendTelegramMessage(`Reminder: ${task.title}`)
            markChannelDelivered(notificationId, "telegram")
          }
        } catch (error) {
          console.error("[scheduler] telegram push failed", error)
        }
      }

      markFired(task, now)
    }
  } catch (error) {
    console.error("[scheduler] tick failed", error)
  }
}

/**
 * Starts the 30s reminder-firing interval. globalThis-guarded so repeated
 * imports (HMR, multiple route handlers) never start a second interval.
 * The timer is unref'd so it never holds the Node process open.
 */
export function startScheduler(): void {
  if (g.__jarvisSchedulerTimer) return

  const timer = setInterval(() => {
    void runSchedulerTick()
  }, TICK_INTERVAL_MS)
  timer.unref()
  g.__jarvisSchedulerTimer = timer

  // Fire an immediate first pass so reminders due before/at startup announce
  // without waiting a full interval.
  void runSchedulerTick()
}
