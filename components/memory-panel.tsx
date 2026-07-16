'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { SEED_MEMORIES } from '@/lib/seed-data'
import { GhostButton, HairlineRow, HudInput, SeedBadge, StaggerList } from '@/components/hud/panel-kit'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Memory = {
  id: number
  content: string
  category: string
  source: string
  createdAt: number
  score?: number
}

export function MemoryPanel() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const { data, error, isLoading } = useSWR<{
    memories: Memory[]
    seeded?: boolean
  }>(
    submitted
      ? `/api/memories?q=${encodeURIComponent(submitted)}`
      : '/api/memories',
    fetcher,
  )

  // Honest fallback: if the API itself is unreachable, render seed data
  // client-side — always with the disconnected badge.
  const seeded = Boolean(error) || Boolean(data?.seeded)
  const memories = error ? SEED_MEMORIES : (data?.memories ?? [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(query.trim())
        }}
      >
        <HudInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="semantic search…"
          aria-label="Search memories"
        />
        <GhostButton type="submit">recall</GhostButton>
      </form>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {seeded && (
          <div className="flex justify-end">
            <SeedBadge />
          </div>
        )}
        {isLoading && (
          <p className="animate-pulse font-mono text-xs text-muted-foreground">
            recalling…
          </p>
        )}
        {memories.length === 0 && !isLoading && (
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            {'> memory bank empty.'}
            <br />
            {'> tell the agent something worth remembering.'}
          </p>
        )}
        <StaggerList
          items={memories}
          keyFn={(memory) => memory.id}
          renderItem={(memory) => (
            <HairlineRow>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                  {memory.category} · {memory.source}
                </span>
                {typeof memory.score === 'number' && (
                  <span className="numeric font-mono text-[10px] text-primary">
                    {(memory.score * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-pretty text-sm leading-relaxed text-foreground">
                {memory.content}
              </p>
            </HairlineRow>
          )}
        />
      </div>
    </div>
  )
}
