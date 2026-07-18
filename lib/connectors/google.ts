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

/* ---------- Calendar ---------- */

export async function getUpcomingEvents(days = 7, limit = 20) {
  const now = new Date()
  const max = new Date(now.getTime() + days * 86_400_000)
  const data = await gFetch<{
    items?: Array<{
      id: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      location?: string
      htmlLink?: string
    }>
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: max.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(limit),
      }),
  )
  return (data.items ?? []).map((e) => ({
    id: e.id,
    title: e.summary ?? "(untitled)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location,
    url: e.htmlLink,
  }))
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

/* ---------- Gmail ---------- */

export async function getRecentEmails(limit = 15) {
  const list = await gFetch<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=in:inbox`,
  )
  const messages = list.messages ?? []
  const details = await Promise.all(
    messages.map((m) =>
      gFetch<{
        id: string
        snippet: string
        internalDate: string
        payload?: { headers?: Array<{ name: string; value: string }> }
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
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

/** Base64url-encode (no padding, - and _) per the Gmail API's `raw` message spec. */
function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export async function sendGmailMessage(to: string, subject: string, body: string): Promise<{ id: string }> {
  const message = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`
  const raw = base64UrlEncode(message)
  const data = await gPost<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { raw })
  return { id: data.id }
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
}
