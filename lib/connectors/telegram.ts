import { tool } from "ai"
import { z } from "zod"
import { addEvent } from "@/lib/events"
import { getConnectorConfig, setConnectorConfig } from "@/lib/settings"

/**
 * Telegram connector — free Bot API, long-polling via getUpdates.
 * Local-first: no webhook (no public URL needed). The bot token is stored in
 * connector_settings; the poll offset is persisted so syncs are incremental.
 *
 * Setup: talk to @BotFather -> /newbot -> paste the token in Settings.
 * Then send your bot any message; its chat id is captured on first sync.
 */

const TELEGRAM_API = "https://api.telegram.org"

export interface TelegramSettings extends Record<string, unknown> {
  botToken: string
  /** Captured from the first incoming message; used for sendMessage. */
  defaultChatId?: number
  /** getUpdates offset — last processed update_id + 1. */
  offset?: number
}

export function getTelegramSettings(): TelegramSettings | null {
  const config = getConnectorConfig<TelegramSettings>("telegram")
  if (!config?.botToken) return null
  return config
}

async function tgFetch<T>(token: string, method: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`)
  }
  return json.result as T
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    date: number
    text?: string
    chat: { id: number; first_name?: string; username?: string; type: string }
    from?: { first_name?: string; username?: string }
  }
}

/** Verify the token works; returns the bot's username. */
export async function checkTelegram(): Promise<{ ok: boolean; username?: string }> {
  const settings = getTelegramSettings()
  if (!settings) return { ok: false }
  try {
    const me = await tgFetch<{ username: string }>(settings.botToken, "getMe")
    return { ok: true, username: me.username }
  } catch {
    return { ok: false }
  }
}

/**
 * Poll new messages into the unified feed. Incremental via stored offset;
 * captures defaultChatId from the first message seen.
 */
export async function syncTelegramToFeed(): Promise<{ added: number }> {
  const settings = getTelegramSettings()
  if (!settings) return { added: 0 }

  const updates = await tgFetch<TelegramUpdate[]>(settings.botToken, "getUpdates", {
    offset: settings.offset ?? 0,
    timeout: 0, // short poll — this runs inside a request handler
    allowed_updates: ["message"],
  })

  let added = 0
  let maxUpdateId = (settings.offset ?? 1) - 1
  let chatId = settings.defaultChatId

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id)
    const msg = update.message
    if (!msg?.text) continue
    chatId = chatId ?? msg.chat.id
    const sender = msg.from?.username ?? msg.from?.first_name ?? "unknown"
    if (
      addEvent({
        source: "telegram",
        title: `@${sender}: ${msg.text.slice(0, 160)}`,
        payload: { kind: "message", chatId: msg.chat.id, sender, text: msg.text },
        externalId: `msg-${msg.chat.id}-${msg.message_id}`,
        createdAt: msg.date * 1000,
      })
    )
      added++
  }

  setConnectorConfig("telegram", {
    ...settings,
    offset: maxUpdateId + 1,
    defaultChatId: chatId,
  })
  return { added }
}

/** Send a message from the bot to the user's chat. */
export async function sendTelegramMessage(text: string, chatId?: number): Promise<void> {
  const settings = getTelegramSettings()
  if (!settings) throw new Error("Telegram is not configured. Add a bot token in Settings.")
  const target = chatId ?? settings.defaultChatId
  if (!target) {
    throw new Error("No chat id known yet. Send your bot a message first, then sync the feed.")
  }
  await tgFetch(settings.botToken, "sendMessage", { chat_id: target, text })
}

/* ---------- Agent tools ---------- */

export const telegramTools = {
  sendTelegram: tool({
    description:
      "Send a Telegram message to the user's phone via their bot. Use when asked to 'send me', 'remind me on telegram', or push a summary to their phone.",
    inputSchema: z.object({
      text: z.string().max(4000).describe("The message text to send."),
    }),
    execute: async ({ text }) => {
      await sendTelegramMessage(text)
      return { sent: true }
    },
  }),
  getTelegramMessages: tool({
    description: "Fetch new incoming Telegram messages into the feed and return recent ones.",
    inputSchema: z.object({}),
    execute: async () => {
      const { added } = await syncTelegramToFeed()
      const { getRecentEvents } = await import("@/lib/events")
      return {
        newMessages: added,
        recent: getRecentEvents(10, "telegram").map((e) => e.title),
      }
    },
  }),
}
