import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Long-term memory. Embeddings live in the `vec_memories` sqlite-vec virtual
 * table (rowid = memories.id) because vec0 tables cannot be modeled by Drizzle.
 */
export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  category: text("category").notNull().default("general"),
  source: text("source").notNull().default("chat"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
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
  createdAt: integer("created_at", { mode: "timestamp" })
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
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Memory = typeof memories.$inferSelect
export type Event = typeof events.$inferSelect
export type ConnectorSetting = typeof connectorSettings.$inferSelect
