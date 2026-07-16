import { and, eq, gte, isNotNull, lte, or } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { tasks } from "@/lib/db/schema"
import { recallMemory } from "@/lib/memory"

/**
 * Per-turn context injection (Phase 6 intelligence core). Everything the
 * brain needs to interpret intent accurately — current time, the memories
 * relevant to what was just said, imminent tasks, and the rolling session
 * summary — assembled into one compact block appended to the system
 * instructions. Every section is fail-soft: a dead Ollama or empty table
 * degrades to a smaller block, never an error.
 */

const MEMORY_LIMIT = 5
const MEMORY_SNIPPET_CHARS = 220
const TASK_WINDOW_MS = 48 * 60 * 60 * 1000
const TASK_LIMIT = 6

export interface TurnContextInput {
  /** The user's latest message text — drives semantic memory recall. */
  latestUserText: string
  /** Rolling summary of this conversation's earlier turns, if any. */
  sessionSummary?: string | null
}

function timeSection(now: Date): string {
  const day = now.toLocaleDateString("en-NZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  const time = now.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Current local time: ${day}, ${time} (${tz}).`
}

async function memorySection(query: string): Promise<string | null> {
  if (!query.trim()) return null
  try {
    const results = await recallMemory(query, { limit: MEMORY_LIMIT })
    if (results.length === 0) return null
    const lines = results.map((m) => {
      const content = m.content.length > MEMORY_SNIPPET_CHARS ? `${m.content.slice(0, MEMORY_SNIPPET_CHARS)}…` : m.content
      return `- [${m.category}] ${content}`
    })
    return `Relevant long-term memories:\n${lines.join("\n")}`
  } catch {
    return null // embeddings offline — recallMemory tool still available to the model
  }
}

function taskSection(now: number): string | null {
  try {
    const horizon = now + TASK_WINDOW_MS
    const rows = getDb()
      .select({ title: tasks.title, dueAt: tasks.dueAt, remindAt: tasks.remindAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "open"),
          or(
            and(isNotNull(tasks.dueAt), lte(tasks.dueAt, new Date(horizon)), gte(tasks.dueAt, new Date(now - TASK_WINDOW_MS))),
            and(isNotNull(tasks.remindAt), lte(tasks.remindAt, new Date(horizon))),
          ),
        ),
      )
      .limit(TASK_LIMIT)
      .all()
    if (rows.length === 0) return null
    const lines = rows.map((t) => {
      const at = t.dueAt ?? t.remindAt
      if (!at) return `- ${t.title}`
      const delta = at.getTime() - now
      const when =
        delta < 0
          ? "OVERDUE"
          : delta < 60 * 60 * 1000
            ? `in ${Math.max(1, Math.round(delta / 60000))} min`
            : `${at.toLocaleDateString("en-NZ", { weekday: "short" })} ${at.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}`
      return `- ${t.title} (${when})`
    })
    return `Open tasks in the next 48h:\n${lines.join("\n")}`
  } catch {
    return null
  }
}

/**
 * Build the context block for one turn. Returns a string ready to append to
 * the system instructions, or null when there is genuinely nothing to add.
 */
export async function buildTurnContext(input: TurnContextInput): Promise<string | null> {
  const now = new Date()
  const sections: string[] = [timeSection(now)]

  const summary = input.sessionSummary?.trim()
  if (summary) sections.push(`Earlier in this conversation (rolling summary):\n${summary}`)

  const [memories, taskBlock] = await Promise.all([
    memorySection(input.latestUserText),
    Promise.resolve(taskSection(now.getTime())),
  ])
  if (taskBlock) sections.push(taskBlock)
  if (memories) sections.push(memories)

  if (sections.length === 0) return null
  return `--- LIVE CONTEXT (assembled ${now.toISOString()}, trust it over stale assumptions) ---\n${sections.join("\n\n")}`
}
