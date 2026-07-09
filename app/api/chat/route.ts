import { z } from "zod"
import type { UIMessage } from "ai"
import { streamOsAgentResponse } from "@/lib/agent"
import { logAgentRun } from "@/lib/skills"

export const maxDuration = 120

/** Cap history so a runaway client cannot send an unbounded prompt. */
const MAX_MESSAGES = 50

const bodySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
})

function extractUserText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim()
}

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: "Request must include a non-empty `messages` array." },
      { status: 400 },
    )
  }

  const messages = (parsed.data.messages as unknown as UIMessage[]).slice(-MAX_MESSAGES)

  // Usage observation for the continuous-discovery loop (failure-tolerant).
  const last = messages[messages.length - 1]
  if (last?.role === "user") {
    const text = extractUserText(last)
    if (text) logAgentRun(text)
  }

  try {
    return await streamOsAgentResponse(messages)
  } catch (error) {
    console.error("[chat] unhandled failure:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat failed unexpectedly." },
      { status: 500 },
    )
  }
}
