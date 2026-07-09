import {
  ToolLoopAgent,
  tool,
  isStepCount,
  toUIMessageStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  validateUIMessages,
  convertToModelMessages,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
  type Tool,
} from "ai"
import { z } from "zod"
import { saveMemory, recallMemory } from "@/lib/memory"
import {
  resolveModel,
  getResolutionChain,
  markProviderCooldown,
  type ResolvedProvider,
} from "@/lib/providers"
import { researchTools } from "@/lib/research"
import { obsidianTools } from "@/lib/connectors/obsidian"
import { githubTools } from "@/lib/connectors/github"
import { telegramTools } from "@/lib/connectors/telegram"
import { googleTools } from "@/lib/connectors/google"
import { appleTools } from "@/lib/connectors/apple"
import { getRecentEvents } from "@/lib/events"

/**
 * The OS brain now comes from the provider failsafe chain (lib/providers.ts):
 * Gemini -> Groq -> OpenRouter -> NVIDIA -> Ollama. `getChatModel()` returns
 * the first healthy provider's model — used by non-streaming callers
 * (skills.ts). Streaming chat uses `streamOsAgentResponse()` below, which adds
 * per-provider failover before the first token.
 */
export function getChatModel(): LanguageModel {
  return resolveModel().model
}

const memoryTools = {
  saveMemory: tool({
    description:
      "Save important information about the user to long-term memory. Use when the user shares preferences, facts about themselves, decisions, or explicitly asks you to remember something.",
    inputSchema: z.object({
      content: z.string().describe("The information to remember, written as a clear standalone statement."),
      category: z
        .string()
        .optional()
        .describe("Category tag, e.g. 'preference', 'project', 'person', 'fact'. Defaults to 'general'."),
    }),
    execute: async ({ content, category }) => {
      const result = await saveMemory(content, { category, source: "chat" })
      return {
        saved: result.ids.length > 0,
        memoryIds: result.ids,
        semanticIndex: result.embedded,
      }
    },
  }),
  recallMemory: tool({
    description:
      "Search long-term memory for relevant context about the user. Use before answering questions that may depend on the user's preferences, projects, or history.",
    inputSchema: z.object({
      query: z.string().describe("What to search for, phrased as a natural language query."),
      category: z.string().optional().describe("Optionally restrict to one category."),
    }),
    execute: async ({ query, category }) => {
      const results = await recallMemory(query, { limit: 6, category })
      return {
        memories: results.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.category,
          source: m.source,
          createdAt: new Date(m.createdAt).toISOString(),
        })),
      }
    },
  }),
}

const feedTools = {
  getUpdatesFeed: tool({
    description:
      "Get recent events from connected services (GitHub notifications, PRs, issues, indexed notes). Use for 'what's new', 'brief me', or status questions.",
    inputSchema: z.object({
      source: z.string().optional().describe("Filter by source, e.g. 'github' or 'obsidian'."),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async ({ source, limit }) => {
      const items = getRecentEvents(limit ?? 30, source)
      return {
        events: items.map((e) => ({
          id: e.id,
          source: e.source,
          title: e.title,
          createdAt: new Date(e.createdAt).toISOString(),
          payload: e.payload,
        })),
      }
    },
  }),
}

const skillTools = {
  saveAsSkill: tool({
    description:
      "Turn a repeated task into a reusable skill. Use when the user says 'save this as a skill', 'automate this', or describes a task they do repeatedly. Write clear step-by-step instructions for performing the task.",
    inputSchema: z.object({
      name: z.string().describe("Short kebab-case skill name, e.g. 'pr-summary'."),
      description: z.string().describe("One-sentence description of what the skill does."),
      instructions: z
        .string()
        .describe("Complete step-by-step instructions for performing the task, written for an AI agent."),
    }),
    execute: async ({ name, description, instructions }) => {
      const { createSkill } = await import("@/lib/skills")
      const skill = createSkill({ name, description, instructions, sourceTask: "chat" })
      return { created: true, id: skill.id, name: skill.name, version: skill.version }
    },
  }),
  listSkills: tool({
    description: "List all skills in the Skill Factory with their status and version.",
    inputSchema: z.object({}),
    execute: async () => {
      const { listSkills } = await import("@/lib/skills")
      return {
        skills: listSkills().map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          status: s.status,
          version: s.version,
          deployedTo: s.deployedTo,
        })),
      }
    },
  }),
  runSkill: tool({
    description: "Execute a skill by name with the given input, and log the run for the Loop Engine.",
    inputSchema: z.object({
      name: z.string().describe("The skill name."),
      input: z.string().describe("The input/task for this skill run."),
    }),
    execute: async ({ name, input }) => {
      const { runSkill } = await import("@/lib/skills")
      const { run } = await runSkill(name, input)
      return { runId: run.id, output: run.output }
    },
  }),
}

