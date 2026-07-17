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
import { connectorTools, connectorPromptLines } from "@/lib/connectors/registry"
import { getRecentEvents } from "@/lib/events"
import { createTask, listTasks, completeTask, snoozeTask, updateTask } from "@/lib/tasks"
import { setAssistantPreference } from "@/lib/assistant/prompt"
import { addWakeWord, listWakeWords, removeWakeWord } from "@/lib/wake-words"

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

const taskTools = {
  createTask: tool({
    description:
      "Create a task/reminder. Use when the user mentions anything time-bound ('remind me', 'by Friday', 'tomorrow morning') or asks you to track something to do.",
    inputSchema: z.object({
      title: z.string().describe("Short task title."),
      notes: z.string().optional().describe("Extra detail about the task."),
      dueAt: z.string().optional().describe("ISO datetime the task is due, if any."),
      remindAt: z.string().optional().describe("ISO datetime to remind the user, if any."),
      recurrence: z
        .enum(["daily", "weekdays", "weekly", "monthly"])
        .optional()
        .describe("Repeat rule, if this task recurs."),
    }),
    execute: async ({ title, notes, dueAt, remindAt, recurrence }) => {
      const task = createTask({
        title,
        notes,
        dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
        remindAt: remindAt ? new Date(remindAt).getTime() : undefined,
        recurrence,
      })
      return { id: task.id, title: task.title, status: task.status }
    },
  }),
  listTasks: tool({
    description: "List tasks, optionally filtered by status ('open' or 'done').",
    inputSchema: z.object({
      status: z.enum(["open", "done"]).optional(),
    }),
    execute: async ({ status }) => {
      const items = listTasks({ status })
      return {
        tasks: items.map((t) => ({
          id: t.id,
          title: t.title,
          notes: t.notes,
          status: t.status,
          dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
          remindAt: t.remindAt ? new Date(t.remindAt).toISOString() : null,
          recurrence: t.recurrence,
        })),
      }
    },
  }),
  completeTask: tool({
    description:
      "Mark a task done by id. If the task recurs, a fresh open task for the next occurrence is created automatically.",
    inputSchema: z.object({
      id: z.number().int().describe("The task id."),
    }),
    execute: async ({ id }) => {
      const task = completeTask(id)
      return { id: task.id, status: task.status, completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null }
    },
  }),
  snoozeTask: tool({
    description: "Push a task's reminder forward by N minutes from now.",
    inputSchema: z.object({
      id: z.number().int().describe("The task id."),
      minutes: z.number().int().positive().describe("Minutes from now to re-remind."),
    }),
    execute: async ({ id, minutes }) => {
      const task = snoozeTask(id, minutes)
      return { id: task.id, remindAt: task.remindAt ? new Date(task.remindAt).toISOString() : null }
    },
  }),
  updateTask: tool({
    description: "Edit an existing task's title, notes, due date, reminder, or recurrence.",
    inputSchema: z.object({
      id: z.number().int().describe("The task id."),
      title: z.string().optional(),
      notes: z.string().optional(),
      dueAt: z.string().optional().describe("New ISO due datetime."),
      remindAt: z.string().optional().describe("New ISO reminder datetime."),
      recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).optional(),
    }),
    execute: async ({ id, title, notes, dueAt, remindAt, recurrence }) => {
      const task = updateTask(id, {
        title,
        notes,
        dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
        remindAt: remindAt ? new Date(remindAt).getTime() : undefined,
        recurrence,
      })
      return {
        id: task.id,
        title: task.title,
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
        remindAt: task.remindAt ? new Date(task.remindAt).toISOString() : null,
        recurrence: task.recurrence,
      }
    },
  }),
}

const wakeWordTools = {
  addWakeWord: tool({
    description:
      "Register a new wake word/phrase that activates an action when spoken aloud. Currently only the \"activate-voice\" action is wired to real behavior (it starts a voice conversation turn, same as saying 'Jarvis' or pressing Alt+J). Other action strings are reserved for future features — registering one now is safe and forward-compatible, but nothing will happen when it's spoken until a listener for that action id is built. Use when the user says things like \"add a wake word 'computer' for activating voice\" or \"let me say 'hey assistant' to talk to you\".",
    inputSchema: z.object({
      phrase: z.string().describe("The word or short phrase to listen for, e.g. 'computer' or 'hey jarvis'. Stored lowercased/trimmed."),
      action: z
        .string()
        .describe(
          "The action id to fire when this phrase is heard. Use 'activate-voice' to start a voice conversation turn (the only currently-wired action). Any other string is reserved for a future feature and will not do anything yet.",
        ),
    }),
    execute: async ({ phrase, action }) => {
      const entry = addWakeWord(phrase, action)
      return { id: entry.id, phrase: entry.phrase, action: entry.action, enabled: entry.enabled }
    },
  }),
  listWakeWords: tool({
    description: "List all registered wake words/phrases, their target action, and whether each is enabled.",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        wakeWords: listWakeWords().map((e) => ({
          id: e.id,
          phrase: e.phrase,
          action: e.action,
          enabled: e.enabled,
        })),
      }
    },
  }),
  removeWakeWord: tool({
    description: "Delete a registered wake word by id. Use listWakeWords first if you need to find the id.",
    inputSchema: z.object({
      id: z.string().describe("The wake word entry id."),
    }),
    execute: async ({ id }) => {
      removeWakeWord(id)
      return { removed: true, id }
    },
  }),
}

