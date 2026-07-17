import { NextResponse } from "next/server"
import {
  getChatSettings,
  setConnectorConfig,
  getMcpKey,
  regenerateMcpKey,
  getObsidianSettings,
  DEFAULT_GROQ_MODEL,
} from "@/lib/settings"
import { getTelegramSettings } from "@/lib/connectors/telegram"
import { getGoogleSettings, isGoogleConnected } from "@/lib/connectors/google"
import { getAppleSettings } from "@/lib/connectors/apple"
import { getAssistantPreferences, setAssistantPreference } from "@/lib/assistant/prompt"

export const dynamic = "force-dynamic"

/** GET /api/settings — current settings (MCP key included: single-user local app). */
export async function GET() {
  const obsidian = getObsidianSettings()
  const google = getGoogleSettings()
  const apple = getAppleSettings()
  return NextResponse.json({
    chat: getChatSettings(),
    mcp: { key: getMcpKey() },
    obsidian: obsidian
      ? { configured: true, baseUrl: obsidian.baseUrl }
      : { configured: false, baseUrl: "http://127.0.0.1:27123" },
    telegram: { configured: Boolean(getTelegramSettings()) },
    google: { credentials: Boolean(google), connected: isGoogleConnected() },
    apple: { configured: Boolean(apple), appleId: apple?.appleId ?? "" },
    defaults: { groqModel: DEFAULT_GROQ_MODEL },
    assistant: getAssistantPreferences(),
  })
}

/**
 * POST /api/settings
 * { action: "setChat", brain, groqModel? }
 * { action: "setObsidian", apiKey, baseUrl? }
 * { action: "setAssistant", key: "tone" | "verbosity" | "address", value }
 * { action: "regenerateMcpKey" }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string
    brain?: string
    groqModel?: string
    apiKey?: string
    baseUrl?: string
    botToken?: string
    clientId?: string
    clientSecret?: string
    appleId?: string
    appPassword?: string
    key?: string
    value?: string
  }

  switch (body.action) {
    case "setChat": {
      const brain = body.brain === "ollama" ? "ollama" : "groq"
      setConnectorConfig("chat", {
        brain,
        groqModel: body.groqModel?.trim() || DEFAULT_GROQ_MODEL,
      })
      return NextResponse.json({ ok: true, chat: getChatSettings() })
    }
    case "setObsidian": {
      if (!body.apiKey?.trim()) {
        return NextResponse.json({ error: "apiKey is required" }, { status: 400 })
      }
      setConnectorConfig("obsidian", {
        apiKey: body.apiKey.trim(),
        baseUrl: body.baseUrl?.trim() || "http://127.0.0.1:27123",
      })
      return NextResponse.json({ ok: true })
    }
    case "setTelegram": {
      if (!body.botToken?.trim()) {
        return NextResponse.json({ error: "botToken is required" }, { status: 400 })
      }
      setConnectorConfig("telegram", { botToken: body.botToken.trim() })
      return NextResponse.json({ ok: true })
    }
    case "setGoogleCredentials": {
      if (!body.clientId?.trim() || !body.clientSecret?.trim()) {
        return NextResponse.json(
          { error: "clientId and clientSecret are required" },
          { status: 400 },
        )
      }
      // Preserve an existing refresh token unless the client id changed.
      const existing = getGoogleSettings()
      const sameClient = existing?.clientId === body.clientId.trim()
      setConnectorConfig("google", {
        clientId: body.clientId.trim(),
        clientSecret: body.clientSecret.trim(),
        ...(sameClient && existing?.refreshToken
          ? { refreshToken: existing.refreshToken }
          : {}),
      })
      return NextResponse.json({ ok: true })
    }
    case "setApple": {
      if (!body.appleId?.trim() || !body.appPassword?.trim()) {
        return NextResponse.json(
          { error: "appleId and appPassword are required" },
          { status: 400 },
        )
      }
      setConnectorConfig("apple", {
        appleId: body.appleId.trim(),
        appPassword: body.appPassword.trim(),
      })
      return NextResponse.json({ ok: true })
    }
    case "setAssistant": {
      if (body.key !== "tone" && body.key !== "verbosity" && body.key !== "address") {
        return NextResponse.json(
          { error: "key must be one of: tone, verbosity, address" },
          { status: 400 },
        )
      }
      if (typeof body.value !== "string" || !body.value.trim()) {
        return NextResponse.json({ error: "value is required" }, { status: 400 })
      }
      try {
        const assistant = setAssistantPreference(body.key, body.value.trim())
        return NextResponse.json({ ok: true, assistant })
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "failed to save preference" },
          { status: 400 },
        )
      }
    }
    case "regenerateMcpKey": {
      const key = regenerateMcpKey()
      return NextResponse.json({ ok: true, key })
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 })
  }
}
