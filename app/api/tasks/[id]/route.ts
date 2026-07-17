import { NextResponse } from "next/server"
import { z } from "zod"
import { completeTask, snoozeTask, updateTask, deleteTask } from "@/lib/tasks"

export const dynamic = "force-dynamic"

const recurrenceSchema = z.enum(["daily", "weekdays", "weekly", "monthly"])

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("snooze"), minutes: z.number().int().positive().optional() }),
  z.object({
    action: z.literal("update"),
    title: z.string().trim().min(1).optional(),
    notes: z.string().optional(),
    dueAt: z.string().datetime().optional(),
    remindAt: z.string().datetime().optional(),
    recurrence: recurrenceSchema.optional(),
  }),
  z.object({ action: z.literal("delete") }),
])

/**
 * POST /api/tasks/[id] — { action: "complete" | "snooze" | "update" | "delete", ...fields }.
 * ISO strings at the API boundary, converted to epoch ms before hitting
 * lib/tasks.ts (mirrors lib/agent.ts's taskTools).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const taskId = Number(id)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 })
  }

  try {
    switch (parsed.data.action) {
      case "complete": {
        const task = completeTask(taskId)
        return NextResponse.json({ task })
      }
      case "snooze": {
        const task = snoozeTask(taskId, parsed.data.minutes ?? 10)
        return NextResponse.json({ task })
      }
      case "update": {
        const { title, notes, dueAt, remindAt, recurrence } = parsed.data
        const task = updateTask(taskId, {
          title,
          notes,
          dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
          remindAt: remindAt ? new Date(remindAt).getTime() : undefined,
          recurrence,
        })
        return NextResponse.json({ task })
      }
      case "delete": {
        deleteTask(taskId)
        return NextResponse.json({ ok: true })
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to update task" },
      { status: 500 },
    )
  }
}
