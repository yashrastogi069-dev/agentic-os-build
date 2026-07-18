import { z } from "zod"
import { requireSystemAuth } from "@/lib/system-auth"
import { addEvent } from "@/lib/events"
import { getRawDb } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * POST /api/system/observe — record a passive observation from the companion
 * (a dictation transcript, or the currently-focused window) into the feed.
 *
 * Prompt-injection mitigation: the raw transcript / window title goes ONLY into
 * the event payload, never into the event's title. The agent reads titles most
 * prominently when summarizing the feed, so a templated title keeps captured
 * text (which agent.ts also flags as source "system" = data-only) out of the
 * most instruction-like slot.
 *
 * Scope decision (intentional, not an omission): we do NOT write to the
 * memories table here. Auto-promoting arbitrary observed text to long-term
 * memory is both noise and a larger injection foothold, since memory is
 * injected into every future turn's context.
 */

const bodySchema = z.object({
  kind: z.enum(["transcript", "window"]),
  text: z.string().max(8000).optional(),
  windowTitle: z.string().max(300).optional(),
  app: z.string().max(100).optional(),
  at: z.number().int().positive().optional(),
})

/** Strip control characters (C0 range + DEL) and trim. */
function sanitize(value: string | undefined): string {
  if (!value) return ""
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim()
}

export async function POST(request: Request) {
  const denied = requireSystemAuth(request)
  if (denied) return denied

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid body" },
      { status: 400 },
    )
  }

  const text = sanitize(parsed.text)
  const windowTitle = sanitize(parsed.windowTitle)
  const app = sanitize(parsed.app) || "unknown app"

  const title =
    parsed.kind === "transcript" ? `Dictation in ${app}` : `Window focus: ${app}`

  let eventId: number | null = null
  try {
    const created = addEvent({
      source: "system",
      title,
      payload: {
        kind: parsed.kind,
        app,
        // Raw captured text lives here (payload), never in the title.
        ...(text ? { text } : {}),
        ...(windowTitle ? { windowTitle } : {}),
        capturedAt: parsed.at ?? Date.now(),
      },
    })
    // addEvent returns whether a row was inserted (not the id). When it did
    // insert, read the real rowid from the same singleton connection — honest
    // id, never a fabricated one.
    if (created) {
      const row = getRawDb().prepare(`SELECT last_insert_rowid() AS id`).get() as
        | { id: number }
        | undefined
      eventId = row?.id ?? null
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "failed to record observation" },
      { status: 500 },
    )
  }

  return Response.json({ ok: true, eventId })
}
