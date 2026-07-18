import { getConnectorConfig, setConnectorConfig } from "@/lib/settings"
import { getUpcomingEvents, isGoogleConnected } from "@/lib/connectors/google"
import { getConnector, type ProbeResult } from "@/lib/connectors/registry"
import { enqueueNotification } from "@/lib/db/notifications"
import { enqueueCalendarEventNotification } from "@/lib/assist/calendar-notify"
import { listTasks } from "@/lib/tasks"

/**
 * The catch-up sweep (Phase 7 Chunk 4) — the "proactive engine" reduced to a
 * reactive, zero-new-timer function. `sweepTriggers()` runs at FETCH TIME from
 * two already-existing session-start signals:
 *   - the companion's GET /api/system/notifications (sweep-then-fetch), and
 *   - the browser's GET /api/health (which the status bar already polls),
 *     where it also passes the live connector probe results it just computed.
 *
 * It does three things, each independently gated so rapid refreshes never
 * hammer anything:
 *   1. calendar-soon: pre-enqueue the next ~24h of timed events (gated to at
 *      most once / ~10 min so refreshing doesn't re-hit the Calendar API).
 *   2. daily briefing: one template-rendered summary the first time it runs on
 *      a new local calendar date. NO LLM — plain string templating over data
 *      already in SQLite.
 *   3. connector-down: on an ok->down TRANSITION only, one notification. Reuses
 *      the /api/health probe results (never adds a new health check); skipped
 *      entirely on the companion path, which does no health probing.
 *
 * Never throws — a failed sweep must not break the health or companion route
 * it rides inside. Zero AI/LLM calls anywhere.
 */

const SWEEP_STATE_KEY = "assist"
const CALENDAR_MIN_INTERVAL_MS = 10 * 60 * 1000

interface ConnectorStatusState {
  status: "ok" | "down"
  since: number
}

interface AssistState extends Record<string, unknown> {
  lastSweptAt?: number
  lastDigestDate?: string
  connectors?: Record<string, ConnectorStatusState>
}

function getState(): AssistState {
  return getConnectorConfig<AssistState>(SWEEP_STATE_KEY) ?? {}
}

function saveState(state: AssistState): void {
  setConnectorConfig(SWEEP_STATE_KEY, state)
}

/** Local (not UTC) YYYY-MM-DD — the digest keys off the user's wall-clock day. */
function localDateString(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function endOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
}

type UpcomingEvent = Awaited<ReturnType<typeof getUpcomingEvents>>[number]

export async function sweepTriggers(opts?: { probes?: Record<string, ProbeResult> }): Promise<void> {
  try {
    const now = Date.now()
    const state = getState()

    const calendarGateOpen = now - (state.lastSweptAt ?? 0) > CALENDAR_MIN_INTERVAL_MS
    const today = localDateString(now)
    const digestNeeded = state.lastDigestDate !== today

    // Fetch the next ~24h of events ONCE, only if calendar-soon or the digest
    // actually needs them, and only when Google is connected. A "not connected"
    // or failed fetch degrades to an empty list — never throws.
    let events: UpcomingEvent[] = []
    if (isGoogleConnected() && (calendarGateOpen || digestNeeded)) {
      try {
        events = await getUpcomingEvents(1, 50)
      } catch (error) {
        console.error("[assist] calendar fetch failed", error)
        events = []
      }
    }

    // 1. calendar-soon — pre-enqueue future deliveries (rate-gated).
    if (calendarGateOpen) {
      for (const event of events) {
        enqueueCalendarEventNotification({ id: event.id, title: event.title, start: event.start }, now)
      }
      state.lastSweptAt = now
    }

    // 2. daily briefing — one per active local day.
    if (digestNeeded) {
      enqueueDailyBriefing(now, today, events, state)
      state.lastDigestDate = today
    }

    // 3. connector-down — transitions, only when the caller supplied live probes.
    if (opts?.probes) {
      detectConnectorTransitions(now, opts.probes, state)
    }

    saveState(state)
  } catch (error) {
    console.error("[assist] sweep failed", error)
  }
}

