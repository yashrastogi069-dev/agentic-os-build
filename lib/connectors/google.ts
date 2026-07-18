import { tool } from "ai"
import { z } from "zod"
import { addEvent } from "@/lib/events"
import { getConnectorConfig } from "@/lib/settings"
import { enqueueCalendarEventNotification } from "@/lib/assist/calendar-notify"
import {
  buildAuthUrl,
  getAccessToken as oauthGetAccessToken,
  handleOAuthCallback,
  isConnected,
  type OAuthDescriptor,
} from "@/lib/connectors/oauth"

/**
 * Google Calendar + Gmail connector — user's own OAuth credentials, free.
 * Local-first OAuth: user creates a "Web application" OAuth client in Google
 * Cloud Console with redirect URI http://localhost:3000/api/google/callback,
 * pastes client id/secret in Settings, clicks connect. The refresh token is
 * stored in connector_settings — tokens never leave the machine.
 *
 * Scopes: calendar (read/write) + gmail.readonly + gmail.send. Existing
 * connections made before write support was added will need to reconnect
 * in Settings (Google's incremental-auth flow re-prompts consent) before
 * write tools work — read tools are unaffected.
 */

/**
 * OAuth descriptor for Google. The generic module in lib/connectors/oauth.ts
 * owns state/CSRF protection, PKCE (unused here), and refresh-token rotation;
 * only the provider-specific endpoints, scopes, and auth params live here.
 * access_type=offline + prompt=consent guarantee a refresh token every time.
 */
const googleOAuth: OAuthDescriptor = {
  settingsKey: "google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  pkce: false,
  clientAuth: "body",
}

export interface GoogleSettings extends Record<string, unknown> {
  clientId: string
  clientSecret: string
  refreshToken?: string
  /** Cached short-lived access token. */
  accessToken?: string
  accessTokenExpiresAt?: number
}

export function getGoogleSettings(): GoogleSettings | null {
  const config = getConnectorConfig<GoogleSettings>("google")
  if (!config?.clientId || !config?.clientSecret) return null
  return config
}

export function isGoogleConnected(): boolean {
  return isConnected(googleOAuth)
}

/** Build Google's consent-screen URL (now with CSRF `state`), via the oauth module. */
export function buildGoogleAuthUrl(redirectUri: string): string {
  return buildAuthUrl(googleOAuth, redirectUri)
}

/** Validate `state` and exchange the callback code for tokens, via the oauth module. */
export async function exchangeGoogleCode(params: URLSearchParams, redirectUri: string): Promise<void> {
  await handleOAuthCallback(googleOAuth, params, redirectUri)
}

async function getAccessToken(): Promise<string> {
  return oauthGetAccessToken(googleOAuth)
}

async function gFetch<T>(url: string): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Google API failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function gPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Google API POST failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function gPatch<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Google API PATCH failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

/** DELETE with no body. Google Calendar returns 204 No Content on success — do not parse JSON. */
async function gDelete(url: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok && res.status !== 404) throw new Error(`Google API DELETE failed: ${res.status} ${await res.text()}`)
}

/* ---------- Calendar ---------- */

export async function getUpcomingEvents(days = 7, limit = 20) {
  const now = new Date()
  const max = new Date(now.getTime() + days * 86_400_000)
  const data = await gFetch<{ items?: RawCalendarEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: max.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(limit),
      }),
  )
  return (data.items ?? []).map(mapEvent)
}

export async function createCalendarEvent(
  summary: string,
  startISO: string,
  endISO: string,
  description?: string,
  location?: string,
): Promise<{ id: string; url?: string }> {
  const data = await gPost<{ id: string; htmlLink?: string }>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      summary,
      description,
      location,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    },
  )
  return { id: data.id, url: data.htmlLink }
}

/** Shape produced by the Calendar API's events.get / events.list items, mapped to our event shape. */
interface RawCalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  htmlLink?: string
}

function mapEvent(e: RawCalendarEvent) {
  return {
    id: e.id,
    title: e.summary ?? "(untitled)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location,
    url: e.htmlLink,
  }
}