const INSTRUCTIONS = `You are Agentic OS — a personal AI operating system running locally on the user's machine.

Capabilities:
- Long-term memory: saveMemory / recallMemory. Proactively recall context before answering personal questions; proactively save durable facts the user shares.
- Obsidian vault: search, read, append, and create notes (when the connector is configured).
- GitHub: notifications, PRs, issues, recent commits (when GITHUB_TOKEN is set).
- Telegram: sendTelegram pushes messages to the user's phone; getTelegramMessages pulls new ones (when a bot token is configured).
- Google: getCalendarEvents / getRecentEmails (when the user connects Google in Settings).
- Apple Calendar: getAppleCalendarEvents via iCloud (when Apple ID + app password are configured).
- Updates feed: merged events from all connectors; use it for briefings.
- Web research: webSearch (live web) + fetchPage (read a URL as markdown). Use these for latest versions, current events, and any fact you are unsure about instead of guessing.
- Skill Factory: saveAsSkill / listSkills / runSkill. When the user mentions doing something repeatedly, offer to save it as a skill.

Behavior:
- Be concise and direct. This is an OS console, not a chatty assistant.
- When asked to "brief me", combine the updates feed, recent notes, and memory into a short structured summary.
- If a tool fails because a local service is offline (Ollama, Obsidian), say so plainly and continue with what works.
- Never invent memory contents or note contents — only report what tools return.`

const allTools = {
  ...memoryTools,
  ...feedTools,
  ...skillTools,
  ...researchTools,
  ...obsidianTools,
  ...githubTools,
  ...telegramTools,
  ...googleTools,
  ...appleTools,
}

/** Build the OS agent on a specific model (used by the failover loop). */
export function buildAgent(model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions: INSTRUCTIONS,
    tools: allTools,
    stopWhen: isStepCount(12),
  })
}

/** The OS agent on the current head-of-chain provider. */
export function createOsAgent() {
  return buildAgent(getChatModel())
}

export type OsAgent = ReturnType<typeof createOsAgent>

/**
 * Stream a chat turn with provider failover.
 *
 * We try each healthy provider in chain order. A provider's output is buffered
 * until its first *content* chunk arrives; only then is it "committed" (its
 * framing + content flushed to the client, tagged with a transient `data-brain`
 * part naming the provider). If a provider errors BEFORE committing, it is put
 * on cooldown and we transparently retry the next provider — the client never
 * sees the failed attempt. Once committed, a later error is surfaced honestly
 * (we do not silently swap brains mid-answer).
 */

// Chunk types that are pure message framing (safe to buffer before commit).
const FRAMING_TYPES = new Set(["start", "start-step", "finish-step", "message-metadata"])

function chunkErrText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}

export async function streamOsAgentResponse(uiMessages: UIMessage[]): Promise<Response> {
  // Loose cast: validateUIMessages wants Tool<unknown, unknown> per name, and
  // the concrete per-tool input types create needless invariance friction (the
  // ai package itself casts here inside createAgentUIStream, which is untyped JS).
  const looseTools = allTools as unknown as Record<string, Tool<unknown, unknown>>
  const validated = await validateUIMessages({ messages: uiMessages, tools: looseTools })
  const modelMessages = await convertToModelMessages(validated, { tools: allTools })

  const chain = getResolutionChain()
  const candidates: ResolvedProvider[] = chain.length > 0 ? chain : [resolveModel()]

  const stream = createUIMessageStream({
    originalMessages: validated,
    execute: async ({ writer }) => {
      let lastError = "No AI provider is currently available. Check API keys in Settings."

      for (const cand of candidates) {
        let result
        try {
          result = await buildAgent(cand.model).stream({ prompt: modelMessages })
        } catch (error) {
          lastError = chunkErrText(error)
          markProviderCooldown(cand.id, error)
          continue
        }

        const reader = toUIMessageStream({
          stream: result.stream,
          tools: allTools,
          sendStart: true,
          sendFinish: true,
        }).getReader()

        let committed = false
        const buffer: UIMessageChunk[] = []
        let failedPreCommit = false

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            if (!committed && value.type === "error") {
              failedPreCommit = true
              lastError = value.errorText || lastError
              markProviderCooldown(cand.id, value.errorText)
              break
            }

            if (committed) {
              writer.write(value)
              continue
            }

            if (FRAMING_TYPES.has(value.type)) {
              buffer.push(value)
              continue
            }

            // First real content chunk — commit to this provider.
            committed = true
            writer.write({
              type: "data-brain",
              data: { provider: cand.id, label: cand.label },
              transient: true,
            } as UIMessageChunk)
            for (const buffered of buffer) writer.write(buffered)
            buffer.length = 0
            writer.write(value)
          }
        } catch (error) {
          if (!committed) {
            failedPreCommit = true
            lastError = chunkErrText(error)
            markProviderCooldown(cand.id, error)
          } else {
            // Honest mid-stream failure after we already started answering.
            writer.write({ type: "error", errorText: chunkErrText(error) })
            return
          }
        } finally {
          reader.releaseLock()
        }

        if (committed) return
        if (failedPreCommit) continue
        // Stream ended cleanly with no content and no error — nothing to retry.
        return
      }

      writer.write({ type: "error", errorText: lastError })
    },
    onError: (error) => chunkErrText(error),
  })

  return createUIMessageStreamResponse({ stream })
}
