import { z } from "zod"
import { requireSystemAuth } from "@/lib/system-auth"
import { runSchedulerTick } from "@/lib/scheduler"
import {
  listPendingNotifications,
  markChannelDelivered,
  ackNotification,
  snoozeNotification,
} from "@/lib/db/notifications"

export const dynamic = "force-dynamic"

/**
 * GET /api/system/notifications — sweep due reminders, then hand the companion
 * any pending notification it hasn't already been given. Mirrors the SSE
 * route's channel-marking pattern (it marks "toast"; we mark "companion") so
 * the same notification is delivered to each channel exactly once.
 *
 * POST — ack or snooze a notification by id.
 */
export async function GET(request: Request) {
  const denied = requireSystemAuth(request)
  if (denied) return denied

  try {
    // Fire the reminder scheduler so anything now due is enqueued before we read.
    await runSchedulerTick()

    const pending = listPendingNotifications(Date.now())
    const undelivered = pending.filter((n) => !n.channels.companion)

    for (const notif of undelivered) {
      markChannelDelivered(notif.id, "companion")
    }

    return Response.json({ notifications: undelivered })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "failed to load notifications" },
      { status: 500 },
    )
  }
}

const postSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["ack", "snooze"]),
  minutes: z.number().int().positive().max(1440).optional(),
})

export async function POST(request: Request) {
  const denied = requireSystemAuth(request)
  if (denied) return denied

  let parsed: z.infer<typeof postSchema>
  try {
    parsed = postSchema.parse(await request.json())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid body" },
      { status: 400 },
    )
  }

  try {
    if (parsed.action === "ack") {
      ackNotification(parsed.id)
    } else {
      snoozeNotification(parsed.id, parsed.minutes ?? 10)
    }
    return Response.json({ ok: true })
  } catch (error) {
    // ackNotification/snoozeNotification throw "Notification <id> not found"
    // when the id doesn't exist — surface that as a 404.
    return Response.json(
      { error: error instanceof Error ? error.message : "not found" },
      { status: 404 },
    )
  }
}
