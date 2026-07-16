import { NextResponse } from "next/server"
import { ttsStatus } from "@/lib/voice/piper"
import { sttStatus } from "@/lib/voice/stt"

export const dynamic = "force-dynamic"

/**
 * GET /api/voice/status — probes both STT and TTS chains without throwing.
 * Backs the voice UI's "is voice ready" indicator.
 */
export async function GET() {
  try {
    const [stt, tts] = await Promise.all([sttStatus(), ttsStatus()])
    return NextResponse.json({ stt, tts, ready: stt.ok && tts.ok })
  } catch (error) {
    return NextResponse.json({
      stt: { ok: false, engine: null, sidecar: { up: false }, fallbackAvailable: false },
      tts: { ok: false, daemonUp: false, binPresent: false, voicePresent: false },
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
