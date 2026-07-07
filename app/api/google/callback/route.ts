import { NextResponse } from "next/server"
import { exchangeGoogleCode } from "@/lib/connectors/google"

export const dynamic = "force-dynamic"

/** GET /api/google/callback — OAuth redirect target; stores the refresh token. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const oauthError = url.searchParams.get("error")

  if (oauthError || !code) {
    return NextResponse.redirect(`${url.origin}/?google=error`)
  }
  try {
    await exchangeGoogleCode(code, `${url.origin}/api/google/callback`)
    return NextResponse.redirect(`${url.origin}/?google=connected`)
  } catch {
    return NextResponse.redirect(`${url.origin}/?google=error`)
  }
}
