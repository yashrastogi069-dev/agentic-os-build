import { NextResponse } from "next/server"
import { transcribeWav, VoiceUnavailableError } from "@/lib/voice/stt"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * POST /api/voice/transcribe — body: audio/wav (16kHz mono PCM, encoded
 * client-side). Chain: managed faster-whisper sidecar -> whisper-cli
 * fallback -> honest 503. Returns { text, engine, decodeMs, audioMs, rtf }.
 */
export async function POST(request: Request) {
  const audio = Buffer.from(await request.arrayBuffer())
  if (audio.length < 44) {
    return NextResponse.json({ error: "empty audio" }, { status: 400 })
  }

  try {
    const result = await transcribeWav(audio)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof VoiceUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "transcription failed" },
      { status: 500 },
    )
  }
}
