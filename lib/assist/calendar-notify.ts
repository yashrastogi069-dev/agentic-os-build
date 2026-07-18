import { enqueueNotification } from "@/lib/db/notifications"

/**
 * Calendar-soon notification timing (Phase 7 Chunk 4). Kept in its own small
 * module so BOTH the catch-up sweep (lib/assist/sweep.ts) and the
 * createCalendarEvent tool (lib/connectors/google.ts) enqueue an event's
 * reminder through exactly one code path — and so lib/scheduler.ts can import
 * the quiet-hours check without pulling in the whole sweep dependency graph.
 * The only dependency here is the notification queue.
 */

/** Deliver a calendar reminder this many ms before the event starts. */
const LEAD_MS = 15 * 60 * 1000
/** Drop an undelivered calendar reminder this many ms after the event starts. */
const GRACE_MS = 10 * 60 * 1000

export interface CalendarEventLike {
  id: string
  title: string
  /** Event start as an ISO 8601 string. All-day (date-only) values are skipped. */
  start: string
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
}

/**
 * Pre-enqueue a single timed event's reminder into the shared notification
 * queue. Delivery is scheduled 15 min before start (or immediately if the
 * event is already inside that window); the row expires 10 min after start so
 * a reminder the app never got to deliver is dropped rather than shown late.
 * The existing 30s scheduler tick delivers it at deliver_at — no new timer.
 *
 * Returns `{ enqueued }` false for events this helper deliberately ignores
 * (all-day, unparseable, or already started) and `{ created }` false when the
 * dedupe key already existed, so a re-run never double-enqueues.
 */
export function enqueueCalendarEventNotification(
  event: CalendarEventLike,
  now: number = Date.now(),
): { enqueued: boolean; created: boolean } {
  // All-day events (Google returns a date-only "start", no "T") get no
  // 15-min-before ping — it is meaningless for them.
  if (!event.start.includes("T")) return { enqueued: false, created: false }

  const startMs = new Date(event.start).getTime()
  if (Number.isNaN(startMs)) return { enqueued: false, created: false }
  // Already started/past: nothing useful to remind about.
  if (startMs <= now) return { enqueued: false, created: false }

  const deliverAt = Math.max(startMs - LEAD_MS, now)
  const expiresAt = startMs + GRACE_MS

  const { created } = enqueueNotification({
    kind: "calendar",
    title: event.title,
    body: `Starts ${hhmm(startMs)}`,
    dedupeKey: `calendar:${event.id}:${event.start}`,
    deliverAt,
    expiresAt,
  })
  return { enqueued: true, created }
}

/**
 * Quiet hours: no phone/Telegram push between 23:00 and 08:00 LOCAL time.
 * The single guardrail kept for v1 (the old per-hour/per-day caps were cut
 * because nothing fires on a timer anymore). Callers skip the push channel
 * during this window — the notification stays queued and still surfaces
 * in-app; it just doesn't buzz the phone overnight.
 */
export function isQuietHours(now: number = Date.now()): boolean {
  const hour = new Date(now).getHours()
  return hour >= 23 || hour < 8
}
