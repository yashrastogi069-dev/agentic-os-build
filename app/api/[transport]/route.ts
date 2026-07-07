import { createMcpHandler } from "mcp-handler"
import { z } from "zod"
import { saveMemory, recallMemory, memoryStats } from "@/lib/memory"
import { getRecentEvents } from "@/lib/events"
import { getChatSettings, verifyMcpKey, getMcpKey } from "@/lib/settings"
import { ollamaIsUp } from "@/lib/ollama"
import { getObsidianSettings } from "@/lib/settings"

/**
 * The OS's MCP server — the single connection point for Claude Code.
 * Register once:  claude mcp add agentic-os http://localhost:3000/api/mcp \
 *                   --transport http --header "Authorization: Bearer <key>"
 * The key is generated in Settings and stored in the local DB.
 */

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_memory",
      {
        title: "Search Memory",
        description:
          "Semantic search over the OS's long-term memory (includes indexed Obsidian notes).",
        inputSchema: {
          query: z.string(),
          category: z.string().optional(),
          limit: z.number().int().min(1).max(25).optional(),
        },
      },
      async ({ query, category, limit }) => {
        const results = await recallMemory(query, { limit: limit ?? 6, category })
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                results.map((m) => ({
                  id: m.id,
                  content: m.content,
                  category: m.category,
                  source: m.source,
                  createdAt: new Date(m.createdAt).toISOString(),
                })),
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    server.registerTool(
      "save_memory",
      {
        title: "Save Memory",
        description: "Save information to the OS's long-term memory.",
        inputSchema: {
          content: z.string(),
          category: z.string().optional(),
        },
      },
      async ({ content, category }) => {
        const result = await saveMemory(content, { category, source: "claude-code" })
        return {
          content: [
            {
              type: "text",
              text: `Saved ${result.ids.length} memory chunk(s)${result.embedded ? " with semantic index" : " (keyword-only: Ollama offline)"}.`,
            },
          ],
        }
      },
    )

    server.registerTool(
      "get_updates_feed",
      {
        title: "Get Updates Feed",
        description:
          "Recent events from connected services (GitHub notifications, PRs, issues, etc.).",
        inputSchema: {
          source: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ source, limit }) => {
        const items = getRecentEvents(limit ?? 30, source)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                items.map((e) => ({
                  source: e.source,
                  title: e.title,
                  createdAt: new Date(e.createdAt).toISOString(),
                })),
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    server.registerTool(
      "get_agent_status",
      {
        title: "Get Agent Status",
        description: "Health and configuration snapshot of the Agentic OS.",
        inputSchema: {},
      },
      async () => {
        const stats = memoryStats()
        const status = {
          chatBrain: getChatSettings(),
          ollamaUp: await ollamaIsUp(),
          groqConfigured: Boolean(process.env.GROQ_API_KEY),
          githubConfigured: Boolean(process.env.GITHUB_TOKEN),
          obsidianConfigured: Boolean(getObsidianSettings()),
          memories: stats,
        }
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] }
      },
    )

    // Stubs — implemented by the Skill Factory phase.
    server.registerTool(
      "list_skills",
      {
        title: "List Skills",
        description: "List skills created by the Skill Factory. (Not built yet — later phase.)",
        inputSchema: {},
      },
      async () => ({
        content: [{ type: "text", text: "Skill Factory not built yet (planned phase 6). No skills exist." }],
      }),
    )
    server.registerTool(
      "run_skill",
      {
        title: "Run Skill",
        description: "Run a skill by name. (Not built yet — later phase.)",
        inputSchema: { name: z.string() },
      },
      async ({ name }) => ({
        content: [{ type: "text", text: `Skill Factory not built yet — cannot run "${name}".` }],
      }),
    )
  },
  {},
  {
    basePath: "/api",
    maxDuration: 120,
    verboseLogs: false,
  },
)

/** Bearer-key gate. Local-first: the key just prevents other local processes / LAN peers from driving the OS. */
function withKey(next: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!getMcpKey()) {
      return new Response(
        JSON.stringify({ error: "MCP key not set. Generate one in Agentic OS Settings first." }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      )
    }
    const auth = req.headers.get("authorization")
    const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : null
    if (!verifyMcpKey(provided)) {
      return new Response(JSON.stringify({ error: "Invalid or missing MCP key." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    return next(req)
  }
}

const guarded = withKey(handler)
export { guarded as GET, guarded as POST, guarded as DELETE }
