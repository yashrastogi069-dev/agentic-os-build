import { createAgentUIStreamResponse, type UIMessage } from "ai"
import { createOsAgent } from "@/lib/agent"
import { logAgentRun } from "@/lib/skills"

export const maxDuration = 120

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json()

  // Usage observation for the continuous-discovery loop (failure-tolerant).
  const last = messages[messages.length - 1]
  if (last?.role === "user") {
    const text = last.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ")
    if (text) logAgentRun(text)
  }

  return createAgentUIStreamResponse({
    agent: createOsAgent(),
    uiMessages: messages,
  })
}
