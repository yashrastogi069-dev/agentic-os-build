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
  Array<{ uid: string; title: string; start: string; end: string; location?: string; calendar: string }>
> {
  const settings = getAppleSettings()
  if (!settings) throw new Error("Apple Calendar is not configured. Add Apple ID + app password in Settings.")

  const fmt = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z"
  const now = new Date()
  const max = new Date(now.getTime() + days * 86_400_000)

  const calendars = await discoverCalendars(settings)
  const all: Array<{ uid: string; title: string; start: string; end: string; location?: string; calendar: string }> =
    []

  for (const cal of calendars.slice(0, 10)) {
    try {
      const xml = await davRequest(
        settings,
        new URL(cal, ICLOUD_CALDAV).toString(),
        "REPORT",
        "1",
        `<?xml version="1.0" encoding="utf-8"?>
         <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
           <D:prop><C:calendar-data/></D:prop>
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
      for (const event of parseIcsEvents(xml)) {
        all.push({ ...event, calendar: calName })
      }
    } catch {
      // skip unreadable calendars (shared/subscription edge cases)
    }
  }
  return all.sort((a, b) => a.start.localeCompare(b.start))
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
}
