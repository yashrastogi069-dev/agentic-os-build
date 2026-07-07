import { NextResponse } from "next/server"
import { getRecentEvents } from "@/lib/events"
import { syncGithubToFeed } from "@/lib/connectors/github"
import { syncObsidianToFeed } from "@/lib/connectors/obsidian"
import { syncTelegramToFeed, getTelegramSettings } from "@/lib/connectors/telegram"
import { syncGoogleToFeed, isGoogleConnected } from "@/lib/connectors/google"
import { syncAppleToFeed, getAppleSettings } from "@/lib/connectors/apple"
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

/** POST /api/feed — trigger connector syncs. { sources?: ("github"|"obsidian")[] } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sources?: string[]
  }
  const sources = body.sources ?? ["github", "obsidian", "telegram", "google", "apple"]
  const results: Record<string, { added?: number; error?: string; skipped?: boolean }> = {}

  if (sources.includes("github")) {
    try {
      results.github = await syncGithubToFeed()
    } catch (error) {
      results.github = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }
  if (sources.includes("obsidian")) {
    try {
      results.obsidian = await syncObsidianToFeed()
    } catch (error) {
      results.obsidian = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }
  if (sources.includes("telegram")) {
    try {
      results.telegram = getTelegramSettings()?.botToken
        ? await syncTelegramToFeed()
        : { skipped: true }
    } catch (error) {
      results.telegram = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }
  if (sources.includes("google")) {
    try {
      results.google = isGoogleConnected() ? await syncGoogleToFeed() : { skipped: true }
    } catch (error) {
      results.google = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }
  if (sources.includes("apple")) {
    try {
      const apple = getAppleSettings()
      results.apple =
        apple?.appleId && apple?.appPassword ? await syncAppleToFeed() : { skipped: true }
    } catch (error) {
      results.apple = { error: error instanceof Error ? error.message : "sync failed" }
    }
  }

  return NextResponse.json({ results })
}
