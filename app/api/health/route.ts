import fs from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { getRawDb, isVecAvailable } from "@/lib/db"
import { ollamaIsUp, ollamaModels, EMBEDDING_MODEL, OLLAMA_CHAT_MODEL } from "@/lib/ollama"
import { getObsidianSettings, getChatSettings, getMcpKey } from "@/lib/settings"
import { memoryStats } from "@/lib/memory"
import { WHISPER_BIN, WHISPER_MODEL, PIPER_BIN, PIPER_VOICE } from "@/lib/voice/paths"

export const dynamic = "force-dynamic"

/**
 * Honest service health for the status bar. Every probe is short-timeout and
 * failure-tolerant — offline services report "offline", never crash the OS.
 */
export async function GET() {
  const [ollamaUp, models, obsidian] = await Promise.all([
    ollamaIsUp(),
    ollamaModels(),
    probeObsidian(),
  ])

  let dbOk = false
  let stats = { total: 0, byCategory: {} as Record<string, number> }
  try {
    getRawDb()
    dbOk = true
    stats = memoryStats()
  } catch {
    dbOk = false
  }

  const embedModelPulled = models.some((m) => m.startsWith(EMBEDDING_MODEL))
  const chatModelPulled = models.some((m) => m.startsWith(OLLAMA_CHAT_MODEL.split(":")[0]))

  return NextResponse.json({
    time: new Date().toISOString(),
    db: { ok: dbOk, vec: dbOk && isVecAvailable(), memories: stats },
    ollama: {
      ok: ollamaUp,
      embeddingModel: { name: EMBEDDING_MODEL, pulled: embedModelPulled },
      chatModel: { name: OLLAMA_CHAT_MODEL, pulled: chatModelPulled },
    },
    groq: { configured: Boolean(process.env.GROQ_API_KEY) },
    github: { configured: Boolean(process.env.GITHUB_TOKEN) },
    obsidian,
    voice: {
      whisper: fs.existsSync(WHISPER_BIN) && fs.existsSync(WHISPER_MODEL),
      piper: fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_VOICE),
      binDir: path.relative(process.cwd(), path.dirname(WHISPER_BIN)),
    },
    chat: getChatSettings(),
    mcp: { keySet: Boolean(getMcpKey()) },
  })
}

async function probeObsidian(): Promise<{ configured: boolean; ok: boolean }> {
  const settings = getObsidianSettings()
  if (!settings) return { configured: false, ok: false }
  try {
    const res = await fetch(`${settings.baseUrl}/`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(1500),
    })
    return { configured: true, ok: res.ok }
  } catch {
    return { configured: true, ok: false }
  }
}
