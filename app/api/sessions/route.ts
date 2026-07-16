import { NextResponse } from "next/server"
import { listSessions } from "@/lib/sessions"

export const dynamic = "force-dynamic"

/** GET /api/sessions — most recent chat sessions first. */
export async function GET() {
  try {
    return NextResponse.json({ sessions: listSessions() })
  } catch (error) {
    console.error("[sessions] list failed:", error)
    return NextResponse.json({ error: "Failed to list sessions." }, { status: 500 })
  }
}
