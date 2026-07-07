'use client'

import { useState } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type FeedEvent = {
  id: number
  source: string
  type: string
  title: string
  url: string | null
  occurredAt: string
}

const sourceColor: Record<string, string> = {
  github: 'text-primary',
  obsidian: 'text-accent',
  system: 'text-muted-foreground',
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function FeedPanel() {
  const { data, error, isLoading, mutate } = useSWR<{ events: FeedEvent[] }>(
    '/api/feed',
    fetcher,
    { refreshInterval: 60_000 },
  )
  const [syncing, setSyncing] = useState(false)

  async function syncNow() {
    setSyncing(true)
    try {
      await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await mutate()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          unified events
        </span>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          {syncing ? 'syncing…' : 'sync'}
        </button>
      </div>
      {isLoading && (
        <p className="animate-pulse font-mono text-xs text-muted-foreground">
          syncing feeds…
        </p>
      )}
      {error && (
        <p className="font-mono text-xs text-destructive">feed unavailable</p>
      )}
      {data?.events?.length === 0 && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {'> no events yet.'}
          <br />
          {'> connect GitHub / Obsidian in settings, then refresh.'}
        </p>
      )}
      <ul className="space-y-2">
        {data?.events?.map((event) => (
          <li
            key={event.id}
            className="rounded-sm border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-mono text-[10px] uppercase tracking-widest ${sourceColor[event.source] ?? 'text-muted-foreground'}`}
              >
                {event.source} · {event.type}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {timeAgo(event.occurredAt)}
              </span>
            </div>
            {event.url ? (
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-pretty text-sm text-foreground underline-offset-2 hover:underline"
              >
                {event.title}
              </a>
            ) : (
              <p className="mt-1 text-pretty text-sm text-foreground">
                {event.title}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
