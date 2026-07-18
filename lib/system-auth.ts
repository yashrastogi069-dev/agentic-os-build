import { verifySystemToken } from "@/lib/settings"

/**
 * Auth + rate-limit guard for the local companion API surface
 * (app/api/system/*). There is exactly ONE caller on this machine (the local
 * dictate/companion process), so everything here is global — not keyed by IP
 * or by route.
 *
 * Security note on the rate limiter: its purpose is to stop a runaway retry
 * loop in the companion from hammering the AI providers, NOT to resist a
 * determined attacker. A 128-bit token isn't brute-forceable regardless, so a
 * simple fixed-window counter is enough. The window state lives in module
 * memory and therefore RESETS on server restart / HMR — an accepted tradeoff,
 * the same one the provider cooldowns in lib/providers.ts already make.
 */

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 120

let windowStart = Date.now()
let windowCount = 0

/** Single in-flight /command turn guard (one boolean, not a queue). */
let commandBusy = false

export function isCommandBusy(): boolean {
  return commandBusy
}

export function setCommandBusy(busy: boolean): void {
  commandBusy = busy
}

function unauthorized(): Response {
  // Uniform body whether the header is missing, malformed, or wrong — never
  // reveal which. The header/token is never logged anywhere in this module.
  return Response.json({ error: "unauthorized" }, { status: 401 })
}

/**
 * Returns a Response to short-circuit with (401/429), or null when the request
 * is authorized and within the rate budget. The rate-limit check runs FIRST,
 * before token verification, so failed-auth attempts also consume the budget.
 */
export function requireSystemAuth(request: Request): Response | null {
  const now = Date.now()

  // Fixed-window counter. Reset the window when it has expired.
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now
    windowCount = 0
  }
  windowCount += 1
  if (windowCount > MAX_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000))
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    )
  }

  // Parse `Authorization: Bearer <token>` exactly as app/api/[transport] does.
  const auth = request.headers.get("authorization")
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : null
  if (!verifySystemToken(provided)) return unauthorized()

  return null
}
