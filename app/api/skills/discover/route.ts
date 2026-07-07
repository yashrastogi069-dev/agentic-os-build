import { NextResponse } from "next/server"
import { discoverSkillCandidates, usageStats } from "@/lib/skills"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** GET /api/skills/discover — usage observation stats. */
export async function GET() {
  try {
    return NextResponse.json(usageStats())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "stats failed" },
      { status: 500 },
    )
  }
}

/** POST /api/skills/discover — run a discovery pass over logged usage. */
export async function POST() {
  try {
    const result = await discoverSkillCandidates()
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "discovery failed" },
      { status: 500 },
    )
  }
}
