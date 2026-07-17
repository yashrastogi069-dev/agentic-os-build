import crypto from "node:crypto"
import { getConnectorConfig, setConnectorConfig } from "@/lib/settings"

/**
 * Generic OAuth 2.0 authorization-code module, shared by every OAuth connector.
 *
 * It exists to close two real, previously-confirmed defects in the hand-rolled
 * Google flow it replaces:
 *
 *   1. CSRF on the callback. The old buildGoogleAuthUrl sent NO `state` param,
 *      and the callback route read only `code`/`error` — it never validated a
 *      `state` because there wasn't one. A malicious page could therefore load
 *      /api/google/callback?code=<attacker's code> and Jarvis would exchange it
 *      and store the ATTACKER's refresh token, silently rebinding the calendar
 *      and gmail tools (including the sendGmail write tool) to the attacker's
 *      account. buildAuthUrl now mints a cryptographically random single-use
 *      `state`, persists it server-side under the connector's settings key, and
 *      handleOAuthCallback refuses to exchange a code unless the returned state
 *      matches an unexpired pending value.
 *
 *   2. Refresh-token rotation loss. The old refresh path re-persisted the OLD
 *      refresh token unconditionally, so a rotated `refresh_token` in a refresh
 *      response was silently dropped and the connector eventually stranded.
 *      getAccessToken now persists `json.refresh_token ?? stored.refreshToken`.
 *
 * State is stored in connector_settings (NOT a cookie): this is a single-user
 * local-first app, so an unguessable single-use server-stored random value
 * defeats the CSRF attack without any cookie plumbing.
 */

export interface OAuthDescriptor {
  /** The connector_settings key, e.g. "google". */
  settingsKey: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  extraAuthParams?: Record<string, string>
  /** Google: false. Built so a future provider can opt into PKCE. */
  pkce?: boolean
  /** How client_id/secret reach tokenUrl. Google: "body". */
  clientAuth?: "body" | "basic"
}

export interface TokenSet {
  refreshToken?: string
  accessToken?: string
  /** Epoch ms at which the access token expires. */
  accessTokenExpiresAt?: number
}

interface PendingAuth {
  state: string
  codeVerifier?: string
  createdAt: number
}

interface OAuthConfig extends Record<string, unknown> {
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
  accessTokenExpiresAt?: number
  pendingAuth?: PendingAuth
}

/** Refresh this many ms before the stored expiry, to absorb clock skew / latency. */
const EXPIRY_SKEW_MS = 60_000
/** A pending authorization is only valid for 10 minutes. */
const PENDING_TTL_MS = 10 * 60_000

function readConfig(d: OAuthDescriptor): OAuthConfig {
  return getConnectorConfig<OAuthConfig>(d.settingsKey) ?? {}
}