/**
 * Template-only daily briefing (renamed from "morning digest"). Composed purely
 * from data already in SQLite plus the events already fetched this sweep — no
 * AI provider is touched. Always enqueues exactly one digest per active day,
 * even when there is nothing notable ("Nothing due today"), so the presence of
 * a briefing is predictable rather than surprising.
 */
function enqueueDailyBriefing(
  now: number,
  today: string,
  events: UpcomingEvent[],
  state: AssistState,
): void {
  const lines: string[] = []

  // Due/overdue reminders: open tasks with a reminder set for today or earlier.
  const endOfDay = endOfLocalDay(now)
  const dueReminders = listTasks({ status: "open" }).filter(
    (t) => t.remindAt !== null && t.remindAt <= endOfDay,
  )
  if (dueReminders.length > 0) {
    lines.push(
      `${dueReminders.length} reminder${dueReminders.length === 1 ? "" : "s"} due: ` +
        dueReminders.map((t) => t.title).join(", "),
    )
  }

  // Today's remaining timed events (from the fetch above).
  const todaysEvents = events.filter(
    (e) =>
      e.start.includes("T") &&
      localDateString(new Date(e.start).getTime()) === today &&
      new Date(e.start).getTime() >= now,
  )
  if (todaysEvents.length > 0) {
    lines.push(
      `${todaysEvents.length} event${todaysEvents.length === 1 ? "" : "s"} today: ` +
        todaysEvents.map((e) => `${hhmm(e.start)} ${e.title}`).join(", "),
    )
  }

  // Connectors last known to be down (from persisted transition state).
  const down = Object.entries(state.connectors ?? {})
    .filter(([, s]) => s.status === "down")
    .map(([id]) => getConnector(id)?.label ?? id)
  if (down.length > 0) {
    lines.push(`Offline: ${down.join(", ")}`)
  }

  const body = lines.length > 0 ? lines.join("\n") : "Nothing on the calendar and no reminders due today."

  enqueueNotification({
    kind: "digest",
    title: `Daily briefing — ${today}`,
    body,
    dedupeKey: `digest:${today}`,
    deliverAt: now,
  })
}

/**
 * Enqueue a "connector down" notification only on a genuine ok->down
 * transition, and only for a connector we have previously seen healthy (so a
 * never-configured connector is never falsely reported "down"). Persists each
 * connector's last-known status so an ongoing outage is not re-notified on
 * every poll — it fires once, then stays quiet until the connector recovers
 * and goes down again.
 */
function detectConnectorTransitions(
  now: number,
  probes: Record<string, ProbeResult>,
  state: AssistState,
): void {
  const connectors: Record<string, ConnectorStatusState> = state.connectors ?? {}

  for (const [id, probe] of Object.entries(probes)) {
    // Infra placeholders with no real "reachability" — skip.
    if (id === "system" || id === "voice") continue

    const currentlyOk = probe.status === "ok"
    const prev = connectors[id]

    if (currentlyOk) {
      // Establish / keep the healthy baseline; preserve `since` across ok polls.
      connectors[id] = { status: "ok", since: prev?.status === "ok" ? prev.since : now }
      continue
    }

    // Not ok. Only an alert-worthy outage if it was healthy a moment ago.
    if (!prev || prev.status !== "ok") continue

    connectors[id] = { status: "down", since: now }
    const label = getConnector(id)?.label ?? id
    enqueueNotification({
      kind: "connector",
      title: `${label} is unreachable`,
      body: `${label} stopped responding as of ${new Date(now).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}.`,
      // `since` is stable until recovery, so a re-run never double-enqueues.
      dedupeKey: `connector:${id}:down:${now}`,
      deliverAt: now,
    })
  }

  state.connectors = connectors
}
