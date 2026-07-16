import { NextResponse } from "next/server"
import { getSession, getMessages } from "@/lib/sessions"

export const dynamic = "force-dynamic"

/** GET /api/sessions/[id] — session detail + its messages. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  return NextResponse.json({ session, messages: getMessages(sessionId) })
}
