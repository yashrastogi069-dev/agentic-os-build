import { tool } from "ai"
import { z } from "zod"

/**
 * Research chain for the agent toolset (PLAN 2.1):
 * - webSearch(query): Tavily  ->  (on failure) Serper.  Returns normalized
 *   {title, url, snippet}[].
 * - fetchPage(url): Firecrawl v1 scrape -> markdown (15s timeout).
 *
 * All calls degrade gracefully: on failure the tool returns an { error } string
 * the model can relay honestly instead of throwing and killing the chat turn.
 */

const TIMEOUT_MS = 15_000

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

function errText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}

async function tavilySearch(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) throw new Error("TAVILY_API_KEY not set")
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }))
}

async function serperSearch(query: string): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error("SERPER_API_KEY not set")
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Serper ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (data.organic ?? []).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }))
}

export async function webSearch(
  query: string,
): Promise<{ source: string; results: SearchResult[] } | { error: string }> {
  try {
    return { source: "tavily", results: await tavilySearch(query) }
  } catch (error) {
    console.error("[research] tavily failed, trying serper:", errText(error))
  }
  try {
    return { source: "serper", results: await serperSearch(query) }
  } catch (error) {
    console.error("[research] serper failed:", errText(error))
    return { error: `web search unavailable: ${errText(error)}` }
  }
}

export async function fetchPage(
  url: string,
): Promise<{ url: string; markdown: string } | { error: string }> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) return { error: "FIRECRAWL_API_KEY not set" }
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        error: `Firecrawl ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      }
    }
    const data = (await res.json()) as { data?: { markdown?: string } }
    const markdown = data.data?.markdown ?? ""
    if (!markdown) return { error: "Firecrawl returned no readable content for that URL." }
    // Cap so a huge page cannot blow the context window.
    return { url, markdown: markdown.slice(0, 8000) }
  } catch (error) {
    console.error("[research] firecrawl failed:", errText(error))
    return { error: `fetch failed: ${errText(error)}` }
  }
}

export const researchTools = {
  webSearch: tool({
    description:
      "Search the live web for current information: latest versions, recent news, facts, docs, or anything you are unsure about. Returns ranked results with title, url, and snippet. Use this instead of guessing about recent or factual matters.",
    inputSchema: z.object({
      query: z.string().describe("The search query, phrased as you would type it into Google."),
    }),
    execute: async ({ query }) => webSearch(query),
  }),
  fetchPage: tool({
    description:
      "Fetch the main readable content of a web page as markdown, given an absolute URL (e.g. one returned by webSearch). Use to read an article or docs page before answering.",
    inputSchema: z.object({
      url: z.string().describe("The absolute URL to fetch, including https://."),
    }),
    execute: async ({ url }) => fetchPage(url),
  }),
}
