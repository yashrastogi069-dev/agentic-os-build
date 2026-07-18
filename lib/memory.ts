import { getRawDb, isVecAvailable, EMBEDDING_DIM } from "@/lib/db"
import { embed, ollamaIsUp } from "@/lib/ollama"

/**
 * Memory engine — the "knows me" core of the OS.
 *
 * Save path: chunk long content -> embed each chunk via local Ollama -> store
 * content in `memories` and vectors in `vec_memories` (rowid = memory id).
 *
 * Recall path: embed query -> sqlite-vec KNN (cosine) -> blend similarity with
 * a recency bonus so fresh context wins ties. Falls back to keyword search
 * when Ollama / sqlite-vec are unavailable so the OS never hard-fails.
 */

export interface MemoryRecord {
  id: number
  content: string
  category: string
  source: string
  createdAt: number
  updatedAt: number
}

export interface RecalledMemory extends MemoryRecord {
  similarity: number | null
  score: number
}

export interface SaveMemoryOptions {
  category?: string
  source?: string
}

export interface RecallOptions {
  limit?: number
  category?: string
  /** 0..1 — how much recency influences ranking (default 0.15) */
  recencyWeight?: number
}

const MAX_CHUNK_CHARS = 1200
const MIN_CHUNK_CHARS = 200

/** Split long content on paragraph, then sentence boundaries. */
export function chunkContent(content: string): string[] {
  const trimmed = content.trim()
  if (trimmed.length <= MAX_CHUNK_CHARS) return trimmed ? [trimmed] : []

  const paragraphs = trimmed.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ""

  const push = () => {
    const c = current.trim()
    if (c) chunks.push(c)
    current = ""
  }

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > MAX_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
      push()
    }
    if (para.length > MAX_CHUNK_CHARS) {
      // Paragraph itself too long — split on sentences.
      push()
      const sentences = para.split(/(?<=[.!?])\s+/)
      for (const sentence of sentences) {
        if ((current + " " + sentence).length > MAX_CHUNK_CHARS) push()
        current = current ? `${current} ${sentence}` : sentence
      }
      push()
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  push()
  return chunks
}

/**
 * Save content to memory. Long content is chunked; each chunk becomes its own
 * memory row + embedding. Returns the ids of the created memories.
 */
