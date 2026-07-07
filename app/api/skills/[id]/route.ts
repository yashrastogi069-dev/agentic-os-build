import { NextResponse } from "next/server"
import {
  runSkill,
  rateRun,
  listRuns,
  deleteSkill,
  proposeRefinement,
  applyRefinement,
  deploySkillToGithub,
  getSkill,
  toSkillMd,
} from "@/lib/skills"

export const dynamic = "force-dynamic"

/** GET /api/skills/[id] — skill detail: runs + SKILL.md preview. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const skillId = Number(id)
  const skill = getSkill(skillId)
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({
    runs: listRuns(skillId).map((r) => ({
      id: r.id,
      version: r.skillVersion,
      input: r.input,
      output: r.output,
      rating: r.rating,
      feedback: r.feedback,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    skillMd: toSkillMd(skill),
  })
}

/**
 * POST /api/skills/[id] — Loop Engine actions:
 * { action: "run", input } | { action: "rate", runId, rating, feedback? }
 * { action: "refine" } | { action: "applyRefinement", instructions }
 * { action: "deploy", repo, basePath? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const skillId = Number(id)
  try {
    const body = (await request.json()) as Record<string, unknown>
    switch (body.action) {
      case "run": {
        if (typeof body.input !== "string" || !body.input.trim()) {
          return NextResponse.json({ error: "input required" }, { status: 400 })
        }
        const { run } = await runSkill(skillId, body.input)
        return NextResponse.json({ runId: run.id, output: run.output })
      }
      case "rate": {
        const rating = body.rating === 1 ? 1 : -1
        rateRun(Number(body.runId), rating, typeof body.feedback === "string" ? body.feedback : undefined)
        return NextResponse.json({ ok: true })
      }
      case "refine": {
        const result = await proposeRefinement(skillId)
        return NextResponse.json({ proposal: result.proposal, reason: result.reason })
      }
      case "applyRefinement": {
        if (typeof body.instructions !== "string" || !body.instructions.trim()) {
          return NextResponse.json({ error: "instructions required" }, { status: 400 })
        }
        const skill = applyRefinement(skillId, body.instructions)
        return NextResponse.json({ version: skill.version })
      }
      case "deploy": {
        if (typeof body.repo !== "string" || !body.repo.trim()) {
          return NextResponse.json({ error: "repo required (owner/name)" }, { status: 400 })
        }
        const result = await deploySkillToGithub(
          skillId,
          body.repo,
          typeof body.basePath === "string" && body.basePath.trim() ? body.basePath : undefined,
        )
        return NextResponse.json(result)
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "action failed" },
      { status: 500 },
    )
  }
}

/** DELETE /api/skills/[id] */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteSkill(Number(id))
  return NextResponse.json({ ok: true })
}
