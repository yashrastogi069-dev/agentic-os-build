import { NextResponse } from "next/server"
import { buildGoogleAuthUrl } from "@/lib/connectors/google"

export const dynamic = "force-dynamic"

/** GET /api/google/auth — redirect to Google's consent screen. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  try {
    const url = buildGoogleAuthUrl(`${origin}/api/google/callback`)
    return NextResponse.redirect(url)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google auth failed" },
      { status: 400 },
    )
  }
}
