/**
 * Seed data — honest placeholder content shown when local services are
 * unreachable (e.g. in a cloud preview, or before connectors are set up).
 * Panels that render these MUST show a "disconnected · seed data" badge.
 */

export type SeedEvent = {
  id: number
  source: string
  type: string
  title: string
  url: string | null
  occurredAt: string
}

export type SeedMemory = {
  id: number
  content: string
  category: string
  source: string
  createdAt: number
  score?: number
}

const now = Date.now()

export const SEED_EVENTS: SeedEvent[] = [
  {
    id: -1,
    source: "github",
    type: "pull-request",
    title: "[seed] PR #42 opened: add memory recall weighting",
    url: null,
    occurredAt: new Date(now - 12 * 60_000).toISOString(),
  },
  {
    id: -2,
    source: "obsidian",
    type: "vault-snapshot",
    title: "[seed] Vault online — 128 notes",
    url: null,
    occurredAt: new Date(now - 45 * 60_000).toISOString(),
  },
  {
    id: -3,
    source: "github",
    type: "issue",
    title: "[seed] Issue: voice loop drops first word on old CPUs",
    url: null,
    occurredAt: new Date(now - 3 * 3_600_000).toISOString(),
  },
  {
    id: -4,
    source: "system",
    type: "briefing",
    title: "[seed] Morning brief compiled: 2 PRs, 1 note updated",
    url: null,
    occurredAt: new Date(now - 8 * 3_600_000).toISOString(),
  },
]

export const SEED_MEMORIES: SeedMemory[] = [
  {
    id: -1,
    content:
      "[seed] User prefers concise briefings: bullet points, most urgent item first.",
    category: "preference",
    source: "chat",
    createdAt: now - 2 * 86_400_000,
  },
  {
    id: -2,
    content:
      "[seed] Working on the Agentic OS project — local-first, SQLite + Ollama embeddings, Groq for chat.",
    category: "project",
    source: "chat",
    createdAt: now - 5 * 86_400_000,
  },
  {
    id: -3,
    content:
      "[seed] Obsidian vault lives at ~/vault; daily notes under /daily, project notes under /projects.",
    category: "fact",
    source: "obsidian",
    createdAt: now - 9 * 86_400_000,
  },
]
