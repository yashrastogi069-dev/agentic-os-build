import { NextResponse } from "next/server"
import { listSkills, createSkill, skillHealth } from "@/lib/skills"

export const dynamic = "force-dynamic"

/** GET /api/skills — all skills with run health for the pipeline chart. */
export async function GET() {
  try {
    const items = listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      sourceTask: skill.sourceTask,
      status: skill.status,
      version: skill.version,
      deployedTo: skill.deployedTo,
      updatedAt: new Date(skill.updatedAt).toISOString(),
      health: skillHealth(skill.id),
    }))
    return NextResponse.json({ skills: items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "skills unavailable" },
      { status: 500 },
    )
  }
}

/** POST /api/skills — create a skill manually. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string
      description?: string
      instructions?: string
    }
    if (!body.name?.trim() || !body.description?.trim() || !body.instructions?.trim()) {
      return NextResponse.json(
        { error: "name, description, and instructions are required" },
        { status: 400 },
      )
    }
    const skill = createSkill({
      name: body.name,
      description: body.description,
      instructions: body.instructions,
    })
    return NextResponse.json({ skill })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create failed" },
      { status: 500 },
    )
  }
}
