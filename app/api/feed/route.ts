import { NextResponse } from "next/server"
import { getRecentEvents } from "@/lib/events"
import { CONNECTORS, getConnector } from "@/lib/connectors/registry"
import { SEED_EVENTS } from "@/lib/seed-data"

export const dynamic = "force-dynamic"

/**
 * GET /api/feed — recent unified events, mapped for the dashboard.
 * Falls back to clearly-labeled seed data (seeded: true) when the local DB
 * is unreachable or no connector has ever written an event.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const source = searchParams.get("source") ?? undefined
  try {
    const events = getRecentEvents(50, source).map((event) => {
      const payload = event.payload ?? {}
      return {
        id: event.id,
        source: event.source,
        type: typeof payload.kind === "string" ? payload.kind : "event",
        title: event.title,
        url: typeof payload.url === "string" ? payload.url : null,
        occurredAt: new Date(event.createdAt).toISOString(),
      }
    })
    if (events.length === 0) {
      return NextResponse.json({ events: SEED_EVENTS, seeded: true })
    }
    return NextResponse.json({ events, seeded: false })
  } catch {
    return NextResponse.json({ events: SEED_EVENTS, seeded: true })
  }
}

/**
 * POST /api/feed — trigger connector syncs. { sources?: string[] }
 *
 * Chunk 5A-4: replaces five copy-pasted sync blocks with one loop over the
 * registry. Per id: no `sync` on the connector -> omitted from results; a
 * config-only probe (`live: false`, so this never calls Telegram's getMe or
 * any other live network check — it only reads local config/tokens) that
 * reports `status: "off"` -> `{ skipped: true }` without calling sync; else
 * try/catch the sync into `results[id]`, so one connector's failure can
 * never 500 the whole route.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sources?: string[]
  }
  const sources = body.sources ?? CONNECTORS.filter((c) => c.sync).map((c) => c.id)
  const results: Record<string, { added?: number; error?: string; skipped?: boolean }> = {}

  for (const id of sources) {
    const connector = getConnector(id)
    if (!connector?.sync) continue

    const probeResult = await connector.probe({ live: false })
    if (probeResult.status === "off") {
      results[id] = { skipped: true }
      continue
    }

    try {
      results[id] = await connector.sync()
    } catch (error) {
      results[id] = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }

  return NextResponse.json({ results })
}