export interface CalendarEventUpdate {
  summary?: string
  description?: string
  location?: string
  startISO?: string
  endISO?: string
}

/**
 * PATCH only the fields that are provided (Calendar's patch semantics: an
 * omitted field is left untouched, unlike PUT which would replace the event).
 */
export async function updateCalendarEvent(
  eventId: string,
  updates: CalendarEventUpdate,
): Promise<{ id: string; url?: string }> {
  const body: Record<string, unknown> = {}
  if (updates.summary !== undefined) body.summary = updates.summary
  if (updates.description !== undefined) body.description = updates.description
  if (updates.location !== undefined) body.location = updates.location
  if (updates.startISO !== undefined) body.start = { dateTime: updates.startISO }
  if (updates.endISO !== undefined) body.end = { dateTime: updates.endISO }

  const data = await gPatch<{ id: string; htmlLink?: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    body,
  )
  return { id: data.id, url: data.htmlLink }
}

/** Deletes an event from the primary calendar. Google returns 204 No Content on success. */
export async function deleteCalendarEvent(eventId: string): Promise<{ ok: true }> {
  await gDelete(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`)
  return { ok: true }
}

/**
 * Free-text search across a time window, using Calendar's own `q` parameter
 * (matches summary, description, location, attendees). Same time-range
 * construction as getUpcomingEvents, so results stay consistent with it.
 */
export async function searchCalendarEvents(query: string, days = 30, limit = 20) {
  const now = new Date()
  const max = new Date(now.getTime() + days * 86_400_000)
  const data = await gFetch<{ items?: RawCalendarEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        q: query,
        timeMin: now.toISOString(),
        timeMax: max.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(limit),
      }),
  )
  return (data.items ?? []).map(mapEvent)
}

/* ---------- Gmail ---------- */

/** Shared metadata shape used by both getRecentEmails and searchGmail. */
async function fetchEmailMetadata(ids: string[]) {
  const details = await Promise.all(
    ids.map((id) =>
      gFetch<{
        id: string
        snippet: string
        internalDate: string
        payload?: { headers?: Array<{ name: string; value: string }> }
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      ),
    ),
  )
  return details.map((d) => {
    const header = (name: string) =>
      d.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
    return {
      id: d.id,
      subject: header("Subject") || "(no subject)",
      from: header("From"),
      snippet: d.snippet,
      date: Number(d.internalDate),
    }
  })
}

export async function getRecentEmails(limit = 15) {
  const list = await gFetch<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=in:inbox`,
  )
  return fetchEmailMetadata((list.messages ?? []).map((m) => m.id))
}

/**
 * Real Gmail search via the API's own `q` parameter — Gmail's native search
 * operators (from:, to:, subject:, after:, before:, has:attachment, label:,
 * is:unread, etc.) all work here exactly as they do in the Gmail search box.
 * Returns the same metadata shape as getRecentEmails (no bodies) — fetch a
 * specific message's full content with readEmail once you have its id.
 */
export async function searchGmail(query: string, limit = 10) {
  const list = await gFetch<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
      new URLSearchParams({ q: query, maxResults: String(limit) }),
  )
  return fetchEmailMetadata((list.messages ?? []).map((m) => m.id))
}

/** Base64url-encode (no padding, - and _) per the Gmail API's `raw` message spec. */
function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

/** Inverse of base64UrlEncode: restores standard base64 alphabet + padding, then decodes to utf-8. */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/")
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4)
  return Buffer.from(withPadding, "base64").toString("utf-8")
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

/** Depth-first search through payload.parts (which can nest, e.g. multipart/alternative inside multipart/mixed). */
function findPart(part: GmailPart | undefined, mimeType: string): GmailPart | undefined {
  if (!part) return undefined
  if (part.mimeType === mimeType && part.body?.data) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return undefined
}

