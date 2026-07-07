import { NextResponse } from "next/server"
import { listVaultFiles, readNote, searchNotes } from "@/lib/connectors/obsidian"

export const dynamic = "force-dynamic"

/**
 * GET /api/obsidian/notes
 *   ?dir=Projects        — list files/folders in a vault directory (default: root)
 *   ?path=Projects/x.md  — read a single note's markdown
 *   ?q=search+terms      — full-text search across the vault
 * Live-only: returns 503 with { connected: false } when Obsidian is unreachable.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get("path")
  const q = searchParams.get("q")
  const dir = searchParams.get("dir") ?? ""

  try {
    if (path) {
      const content = await readNote(path)
      return NextResponse.json({ connected: true, path, content })
    }
    if (q) {
      const results = await searchNotes(q, 20)
      return NextResponse.json({ connected: true, results })
    }
    const entries = await listVaultFiles(dir)
    const folders = entries.filter((e) => e.endsWith("/")).sort()
    const notes = entries.filter((e) => e.endsWith(".md")).sort()
    return NextResponse.json({ connected: true, dir, folders, notes })
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : "Obsidian unreachable",
      },
      { status: 503 },
    )
  }
}
