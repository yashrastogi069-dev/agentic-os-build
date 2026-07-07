import { NextResponse } from "next/server"
import { getRecentEvents } from "@/lib/events"
import { syncGithubToFeed } from "@/lib/connectors/github"
import { syncObsidianToFeed } from "@/lib/connectors/obsidian"

export const dynamic = "force-dynamic"

/** GET /api/feed — recent unified events, mapped for the dashboard. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const source = searchParams.get("source") ?? undefined
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
  return NextResponse.json({ events })
}

/** POST /api/feed — trigger connector syncs. { sources?: ("github"|"obsidian")[] } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sources?: string[]
  }
  const sources = body.sources ?? ["github", "obsidian"]
  const results: Record<string, { added?: number; error?: string }> = {}

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

  return NextResponse.json({ results })
}
