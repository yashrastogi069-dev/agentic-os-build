import { NextResponse } from "next/server"
import { z } from "zod"
import { synthesize } from "@/lib/voice/piper"
import { VoiceUnavailableError } from "@/lib/voice/stt"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const bodySchema = z.object({
  text: z.string().trim().min(1, "text is required").max(4000, "text is too long (4000 char cap)"),
})

/**
 * POST /api/voice/speak — { text } -> audio/wav via the persistent Piper
 * daemon (lib/voice/piper.ts).
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
    const { wav, synthMs } = await synthesize(parsed.data.text)
    return new Response(new Uint8Array(wav), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Synth-Ms": String(synthMs),
      },
    })
  } catch (error) {
    if (error instanceof VoiceUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "speech synthesis failed" },
      { status: 500 },
    )
  }
}
