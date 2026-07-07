import { tool } from "ai"
import { z } from "zod"
import { addEvent } from "@/lib/events"
import { getConnectorConfig, setConnectorConfig } from "@/lib/settings"

/**
 * Google Calendar + Gmail connector — user's own OAuth credentials, free.
 * Local-first OAuth: user creates a "Web application" OAuth client in Google
 * Cloud Console with redirect URI http://localhost:3000/api/google/callback,
 * pastes client id/secret in Settings, clicks connect. The refresh token is
 * stored in connector_settings — tokens never leave the machine.
 *
 * Read-only scopes only: calendar.readonly + gmail.readonly.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ")

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
  return Boolean(getGoogleSettings()?.refreshToken)
}

export function buildGoogleAuthUrl(redirectUri: string): string {
  const settings = getGoogleSettings()
  if (!settings) throw new Error("Google client id/secret not configured in Settings.")
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // always return a refresh token
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<void> {
  const settings = getGoogleSettings()
  if (!settings) throw new Error("Google client id/secret not configured.")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error_description?: string
  }
  if (!res.ok || !json.refresh_token) {
    throw new Error(`Google token exchange failed: ${json.error_description ?? res.status}`)
  }
  setConnectorConfig("google", {
    ...settings,
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  })
}

async function getAccessToken(): Promise<string> {
  const settings = getGoogleSettings()
  if (!settings?.refreshToken) {
    throw new Error("Google is not connected. Complete the OAuth flow in Settings.")
  }
  if (settings.accessToken && (settings.accessTokenExpiresAt ?? 0) > Date.now()) {
    return settings.accessToken
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: settings.refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: "refresh_token",
    }),
  })
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!res.ok || !json.access_token) throw new Error("Google token refresh failed — reconnect in Settings.")
  setConnectorConfig("google", {
    ...settings,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  })
  return json.access_token
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
}