/** Minimal, dependency-free HTML-to-text: drops script/style blocks, strips tags, unescapes common entities. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

/**
 * Fetches one email's full plain-text content by id (format=full, walking
 * payload.parts for a text/plain part first; falls back to text/html run
 * through a simple tag-strip when no plain-text part exists). This is the
 * companion to searchGmail/getRecentEmails, which intentionally return only
 * metadata for speed — call this once you know which message id you need.
 */
export async function readEmail(
  id: string,
): Promise<{ id: string; subject: string; from: string; date: number; body: string }> {
  const data = await gFetch<{
    id: string
    internalDate: string
    payload?: GmailPart & { headers?: Array<{ name: string; value: string }> }
  }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)

  const header = (name: string) =>
    data.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""

  const plainPart = findPart(data.payload, "text/plain")
  let body: string
  if (plainPart?.body?.data) {
    body = base64UrlDecode(plainPart.body.data).trim()
  } else {
    const htmlPart = findPart(data.payload, "text/html")
    if (htmlPart?.body?.data) {
      body = htmlToPlainText(base64UrlDecode(htmlPart.body.data))
    } else if (data.payload?.body?.data) {
      // Single-part message (no multipart/parts array) — body is directly on the payload.
      const raw = base64UrlDecode(data.payload.body.data)
      body = data.payload.mimeType === "text/html" ? htmlToPlainText(raw) : raw.trim()
    } else {
      body = "(no readable body found)"
    }
  }

  return {
    id: data.id,
    subject: header("Subject") || "(no subject)",
    from: header("From"),
    date: Number(data.internalDate),
    body,
  }
}

export async function sendGmailMessage(to: string, subject: string, body: string): Promise<{ id: string }> {
  const message = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`
  const raw = base64UrlEncode(message)
  const data = await gPost<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { raw })
  return { id: data.id }
}

/**
 * Fetches just what's needed to reply within a thread: the Gmail threadId
 * (a top-level field on the message resource, not a header) plus the
 * Message-ID/Subject/From headers. format=metadata keeps this cheap — no
 * need to pull the full body just to build a reply envelope.
 */
async function getReplyContext(
  id: string,
): Promise<{ threadId: string; messageId: string; subject: string; from: string }> {
  const data = await gFetch<{
    threadId: string
    payload?: { headers?: Array<{ name: string; value: string }> }
  }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From`,
  )
  const header = (name: string) =>
    data.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  return {
    threadId: data.threadId,
    messageId: header("Message-ID"),
    subject: header("Subject"),
    from: header("From"),
  }
}

/**
 * Replies within an existing Gmail thread, unlike sendGmailMessage which
 * always starts a brand-new conversation. Sets threadId on the send request
 * (keeps it in the same Gmail conversation) and In-Reply-To/References
 * headers to the original message's Message-ID (the RFC 5322 mechanism mail
 * clients use to thread replies) so it reads as a genuine reply, not just a
 * same-subject message that happens to land in the same thread by luck.
 */
export async function replyToEmailMessage(
  originalId: string,
  body: string,
  toOverride?: string,
): Promise<{ id: string; threadId: string }> {
  const original = await getReplyContext(originalId)
  const to = toOverride ?? original.from
  if (!to) throw new Error(`Could not determine a recipient: original message ${originalId} has no From header.`)
  const subject = /^re:/i.test(original.subject.trim()) ? original.subject : `Re: ${original.subject}`

  const headerLines = [`To: ${to}`, `Subject: ${subject}`]
  if (original.messageId) {
    headerLines.push(`In-Reply-To: ${original.messageId}`, `References: ${original.messageId}`)
  }
  headerLines.push(`Content-Type: text/plain; charset="UTF-8"`)
  const message = `${headerLines.join("\r\n")}\r\n\r\n${body}`
  const raw = base64UrlEncode(message)

  const data = await gPost<{ id: string; threadId: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    { raw, threadId: original.threadId },
  )
  return { id: data.id, threadId: data.threadId }
}

/* ---------- Feed sync ---------- */

