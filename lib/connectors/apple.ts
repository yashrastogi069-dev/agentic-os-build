import { tool } from "ai"
import { z } from "zod"
import { addEvent } from "@/lib/events"
import { getConnectorConfig } from "@/lib/settings"

/**
 * Apple Calendar connector — iCloud CalDAV, free.
 * Auth: Apple ID email + app-specific password (appleid.apple.com ->
 * Sign-In & Security -> App-Specific Passwords). Stored in connector_settings.
 *
 * CalDAV flow: PROPFIND to discover the calendar home, then REPORT
 * (calendar-query) for VEVENTs in a time window. Minimal ICS parsing —
 * enough for title/start/end/location on typical iCloud events.
 */

const ICLOUD_CALDAV = "https://caldav.icloud.com"

export interface AppleSettings extends Record<string, unknown> {
  appleId: string
  appPassword: string
}

export function getAppleSettings(): AppleSettings | null {
  const config = getConnectorConfig<AppleSettings>("apple")
  if (!config?.appleId || !config?.appPassword) return null
  return config
}

function authHeader(settings: AppleSettings): string {
  return `Basic ${Buffer.from(`${settings.appleId}:${settings.appPassword}`).toString("base64")}`
}

async function davRequest(
  settings: AppleSettings,
  url: string,
  method: string,
  depth: string,
  body: string,
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(settings),
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok && res.status !== 207) {
    throw new Error(`CalDAV ${method} ${url} failed: ${res.status}`)
  }
  return res.text()
}

/** Extract all <D:href> values from a multistatus response. */
function extractHrefs(xml: string): string[] {
  const hrefs: string[] = []
  const re = /<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) hrefs.push(match[1].trim())
  return hrefs
}

function unescapeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/**
 * Extract per-resource { href, calendarData } pairs from a REPORT
 * (calendar-query) multistatus response. Each <D:response> wraps one
 * resource's <D:href> alongside its <C:calendar-data> — unlike
 * extractHrefs (used for PROPFIND discovery), this keeps the href tied to
 * its own event data so a fetched event can later be updated/deleted by
 * targeting the exact resource it came from.
 */
function extractResponseItems(xml: string): Array<{ href: string; calendarData: string }> {
  const items: Array<{ href: string; calendarData: string }> = []
  const responseRe = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi
  let match: RegExpExecArray | null
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1]
    const hrefMatch = /<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/i.exec(block)
    const dataMatch = /<(?:[\w-]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/i.exec(block)
    if (hrefMatch && dataMatch) {
      items.push({ href: hrefMatch[1].trim(), calendarData: unescapeXmlEntities(dataMatch[1]) })
    }
  }
  return items
}

