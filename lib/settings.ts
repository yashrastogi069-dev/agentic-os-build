import crypto from "node:crypto"
import { getRawDb } from "@/lib/db"

/**
 * Key-value connector settings stored in SQLite (connector_settings table).
 * Used for: Obsidian API key, chat model picker, MCP endpoint key.
 * Local-first: this file is the user's own machine — no extra encryption layer.
 */

export function getConnectorConfig<T extends Record<string, unknown>>(
  connector: string,
): T | null {
  const db = getRawDb()
  const row = db
    .prepare(`SELECT config_json FROM connector_settings WHERE connector = ?`)
    .get(connector) as { config_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.config_json) as T
  } catch {
    return null
  }
}

export function setConnectorConfig(
  connector: string,
  config: Record<string, unknown>,
): void {
  const db = getRawDb()
  db.prepare(
    `INSERT INTO connector_settings (connector, config_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(connector) DO UPDATE SET config_json = excluded.config_json,
                                          updated_at = excluded.updated_at`,
  ).run(connector, JSON.stringify(config), Date.now())
}

/* ---------- Chat model picker ---------- */

export type ChatBrain = "groq" | "ollama"

export interface ChatSettings extends Record<string, unknown> {
  brain: ChatBrain
  groqModel: string
}

export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"

export function getChatSettings(): ChatSettings {
  const config = getConnectorConfig<ChatSettings>("chat")
  return {
    brain: config?.brain === "ollama" ? "ollama" : "groq",
    groqModel: config?.groqModel || DEFAULT_GROQ_MODEL,
  }
}

/* ---------- MCP endpoint key ---------- */

export function getMcpKey(): string | null {
  const config = getConnectorConfig<{ key: string }>("mcp")
  return config?.key ?? null
}

export function regenerateMcpKey(): string {
  const key = `aos_${crypto.randomBytes(24).toString("hex")}`
  setConnectorConfig("mcp", { key })
  return key
}

export function verifyMcpKey(provided: string | null): boolean {
  const key = getMcpKey()
  if (!key || !provided) return false
  const a = Buffer.from(key)
  const b = Buffer.from(provided)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/* ---------- System (companion) token ---------- */

/**
 * Bearer token for the local system/companion API surface (app/api/system/*).
 * Auto-generates on first read so there is never a "not configured" open-auth
 * window — do NOT add a null-token bypass anywhere that reads this.
 */
export function getSystemToken(): string {
  const config = getConnectorConfig<{ token: string }>("system")
  if (config?.token) return config.token
  return regenerateSystemToken()
}

export function regenerateSystemToken(): string {
  const token = crypto.randomBytes(16).toString("hex")
  setConnectorConfig("system", { token })
  return token
}

export function verifySystemToken(provided: string | null): boolean {
  if (!provided) return false
  const a = Buffer.from(getSystemToken())
  const b = Buffer.from(provided)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/* ---------- Obsidian ---------- */

export interface ObsidianSettings extends Record<string, unknown> {
  apiKey: string
  baseUrl: string
}

export function getObsidianSettings(): ObsidianSettings | null {
  const config = getConnectorConfig<ObsidianSettings>("obsidian")
  if (!config?.apiKey) return null
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || "http://127.0.0.1:27123",
  }
}
