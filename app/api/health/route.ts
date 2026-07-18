import path from "node:path"
import { NextResponse } from "next/server"
import { getRawDb, isVecAvailable } from "@/lib/db"
import { ollamaIsUp, ollamaModels, EMBEDDING_MODEL, OLLAMA_CHAT_MODEL } from "@/lib/ollama"
import { getChatSettings, getMcpKey } from "@/lib/settings"
import { getActiveProviderId, getProviderStatus } from "@/lib/providers"
import { CONNECTORS, type ProbeResult } from "@/lib/connectors/registry"
import { memoryStats } from "@/lib/memory"
import { WHISPER_BIN } from "@/lib/voice/paths"
import { sweepTriggers } from "@/lib/assist/sweep"

export const dynamic = "force-dynamic"

/**
 * Honest service health for the status bar. Every probe is short-timeout and
 * failure-tolerant — offline services report "offline", never crash the OS.
 *
 * Chunk 5A-3: connector probing now flows through the single registry
 * (lib/connectors/registry.ts) instead of five copy-pasted inline checks.
 * Each connector's `probe()` is called with its default arguments, which
 * preserves the exact live/config-only behavior this route had before the
 * refactor (obsidian's default probe is a live fetch, matching the old
 * inline `probeObsidian`; every other connector's default probe is a cheap
 * config-only check, matching what this route already did). The legacy
 * top-level fields (`github`, `telegram`, `google`, `apple`, `obsidian`,
 * `voice`) are now derived from the same probe results so there is one
 * source of truth, but their shape and values are unchanged for clients.
 */
export async function GET() {
  const [ollamaUp, models, connectorResults] = await Promise.all([
    ollamaIsUp(),
    ollamaModels(),
    Promise.all(CONNECTORS.map(async (c) => [c.id, await c.probe()] as const)),
  ])

  const probes = Object.fromEntries(connectorResults) as Record<string, ProbeResult>

  // Reactive catch-up sweep (Phase 7 Chunk 4): the status bar already polls this
  // route whenever a tab is open, so it doubles as the browser's session-start
  // signal. Pass the probe results we just computed so connector-down detection
  // reuses them instead of adding any new health check. sweepTriggers never
  // throws (internal try/catch); on the common path (rate-gated, digest done)
  // it does no network work and just reads/writes local state.
  await sweepTriggers({ probes })

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

  const connectors: Record<string, { label: string; status: string; reason?: string; detail?: ProbeResult["detail"] }> =
    Object.fromEntries(
      CONNECTORS.map((c) => {
        const result = probes[c.id]
        return [
          c.id,
          {
            label: c.label,
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.detail ? { detail: result.detail } : {}),
          },
        ]
      }),
    )

  const obsidianDetail = probes.obsidian?.detail ?? {}
  const githubDetail = probes.github?.detail ?? {}
  const telegramDetail = probes.telegram?.detail ?? {}
  const googleDetail = probes.google?.detail ?? {}
  const appleDetail = probes.apple?.detail ?? {}
  const voiceDetail = probes.voice?.detail ?? {}

  return NextResponse.json({
    time: new Date().toISOString(),
    db: { ok: dbOk, vec: dbOk && isVecAvailable(), memories: stats },
    ollama: {
      ok: ollamaUp,
      embeddingModel: { name: EMBEDDING_MODEL, pulled: embedModelPulled },
      chatModel: { name: OLLAMA_CHAT_MODEL, pulled: chatModelPulled },
    },
    groq: { configured: Boolean(process.env.GROQ_API_KEY) },
    github: { configured: Boolean(githubDetail.configured) },
    obsidian: { configured: Boolean(obsidianDetail.configured), ok: Boolean(obsidianDetail.ok) },
    telegram: { configured: Boolean(telegramDetail.configured) },
    google: {
      credentials: Boolean(googleDetail.credentials),
      connected: Boolean(googleDetail.connected),
    },
    apple: {
      configured: Boolean(appleDetail.configured),
    },
    voice: {
      whisper: Boolean(voiceDetail.whisper),
      piper: Boolean(voiceDetail.piper),
      binDir: path.relative(process.cwd(), path.dirname(WHISPER_BIN)),
    },
    connectors,
    chat: getChatSettings(),
    // Provider failsafe chain: which brain answers now + per-provider status.
    brain: {
      active: getActiveProviderId(),
      chain: getProviderStatus().map((p) => ({
        id: p.id,
        label: p.label,
        status: p.status,
      })),
    },
    mcp: { keySet: Boolean(getMcpKey()) },
  })
}
