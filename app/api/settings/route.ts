import { NextResponse } from "next/server"
import {
  getChatSettings,
  setConnectorConfig,
  getMcpKey,
  regenerateMcpKey,
  getObsidianSettings,
  DEFAULT_GROQ_MODEL,
} from "@/lib/settings"

export const dynamic = "force-dynamic"

/** GET /api/settings — current settings (MCP key included: single-user local app). */
export async function GET() {
  const obsidian = getObsidianSettings()
  return NextResponse.json({
    chat: getChatSettings(),
    mcp: { key: getMcpKey() },
    obsidian: obsidian
      ? { configured: true, baseUrl: obsidian.baseUrl }
      : { configured: false, baseUrl: "http://127.0.0.1:27123" },
    defaults: { groqModel: DEFAULT_GROQ_MODEL },
  })
}

/**
 * POST /api/settings
 * { action: "setChat", brain, groqModel? }
 * { action: "setObsidian", apiKey, baseUrl? }
 * { action: "regenerateMcpKey" }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string
    brain?: string
    groqModel?: string
    apiKey?: string
    baseUrl?: string
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
    case "regenerateMcpKey": {
      const key = regenerateMcpKey()
      return NextResponse.json({ ok: true, key })
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 })
  }
}
