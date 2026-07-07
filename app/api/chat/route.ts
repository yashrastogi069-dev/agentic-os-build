import { createAgentUIStreamResponse, type UIMessage } from "ai"
import { createOsAgent } from "@/lib/agent"

export const maxDuration = 120

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json()

  return createAgentUIStreamResponse({
    agent: createOsAgent(),
    uiMessages: messages,
  })
}
