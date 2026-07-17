'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { AccentButton, GhostButton, HudInput, PanelSectionHeading, StaggerList } from '@/components/hud/panel-kit'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type AssistantTone = 'professional' | 'casual' | 'warm' | 'direct'
type AssistantVerbosity = 'brief' | 'balanced' | 'detailed'

type Settings = {
  chat: { brain: 'groq' | 'ollama'; groqModel: string }
  mcp: { key: string }
  obsidian: { configured: boolean; baseUrl: string }
  telegram: { configured: boolean }
  google: { credentials: boolean; connected: boolean }
  apple: { configured: boolean; appleId: string }
  defaults: { groqModel: string }
  assistant: { tone: AssistantTone; verbosity: AssistantVerbosity; address: string }
}

type VoiceLatencySummary = {
  count: number
  p50TotalMs: number
  p90TotalMs: number
  p50SttMs: number
  p50BrainFirstSentenceMs: number
  p50TtsFirstChunkMs: number
  lastTurnAt: number | null
}

const TONE_OPTIONS: AssistantTone[] = ['professional', 'casual', 'warm', 'direct']
const VERBOSITY_OPTIONS: AssistantVerbosity[] = ['brief', 'balanced', 'detailed']

type BrainStatus = 'active' | 'ready' | 'cooling' | 'down'

type Health = {
  brain?: {
    active: string
    chain: { id: string; label: string; status: BrainStatus }[]
  }
}

const BRAIN_DOT: Record<BrainStatus, string> = {
  active: 'bg-success animate-core-pulse',
  ready: 'bg-success/40',
  cooling: 'bg-warning',
  down: 'bg-muted-foreground/40',
}

