import { z } from "zod"
import type { UIMessage } from "ai"
import { streamOsAgentResponse } from "@/lib/agent"
import { logAgentRun } from "@/lib/skills"
import { createSession, appendMessage, getSessionSummary, summarizeIfNeeded } from "@/lib/sessions"
import { buildTurnContext } from "@/lib/assistant/context"

export const maxDuration = 120

/** Cap history so a runaway client cannot send an unbounded prompt. */
const MAX_MESSAGES = 50

const bodySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
  sessionId: z.number().int().positive().optional(),
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

  const sessionId = parsed.data.sessionId ?? createSession()

  // Usage observation for the continuous-discovery loop (failure-tolerant).
  const last = messages[messages.length - 1]
  let userText = ""
  if (last?.role === "user") {
    userText = extractUserText(last)
    if (userText) logAgentRun(userText)
  }

  // Persist the user turn before calling the agent so it is never lost even
  // if the stream fails mid-flight.
  if (last?.role === "user" && userText) {
    try {
      appendMessage(sessionId, "user", userText, { uiParts: last.parts })
    } catch (error) {
      console.error("[chat] failed to persist user message:", error)
    }
  }

  let contextMessages = messages
  try {
    const context = await buildTurnContext({
      latestUserText: userText,
      sessionSummary: getSessionSummary(sessionId),
    })
    if (context) {
      const systemMessage: UIMessage = {
        id: `ctx-${sessionId}-${Date.now()}`,
        role: "system",
        parts: [{ type: "text", text: context }],
      }
      contextMessages = [systemMessage, ...messages]
    }
  } catch (error) {
    console.error("[chat] failed to build turn context (continuing without it):", error)
  }

  try {
    const response = await streamOsAgentResponse(contextMessages, {
      onSessionPersist: ({ text, brain, uiParts }) => {
        try {
          appendMessage(sessionId, "assistant", text, { uiParts, brain: brain ?? undefined })
        } catch (error) {
          console.error("[chat] failed to persist assistant message:", error)
        }
        void summarizeIfNeeded(sessionId).catch((error) =>
          console.error("[chat] summarizeIfNeeded rejected:", error),
        )
      },
    })
    response.headers.set("X-Session-Id", String(sessionId))
    return response
  } catch (error) {
    console.error("[chat] unhandled failure:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat failed unexpectedly." },
      { status: 500 },
    )
  }
}
