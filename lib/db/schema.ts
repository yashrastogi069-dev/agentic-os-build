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

export type Memory = typeof memories.$inferSelect
export type Event = typeof events.$inferSelect
export type ConnectorSetting = typeof connectorSettings.$inferSelect
export type Skill = typeof skills.$inferSelect
export type SkillRun = typeof skillRuns.$inferSelect
export type AgentRun = typeof agentRuns.$inferSelect
