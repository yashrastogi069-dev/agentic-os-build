import { NextResponse } from "next/server"
import { indexVault } from "@/lib/connectors/obsidian"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** POST /api/obsidian/index — walk the vault and embed all notes into memory. */
export async function POST() {
  try {
    const result = await indexVault()
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "vault indexing failed" },
      { status: 502 },
    )
  }
}
