import { z } from "zod"
import { requireSystemAuth, isCommandBusy, setCommandBusy } from "@/lib/system-auth"
import { collectOsAgentResponse } from "@/lib/agent"
import { logAgentRun } from "@/lib/skills"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * POST /api/system/command — run one full agent turn for the companion and
 * return the final reply. Unlike /cleanup this must NOT pass-through-as-success
 * on failure: the companion needs to tell "Jarvis said nothing" (200, empty
 * reply) apart from "Jarvis is down" (502).
 */

const bodySchema = z.object({ text: z.string().min(1).max(4000) })

export async function POST(request: Request) {
  const denied = requireSystemAuth(request)
  if (denied) return denied

  // Cap concurrent turns at 1 (single boolean guard, not a queue).
  if (isCommandBusy()) {
    return Response.json({ error: "busy" }, { status: 503 })
  }

  let text: string
  try {
    text = bodySchema.parse(await request.json()).text
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid body" },
      { status: 400 },
    )
  }

  setCommandBusy(true)
  try {
    logAgentRun(text)
    const { text: reply, brain } = await collectOsAgentResponse(text)
    return Response.json({ reply, brain })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "agent failed" },
      { status: 502 },
    )
  } finally {
    setCommandBusy(false)
  }
}
