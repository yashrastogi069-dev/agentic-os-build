'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Settings2 } from 'lucide-react'

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
  voice: { whisper: boolean; piper: boolean }
  chat: { brain: 'groq' | 'ollama'; groqModel: string }
  brain?: {
    active: string
    chain: { id: string; label: string; status: 'active' | 'ready' | 'cooling' | 'down' }[]
  }
  mcp: { keySet: boolean }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useHealth() {
  return useSWR<HealthData>('/api/health', fetcher, { refreshInterval: 10_000 })
}

function Dot({ label, state }: { label: string; state: 'ok' | 'warn' | 'off' }) {
  const color =
    state === 'ok' ? 'bg-success' : state === 'warn' ? 'bg-warning' : 'bg-muted-foreground/40'
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
    <header className="flex items-center justify-between gap-4 border-b border-border bg-card/60 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-glow font-mono text-sm font-semibold tracking-widest text-primary">
          AGENTIC/OS
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
          local-first
        </span>
      </div>

      <div className="hidden flex-wrap items-center gap-4 md:flex">
        {data?.brain?.active && (
          <span
            className="font-mono text-[10px] uppercase tracking-widest text-primary/80"
            title="Active AI provider (failsafe chain head)"
          >
            brain: {data.brain.active}
          </span>
        )}
        <Dot label="db" state={data?.db.ok ? (data.db.vec ? 'ok' : 'warn') : 'off'} />
        <Dot
          label="ollama"
          state={data?.ollama.ok ? (data.ollama.embeddingModel.pulled ? 'ok' : 'warn') : 'off'}
        />
        <Dot label="groq" state={data?.groq.configured ? 'ok' : 'off'} />
        <Dot
          label="obsidian"
          state={data?.obsidian.ok ? 'ok' : data?.obsidian.configured ? 'warn' : 'off'}
        />
        <Dot
          label="voice"
          state={
            data?.voice.whisper && data?.voice.piper
              ? 'ok'
              : data?.voice.whisper || data?.voice.piper
                ? 'warn'
                : 'off'
          }
        />
        <Dot label="github" state={data?.github.configured ? 'ok' : 'off'} />
        <Dot label="mcp" state={data?.mcp.keySet ? 'ok' : 'off'} />
      </div>

      <div className="flex items-center gap-3">
        <time className="font-mono text-xs tabular-nums text-muted-foreground">{time}</time>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md border border-border bg-secondary p-1.5 text-muted-foreground transition-colors hover:text-primary"
          aria-label="Open settings"
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
