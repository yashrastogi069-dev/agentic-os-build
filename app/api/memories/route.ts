import { NextResponse } from "next/server"
import { saveMemory, recallMemory, listMemories, deleteMemory } from "@/lib/memory"
import { SEED_MEMORIES } from "@/lib/seed-data"

export const dynamic = "force-dynamic"

/**
 * GET /api/memories?q=...&category=...&limit=... — recall (q) or list.
 * Falls back to clearly-labeled seed data (seeded: true) when the DB or
 * Ollama embeddings are unreachable, or the memory bank is empty.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")
  const category = searchParams.get("category") ?? undefined
  const limit = Number(searchParams.get("limit") ?? 20)

  try {
    if (q) {
      const results = await recallMemory(q, { limit, category })
      return NextResponse.json({ memories: results, seeded: false })
    }
    const memories = listMemories(limit, category)
    if (memories.length === 0) {
      return NextResponse.json({ memories: SEED_MEMORIES, seeded: true })
    }
    return NextResponse.json({ memories, seeded: false })
  } catch {
    return NextResponse.json({ memories: SEED_MEMORIES, seeded: true })
  }
}

/** POST /api/memories — { content, category?, source? } */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    content?: string
    category?: string
    source?: string
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 })
  }
  const result = await saveMemory(body.content, {
    category: body.category,
    source: body.source,
  })
  return NextResponse.json(result, { status: 201 })
}

/** DELETE /api/memories?id=123 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = Number(searchParams.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "valid id is required" }, { status: 400 })
  }
  deleteMemory(id)
  return NextResponse.json({ ok: true })
}
