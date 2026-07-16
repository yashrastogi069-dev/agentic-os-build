import { getRawDb } from "@/lib/db"
import { getChatModel } from "@/lib/agent"
import { generateText } from "ai"

/**
 * Multi-turn conversation persistence (Phase 6D). Raw-SQL style, mirroring
 * lib/events.ts / lib/settings.ts — chat_sessions + chat_messages already
 * exist in lib/db/index.ts's DDL (SCHEMA_VERSION 4).
 */

export interface ChatSession {
  id: number
  title: string
  summary: string | null
  summaryThroughMessageId: number | null
  lastMode: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: number
  sessionId: number
  role: "user" | "assistant" | "system"
  content: string
  uiParts: unknown[] | null
  brain: string | null
  createdAt: number
}

type SessionRow = {
  id: number
  title: string
  summary: string | null
  summary_through_message_id: number | null
  last_mode: string
  created_at: number
  updated_at: number
}

type MessageRow = {
  id: number
  session_id: number
  role: string
  content: string
  ui_parts: string | null
  brain: string | null
  created_at: number
}

function rowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    summaryThroughMessageId: row.summary_through_message_id,
    lastMode: row.last_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    uiParts: row.ui_parts ? safeParseArray(row.ui_parts) : null,
    brain: row.brain,
    createdAt: row.created_at,
  }
}

function safeParseArray(json: string): unknown[] | null {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createSession(title?: string): number {
  const db = getRawDb()
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO chat_sessions (title, last_mode, created_at, updated_at)
       VALUES (?, 'text', ?, ?)`,
    )
    .run(title?.trim() || "New conversation", now, now)
  return Number(result.lastInsertRowid)
}

export function getSession(id: number): ChatSession | null {
  const db = getRawDb()
  const row = db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as
    | SessionRow
    | undefined
  return row ? rowToSession(row) : null
}

export function listSessions(limit = 20): ChatSession[] {
  const db = getRawDb()
  const rows = db
    .prepare(`SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as SessionRow[]
  return rows.map(rowToSession)
}

export function appendMessage(
  sessionId: number,
  role: "user" | "assistant" | "system",
  content: string,
  opts?: { uiParts?: unknown[]; brain?: string },
): number {
  const db = getRawDb()
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, role, content, ui_parts, brain, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      role,
      content,
      opts?.uiParts ? JSON.stringify(opts.uiParts) : null,
      opts?.brain ?? null,
      now,
    )
  db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId)
  return Number(result.lastInsertRowid)
}

export function getMessages(sessionId: number, opts?: { afterId?: number }): ChatMessage[] {
  const db = getRawDb()
  const rows = opts?.afterId
    ? (db
        .prepare(
          `SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`,
        )
        .all(sessionId, opts.afterId) as MessageRow[])
    : (db
        .prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`)
        .all(sessionId) as MessageRow[])
  return rows.map(rowToMessage)
}

export function getSessionSummary(sessionId: number): string | null {
  const db = getRawDb()
  const row = db
    .prepare(`SELECT summary FROM chat_sessions WHERE id = ?`)
    .get(sessionId) as { summary: string | null } | undefined
  return row?.summary ?? null
}

const SUMMARIZE_CHAR_THRESHOLD = 6000
const SUMMARIZE_MESSAGE_THRESHOLD = 20

/**
 * Rolling summarization: compress un-summarized turns into the session's
 * summary field once they get large. Failure-tolerant by design — this is a
 * background quality-of-life step, never allowed to break the chat turn.
 */
export async function summarizeIfNeeded(sessionId: number): Promise<void> {
  try {
    const db = getRawDb()
    const session = getSession(sessionId)
    if (!session) return

    const pending = getMessages(sessionId, {
      afterId: session.summaryThroughMessageId ?? undefined,
    }).filter((m) => m.role !== "system")

    if (pending.length === 0) return

    const combinedChars = pending.reduce((sum, m) => sum + m.content.length, 0)
    if (combinedChars <= SUMMARIZE_CHAR_THRESHOLD && pending.length <= SUMMARIZE_MESSAGE_THRESHOLD) {
      return
    }

    const segment = pending.map((m) => `${m.role}: ${m.content}`).join("\n")
    const prompt = session.summary
      ? `Previous summary: ${session.summary}\n\nNew segment:\n${segment}`
      : segment

    const { text } = await generateText({
      model: getChatModel(),
      system:
        "Summarize this conversation segment in 3-5 dense sentences, preserving names, decisions, and open threads. Do not editorialize.",
      prompt,
    })

    const lastId = pending[pending.length - 1].id
    db.prepare(
      `UPDATE chat_sessions SET summary = ?, summary_through_message_id = ? WHERE id = ?`,
    ).run(text.trim(), lastId, sessionId)
  } catch (error) {
    console.error("[agentic-os] summarizeIfNeeded failed (non-fatal):", error)
  }
}
