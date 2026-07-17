import { NextResponse } from "next/server"
import { exchangeGoogleCode } from "@/lib/connectors/google"

export const dynamic = "force-dynamic"

/**
 * GET /api/google/callback — OAuth redirect target; stores the refresh token.
 *
 * Passes the full URLSearchParams (code, state, error) into exchangeGoogleCode,
 * which validates `state` against the single-use value persisted by
 * buildGoogleAuthUrl before ever exchanging the code. This closes a real CSRF
 * hole: the old version read only code/error and never checked state, so a
 * malicious page could load this URL with an attacker's own code and get
 * Jarvis to store the attacker's refresh token.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    await exchangeGoogleCode(url.searchParams, `${url.origin}/api/google/callback`)
    return NextResponse.redirect(`${url.origin}/?google=connected`)
  } catch (error) {
    // Do not swallow: log the reason (never a secret value) so a broken
    // connect flow is diagnosable instead of a silent redirect.
    console.error("[google:callback] OAuth exchange failed:", error instanceof Error ? error.message : error)
    return NextResponse.redirect(`${url.origin}/?google=error`)
  }
}