const BRAIN_LABEL: Record<BrainStatus, string> = {
  active: 'active',
  ready: 'standby',
  cooling: 'cooling down',
  down: 'no key / offline',
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
  const { data: health } = useSWR<Health>('/api/health', fetcher, { refreshInterval: 10_000 })
  const { data: voiceLatency } = useSWR<VoiceLatencySummary>('/api/voice/latency', fetcher, {
    refreshInterval: 15_000,
  })
  const [obsidianKey, setObsidianKey] = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [appleId, setAppleId] = useState('')
  const [applePassword, setApplePassword] = useState('')
  const [showMcpKey, setShowMcpKey] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [savingPref, setSavingPref] = useState<'tone' | 'verbosity' | 'address' | null>(null)

  if (!data) {
    return (
      <p className="animate-pulse p-3 font-mono text-xs text-muted-foreground">
        loading settings…
      </p>
    )
  }

  const mcpCommand = `claude mcp add --transport http agentic-os http://localhost:3000/api/mcp --header "Authorization: Bearer ${data.mcp.key}"`

  async function setPref(key: 'tone' | 'verbosity' | 'address', value: string) {
    setSavingPref(key)
    const json = await postSettings({ action: 'setAssistant', key, value })
    setStatusLine(json.error ? `[error] ${json.error}` : `${key} updated`)
    setSavingPref(null)
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      {/* Brain — provider failsafe chain (auto-routed, read-only status) */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          agent brain
        </PanelSectionHeading>
        {health?.brain ? (
          <StaggerList
            items={health.brain.chain}
            keyFn={(p) => p.id}
            className="space-y-1.5"
            renderItem={(p) => (
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block size-1.5 shrink-0 rounded-full ${BRAIN_DOT[p.status]}`}
                  aria-hidden="true"
                />
                <span className="font-mono text-xs text-foreground">{p.label}</span>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {BRAIN_LABEL[p.status]}
                </span>
              </div>
            )}
          />
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground">reading provider chain…</p>
        )}
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          auto-routed: gemini → groq → openrouter → nvidia → ollama. failover is
          automatic on rate-limit or outage.
        </p>
      </section>

      {/* Assistant tone/verbosity/address — same values setPreference (agent tool) writes to connector_settings.assistant; editing here calls the identical setAssistantPreference() path. */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          assistant preferences
        </PanelSectionHeading>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              tone
            </span>
            <select
              value={data.assistant.tone}
              disabled={savingPref === 'tone'}
              onChange={(e) => void setPref('tone', e.target.value)}
              aria-label="Assistant tone"
              className="flex-1 rounded-sm border border-border bg-[oklch(0.1_0.02_250_/_55%)] px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              verbosity
            </span>
            <select
              value={data.assistant.verbosity}
              disabled={savingPref === 'verbosity'}
              onChange={(e) => void setPref('verbosity', e.target.value)}
              aria-label="Assistant verbosity"
              className="flex-1 rounded-sm border border-border bg-[oklch(0.1_0.02_250_/_55%)] px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {VERBOSITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = addressInput.trim()
              if (!v) return
              void setPref('address', v)
              setAddressInput('')
            }}
          >
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              address
            </span>
            <HudInput
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder={data.assistant.address}
              aria-label="How the assistant addresses you"
            />
            <AccentButton size="xs" type="submit" disabled={savingPref === 'address' || !addressInput.trim()}>
              save
            </AccentButton>
          </form>
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          currently: {data.assistant.tone} · {data.assistant.verbosity} · addresses you as{' '}
          {data.assistant.address}. also settable by just telling the agent (e.g. &quot;be more
          casual&quot;).
        </p>
      </section>

      {/* Voice turn latency — Phase 6 Chunk F. Read-only p50/p90 over the last 50 completed turns; per-turn rows persist in voice_latency (see lib/voice/latency.ts). */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          voice latency
        </PanelSectionHeading>
        {!voiceLatency || voiceLatency.count === 0 ? (
          <p className="font-mono text-[10px] text-muted-foreground">
            no completed voice turns logged yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-foreground">
                first-audio p50 {voiceLatency.p50TotalMs} ms
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                p90 {voiceLatency.p90TotalMs} ms
              </span>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              stt p50 {voiceLatency.p50SttMs} ms · brain-first-sentence p50{' '}
              {voiceLatency.p50BrainFirstSentenceMs} ms · tts-first-chunk p50{' '}
              {voiceLatency.p50TtsFirstChunkMs} ms
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              over last {voiceLatency.count} turn{voiceLatency.count === 1 ? '' : 's'} · budget
              (§5.4): p50 ≤ 1800 ms, p90 ≤ 3000 ms
            </p>
          </div>
        )}
      </section>

      {/* Obsidian */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          obsidian vault
        </PanelSectionHeading>
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
              className="w-full rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
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
            <HudInput
              type="password"
              value={obsidianKey}
              onChange={(e) => setObsidianKey(e.target.value)}
              placeholder="Local REST API plugin key"
              aria-label="Obsidian Local REST API key"
            />
            <AccentButton type="submit">save</AccentButton>
          </form>
        )}
      </section>

      {/* Telegram */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          telegram bot
        </PanelSectionHeading>
        {data.telegram.configured ? (
          <p className="font-mono text-xs text-primary">bot token configured</p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!telegramToken.trim()) return
              await postSettings({ action: 'setTelegram', botToken: telegramToken.trim() })
              setTelegramToken('')
              setStatusLine('telegram bot saved — message your bot, then sync feeds')
            }}
          >
            <HudInput
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder="bot token from @BotFather"
              aria-label="Telegram bot token"
            />
            <AccentButton type="submit">save</AccentButton>
          </form>
        )}
      </section>

      {/* Google */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          google calendar + gmail
        </PanelSectionHeading>
        {data.google.connected ? (
          <p className="font-mono text-xs text-primary">connected (read-only)</p>
        ) : data.google.credentials ? (
          <a
            href="/api/google/auth"
            className="block w-full rounded-sm border border-primary/40 bg-primary/10 px-3 py-2 text-center font-mono text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            connect google account
          </a>
        ) : (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!googleClientId.trim() || !googleClientSecret.trim()) return
              await postSettings({
                action: 'setGoogleCredentials',
                clientId: googleClientId.trim(),
                clientSecret: googleClientSecret.trim(),
              })
              setGoogleClientId('')
              setGoogleClientSecret('')
              setStatusLine('google credentials saved — now click connect')
            }}
          >
            <HudInput
              type="text"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              placeholder="OAuth client ID"
              aria-label="Google OAuth client ID"
            />
            <div className="flex gap-2">
              <HudInput
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder="OAuth client secret"
                aria-label="Google OAuth client secret"
              />
              <AccentButton type="submit">save</AccentButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              create a Web OAuth client in Google Cloud Console with redirect URI
              http://localhost:3000/api/google/callback
            </p>
          </form>
        )}
      </section>

      {/* Apple Calendar */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          apple calendar (icloud)
        </PanelSectionHeading>
        {data.apple.configured ? (
          <p className="font-mono text-xs text-primary">
            configured as {data.apple.appleId}
          </p>
        ) : (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!appleId.trim() || !applePassword.trim()) return
              await postSettings({
                action: 'setApple',
                appleId: appleId.trim(),
                appPassword: applePassword.trim(),
              })
              setAppleId('')
              setApplePassword('')
              setStatusLine('apple calendar saved — sync feeds to pull events')
            }}
          >
            <HudInput
              type="email"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="Apple ID email"
              aria-label="Apple ID email"
            />
            <div className="flex gap-2">
              <HudInput
                type="password"
                value={applePassword}
                onChange={(e) => setApplePassword(e.target.value)}
                placeholder="app-specific password"
                aria-label="Apple app-specific password"
              />
              <AccentButton type="submit">save</AccentButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              generate an app-specific password at appleid.apple.com → security
            </p>
          </form>
        )}
      </section>

      {/* Connector sync */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          connectors
        </PanelSectionHeading>
        <AccentButton
          disabled={syncing}
          className="w-full py-2"
          onClick={async () => {
            setSyncing(true)
            setStatusLine('syncing all connectors…')
            const res = await fetch('/api/feed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            const json = (await res.json()) as {
              results: Record<
                string,
                { added?: number; error?: string; skipped?: boolean }
              >
            }
            const lines = Object.entries(json.results).map(([source, r]) =>
              r.error
                ? `${source}: ${r.error}`
                : r.skipped
                  ? `${source}: not configured`
                  : `${source}: +${r.added} events`,
            )
            setStatusLine(lines.join(' · '))
            setSyncing(false)
            mutate('/api/feed')
          }}
        >
          {syncing ? 'syncing…' : 'sync feeds now'}
        </AccentButton>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          github uses GITHUB_TOKEN from .env.local
        </p>
      </section>

      {/* MCP */}
      <section>
        <PanelSectionHeading as="h3" className="mb-2">
          claude code / mcp
        </PanelSectionHeading>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-sm border border-[oklch(1_0_0_/_8%)] bg-[oklch(1_0_0_/_3%)] px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              {showMcpKey ? data.mcp.key : '•'.repeat(32)}
            </code>
            <GhostButton size="sm" onClick={() => setShowMcpKey((v) => !v)}>
              {showMcpKey ? 'hide' : 'show'}
            </GhostButton>
          </div>
          <div className="flex gap-2">
            <AccentButton size="xs" className="flex-1 py-1.5" onClick={() => copy(mcpCommand, 'command')}>
              {copied === 'command' ? 'copied' : 'copy claude setup command'}
            </AccentButton>
            <button
              type="button"
              onClick={async () => {
                if (confirm('Regenerate MCP key? Claude Code will need re-registering.')) {
                  await postSettings({ action: 'regenerateMcpKey' })
                }
              }}
              className="rounded-sm border border-destructive/40 px-3 py-1.5 font-mono text-[10px] uppercase text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              rotate
            </button>
          </div>
        </div>
      </section>

      {statusLine && (
        <p className="border-t border-[oklch(1_0_0_/_6%)] pt-2 font-mono text-[10px] leading-relaxed text-accent">
          {'> '}
          {statusLine}
        </p>
      )}
    </div>
  )
}
