import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { writeFile, unlink, mkdtemp, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WHISPER_BIN, WHISPER_MODEL } from "@/lib/voice/paths"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * POST /api/voice/transcribe — body: audio/wav (16kHz mono PCM, encoded client-side).
 * Runs whisper.cpp locally (tiny.en). Returns { text }.
 */
export async function POST(request: Request) {
  if (!existsSync(WHISPER_BIN) || !existsSync(WHISPER_MODEL)) {
    return NextResponse.json(
      {
        error:
          "whisper.cpp is not installed. Run scripts/setup-voice.sh to download the binary and tiny.en model.",
      },
      { status: 503 },
    )
  }

  const audio = Buffer.from(await request.arrayBuffer())
  if (audio.length < 44) {
    return NextResponse.json({ error: "empty audio" }, { status: 400 })
  }

  const dir = await mkdtemp(path.join(tmpdir(), "agentic-os-stt-"))
  const wavPath = path.join(dir, "input.wav")
  const outBase = path.join(dir, "out")

  try {
    await writeFile(wavPath, audio)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(WHISPER_BIN, [
        "-m", WHISPER_MODEL,
        "-f", wavPath,
        "-otxt",
        "-of", outBase,
        "--no-prints",
        "-t", "2",
      ])
      let stderr = ""
      proc.stderr.on("data", (d) => (stderr += d))
      proc.on("error", reject)
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`whisper exited ${code}: ${stderr.slice(-400)}`)),
      )
    })

    const text = (await readFile(`${outBase}.txt`, "utf8")).trim()
    return NextResponse.json({ text })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "transcription failed" },
      { status: 500 },
    )
  } finally {
    await Promise.allSettled([unlink(wavPath), unlink(`${outBase}.txt`)])
  }
}
