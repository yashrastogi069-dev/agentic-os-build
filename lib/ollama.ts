/**
 * Thin client for the local Ollama server.
 * - Embeddings: nomic-embed-text (768 dims), generated on save only.
 * - Offline chat fallback: llama3.2:3b via Ollama's OpenAI-compatible endpoint
 *   (wired up in lib/agent.ts).
 */

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"
export const EMBEDDING_MODEL = "nomic-embed-text"
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2:3b"

export async function ollamaIsUp(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Returns the list of locally pulled model names (e.g. to verify nomic-embed-text). */
export async function ollamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

/** Embed one or more texts with nomic-embed-text. Throws if Ollama is unreachable. */
export async function embed(input: string | string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `Ollama embed failed (${res.status}): ${body || res.statusText}. ` +
        `Is Ollama running and is "${EMBEDDING_MODEL}" pulled? (ollama pull ${EMBEDDING_MODEL})`,
    )
  }

  const data = (await res.json()) as { embeddings: number[][] }
  return data.embeddings
}
