import { NextResponse } from "next/server"
import { z } from "zod"
import { createTask, listTasks } from "@/lib/tasks"

export const dynamic = "force-dynamic"

/** GET /api/tasks?status=open|done — all tasks, or filtered by status. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")

  try {
    if (status === "open" || status === "done") {
      return NextResponse.json({ tasks: listTasks({ status }) })
    }
    return NextResponse.json({ tasks: listTasks() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to load tasks" },
      { status: 500 },
    )
  }
}

const recurrenceSchema = z.enum(["daily", "weekdays", "weekly", "monthly"])

const createSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  notes: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  remindAt: z.string().datetime().optional(),
  recurrence: recurrenceSchema.optional(),
})

/**
 * POST /api/tasks — { title, notes?, dueAt?, remindAt?, recurrence? }.
 * dueAt/remindAt are ISO strings at the API boundary, converted to epoch ms
 * before hitting lib/tasks.ts (mirrors lib/agent.ts's taskTools).
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 })
  }

  try {
    const { title, notes, dueAt, remindAt, recurrence } = parsed.data
    const task = createTask({
      title,
      notes,
      dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
      remindAt: remindAt ? new Date(remindAt).getTime() : undefined,
      recurrence,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to create task" },
      { status: 500 },
    )
  }
}
