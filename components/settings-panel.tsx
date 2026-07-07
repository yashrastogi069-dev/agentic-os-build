'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Settings = {
  chat: { brain: 'groq' | 'ollama'; groqModel: string }
  mcp: { key: string }
  obsidian: { configured: boolean; baseUrl: string }
  defaults: { groqModel: string }
}

async function postSettings(body: Record<string, unknown>) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await mutate('/api/settings')
  return res.json()
}

export function SettingsPanel() {
  const { data } = useSWR<Settings>('/api/settings', fetcher)
  const [obsidianKey, setObsidianKey] = useState('')
  const [showMcpKey, setShowMcpKey] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [statusLine, setStatusLine] = useState('')

  if (!data) {
    return (
      <p className="animate-pulse p-3 font-mono text-xs text-muted-foreground">
        loading settings…
      </p>
    )
  }

  const mcpCommand = `claude mcp add --transport http agentic-os http://localhost:3000/api/mcp --header "Authorization: Bearer ${data.mcp.key}"`

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      {/* Brain */}
      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          agent brain
        </h3>
        <div className="flex gap-2">
          {(['groq', 'ollama'] as const).map((brain) => (
            <button
              key={brain}
              type="button"
              onClick={() =>
                postSettings({ action: 'setChat', brain, groqModel: data.chat.groqModel })
              }
              className={`flex-1 rounded-sm border px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors ${
                data.chat.brain === brain
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              }`}
            >
              {brain === 'groq' ? 'groq (cloud, fast)' : 'ollama (offline)'}
            </button>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          groq model: {data.chat.groqModel}
        </p>
      </section>

      {/* Obsidian */}
      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          obsidian vault
        </h3>
        {data.obsidian.configured ? (
          <div className="space-y-2">
            <p className="font-mono text-xs text-primary">
              configured @ {data.obsidian.baseUrl}
            </p>
            <button
              type="button"
              disabled={indexing}
              onClick={async () => {
                setIndexing(true)
                setStatusLine('indexing vault into memory…')
                const res = await fetch('/api/obsidian/index', { method: 'POST' })
                const json = await res.json()
                setStatusLine(
                  json.error
                    ? `[error] ${json.error}`
                    : `indexed ${json.files} notes → ${json.memories} memories`,
                )
                setIndexing(false)
              }}
              className="w-full rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
            >
              {indexing ? 'indexing…' : 'index vault into memory'}
            </button>
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!obsidianKey.trim()) return
              await postSettings({ action: 'setObsidian', apiKey: obsidianKey.trim() })
              setObsidianKey('')
            }}
          >
            <input
              type="password"
              value={obsidianKey}
              onChange={(e) => setObsidianKey(e.target.value)}
              placeholder="Local REST API plugin key"
              aria-label="Obsidian Local REST API key"
              className="flex-1 rounded-sm border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            <button
              type="submit"
              className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs uppercase text-primary hover:bg-primary/20"
            >
              save
            </button>
          </form>
        )}
      </section>

      {/* Connector sync */}
      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          connectors
        </h3>
        <button
          type="button"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true)
            setStatusLine('syncing github + obsidian…')
            const res = await fetch('/api/feed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            const json = (await res.json()) as {
              results: Record<string, { added?: number; error?: string }>
            }
            const lines = Object.entries(json.results).map(([source, r]) =>
              r.error ? `${source}: ${r.error}` : `${source}: +${r.added} events`,
            )
            setStatusLine(lines.join(' · '))
            setSyncing(false)
            mutate('/api/feed')
          }}
          className="w-full rounded-sm border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
        >
          {syncing ? 'syncing…' : 'sync feeds now'}
        </button>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          github uses GITHUB_TOKEN from .env.local
        </p>
      </section>

      {/* MCP */}
      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          claude code / mcp
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-sm border border-border bg-card px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              {showMcpKey ? data.mcp.key : '•'.repeat(32)}
            </code>
            <button
              type="button"
              onClick={() => setShowMcpKey((v) => !v)}
              className="rounded-sm border border-border px-2 py-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
            >
              {showMcpKey ? 'hide' : 'show'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copy(mcpCommand, 'command')}
              className="flex-1 rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              {copied === 'command' ? 'copied' : 'copy claude setup command'}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (confirm('Regenerate MCP key? Claude Code will need re-registering.')) {
                  await postSettings({ action: 'regenerateMcpKey' })
                }
              }}
              className="rounded-sm border border-destructive/40 px-3 py-1.5 font-mono text-[10px] uppercase text-destructive hover:bg-destructive/10"
            >
              rotate
            </button>
          </div>
        </div>
      </section>

      {statusLine && (
        <p className="border-t border-border pt-2 font-mono text-[10px] leading-relaxed text-accent">
          {'> '}
          {statusLine}
        </p>
      )}
    </div>
  )
}
