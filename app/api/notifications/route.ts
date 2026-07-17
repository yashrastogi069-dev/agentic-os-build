import { NextResponse } from "next/server"
import { listPendingNotifications, markChannelDelivered } from "@/lib/db/notifications"

export const dynamic = "force-dynamic"

const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 20_000

/**
 * GET /api/notifications — two modes on the same route:
 *   - Accept: text/event-stream -> SSE stream (Phase 6 in-tab live push,
 *     MASTER_PLAN_V2 §5.2). Polls the pending queue every 5s, pushes any
 *     notification not yet marked "toast"-delivered, marks it delivered as
 *     it's emitted so it isn't re-sent on the next poll. Heartbeat comment
 *     every ~20s keeps the connection alive through proxies/idle timeouts.
 *   - plain fetch -> { notifications } JSON snapshot, for clients that don't
 *     hold the SSE connection open (initial load, fallback).
 */
export async function GET(request: Request) {
  const accept = request.headers.get("accept") ?? ""

  if (accept.includes("text/event-stream")) {
    const encoder = new TextEncoder()

    let pollTimer: NodeJS.Timeout | undefined
    let heartbeatTimer: NodeJS.Timeout | undefined

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        function poll() {
          try {
            const pending = listPendingNotifications(Date.now())
            for (const notif of pending) {
              if (notif.channels.toast) continue
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(notif)}\n\n`))
                markChannelDelivered(notif.id, "toast")
              } catch (error) {
                console.error("[notifications/sse] failed to emit notification", error)
              }
            }
          } catch (error) {
            console.error("[notifications/sse] poll failed", error)
          }
        }

        // Emit immediately, then on the poll interval.
        poll()
        pollTimer = setInterval(poll, POLL_INTERVAL_MS)

        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
          } catch {
            // stream already closed
          }
        }, HEARTBEAT_INTERVAL_MS)

        request.signal.addEventListener("abort", () => {
          if (pollTimer) clearInterval(pollTimer)
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          try {
            controller.close()
          } catch {
            // already closed
          }
        })
      },
      cancel() {
        if (pollTimer) clearInterval(pollTimer)
        if (heartbeatTimer) clearInterval(heartbeatTimer)
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  }

  try {
    return NextResponse.json({ notifications: listPendingNotifications(Date.now()) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to load notifications" },
      { status: 500 },
    )
  }
}