function requireClient(d: OAuthDescriptor, config: OAuthConfig): { clientId: string; clientSecret: string } {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${d.settingsKey} client id/secret not configured in Settings.`)
  }
  return { clientId: config.clientId, clientSecret: config.clientSecret }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

/**
 * Applies the descriptor's clientAuth mode to a token request. "body" puts
 * client_id/client_secret in the form params; "basic" sends them as an HTTP
 * Basic Authorization header instead.
 */
function applyClientAuth(
  d: OAuthDescriptor,
  clientId: string,
  clientSecret: string,
  params: URLSearchParams,
  headers: Record<string, string>,
): void {
  if (d.clientAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    return
  }
  params.set("client_id", clientId)
  params.set("client_secret", clientSecret)
}

/**
 * Generates a random `state` (and, when pkce is enabled, a code_verifier +
 * S256 code_challenge), persists them as pendingAuth under the connector's
 * settings key, and returns the full authorize URL including `state`.
 */
export function buildAuthUrl(d: OAuthDescriptor, redirectUri: string): string {
  const config = readConfig(d)
  const { clientId } = requireClient(d, config)

  const state = base64Url(crypto.randomBytes(32))
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: d.scopes.join(" "),
    state,
  })
  for (const [key, value] of Object.entries(d.extraAuthParams ?? {})) {
    params.set(key, value)
  }

  let codeVerifier: string | undefined
  if (d.pkce) {
    // 32 random bytes -> 43-char base64url string, within RFC 7636's 43-128 range.
    codeVerifier = base64Url(crypto.randomBytes(32))
    const challenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest())
    params.set("code_challenge", challenge)
    params.set("code_challenge_method", "S256")
  }

  setConnectorConfig(d.settingsKey, {
    ...config,
    pendingAuth: { state, codeVerifier, createdAt: Date.now() },
  })

  return `${d.authorizeUrl}?${params}`
}

/**
 * Validates the callback's `state` against the stored single-use pendingAuth,
 * then exchanges the code for tokens and persists them. Throws WITHOUT calling
 * the token endpoint when state is missing, mismatched, or expired. Clears
 * pendingAuth BEFORE the exchange so a replayed callback URL is rejected on the
 * second attempt even if the first exchange is still in flight.
 */
export async function handleOAuthCallback(
  d: OAuthDescriptor,
  params: URLSearchParams,
  redirectUri: string,
): Promise<void> {
  const error = params.get("error")
  if (error) throw new Error(`${d.settingsKey} authorization failed: ${error}`)

  const code = params.get("code")
  const state = params.get("state")
  if (!code) throw new Error(`${d.settingsKey} authorization failed: missing code.`)

  const config = readConfig(d)
  const pending = config.pendingAuth
  if (!pending || !state || pending.state !== state || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    throw new Error(`${d.settingsKey} authorization failed: invalid or expired authorization state.`)
  }

  const { clientId, clientSecret } = requireClient(d, config)

  // Single-use: clear the pending state FIRST, before the network round trip,
  // so a replay of the same callback URL fails the state check next time.
  const { pendingAuth: _cleared, ...withoutPending } = config
  setConnectorConfig(d.settingsKey, withoutPending)

  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })
  if (pending.codeVerifier) body.set("code_verifier", pending.codeVerifier)
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" }
  applyClientAuth(d, clientId, clientSecret, body, headers)

  let json: { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
  try {
    const res = await fetch(d.tokenUrl, { method: "POST", headers, body })
    json = (await res.json()) as typeof json
    if (!res.ok || !json.refresh_token) {
      throw new Error(`token exchange failed: ${json.error_description ?? res.status}`)
    }
  } catch (err) {
    // Do not swallow: the old callback route hid exchange failures behind a
    // generic redirect. Log the reason (never a secret value) and rethrow.
    console.error(`[oauth:${d.settingsKey}] token exchange failed:`, err instanceof Error ? err.message : err)
    throw err
  }

  const tokens: TokenSet = {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
  setConnectorConfig(d.settingsKey, { ...withoutPending, ...tokens })
}

/**
 * Returns a still-valid cached access token, or refreshes it via the
 * refresh_token grant. Persists a rotated refresh_token when the provider
 * returns one (`json.refresh_token ?? stored.refreshToken`).
 */
export async function getAccessToken(d: OAuthDescriptor): Promise<string> {
  const config = readConfig(d)
  if (!config.refreshToken) {
    throw new Error(`${d.settingsKey} is not connected. Complete the OAuth flow in Settings.`)
  }
  if (config.accessToken && (config.accessTokenExpiresAt ?? 0) - EXPIRY_SKEW_MS > Date.now()) {
    return config.accessToken
  }

  const { clientId, clientSecret } = requireClient(d, config)
  const body = new URLSearchParams({
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  })
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" }
  applyClientAuth(d, clientId, clientSecret, body, headers)

  let json: { access_token?: string; refresh_token?: string; expires_in?: number }
  try {
    const res = await fetch(d.tokenUrl, { method: "POST", headers, body })
    json = (await res.json()) as typeof json
    if (!res.ok || !json.access_token) {
      throw new Error(`token refresh failed — reconnect ${d.settingsKey} in Settings.`)
    }
  } catch (err) {
    console.error(`[oauth:${d.settingsKey}] token refresh failed:`, err instanceof Error ? err.message : err)
    throw err
  }

  setConnectorConfig(d.settingsKey, {
    ...config,
    // Rotation fix: keep the new refresh token if the provider rotated it.
    refreshToken: json.refresh_token ?? config.refreshToken,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  })
  return json.access_token
}

/** Clears stored tokens and any pending authorization for this connector. */
export function disconnect(d: OAuthDescriptor): void {
  const config = readConfig(d)
  const {
    refreshToken: _r,
    accessToken: _a,
    accessTokenExpiresAt: _e,
    pendingAuth: _p,
    ...rest
  } = config
  setConnectorConfig(d.settingsKey, rest)
}

/** True when a refresh token is stored for this connector. */
export function isConnected(d: OAuthDescriptor): boolean {
  return Boolean(readConfig(d).refreshToken)
}
