import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { PIPER_BIN, PIPER_VOICE } from "@/lib/voice/paths"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * POST /api/voice/speak — { text } -> audio/wav via local Piper TTS.
 */
export async function POST(request: Request) {
  if (!existsSync(PIPER_BIN) || !existsSync(PIPER_VOICE)) {
    return NextResponse.json(
      {
        error:
          "Piper is not installed. Run scripts/setup-voice.sh to download the binary and voice model.",
      },
      { status: 503 },
    )
  }

  const { text } = (await request.json()) as { text?: string }
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 })
  }

  try {
    const wav = await new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(PIPER_BIN, [
        "--model", PIPER_VOICE,
        "--output_file", "-",
      ])
      const chunks: Buffer[] = []
      let stderr = ""
      proc.stdout.on("data", (d) => chunks.push(d))
      proc.stderr.on("data", (d) => (stderr += d))
      proc.on("error", reject)
      proc.on("close", (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks))
          : reject(new Error(`piper exited ${code}: ${stderr.slice(-400)}`)),
      )
      proc.stdin.write(text.trim())
      proc.stdin.end()
    })

    return new Response(new Uint8Array(wav), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "speech synthesis failed" },
      { status: 500 },
    )
  }
}
