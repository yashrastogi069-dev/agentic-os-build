import { tool } from "ai"
import { z } from "zod"
import { addEvent } from "@/lib/events"

/**
 * GitHub connector — server-side, PAT via GITHUB_TOKEN env var.
 * Sync writes notifications / PRs / issues into the unified events feed.
 */

const GITHUB_API = "https://api.github.com"

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set. Add a GitHub personal access token to .env.local.")
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

async function ghFetch<T>(pathname: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export async function getNotifications(limit = 20) {
  const data = await ghFetch<
    Array<{
      id: string
      reason: string
      updated_at: string
      subject: { title: string; type: string; url: string | null }
      repository: { full_name: string }
    }>
  >(`/notifications?per_page=${limit}`)
  return data.map((n) => ({
    id: n.id,
    reason: n.reason,
    updatedAt: n.updated_at,
    title: n.subject.title,
    type: n.subject.type,
    repo: n.repository.full_name,
  }))
}

export async function searchMyOpenPRs(limit = 15) {
  const user = await ghFetch<{ login: string }>(`/user`)
  const data = await ghFetch<{
    items: Array<{
      number: number
      title: string
      html_url: string
      updated_at: string
      repository_url: string
      state: string
    }>
  }>(`/search/issues?q=${encodeURIComponent(`is:pr is:open author:${user.login}`)}&per_page=${limit}&sort=updated`)
  return data.items.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    updatedAt: pr.updated_at,
    repo: pr.repository_url.replace(`${GITHUB_API}/repos/`, ""),
    state: pr.state,
  }))
}

export async function searchMyOpenIssues(limit = 15) {
  const user = await ghFetch<{ login: string }>(`/user`)
  const data = await ghFetch<{
    items: Array<{
      number: number
      title: string
      html_url: string
      updated_at: string
      repository_url: string
    }>
  }>(
    `/search/issues?q=${encodeURIComponent(`is:issue is:open assignee:${user.login}`)}&per_page=${limit}&sort=updated`,
  )
  return data.items.map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    repo: issue.repository_url.replace(`${GITHUB_API}/repos/`, ""),
  }))
}

export async function getRecentCommits(repo: string, limit = 10) {
  const data = await ghFetch<
    Array<{
      sha: string
      html_url: string
      commit: { message: string; author: { name: string; date: string } }
    }>
  >(`/repos/${repo}/commits?per_page=${limit}`)
  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
  }))
}

/** Pull notifications + PRs + issues into the unified events feed. Idempotent. */
export async function syncGithubToFeed(): Promise<{ added: number }> {
  let added = 0

  const [notifications, prs, issues] = await Promise.all([
    getNotifications(30),
    searchMyOpenPRs(20),
    searchMyOpenIssues(20),
  ])

  for (const n of notifications) {
    if (
      addEvent({
        source: "github",
        title: `[${n.reason}] ${n.title} (${n.repo})`,
        payload: { kind: "notification", ...n },
        externalId: `notification-${n.id}-${n.updatedAt}`,
        createdAt: new Date(n.updatedAt).getTime(),
      })
    )
      added++
  }
  for (const pr of prs) {
    if (
      addEvent({
        source: "github",
        title: `PR #${pr.number}: ${pr.title} (${pr.repo})`,
        payload: { kind: "pr", ...pr },
        externalId: `pr-${pr.repo}-${pr.number}-${pr.updatedAt}`,
        createdAt: new Date(pr.updatedAt).getTime(),
      })
    )
      added++
  }
  for (const issue of issues) {
    if (
      addEvent({
        source: "github",
        title: `Issue #${issue.number}: ${issue.title} (${issue.repo})`,
        payload: { kind: "issue", ...issue },
        externalId: `issue-${issue.repo}-${issue.number}-${issue.updatedAt}`,
        createdAt: new Date(issue.updatedAt).getTime(),
      })
    )
      added++
  }

  return { added }
}

/* ---------- Agent tools ---------- */

export const githubTools = {
  getGithubNotifications: tool({
    description: "Get the user's unread GitHub notifications.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    execute: async ({ limit }) => ({ notifications: await getNotifications(limit ?? 20) }),
  }),
  getMyOpenPRs: tool({
    description: "List the user's open pull requests across all repositories.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    execute: async ({ limit }) => ({ pullRequests: await searchMyOpenPRs(limit ?? 15) }),
  }),
  getMyOpenIssues: tool({
    description: "List open GitHub issues assigned to the user.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    execute: async ({ limit }) => ({ issues: await searchMyOpenIssues(limit ?? 15) }),
  }),
  getRecentCommits: tool({
    description: "Get recent commits for a repository (format: 'owner/repo').",
    inputSchema: z.object({
      repo: z.string().describe("Repository in 'owner/repo' format"),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    execute: async ({ repo, limit }) => ({ commits: await getRecentCommits(repo, limit ?? 10) }),
  }),
}
