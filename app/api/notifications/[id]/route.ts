import { NextResponse } from "next/server"
import { z } from "zod"
import { ackNotification, snoozeNotification } from "@/lib/db/notifications"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  action: z.enum(["ack", "snooze"]),
  minutes: z.number().int().positive().optional(),
})

/** POST /api/notifications/[id] — { action: "ack" | "snooze", minutes? } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const notificationId = Number(id)
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return NextResponse.json({ error: "invalid notification id" }, { status: 400 })
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
    if (parsed.data.action === "ack") {
      ackNotification(notificationId)
    } else {
      snoozeNotification(notificationId, parsed.data.minutes ?? 10)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to update notification" },
      { status: 500 },
    )
  }
}
