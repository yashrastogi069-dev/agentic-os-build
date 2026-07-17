'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { GearSix } from '@phosphor-icons/react'

export interface HealthData {
  db: { ok: boolean; vec: boolean; memories: { total: number } }
  ollama: {
    ok: boolean
    embeddingModel: { name: string; pulled: boolean }
    chatModel: { name: string; pulled: boolean }
  }
  groq: { configured: boolean }
  github: { configured: boolean }
  obsidian: { configured: boolean; ok: boolean }
  telegram: { configured: boolean }
  google: { credentials: boolean; connected: boolean }
  apple: { configured: boolean }
  voice: { whisper: boolean; piper: boolean }
  // Chunk 5A-3: single source of truth for connector status, keyed by
  // registry id (lib/connectors/registry.ts). Deliberately NOT imported from
  // that file here — this is a client component, and registry.ts pulls in
  // better-sqlite3/node:fs transitively via lib/settings, which breaks the
  // client bundle (this happened once already; do not repeat it). The shape
  // is just the JSON the health route already serializes.
  connectors: Record<string, { label: string; status: 'ok' | 'warn' | 'off'; reason?: string }>
  chat: { brain: 'groq' | 'ollama'; groqModel: string }
  brain?: {
    active: string
    chain: { id: string; label: string; status: 'active' | 'ready' | 'cooling' | 'down' }[]
  }
  mcp: { keySet: boolean }
}

type DotState = 'ok' | 'warn' | 'off'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useHealth() {
  return useSWR<HealthData>('/api/health', fetcher, { refreshInterval: 10_000 })
}

/** Reads a connector's dot state from health.connectors[id], defaulting to 'off' if absent (probe not yet in). */
function connectorState(data: HealthData, id: string): DotState {
  return data.connectors?.[id]?.status ?? 'off'
}

/**
 * Data-driven connector dots — Phase 4B, flipped onto the registry's
 * `connectors` map in chunk 5A-3. One entry per connector the registry
 * knows about; adding a new one later is a one-line append here, not a new
 * `<Dot>` call site. `db`, `ollama`, and `mcp` aren't registry connectors
 * (db/ollama are infra, mcp is "is a key set"), so they keep their own
 * hardcoded checks against the top-level health fields, same as before.
 */
const DOT_DESCRIPTORS: Array<{ id: string; label: string; state: (data: HealthData) => DotState }> = [
  { id: 'db', label: 'db', state: (data) => (data.db.ok ? (data.db.vec ? 'ok' : 'warn') : 'off') },
  {
    id: 'ollama',
    label: 'ollama',
    state: (data) => (data.ollama.ok ? (data.ollama.embeddingModel.pulled ? 'ok' : 'warn') : 'off'),
  },
  { id: 'obsidian', label: 'obsidian', state: (data) => connectorState(data, 'obsidian') },
  { id: 'github', label: 'github', state: (data) => connectorState(data, 'github') },
  { id: 'telegram', label: 'telegram', state: (data) => connectorState(data, 'telegram') },
  { id: 'google', label: 'google', state: (data) => connectorState(data, 'google') },
  { id: 'apple', label: 'apple', state: (data) => connectorState(data, 'apple') },
  { id: 'voice', label: 'voice', state: (data) => connectorState(data, 'voice') },
  { id: 'mcp', label: 'mcp', state: (data) => (data.mcp.keySet ? 'ok' : 'off') },
]

function Dot({ label, state }: { label: string; state: DotState }) {
  const color =
    state === 'ok'
      ? 'bg-success text-success shadow-[0_0_6px_currentColor]'
      : state === 'warn'
        ? 'bg-warning text-warning shadow-[0_0_6px_currentColor]'
        : 'bg-muted-foreground/40'
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${state}`}>
      <span
        className={`inline-block size-1.5 rounded-full ${color} ${state === 'ok' ? 'animate-core-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="sr-only">{`${label} status: ${state}`}</span>
    </div>
  )
}

/**
 * Below `lg`, nine individual dots would wrap the bar — collapse them into
 * one aggregate "links n/m" dot instead. `n` counts connectors that are at
 * least `warn`-or-better (i.e. not fully down); the title lists exactly
 * which ones are down, so the honesty of the full row is preserved, just
 * summarized. `data` is optional so the dot still renders (all-down, honest)
 * while the health probe is in flight, same as the individual dots below.
 */
function AggregateDot({ data }: { data?: HealthData }) {
  const { up, total, down } = useMemo(() => {
    const states = DOT_DESCRIPTORS.map((d) => ({ id: d.id, state: data ? d.state(data) : ('off' as DotState) }))
    const down = states.filter((s) => s.state === 'off').map((s) => s.id)
    return { up: states.length - down.length, total: states.length, down }
  }, [data])
  const state: DotState = down.length === 0 ? 'ok' : up === 0 ? 'off' : 'warn'
  const color =
    state === 'ok'
      ? 'bg-success text-success shadow-[0_0_6px_currentColor]'
      : state === 'warn'
        ? 'bg-warning text-warning shadow-[0_0_6px_currentColor]'
        : 'bg-muted-foreground/40'
  const title = down.length === 0 ? `links ${up}/${total}: all connected` : `links ${up}/${total}: down — ${down.join(', ')}`
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span
        className={`inline-block size-1.5 rounded-full ${color} ${state === 'ok' ? 'animate-core-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className="numeric font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        links {up}/{total}
      </span>
      <span className="sr-only">{title}</span>
    </div>
  )
}

export function StatusBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data } = useHealth()
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex items-center justify-between gap-4 bg-transparent px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="display text-glow text-[15px] font-semibold tracking-[0.02em] text-primary">
          AGENTIC<span className="text-accent">/</span>OS
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
          local-first
        </span>
      </div>

      {/* >=lg: full connector row + brain indicator. <lg: one aggregate dot,
          so the bar never wraps. Dots render immediately at "off" while the
          health probe is in flight (data undefined), then flip live — same
          graceful-degrade behavior as before this refactor. */}
      <div className="flex min-w-0 items-center">
        <div className="hidden flex-wrap items-center gap-4 lg:flex">
          <span
            className="text-glow font-mono text-[10px] uppercase tracking-widest text-primary"
            title="Active AI provider (failsafe chain head)"
          >
            brain: {data?.brain?.active ?? '—'}
          </span>
          {DOT_DESCRIPTORS.map((d) => (
            <Dot key={d.id} label={d.label} state={data ? d.state(data) : 'off'} />
          ))}
        </div>
        <div className="flex lg:hidden">
          <AggregateDot data={data} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <time className="numeric font-mono text-xs tabular-nums text-foreground/75">{time}</time>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[oklch(from_var(--accent-live)_l_c_h_/_10%)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open settings"
        >
          <GearSix className="size-4" weight="thin" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