export async function syncGoogleToFeed(): Promise<{ added: number }> {
  if (!isGoogleConnected()) return { added: 0 }
  let added = 0

  const [events, emails] = await Promise.all([getUpcomingEvents(7, 20), getRecentEmails(15)])

  for (const event of events) {
    if (
      addEvent({
        source: "gcal",
        title: `${event.start.slice(0, 16).replace("T", " ")} — ${event.title}`,
        payload: { kind: "calendar-event", ...event },
        externalId: `event-${event.id}`,
        createdAt: new Date(event.start).getTime(),
      })
    )
      added++
  }
  for (const email of emails) {
    if (
      addEvent({
        source: "gmail",
        title: `${email.from.replace(/<.*>/, "").trim()}: ${email.subject}`,
        payload: { kind: "email", ...email },
        externalId: `email-${email.id}`,
        createdAt: email.date,
      })
    )
      added++
  }
  return { added }
}

/* ---------- Agent tools ---------- */

export const googleTools = {
  getCalendarEvents: tool({
    description: "Get the user's upcoming Google Calendar events for the next N days.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(30).optional().describe("How many days ahead (default 7)."),
    }),
    execute: async ({ days }) => ({ events: await getUpcomingEvents(days ?? 7) }),
  }),
  getRecentEmails: tool({
    description: "Get the user's recent Gmail inbox messages (subject, sender, snippet).",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ limit }) => ({ emails: await getRecentEmails(limit ?? 10) }),
  }),
  createCalendarEvent: tool({
    description: "Create a new event on the user's primary Google Calendar.",
    inputSchema: z.object({
      summary: z.string().describe("Event title."),
      description: z.string().optional(),
      startISO: z.string().describe("Start time as an ISO 8601 datetime."),
      endISO: z.string().describe("End time as an ISO 8601 datetime."),
      location: z.string().optional(),
    }),
    execute: async ({ summary, description, startISO, endISO, location }) => {
      const result = await createCalendarEvent(summary, startISO, endISO, description, location)
      // Give the event its own future reminder immediately at creation time, so
      // it doesn't have to wait for the next catch-up sweep to be pre-enqueued.
      // Same dedupe scheme, so the sweep never double-enqueues it. Best-effort:
      // a notification failure must not fail the event the user just created.
      try {
        enqueueCalendarEventNotification({ id: result.id, title: summary, start: startISO })
      } catch (error) {
        console.error("[google] failed to enqueue calendar notification", error)
      }
      return { created: true, ...result }
    },
  }),
  sendGmail: tool({
    description:
      "Send an email from the user's Gmail account. Visible to other people and hard to undo, so this requires explicit confirmation: call with confirmed:false first to preview the exact to/subject/body, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      to: z.string().describe("Recipient email address."),
      subject: z.string(),
      body: z.string(),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the exact content in this turn or a prior turn of this conversation. If the user has not confirmed, call this tool with confirmed:false first to show them exactly what would be sent/posted, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ to, subject, body, confirmed }) => {
      if (!confirmed) {
        return { sent: false, preview: { to, subject, body }, requiresConfirmation: true }
      }
      const result = await sendGmailMessage(to, subject, body)
      return { sent: true, ...result }
    },
  }),
  replyToEmail: tool({
    description:
      "Reply within an existing Gmail thread to a specific message (by id, as returned by searchGmail/getRecentEmails/readEmail) — unlike sendGmail, which always starts a brand-new, unthreaded email, this keeps the reply in the same conversation thread (sets threadId + In-Reply-To/References so it shows up as a genuine reply in Gmail and in the recipient's mail client). Visible to other people and hard to undo, so this requires explicit confirmation: call with confirmed:false first to preview the exact recipient/subject/body, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      id: z.string().describe("The id of the message being replied to."),
      body: z.string().describe("The reply body (plain text)."),
      to: z
        .string()
        .optional()
        .describe("Override the recipient. Defaults to the original message's From address if omitted."),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the exact content in this turn or a prior turn of this conversation. If the user has not confirmed, call this tool with confirmed:false first to show them exactly what would be sent, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ id, body, to, confirmed }) => {
      if (!confirmed) {
        return { sent: false, preview: { replyingTo: id, to, body }, requiresConfirmation: true }
      }
      const result = await replyToEmailMessage(id, body, to)
      return { sent: true, ...result }
    },
  }),
  searchGmail: tool({
    description:
      "Search the user's Gmail using Gmail's own search syntax (from:, to:, subject:, after:YYYY/MM/DD, before:YYYY/MM/DD, has:attachment, is:unread, label:, in:inbox, etc — the same operators as the Gmail search box). Use this instead of getRecentEmails whenever you need to find a SPECIFIC email rather than just the latest inbox messages. Returns metadata only (subject/from/snippet/date/id) — call readEmail with a result's id to get the full body.",
    inputSchema: z.object({
      query: z.string().describe("Gmail search query, e.g. 'from:boss@company.com subject:meeting after:2026/07/01'."),
      limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
    }),
    execute: async ({ query, limit }) => ({ emails: await searchGmail(query, limit ?? 10) }),
  }),
  readEmail: tool({
    description:
      "Fetch the full plain-text body of one email by its id (as returned by searchGmail or getRecentEmails). Use this after search to actually read what's in a message — search/list tools only return a short snippet, not the full content.",
    inputSchema: z.object({
      id: z.string().describe("The Gmail message id."),
    }),
    execute: async ({ id }) => await readEmail(id),
  }),
  updateCalendarEvent: tool({
    description:
      "Update fields (title/time/location/description) of an EXISTING Google Calendar event by its id. Only the fields you pass are changed; omitted fields are left as-is. Changes an event the user may already be relying on, so this requires explicit confirmation: call with confirmed:false first to preview exactly what would change, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      eventId: z.string().describe("The Google Calendar event id to update."),
      summary: z.string().optional().describe("New event title."),
      description: z.string().optional(),
      location: z.string().optional(),
      startISO: z.string().optional().describe("New start time as an ISO 8601 datetime."),
      endISO: z.string().optional().describe("New end time as an ISO 8601 datetime."),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the exact change in this turn or a prior turn. If the user has not confirmed, call this tool with confirmed:false first to show them exactly what would change, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ eventId, summary, description, location, startISO, endISO, confirmed }) => {
      const updates: CalendarEventUpdate = { summary, description, location, startISO, endISO }
      if (!confirmed) {
        return { updated: false, preview: { eventId, changes: updates }, requiresConfirmation: true }
      }
      const result = await updateCalendarEvent(eventId, updates)
      return { updated: true, ...result }
    },
  }),
  deleteCalendarEvent: tool({
    description:
      "Delete an event from the user's primary Google Calendar by its id. Destructive and hard to undo, so this requires explicit confirmation: call with confirmed:false first to preview which event would be deleted, show it to the user, and only call again with confirmed:true after they explicitly approve it in this turn or a prior turn.",
    inputSchema: z.object({
      eventId: z.string().describe("The Google Calendar event id to delete."),
      confirmed: z
        .boolean()
        .describe(
          "Set true ONLY after the user has explicitly approved the deletion in this turn or a prior turn. If the user has not confirmed, call this tool with confirmed:false first to show them which event would be deleted, and wait for their explicit yes before calling again with confirmed:true.",
        ),
    }),
    execute: async ({ eventId, confirmed }) => {
      if (!confirmed) {
        return { deleted: false, preview: { eventId }, requiresConfirmation: true }
      }
      const result = await deleteCalendarEvent(eventId)
      return { deleted: true, ...result }
    },
  }),
  searchCalendarEvents: tool({
    description:
      "Search the user's Google Calendar with free-text matching against event title/description/location/attendees (Calendar's own search), within a time window. Use this instead of getCalendarEvents when you need to find a SPECIFIC event rather than just list what's upcoming.",
    inputSchema: z.object({
      query: z.string().describe("Free-text search term, e.g. 'dentist' or 'quarterly review'."),
      days: z.number().int().min(1).max(365).optional().describe("How many days ahead to search within (default 30)."),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ query, days, limit }) => ({ events: await searchCalendarEvents(query, days ?? 30, limit ?? 20) }),
  }),
}
