import { NextResponse } from "next/server"
import { z } from "zod"
import {
  listWakeWords,
  getWakeListeningEnabled,
  setWakeListeningEnabled,
} from "@/lib/wake-words"

export const dynamic = "force-dynamic"

/**
 * Wake-word registry access for the CLIENT listener
 * (components/voice/wake-word-listener.tsx), which cannot import the
 * server-only lib/wake-words module (it touches the DB). The listener reads
 * the entry list + the enabled flag here and runs the pure matcher
 * (lib/wake-words-match.ts) in the browser. Add/remove of entries goes
 * through the agent tools, not this route.
 */

export async function GET() {
  try {
    return NextResponse.json({
      entries: listWakeWords(),
      listeningEnabled: getWakeListeningEnabled(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to load wake words" },
      { status: 500 },
    )
  }
}

const postSchema = z.object({
  action: z.literal("set-listening"),
  enabled: z.boolean(),
})

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { action: 'set-listening', enabled: boolean }." }, { status: 400 })
  }
  try {
    setWakeListeningEnabled(parsed.data.enabled)
    return NextResponse.json({ ok: true, listeningEnabled: parsed.data.enabled })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to update wake listening" },
      { status: 500 },
    )
  }
}
