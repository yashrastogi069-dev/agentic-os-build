'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  AccentButton,
  GhostButton,
  HairlineRow,
  HudInput,
  PanelSectionHeading,
  StaggerList,
} from '@/components/hud/panel-kit'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type SkillItem = {
  id: number
  name: string
  description: string
  instructions: string
  sourceTask: string
  status: string
  version: number
  deployedTo: string | null
  health: { total: number; up: number; down: number }
}

type SkillRunItem = {
  id: number
  version: number
  input: string
  output: string
  rating: number
  feedback: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  candidate: 'text-muted-foreground border-border',
  built: 'text-primary border-primary/40',
  deployed: 'text-success border-success/40',
  refining: 'text-warning border-warning/40',
}

/**
 * Skill Factory + Loop Engine panel.
 * Pipeline: create → run → rate → refine (versioned) → deploy to GitHub.
 */
export function SkillsPanel() {
  const { data, error, mutate } = useSWR<{ skills: SkillItem[] }>('/api/skills', fetcher)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoverMessage, setDiscoverMessage] = useState('')

  const skills = data?.skills ?? []

  async function discover() {
    setDiscovering(true)
    setDiscoverMessage('')
    try {
      const res = await fetch('/api/skills/discover', { method: 'POST' })
      const json = (await res.json()) as {
        created?: Array<{ name: string }>
        reason?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? 'discovery failed')
      setDiscoverMessage(
        json.created && json.created.length > 0
          ? `found: ${json.created.map((c) => c.name).join(', ')} — review the candidates below`
          : (json.reason ?? 'no new patterns'),
      )
      mutate()
    } catch (err) {
      setDiscoverMessage(err instanceof Error ? err.message : 'discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelSectionHeading>skill factory · loop engine</PanelSectionHeading>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={discovering}
            title="Analyze your usage history for repeated tasks"
            onClick={discover}
            className="rounded-sm border border-accent/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {discovering ? 'analyzing…' : 'discover'}
          </button>
          <GhostButton onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'close' : '+ new skill'}
          </GhostButton>
        </div>
      </div>

      {discoverMessage && (
        <p className="mb-2 font-mono text-[10px] leading-relaxed text-accent">
          {'> '}
          {discoverMessage}
        </p>
      )}

      {showCreate && (
        <CreateSkillForm
          onCreated={() => {
            setShowCreate(false)
            mutate()
          }}
        />
      )}

      {error && (
        <p className="font-mono text-xs text-destructive">skill factory unavailable</p>
      )}
      {skills.length === 0 && !error && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {'> no skills yet.'}
          <br />
          {'> tell the agent "save this as a skill" or create one manually.'}
        </p>
      )}

      <StaggerList
        items={skills}
        keyFn={(skill) => skill.id}
        renderItem={(skill) => (
          <>
            <HairlineRow
              as="button"
              interactive
              className="flex items-center gap-2"
              onClick={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
              aria-expanded={expandedId === skill.id}
            >
              <span
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${STATUS_COLORS[skill.status] ?? STATUS_COLORS.built}`}
              >
                {skill.status}
              </span>
              <span className="flex-1 truncate font-mono text-xs text-foreground">
                {skill.name}
                <span className="numeric text-muted-foreground"> · v{skill.version}</span>
              </span>
              <span className="numeric font-mono text-[10px] text-muted-foreground">
                {skill.health.total} runs
                {skill.health.total > 0 && (
                  <>
                    {' '}
                    · <span className="text-success">{skill.health.up}↑</span>{' '}
                    <span className="text-destructive">{skill.health.down}↓</span>
                  </>
                )}
              </span>
            </HairlineRow>
            {expandedId === skill.id && <SkillDetail skill={skill} onChanged={mutate} />}
          </>
        )}
      />
    </div>
  )
}

function CreateSkillForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, instructions }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'create failed')
      setName('')
      setDescription('')
      setInstructions('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2 rounded-md bg-[oklch(1_0_0_/_3%)] p-2">
      <HudInput
        placeholder="skill-name (kebab-case)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Skill name"
      />
      <HudInput
        placeholder="one-line description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Skill description"
      />
      <textarea
        className="min-h-20 w-full resize-y rounded-sm border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="step-by-step instructions for the agent…"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        aria-label="Skill instructions"
      />
      {error && <p className="font-mono text-[10px] text-destructive">{error}</p>}
      <AccentButton
        type="submit"
        disabled={busy || !name.trim() || !description.trim() || !instructions.trim()}
        className="self-end"
      >
        {busy ? 'creating…' : 'create skill'}
      </AccentButton>
    </form>
  )
}

function SkillDetail({ skill, onChanged }: { skill: SkillItem; onChanged: () => void }) {
  const { data, mutate: mutateDetail } = useSWR<{ runs: SkillRunItem[]; skillMd: string }>(
    `/api/skills/${skill.id}`,
    fetcher,
  )
  const [runInput, setRunInput] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [message, setMessage] = useState('')
  const [repo, setRepo] = useState('')
  const [proposal, setProposal] = useState<string | null>(null)
  // Inline "what went wrong?" feedback capture for a bad rating — a native
  // window.prompt() breaks HUD immersion, so this replaces it with an
  // in-panel input that appears on the run whose rating is being captured.
  const [feedbackDraftRunId, setFeedbackDraftRunId] = useState<number | null>(null)
  const [feedbackText, setFeedbackText] = useState('')

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusyAction(action)
    setMessage('')
    try {
      const res = await fetch(`/api/skills/${skill.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) throw new Error(String(json.error ?? `${action} failed`))
      return json
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${action} failed`)
      return null
    } finally {
      setBusyAction('')
    }
  }

  async function submitBadRating(runId: number) {
    const feedback = feedbackText.trim() || undefined
    await act('rate', { runId, rating: -1, feedback })
    setFeedbackDraftRunId(null)
    setFeedbackText('')
    mutateDetail()
    onChanged()
  }

  return (
    <div className="space-y-3 border-t border-[oklch(1_0_0_/_6%)] p-2">
      <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{skill.description}</p>
      {skill.deployedTo && (
        <p className="font-mono text-[10px] text-success">deployed → {skill.deployedTo}</p>
      )}

      {/* Run */}
      <div className="flex gap-2">
        <HudInput
          placeholder="input for this skill run…"
          value={runInput}
          onChange={(e) => setRunInput(e.target.value)}
          aria-label={`Run input for ${skill.name}`}
        />
        <GhostButton
          disabled={busyAction !== '' || !runInput.trim()}
          onClick={async () => {
            const result = await act('run', { input: runInput })
            if (result) {
              setRunInput('')
              mutateDetail()
              onChanged()
            }
          }}
        >
          {busyAction === 'run' ? 'running…' : 'run'}
        </GhostButton>
      </div>

      {/* Loop Engine actions */}
      <div className="flex flex-wrap items-center gap-2">
        {skill.status === 'candidate' && (
          <button
            type="button"
            disabled={busyAction !== ''}
            title="Promote this discovered candidate to a built skill"
            onClick={async () => {
              const result = await act('approve')
              if (result) {
                setMessage('candidate approved — skill is now built')
                onChanged()
              }
            }}
            className="rounded-sm border border-success/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-success transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {busyAction === 'approve' ? 'approving…' : 'approve candidate'}
          </button>
        )}
        <GhostButton
          disabled={busyAction !== '' || skill.health.down === 0}
          title={skill.health.down === 0 ? 'Needs at least one thumbs-down run' : 'Propose improved instructions'}
          onClick={async () => {
            const result = await act('refine')
            if (result) {
              if (result.proposal) setProposal(String(result.proposal))
              else setMessage(String(result.reason ?? 'no proposal'))
            }
          }}
        >
          {busyAction === 'refine' ? 'analyzing…' : 'refine'}
        </GhostButton>
        <HudInput
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          aria-label="GitHub repo for deploy"
        />
        <GhostButton
          disabled={busyAction !== '' || !repo.trim()}
          onClick={async () => {
            const result = await act('deploy', { repo })
            if (result) {
              setMessage(`deployed: ${String(result.deployedTo)}`)
              onChanged()
            }
          }}
        >
          {busyAction === 'deploy' ? 'deploying…' : 'deploy → github'}
        </GhostButton>
        <button
          type="button"
          disabled={busyAction !== ''}
          onClick={async () => {
            await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' })
            onChanged()
          }}
          className="rounded-sm border border-destructive/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          delete
        </button>
      </div>

      {message && <p className="font-mono text-[10px] text-warning">{message}</p>}

      {/* Refinement proposal */}
      {proposal && (
        <div className="space-y-2 rounded-sm border border-warning/40 bg-warning/5 p-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-warning">
            proposed v{skill.version + 1} instructions
          </p>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
            {proposal}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyAction !== ''}
              onClick={async () => {
                const result = await act('applyRefinement', { instructions: proposal })
                if (result) {
                  setProposal(null)
                  setMessage(`upgraded to v${String(result.version)}`)
                  onChanged()
                }
              }}
              className="rounded-sm border border-success/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-success transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              apply
            </button>
            <GhostButton onClick={() => setProposal(null)}>discard</GhostButton>
          </div>
        </div>
      )}

      {/* Run history with rating */}
      {data && data.runs.length > 0 && (
        <div className="space-y-2">
          <PanelSectionHeading>run history</PanelSectionHeading>
          <StaggerList
            items={data.runs.slice(0, 5)}
            keyFn={(run) => run.id}
            renderItem={(run) => (
              <HairlineRow>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  in: {run.input}
                </p>
                <p className="mt-1 line-clamp-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {run.output}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="numeric font-mono text-[10px] text-muted-foreground">
                    v{run.version} · {new Date(run.createdAt).toLocaleString()}
                  </span>
                  {run.rating === 0 ? (
                    feedbackDraftRunId === run.id ? (
                      <form
                        className="flex flex-1 items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault()
                          submitBadRating(run.id)
                        }}
                      >
                        <HudInput
                          autoFocus
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          placeholder="what went wrong? (optional)"
                          aria-label={`Feedback for run ${run.id}`}
                          wrapperClassName="py-1"
                        />
                        <GhostButton type="submit" disabled={busyAction !== ''}>
                          submit
                        </GhostButton>
                        <GhostButton
                          type="button"
                          onClick={() => {
                            setFeedbackDraftRunId(null)
                            setFeedbackText('')
                          }}
                        >
                          cancel
                        </GhostButton>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Rate run good"
                          onClick={async () => {
                            await act('rate', { runId: run.id, rating: 1 })
                            mutateDetail()
                            onChanged()
                          }}
                          className="rounded-sm font-mono text-[10px] text-success hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          good
                        </button>
                        <button
                          type="button"
                          aria-label="Rate run bad"
                          onClick={() => {
                            setFeedbackDraftRunId(run.id)
                            setFeedbackText('')
                          }}
                          className="rounded-sm font-mono text-[10px] text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          bad
                        </button>
                      </>
                    )
                  ) : (
                    <span
                      className={`font-mono text-[10px] ${run.rating === 1 ? 'text-success' : 'text-destructive'}`}
                    >
                      rated {run.rating === 1 ? 'good' : 'bad'}
                    </span>
                  )}
                </div>
              </HairlineRow>
            )}
          />
        </div>
      )}
    </div>
  )
}