export async function saveMemory(
  content: string,
  options: SaveMemoryOptions = {},
): Promise<{ ids: number[]; embedded: boolean }> {
  const db = getRawDb()
  const category = options.category ?? "general"
  const source = options.source ?? "chat"
  const now = Date.now()

  const chunks = chunkContent(content)
  if (chunks.length === 0) return { ids: [], embedded: false }

  let embeddings: number[][] | null = null
  if (isVecAvailable() && (await ollamaIsUp())) {
    try {
      embeddings = await embed(chunks)
    } catch (error) {
      console.error("[agentic-os] embedding failed, saving without vectors:", error)
    }
  }

  const insertMemory = db.prepare(
    `INSERT INTO memories (content, category, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const insertVec = isVecAvailable()
    ? db.prepare(`INSERT INTO vec_memories (rowid, embedding) VALUES (?, ?)`)
    : null

  const ids: number[] = []
  const tx = db.transaction(() => {
    chunks.forEach((chunk, i) => {
      const result = insertMemory.run(chunk, category, source, now, now)
      const id = Number(result.lastInsertRowid)
      ids.push(id)
      const vector = embeddings?.[i]
      if (insertVec && vector && vector.length === EMBEDDING_DIM) {
        insertVec.run(BigInt(id), JSON.stringify(vector))
      }
    })
  })
  tx()

  return { ids, embedded: embeddings !== null }
}

/** Semantic recall with recency weighting; keyword fallback when vectors are unavailable. */
export async function recallMemory(
  query: string,
  options: RecallOptions = {},
): Promise<RecalledMemory[]> {
  const limit = options.limit ?? 6
  const recencyWeight = options.recencyWeight ?? 0.15

  if (isVecAvailable() && (await ollamaIsUp())) {
    try {
      return await vectorRecall(query, limit, options.category, recencyWeight)
    } catch (error) {
      console.error("[agentic-os] vector recall failed, falling back to keyword:", error)
    }
  }
  return keywordRecall(query, limit, options.category)
}

async function vectorRecall(
  query: string,
  limit: number,
  category: string | undefined,
  recencyWeight: number,
): Promise<RecalledMemory[]> {
  const db = getRawDb()
  const [queryVec] = await embed(query)

  // Over-fetch so category filtering + recency re-ranking have candidates.
  const candidates = db
    .prepare(
      `SELECT v.rowid AS id, v.distance AS distance,
              m.content, m.category, m.source, m.created_at, m.updated_at
       FROM vec_memories v
       JOIN memories m ON m.id = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`,
    )
    .all(JSON.stringify(queryVec), Math.max(limit * 4, 20)) as Array<{
    id: number
    distance: number
    content: string
    category: string
    source: string
    created_at: number
    updated_at: number
  }>

  const now = Date.now()
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

  const scored = candidates
    .filter((row) => !category || row.category === category)
    .map((row) => {
      // sqlite-vec default distance is L2; convert to a bounded similarity.
      const similarity = 1 / (1 + row.distance)
      const ageMs = Math.max(0, now - row.created_at)
      const recency = Math.max(0, 1 - ageMs / THIRTY_DAYS)
      const score = similarity * (1 - recencyWeight) + recency * recencyWeight
      return {
        id: row.id,
        content: row.content,
        category: row.category,
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        similarity,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}

function keywordRecall(
  query: string,
  limit: number,
  category: string | undefined,
): RecalledMemory[] {
  const db = getRawDb()
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2)
    .slice(0, 8)

  const rows = db
    .prepare(
      `SELECT id, content, category, source, created_at, updated_at
       FROM memories
       ${category ? "WHERE category = ?" : ""}
       ORDER BY created_at DESC
       LIMIT 500`,
    )
    .all(...(category ? [category] : [])) as Array<{
    id: number
    content: string
    category: string
    source: string
    created_at: number
    updated_at: number
  }>

  const scored = rows
    .map((row) => {
      const haystack = row.content.toLowerCase()
      const hits = terms.filter((t) => haystack.includes(t)).length
      return { row, hits }
    })
    .filter(({ hits }) => hits > 0 || terms.length === 0)
    .sort((a, b) => b.hits - a.hits || b.row.created_at - a.row.created_at)
    .slice(0, limit)

  return scored.map(({ row, hits }) => ({
    id: row.id,
    content: row.content,
    category: row.category,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    similarity: null,
    score: terms.length > 0 ? hits / terms.length : 0,
  }))
}

export function listMemories(limit = 50, category?: string): MemoryRecord[] {
  const db = getRawDb()
  const rows = db
    .prepare(
      `SELECT id, content, category, source, created_at, updated_at
       FROM memories
       ${category ? "WHERE category = ?" : ""}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...(category ? [category, limit] : [limit])) as Array<{
    id: number
    content: string
    category: string
    source: string
    created_at: number
    updated_at: number
  }>

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    category: r.category,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/** Fetch a single memory by id, or undefined if it doesn't exist. */
export function getMemory(id: number): MemoryRecord | undefined {
  const db = getRawDb()
  const row = db
    .prepare(`SELECT id, content, category, source, created_at, updated_at FROM memories WHERE id = ?`)
    .get(id) as
    | { id: number; content: string; category: string; source: string; created_at: number; updated_at: number }
    | undefined
  if (!row) return undefined
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function deleteMemory(id: number): void {
  const db = getRawDb()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(id)
    if (isVecAvailable()) {
      db.prepare(`DELETE FROM vec_memories WHERE rowid = ?`).run(BigInt(id))
    }
  })
  tx()
}

export function memoryStats(): { total: number; byCategory: Record<string, number> } {
  const db = getRawDb()
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }).c
  const rows = db
    .prepare(`SELECT category, COUNT(*) AS c FROM memories GROUP BY category`)
    .all() as Array<{ category: string; c: number }>
  return {
    total,
    byCategory: Object.fromEntries(rows.map((r) => [r.category, r.c])),
  }
}
