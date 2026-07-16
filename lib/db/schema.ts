import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Timestamp convention (unified 2026-07-09, PLAN 1.4): every timestamp column
 * uses `mode: "timestamp_ms"` so Drizzle stores/reads epoch MILLISECONDS. This
 * matches the raw-SQL paths (lib/events.ts, lib/memory.ts, lib/settings.ts)
 * which already write `Date.now()` (ms). Previously the Drizzle columns used
 * `mode: "timestamp"` (seconds), so cross-path reads rendered 1970 dates. A
 * one-time idempotent migration (scripts/normalize-timestamps.mjs) converts any
 * legacy seconds values (< 1e12) to ms.
 */

/**
 * Long-term memory. Embeddings live in the `vec_memories` sqlite-vec virtual
 * table (rowid = memories.id) because vec0 tables cannot be modeled by Drizzle.
 */
export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  category: text("category").notNull().default("general"),
  source: text("source").notNull().default("chat"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Unified connector feed (GitHub, Obsidian, Telegram later, ...) */
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  title: text("title").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  externalId: text("external_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Per-connector configuration (Obsidian API key, model picker, MCP key, ...) */
export const connectorSettings = sqliteTable("connector_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connector: text("connector").notNull().unique(),
  configJson: text("config_json", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Skill Factory: repeated tasks turned into reusable skills. */
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  /** The skill's system instructions — how to perform the task. */
  instructions: text("instructions").notNull(),
  /** Where this skill came from: 'manual', 'interview', 'usage-pattern'. */
  sourceTask: text("source_task").notNull().default("manual"),
  status: text("status").notNull().default("built"), // candidate | built | deployed | refining
  version: integer("version").notNull().default(1),
  /** Last GitHub deploy target, e.g. "owner/repo@.claude/skills/name". */
  deployedTo: text("deployed_to"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Loop Engine: every skill execution, scored for the refine cycle. */
export const skillRuns = sqliteTable("skill_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  skillId: integer("skill_id").notNull(),
  skillVersion: integer("skill_version").notNull().default(1),
  input: text("input").notNull(),
  output: text("output").notNull(),
  /** 1 = thumbs up, -1 = thumbs down, 0 = unrated. */
  rating: integer("rating").notNull().default(0),
  feedback: text("feedback"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Usage observation: every user request to the agent, logged for the
 * continuous-discovery loop (repeated tasks -> skill candidates).
 */
export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userMessage: text("user_message").notNull(),
  /** Set once a discovery pass has considered this run. */
  analyzed: integer("analyzed").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Multi-turn conversation persistence (Phase 6). One row per conversation;
 * `summary` is the rolling compression of everything up to and including
 * message id `summaryThroughMessageId` — turns after that id are still in
 * chat_messages verbatim and get sent to the model raw.
 */
export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New conversation"),
  summary: text("summary"),
  summaryThroughMessageId: integer("summary_through_message_id"),
  /** "text" | "voice" — which surface last drove this session. */
  lastMode: text("last_mode").notNull().default("text"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Persisted turns. `content` is the flattened plain text (context building,
 * summarization, search); `uiParts` is the full UIMessage parts array so the
 * client restores tool calls/results faithfully on resume.
 */
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  uiParts: text("ui_parts", { mode: "json" }).$type<unknown[]>(),
  /** Provider that answered (assistant rows), e.g. "gemini". */
  brain: text("brain"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Tasks/reminders (Phase 6). Snooze = push remindAt forward. The scheduler
 * fires rows where status='open' AND remindAt <= now AND (lastFiredAt IS NULL
 * OR lastFiredAt < remindAt); recurrence recomputes remindAt after firing.
 */
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"), // open | done
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  remindAt: integer("remind_at", { mode: "timestamp_ms" }),
  /** null | "daily" | "weekdays" | "weekly" | "monthly" */
  recurrence: text("recurrence"),
  lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
})

/**
 * THE one notification queue (MASTER_PLAN_V2 §1.1) — Phase 6 in-tab toasts
 * and Phase 7's companion (Windows toasts + ntfy) consume the SAME rows.
 * `dedupeKey` is UNIQUE so an event can never be enqueued twice; convention:
 * "reminder:task:<taskId>:<remindAtMs>", "connector:<id>:down:<dayBucket>".
 * Channel delivery is recorded per-channel in `channels` (name -> epoch ms);
 * `ackedAt` ends the row's life for every consumer.
 */
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // reminder | calendar | job | digest | connector | system
  title: text("title").notNull(),
  body: text("body"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  taskId: integer("task_id"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  deliverAt: integer("deliver_at", { mode: "timestamp_ms" }).notNull(),
  channels: text("channels", { mode: "json" })
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  ackedAt: integer("acked_at", { mode: "timestamp_ms" }),
  snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Memory = typeof memories.$inferSelect
export type Event = typeof events.$inferSelect
export type ConnectorSetting = typeof connectorSettings.$inferSelect
export type Skill = typeof skills.$inferSelect
export type SkillRun = typeof skillRuns.$inferSelect
export type AgentRun = typeof agentRuns.$inferSelect
export type ChatSession = typeof chatSessions.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Notification = typeof notifications.$inferSelect