const preferenceTools = {
  setPreference: tool({
    description:
      "Persist how the user wants the assistant to behave — tone, verbosity, or how to address them. This PERSISTS across sessions: when the user says 'be more casual' or 'call me boss', use this so it sticks instead of complying for one turn only.",
    inputSchema: z.object({
      key: z.enum(["tone", "verbosity", "address"]),
      value: z.string().describe("For tone: professional/casual/warm/direct. For verbosity: brief/balanced/detailed. For address: any short name."),
    }),
    execute: async ({ key, value }) => {
      const prefs = setAssistantPreference(key, value)
      return { preferences: prefs }
    },
  }),
}

/**
 * Exported (not just module-local) so tests/agent.instructions.test.ts can
 * snapshot it directly and catch any drift in the connector registry's
 * promptHint strings without needing to build a full agent/model.
 */
export const INSTRUCTIONS = `You are Agentic OS — a personal AI operating system running locally on the user's machine.

Capabilities:
- Long-term memory: saveMemory / recallMemory. Proactively recall context before answering personal questions; proactively save durable facts the user shares.
- Tasks & reminders: createTask / listTasks / completeTask / snoozeTask / updateTask. When the user mentions anything time-bound ("remind me", "by Friday", "tomorrow morning"), create a task instead of just acknowledging.
- Preferences: setPreference persists tone/verbosity/how to address the user across sessions — use it when the user says things like "be more casual" instead of just complying for one turn.
${connectorPromptLines()}
- Updates feed: merged events from all connectors; use it for briefings.
- Web research: webSearch (live web) + fetchPage (read a URL as markdown). Use these for latest versions, current events, and any fact you are unsure about instead of guessing.
- Skill Factory: saveAsSkill / listSkills / runSkill. When the user mentions doing something repeatedly, offer to save it as a skill.
- Wake words: addWakeWord / listWakeWords / removeWakeWord. Use when the user wants to add or manage spoken trigger phrases (e.g. "add a wake word 'computer'"). Only the 'activate-voice' action currently does anything (it starts a voice turn, like saying "Jarvis"); say so if the user asks for a different action.

Behavior:
- Be concise and direct. This is an OS console, not a chatty assistant.
- When asked to "brief me", combine the updates feed, recent notes, and memory into a short structured summary.
- If a tool fails because a local service is offline (Ollama, Obsidian), say so plainly and continue with what works.
- Never invent memory contents or note contents — only report what tools return.`

const allTools = {
  ...memoryTools,
  ...feedTools,
  ...skillTools,
  ...taskTools,
  ...wakeWordTools,
  ...preferenceTools,
  ...researchTools,
  ...connectorTools,
}

/** Build the OS agent on a specific model (used by the failover loop). `extraInstructions`,
 * when provided, is appended to the fixed INSTRUCTIONS for this call only (used to inject
 * per-turn context: time, session summary, open tasks, relevant memories). */
export function buildAgent(model: LanguageModel, extraInstructions?: string) {
  return new ToolLoopAgent({
    model,
    instructions: extraInstructions ? `${INSTRUCTIONS}\n\n${extraInstructions}` : INSTRUCTIONS,
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

export interface StreamOsAgentOptions {
  /** Appended to the fixed INSTRUCTIONS for this call — per-turn context (time, summary, tasks, memories). */
  extraContext?: string
  /** Invoked once the stream finishes with the assistant's final text, which provider answered, and its UI parts. */
  onSessionPersist?: (result: { text: string; brain: string | null; uiParts: unknown[] }) => void
}

export async function streamOsAgentResponse(
  uiMessages: UIMessage[],
  opts: StreamOsAgentOptions = {},
): Promise<Response> {
  // Loose cast: validateUIMessages wants Tool<unknown, unknown> per name, and
  // the concrete per-tool input types create needless invariance friction (the
  // ai package itself casts here inside createAgentUIStream, which is untyped JS).
  const looseTools = allTools as unknown as Record<string, Tool<unknown, unknown>>
  const validated = await validateUIMessages({ messages: uiMessages, tools: looseTools })
  const modelMessages = await convertToModelMessages(validated, { tools: allTools })

  const chain = getResolutionChain()
  const candidates: ResolvedProvider[] = chain.length > 0 ? chain : [resolveModel()]

  let committedBrain: string | null = null

  const stream = createUIMessageStream({
    originalMessages: validated,
    onFinish: ({ responseMessage }) => {
      if (!opts.onSessionPersist) return
      const text = (responseMessage.parts ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
      if (!text.trim()) return
      opts.onSessionPersist({ text, brain: committedBrain, uiParts: responseMessage.parts })
    },
    execute: async ({ writer }) => {
      let lastError = "No AI provider is currently available. Check API keys in Settings."

      for (const cand of candidates) {
        let result
        try {
          result = await buildAgent(cand.model, opts.extraContext).stream({ prompt: modelMessages })
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
            committedBrain = cand.id
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