/** Discover the user's calendar collection URLs. */
async function discoverCalendars(settings: AppleSettings): Promise<string[]> {
  // 1. principal
  const principalXml = await davRequest(
    settings,
    `${ICLOUD_CALDAV}/`,
    "PROPFIND",
    "0",
    `<?xml version="1.0" encoding="utf-8"?>
     <D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
  )
  const principal = extractHrefs(principalXml).find((h) => h.includes("principal")) ?? extractHrefs(principalXml)[0]
  if (!principal) throw new Error("CalDAV: could not discover principal.")

  // 2. calendar home
  const homeXml = await davRequest(
    settings,
    new URL(principal, ICLOUD_CALDAV).toString(),
    "PROPFIND",
    "0",
    `<?xml version="1.0" encoding="utf-8"?>
     <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
       <D:prop><C:calendar-home-set/></D:prop>
     </D:propfind>`,
  )
  const home = extractHrefs(homeXml).find((h) => h.includes("calendars")) ?? extractHrefs(homeXml)[0]
  if (!home) throw new Error("CalDAV: could not discover calendar home.")

  // 3. calendar collections under home
  const listXml = await davRequest(
    settings,
    new URL(home, ICLOUD_CALDAV).toString(),
    "PROPFIND",
    "1",
    `<?xml version="1.0" encoding="utf-8"?>
     <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>`,
  )
  // Keep collection hrefs that look like calendar folders (skip inbox/outbox/notification)
  return extractHrefs(listXml).filter(
    (h) =>
      h.startsWith(new URL(home, ICLOUD_CALDAV).pathname) &&
      h !== new URL(home, ICLOUD_CALDAV).pathname &&
      !/inbox|outbox|notification|dropbox/.test(h),
  )
}

/** Minimal ICS VEVENT parser — title/start/end/location/uid. */
function parseIcsEvents(ics: string): Array<{
  uid: string
  title: string
  start: string
  end: string
  location?: string
}> {
  const events: Array<{ uid: string; title: string; start: string; end: string; location?: string }> = []
  // Unfold continuation lines (RFC 5545: lines starting with space/tab continue the previous line)
  const unfolded = ics.replace(/\r?\n[ \t]/g, "")
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1)
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0]
    const prop = (name: string): string => {
      const re = new RegExp(`^${name}[^:]*:(.*)$`, "mi")
      return re.exec(body)?.[1]?.trim() ?? ""
    }
    const toIso = (value: string): string => {
      // 20260708T090000Z / 20260708T090000 / 20260708
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(value)
      if (!m) return value
      const [, y, mo, d, h = "00", mi = "00", s = "00"] = m
      return `${y}-${mo}-${d}T${h}:${mi}:${s}${value.endsWith("Z") ? "Z" : ""}`
    }
    const uid = prop("UID")
    const title = prop("SUMMARY")
    if (!uid || !title) continue
    events.push({
      uid,
      title: title.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " "),
      start: toIso(prop("DTSTART")),
      end: toIso(prop("DTEND")),
      location: prop("LOCATION") || undefined,
    })
  }
  return events
}

/** Query upcoming VEVENTs across all discovered calendars. */
export async function getAppleEvents(days = 7): Promise<
  Array<{
    uid: string
    title: string
    start: string
    end: string
    location?: string
    calendar: string
    href: string
  }>
> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const fmt = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z"
  const now = new Date()
  const max = new Date(now.getTime() + days * 86_400_000)

  const calendars = await discoverCalendars(settings)
  const all: Array<{
    uid: string
    title: string
    start: string
    end: string
    location?: string
    calendar: string
    href: string
  }> = []

  for (const cal of calendars.slice(0, 10)) {
    try {
      const xml = await davRequest(
        settings,
        new URL(cal, ICLOUD_CALDAV).toString(),
        "REPORT",
        "1",
        `<?xml version="1.0" encoding="utf-8"?>
         <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
           <D:prop><D:getetag/><C:calendar-data/></D:prop>
           <C:filter>
             <C:comp-filter name="VCALENDAR">
               <C:comp-filter name="VEVENT">
                 <C:time-range start="${fmt(now)}" end="${fmt(max)}"/>
               </C:comp-filter>
             </C:comp-filter>
           </C:filter>
         </C:calendar-query>`,
      )
      const calName = cal.split("/").filter(Boolean).pop() ?? "calendar"
      // Extract href alongside calendar-data per <D:response> so each parsed
      // event can be traced back to the exact resource it came from — this
      // is what makes update/delete possible for events fetched here, not
      // only for events Jarvis itself created.
      for (const item of extractResponseItems(xml)) {
        for (const event of parseIcsEvents(item.calendarData)) {
          all.push({ ...event, calendar: calName, href: item.href })
        }
      }
    } catch {
      // skip unreadable calendars (shared/subscription edge cases)
    }
  }
  return all.sort((a, b) => a.start.localeCompare(b.start))
}

/** Find a single event by UID across the discovered calendars within a time window. */
async function findAppleEventByUid(
  uid: string,
  days: number,
): Promise<
  { uid: string; title: string; start: string; end: string; location?: string; calendar: string; href: string } | null
> {
  const events = await getAppleEvents(days)
  return events.find((event) => event.uid === uid) ?? null
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`)
  return d.toISOString().replace(/[-:]|\.\d{3}/g, "")
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n")
}

/**
 * Create a new event by PUTting a minimal .ics VEVENT resource into the
 * user's first discovered calendar collection (RFC 5545 / RFC 4791).
 */
