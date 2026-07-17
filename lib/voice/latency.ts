import { desc } from "drizzle-orm"
import { getDb, schema } from "@/lib/db"

/** Sanity cap — a turn's total latency should never legitimately exceed this; guards against a corrupt client clock producing a garbage row. */
const MAX_STAGE_MS = 5 * 60 * 1000

export interface VoiceLatencyInput {
  turnAt: number
  vadMs: number
  sttMs: number
  brainFirstSentenceMs: number
  ttsFirstChunkMs: number
  totalMs: number
}

function isValidStage(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_STAGE_MS
}

/** Validates and persists one voice turn's per-stage latency. Throws on a malformed payload; the caller (API route) turns that into a 400. */
export function recordVoiceLatency(input: VoiceLatencyInput): void {
  if (!Number.isFinite(input.turnAt) || input.turnAt <= 0) {
    throw new Error("turnAt must be a positive epoch-ms timestamp")
  }
  for (const key of ["vadMs", "sttMs", "brainFirstSentenceMs", "ttsFirstChunkMs", "totalMs"] as const) {
    if (!isValidStage(input[key])) {
      throw new Error(`${key} must be a finite non-negative number <= ${MAX_STAGE_MS}ms`)
    }
  }

  getDb()
    .insert(schema.voiceLatency)
    .values({
      turnAt: new Date(input.turnAt),
      vadMs: Math.round(input.vadMs),
      sttMs: Math.round(input.sttMs),
      brainFirstSentenceMs: Math.round(input.brainFirstSentenceMs),
      ttsFirstChunkMs: Math.round(input.ttsFirstChunkMs),
      totalMs: Math.round(input.totalMs),
    })
    .run()
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

export interface VoiceLatencySummary {
  count: number
  p50TotalMs: number
  p90TotalMs: number
  p50SttMs: number
  p50BrainFirstSentenceMs: number
  p50TtsFirstChunkMs: number
  lastTurnAt: number | null
  recent: {
    turnAt: number
    vadMs: number
    sttMs: number
    brainFirstSentenceMs: number
    ttsFirstChunkMs: number
    totalMs: number
  }[]
}

/** Reads the last `limit` turns and computes p50/p90 over them — the "queryable, not vanishing" surface for tasks/PHASE6_BENCH.md's §5.4 budget. */
export function getVoiceLatencySummary(limit = 50): VoiceLatencySummary {
  const rows = getDb()
    .select()
    .from(schema.voiceLatency)
    .orderBy(desc(schema.voiceLatency.id))
    .limit(limit)
    .all()

  const totals = rows.map((r) => r.totalMs).sort((a, b) => a - b)
  const stts = rows.map((r) => r.sttMs).sort((a, b) => a - b)
  const brains = rows.map((r) => r.brainFirstSentenceMs).sort((a, b) => a - b)
  const ttses = rows.map((r) => r.ttsFirstChunkMs).sort((a, b) => a - b)

  return {
    count: rows.length,
    p50TotalMs: percentile(totals, 50),
    p90TotalMs: percentile(totals, 90),
    p50SttMs: percentile(stts, 50),
    p50BrainFirstSentenceMs: percentile(brains, 50),
    p50TtsFirstChunkMs: percentile(ttses, 50),
    lastTurnAt: rows[0]?.turnAt.getTime() ?? null,
    recent: rows.slice(0, 20).map((r) => ({
      turnAt: r.turnAt.getTime(),
      vadMs: r.vadMs,
      sttMs: r.sttMs,
      brainFirstSentenceMs: r.brainFirstSentenceMs,
      ttsFirstChunkMs: r.ttsFirstChunkMs,
      totalMs: r.totalMs,
    })),
  }
}
