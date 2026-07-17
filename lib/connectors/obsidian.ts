import { tool } from "ai"
import { z } from "zod"
import { getObsidianSettings } from "@/lib/settings"
import { saveMemory } from "@/lib/memory"
import { addEvent } from "@/lib/events"

/**
 * Obsidian connector — server-side, first-class.
 * Talks to the Local REST API community plugin on http://127.0.0.1:27123
 * (the plain-HTTP port; enable "Non-encrypted (HTTP) Server" in plugin settings).
 * The API key is stored in Settings (DB), not env.
 */

class ObsidianNotConfiguredError extends Error {
  constructor() {
    super(
      "Obsidian is not configured. Add the Local REST API plugin key in Settings, and make sure Obsidian is running with the plugin's HTTP server enabled on port 27123.",
    )
  }
}

async function obsidianFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const settings = getObsidianSettings()
  if (!settings) throw new ObsidianNotConfiguredError()

  const res = await fetch(`${settings.baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  return res
}

export async function searchNotes(query: string, limit = 10) {
  const res = await obsidianFetch(
    `/search/simple/?query=${encodeURIComponent(query)}&contextLength=200`,
    { method: "POST" },
  )
  if (!res.ok) throw new Error(`Obsidian search failed: ${res.status} ${await res.text()}`)
  const results = (await res.json()) as Array<{
    filename: string
    score: number
    matches: Array<{ context: string }>
  }>
  return results.slice(0, limit).map((r) => ({
    path: r.filename,
    score: r.score,
    snippets: r.matches.slice(0, 3).map((m) => m.context),
  }))
}

export async function readNote(notePath: string): Promise<string> {
  const res = await obsidianFetch(`/vault/${encodePath(notePath)}`, {
    headers: { Accept: "text/markdown" },
  })
  if (res.status === 404) throw new Error(`Note not found: ${notePath}`)
  if (!res.ok) throw new Error(`Obsidian read failed: ${res.status}`)
  return res.text()
}

export async function appendNote(notePath: string, content: string): Promise<void> {
  const res = await obsidianFetch(`/vault/${encodePath(notePath)}`, {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  })
  if (!res.ok) throw new Error(`Obsidian append failed: ${res.status} ${await res.text()}`)
}

export async function createNote(notePath: string, content: string): Promise<void> {
  const res = await obsidianFetch(`/vault/${encodePath(notePath)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  })
  if (!res.ok) throw new Error(`Obsidian create failed: ${res.status} ${await res.text()}`)
}

export async function listVaultFiles(dir = ""): Promise<string[]> {
  const res = await obsidianFetch(`/vault/${dir ? `${encodePath(dir)}/` : ""}`)
  if (!res.ok) throw new Error(`Obsidian list failed: ${res.status}`)
  const data = (await res.json()) as { files: string[] }
  return data.files
}

/**
 * Index the vault into memory: walks all markdown files, embeds their content
 * (chunked), tagged source="obsidian" so notes are semantically recallable.
 * Returns counts. Long vaults: runs sequentially to stay light on old CPUs.
 */
export async function indexVault(): Promise<{ files: number; memories: number; errors: string[] }> {
  const errors: string[] = []
  let fileCount = 0
  let memoryCount = 0

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await listVaultFiles(dir)
    const files: string[] = []
    for (const entry of entries) {
      const full = dir ? `${dir}/${entry}` : entry
      if (entry.endsWith("/")) {
        files.push(...(await walk(full.slice(0, -1))))
      } else if (entry.endsWith(".md")) {
        files.push(full)
      }
    }
    return files
  }

  const mdFiles = await walk("")
  for (const file of mdFiles) {
    try {
      const content = await readNote(file)
      if (!content.trim()) continue
      const result = await saveMemory(`[Note: ${file}]\n\n${content}`, {
        category: "note",
        source: "obsidian",
      })
      fileCount++
      memoryCount += result.ids.length
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { files: fileCount, memories: memoryCount, errors: errors.slice(0, 10) }
}

function encodePath(notePath: string): string {
  return notePath.split("/").map(encodeURIComponent).join("/")
}

/**
 * Live reachability probe — same logic as the inline `probeObsidian` in
 * app/api/health/route.ts (that route keeps its own copy for now; this
 * export exists so lib/connectors/registry.ts can reuse the identical check
 * without a network-call-shaped health-route refactor, which is out of
 * scope for the registry pass).
 */
export async function checkObsidian(): Promise<{ configured: boolean; ok: boolean }> {
  const settings = getObsidianSettings()
  if (!settings) return { configured: false, ok: false }
  try {
    const res = await fetch(`${settings.baseUrl}/`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(1500),
    })
    return { configured: true, ok: res.ok }
  } catch {
    return { configured: true, ok: false }
  }
}

/**
 * Feed sync — records a daily vault snapshot event (file count + reachability).
 * The Local REST API has no modified-since endpoint, so per-note change events
 * aren't available; the snapshot keeps the feed honest about vault status.
 */
export async function syncObsidianToFeed(): Promise<{ added: number }> {
  const walk = async (dir: string): Promise<number> => {
    const entries = await listVaultFiles(dir)
    let count = 0
    for (const entry of entries) {
      const full = dir ? `${dir}/${entry}` : entry
      if (entry.endsWith("/")) count += await walk(full.slice(0, -1))
      else if (entry.endsWith(".md")) count++
    }
    return count
  }
  const noteCount = await walk("")
  const day = new Date().toISOString().slice(0, 10)
  const added = addEvent({
    source: "obsidian",
    title: `Vault online — ${noteCount} notes`,
    payload: { kind: "vault-snapshot", noteCount },
    externalId: `vault-snapshot-${day}`,
  })
  return { added: added ? 1 : 0 }
}

/* ---------- Agent tools ---------- */

export const obsidianTools = {
  searchNotes: tool({
    description: "Search the user's Obsidian vault for notes matching a query. Returns file paths and matching snippets.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ query, limit }) => ({
      results: await searchNotes(query, limit ?? 10),
    }),
  }),
  readNote: tool({
    description: "Read the full markdown content of a note in the Obsidian vault by its path (e.g. 'Projects/agentic-os.md').",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => ({ path, content: await readNote(path) }),
  }),
  appendNote: tool({
    description: "Append markdown content to the end of an existing note in the Obsidian vault.",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      await appendNote(path, content)
      return { ok: true, path }
    },
  }),
  createNote: tool({
    description: "Create a new note (or overwrite an existing one) in the Obsidian vault at the given path.",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      await createNote(path, content)
      return { ok: true, path }
    },
  }),
}