export async function createAppleEvent(
  summary: string,
  startISO: string,
  endISO: string,
  location?: string,
): Promise<{ uid: string; url: string }> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const calendars = await discoverCalendars(settings)
  const calendar = calendars[0]
  if (!calendar) throw new Error("CalDAV: no writable calendar collection found.")

  const uid = `${crypto.randomUUID()}@jarvis`
  const dtstamp = toIcsUtc(new Date().toISOString())
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jarvis//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsUtc(startISO)}`,
    `DTEND:${toIcsUtc(endISO)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n")

  const eventUrl = new URL(`${uid}.ics`, new URL(calendar, ICLOUD_CALDAV).toString().replace(/\/?$/, "/")).toString()

  const res = await fetch(eventUrl, {
    method: "PUT",
    headers: {
      Authorization: authHeader(settings),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ics,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    throw new Error(`CalDAV PUT ${eventUrl} failed: ${res.status} ${await res.text()}`)
  }
  return { uid, url: eventUrl }
}

/**
 * Update an existing event by PUTting a revised .ics body to its resource
 * URL. The resource URL comes from `findAppleEventByUid`, which resolves it
 * via the per-item href captured by `getAppleEvents` (see
 * `extractResponseItems`) — this works for ANY event, not only ones Jarvis
 * created, because the href is read back from the server's own REPORT
 * response rather than reconstructed from a naming convention.
 *
 * Uses an unconditional `If-Match: *` rather than tracking/round-tripping a
 * real ETag: this is a single-user, local-first tool with no concurrent
 * writers to guard against, and ETag tracking would mean persisting a
 * per-event ETag somewhere and threading it through every read/write call
 * for a benefit (protecting against a lost update from a second writer)
 * that doesn't apply here. `If-Match: *` still keeps the one safety
 * property worth having for free: it fails with 412 if the resource was
 * deleted since it was fetched, instead of silently creating a new one.
 */
export async function updateAppleEvent(
  uid: string,
  updates: { summary?: string; startISO?: string; endISO?: string; location?: string },
  searchDays = 90,
): Promise<{ uid: string; url: string }> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const existing = await findAppleEventByUid(uid, searchDays)
  if (!existing) {
    throw new Error(
      `Apple Calendar: no event found with uid "${uid}" within the next ${searchDays} days. It may be further out, already past, or already deleted — widen searchDays or re-check the uid.`,
    )
  }

  const summary = updates.summary ?? existing.title
  const startISO = updates.startISO ?? existing.start
  const endISO = updates.endISO ?? existing.end
  const location = updates.location !== undefined ? updates.location : existing.location

  const dtstamp = toIcsUtc(new Date().toISOString())
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jarvis//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsUtc(startISO)}`,
    `DTEND:${toIcsUtc(endISO)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n")

  const eventUrl = new URL(existing.href, ICLOUD_CALDAV).toString()

  const res = await fetch(eventUrl, {
    method: "PUT",
    headers: {
      Authorization: authHeader(settings),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-Match": "*",
    },
    body: ics,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    throw new Error(`CalDAV PUT (update) ${eventUrl} failed: ${res.status} ${await res.text()}`)
  }
  return { uid, url: eventUrl }
}

/**
 * Delete an event by HTTP DELETE to its resource URL, resolved the same way
 * as `updateAppleEvent` (href captured off the REPORT response, not
 * reconstructed).
 */
export async function deleteAppleEvent(uid: string, searchDays = 90): Promise<{ uid: string }> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const existing = await findAppleEventByUid(uid, searchDays)
  if (!existing) {
    throw new Error(
      `Apple Calendar: no event found with uid "${uid}" within the next ${searchDays} days. It may be further out, already past, or already deleted — widen searchDays or re-check the uid.`,
    )
  }

  const eventUrl = new URL(existing.href, ICLOUD_CALDAV).toString()
  const res = await fetch(eventUrl, {
    method: "DELETE",
    headers: { Authorization: authHeader(settings) },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`CalDAV DELETE ${eventUrl} failed: ${res.status} ${await res.text()}`)
  }
  return { uid }
}

/**
 * Search upcoming events by a case-insensitive substring match on title or
 * location. iCloud's CalDAV REPORT does support a server-side
 * <C:text-match> prop-filter per RFC 4791, but wiring that XML correctly
 * cannot be confirmed without a live successful REPORT against a real
 * account (currently blocked by Yash's account-side 401). Filtering
 * client-side over the already-time-windowed, already-working
 * `getAppleEvents` is simpler and certainly correct, so that's the chosen
 * approach — no fragile unverified XML filter added on a hunch.
 */
export async function searchAppleEvents(
  query: string,
  days = 30,
): Promise<
  Array<{ uid: string; title: string; start: string; end: string; location?: string; calendar: string; href: string }>
> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const q = query.trim().toLowerCase()
  if (!q) return []
  const events = await getAppleEvents(days)
  return events.filter(
    (event) => event.title.toLowerCase().includes(q) || (event.location ?? "").toLowerCase().includes(q),
  )
}

export async function checkApple(): Promise<boolean> {
  const settings = getAppleSettings()
  if (!settings) return false
  try {
    await discoverCalendars(settings)
    return true
  } catch {
    return false
  }
}

/* ---------- Feed sync ---------- */

export async function syncAppleToFeed(): Promise<{ added: number }> {
  const settings = getAppleSettings()
  if (!settings) return { added: 0 }
  let added = 0
  const events = await getAppleEvents(7)
  for (const event of events) {
    if (
      addEvent({
        source: "icloud",
        title: `${event.start.slice(0, 16).replace("T", " ")} — ${event.title}`,
        payload: { kind: "calendar-event", ...event },
        externalId: `event-${event.uid}-${event.start}`,
        createdAt: new Date(event.start).getTime() || Date.now(),
      })
    )
      added++
  }
  return { added }
}

/* ---------- Agent tools ---------- */

export const appleTools = {
  getAppleCalendarEvents: tool({
    description: "Get the user's upcoming Apple/iCloud Calendar events for the next N days.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(30).optional().describe("How many days ahead (default 7)."),
    }),
    execute: async ({ days }) => ({ events: await getAppleEvents(days ?? 7) }),
  }),
  createAppleCalendarEvent: tool({
    description: "Create a new event on the user's Apple/iCloud Calendar (first available calendar collection).",
    inputSchema: z.object({
      summary: z.string().describe("Event title."),
      startISO: z.string().describe("Start time as an ISO 8601 datetime."),
      endISO: z.string().describe("End time as an ISO 8601 datetime."),
      location: z.string().optional(),
    }),
    execute: async ({ summary, startISO, endISO, location }) => {
      const result = await createAppleEvent(summary, startISO, endISO, location)
      return { created: true, ...result }
    },
  }),
  updateAppleCalendarEvent: tool({
    description:
      "Update an existing Apple/iCloud Calendar event (summary/start/end/location, all optional except uid). Modifies a real calendar entry, so this requires explicit confirmation: call with confirmed:false first to preview exactly what would change, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      uid: z.string().describe("The event's UID, as returned by getAppleCalendarEvents or searchAppleCalendarEvents."),
      summary: z.string().optional().describe("New title. Omit to keep the existing title."),
      startISO: z.string().optional().describe("New start time as an ISO 8601 datetime. Omit to keep existing."),
      endISO: z.string().optional().describe("New end time as an ISO 8601 datetime. Omit to keep existing."),
      location: z.string().optional().describe("New location. Omit to keep existing."),
      searchDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("How many days ahead to search for the event by uid (default 90)."),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the exact change in this turn or a prior turn of this conversation. If the user has not confirmed, call this tool with confirmed:false first to show them exactly what would change, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ uid, summary, startISO, endISO, location, searchDays, confirmed }) => {
      if (!confirmed) {
        return {
          updated: false,
          preview: { uid, summary, startISO, endISO, location },
          requiresConfirmation: true,
        }
      }
      const result = await updateAppleEvent(uid, { summary, startISO, endISO, location }, searchDays ?? 90)
      return { updated: true, ...result }
    },
  }),
  deleteAppleCalendarEvent: tool({
    description:
      "Delete an event from the user's Apple/iCloud Calendar by uid. Permanently removes a real calendar entry, so this requires explicit confirmation: call with confirmed:false first to preview which event would be deleted, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      uid: z.string().describe("The event's UID, as returned by getAppleCalendarEvents or searchAppleCalendarEvents."),
      searchDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("How many days ahead to search for the event by uid (default 90)."),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the deletion in this turn or a prior turn of this conversation. If the user has not confirmed, call this tool with confirmed:false first to show them exactly which event would be deleted, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ uid, searchDays, confirmed }) => {
      if (!confirmed) {
        const existing = await findAppleEventByUid(uid, searchDays ?? 90)
        return { deleted: false, preview: existing, requiresConfirmation: true }
      }
      const result = await deleteAppleEvent(uid, searchDays ?? 90)
      return { deleted: true, ...result }
    },
  }),
  searchAppleCalendarEvents: tool({
    description:
      "Search the user's upcoming Apple/iCloud Calendar events by a case-insensitive substring match against title or location. Read-only.",
    inputSchema: z.object({
      query: z.string().describe("Text to search for in the event title or location."),
      days: z.number().int().min(1).max(365).optional().describe("How many days ahead to search (default 30)."),
    }),
    execute: async ({ query, days }) => ({ events: await searchAppleEvents(query, days ?? 30) }),
  }),
}
