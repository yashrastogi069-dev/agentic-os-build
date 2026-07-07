import { ToolLoopAgent, tool, isStepCount, type LanguageModel } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { z } from "zod"
import { saveMemory, recallMemory } from "@/lib/memory"
import { getChatSettings } from "@/lib/settings"
import { OLLAMA_URL, OLLAMA_CHAT_MODEL } from "@/lib/ollama"
import { obsidianTools } from "@/lib/connectors/obsidian"
import { githubTools } from "@/lib/connectors/github"
import { telegramTools } from "@/lib/connectors/telegram"
import { googleTools } from "@/lib/connectors/google"
import { appleTools } from "@/lib/connectors/apple"
import { getRecentEvents } from "@/lib/events"

/**
 * The OS agent. Brain selection (Settings model picker):
 * - groq (default): fast free cloud inference, GROQ_API_KEY
 * - ollama (offline fallback): llama3.2:3b via Ollama's OpenAI-compatible API
 */
export function getChatModel(): LanguageModel {
  const settings = getChatSettings()

  if (settings.brain === "ollama" || !process.env.GROQ_API_KEY) {
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: `${OLLAMA_URL}/v1`,
    })
    return ollama(OLLAMA_CHAT_MODEL)
  }

  const groq = createGroq()
  return groq(settings.groqModel)
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
- Skill Factory: saveAsSkill / listSkills / runSkill. When the user mentions doing something repeatedly, offer to save it as a skill.

Behavior:
- Be concise and direct. This is an OS console, not a chatty assistant.
- When asked to "brief me", combine the updates feed, recent notes, and memory into a short structured summary.
- If a tool fails because a local service is offline (Ollama, Obsidian), say so plainly and continue with what works.
- Never invent memory contents or note contents — only report what tools return.`

export function createOsAgent() {
  return new ToolLoopAgent({
    model: getChatModel(),
    instructions: INSTRUCTIONS,
    tools: {
      ...memoryTools,
      ...feedTools,
      ...skillTools,
      ...obsidianTools,
      ...githubTools,
      ...telegramTools,
      ...googleTools,
      ...appleTools,
    },
    stopWhen: isStepCount(12),
  })
}

export type OsAgent = ReturnType<typeof createOsAgent>
