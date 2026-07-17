import { NextResponse } from "next/server"
import { z } from "zod"
import { recordVoiceLatency, getVoiceLatencySummary } from "@/lib/voice/latency"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  turnAt: z.number().positive(),
  vadMs: z.number().min(0),
  sttMs: z.number().min(0),
  brainFirstSentenceMs: z.number().min(0),
  ttsFirstChunkMs: z.number().min(0),
  totalMs: z.number().min(0),
})

/**
 * GET /api/voice/latency — last N voice turns' per-stage latency + p50/p90,
 * for the Settings panel's "voice latency" section and future manual review
 * (tasks/PHASE6_BENCH.md §5.4 budget check).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50
  try {
    return NextResponse.json(getVoiceLatencySummary(limit))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to read voice latency" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/voice/latency — one row per completed voice turn. Fire-and-forget
 * from components/voice/voice-controller.tsx right after first TTS playback
 * starts; never on the hot path (no synchronous round trip blocks audio).
 * Malformed/failed writes are logged server-side only — this endpoint is
 * observability, never allowed to disrupt the voice pipeline.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 })
  }

  try {
    recordVoiceLatency(parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[voice/latency] failed to persist turn:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to persist latency" },
      { status: 500 },
    )
  }
}
