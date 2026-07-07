'use client'

import { useState } from 'react'
import useSWR from 'swr'

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

  const skills = data?.skills ?? []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          skill factory · loop engine
        </span>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          {showCreate ? 'close' : '+ new skill'}
        </button>
      </div>

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

      <ul className="space-y-2">
        {skills.map((skill) => (
          <li key={skill.id} className="rounded-sm border border-border bg-card/40">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-2 text-left"
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
                <span className="text-muted-foreground"> · v{skill.version}</span>
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {skill.health.total} runs
                {skill.health.total > 0 && (
                  <>
                    {' '}
                    · <span className="text-success">{skill.health.up}↑</span>{' '}
                    <span className="text-destructive">{skill.health.down}↓</span>
                  </>
                )}
              </span>
            </button>
            {expandedId === skill.id && <SkillDetail skill={skill} onChanged={mutate} />}
          </li>
        ))}
      </ul>
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

  const inputClass =
    'w-full rounded-sm border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none'

  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2 rounded-sm border border-border bg-card/40 p-2">
      <input
        className={inputClass}
        placeholder="skill-name (kebab-case)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Skill name"
      />
      <input
        className={inputClass}
        placeholder="one-line description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Skill description"
      />
      <textarea
        className={`${inputClass} min-h-20 resize-y`}
        placeholder="step-by-step instructions for the agent…"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        aria-label="Skill instructions"
      />
      {error && <p className="font-mono text-[10px] text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim() || !description.trim() || !instructions.trim()}
        className="self-end rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
      >
        {busy ? 'creating…' : 'create skill'}
      </button>
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

  const buttonClass =
    'rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40'

  return (
    <div className="space-y-3 border-t border-border p-2">
      <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{skill.description}</p>
      {skill.deployedTo && (
        <p className="font-mono text-[10px] text-success">deployed → {skill.deployedTo}</p>
      )}

      {/* Run */}
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          placeholder="input for this skill run…"
          value={runInput}
          onChange={(e) => setRunInput(e.target.value)}
          aria-label={`Run input for ${skill.name}`}
        />
        <button
          type="button"
          disabled={busyAction !== '' || !runInput.trim()}
          onClick={async () => {
            const result = await act('run', { input: runInput })
            if (result) {
              setRunInput('')
              mutateDetail()
              onChanged()
            }
          }}
          className={buttonClass}
        >
          {busyAction === 'run' ? 'running…' : 'run'}
        </button>
      </div>

      {/* Loop Engine actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busyAction !== '' || skill.health.down === 0}
          title={skill.health.down === 0 ? 'Needs at least one thumbs-down run' : 'Propose improved instructions'}
          onClick={async () => {
            const result = await act('refine')
            if (result) {
              if (result.proposal) setProposal(String(result.proposal))
              else setMessage(String(result.reason ?? 'no proposal'))
            }
          }}
          className={buttonClass}
        >
          {busyAction === 'refine' ? 'analyzing…' : 'refine'}
        </button>
        <input
          className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          aria-label="GitHub repo for deploy"
        />
        <button
          type="button"
          disabled={busyAction !== '' || !repo.trim()}
          onClick={async () => {
            const result = await act('deploy', { repo })
            if (result) {
              setMessage(`deployed: ${String(result.deployedTo)}`)
              onChanged()
            }
          }}
          className={buttonClass}
        >
          {busyAction === 'deploy' ? 'deploying…' : 'deploy → github'}
        </button>
        <button
          type="button"
          disabled={busyAction !== ''}
          onClick={async () => {
            await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' })
            onChanged()
          }}
          className="rounded-sm border border-destructive/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10"
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
              className="rounded-sm border border-success/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-success transition-colors hover:bg-success/10"
            >
              apply
            </button>
            <button type="button" onClick={() => setProposal(null)} className={buttonClass}>
              discard
            </button>
          </div>
        </div>
      )}

      {/* Run history with rating */}
      {data && data.runs.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            run history
          </p>
          {data.runs.slice(0, 5).map((run) => (
            <div key={run.id} className="rounded-sm border border-border/60 p-2">
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                in: {run.input}
              </p>
              <p className="mt-1 line-clamp-3 font-mono text-[11px] leading-relaxed text-foreground">
                {run.output}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  v{run.version} · {new Date(run.createdAt).toLocaleString()}
                </span>
                {run.rating === 0 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Rate run good"
                      onClick={async () => {
                        await act('rate', { runId: run.id, rating: 1 })
                        mutateDetail()
                        onChanged()
                      }}
                      className="font-mono text-[10px] text-success hover:underline"
                    >
                      good
                    </button>
                    <button
                      type="button"
                      aria-label="Rate run bad"
                      onClick={async () => {
                        const feedback = window.prompt('What went wrong? (optional)') ?? undefined
                        await act('rate', { runId: run.id, rating: -1, feedback })
                        mutateDetail()
                        onChanged()
                      }}
                      className="font-mono text-[10px] text-destructive hover:underline"
                    >
                      bad
                    </button>
                  </>
                ) : (
                  <span
                    className={`font-mono text-[10px] ${run.rating === 1 ? 'text-success' : 'text-destructive'}`}
                  >
                    rated {run.rating === 1 ? 'good' : 'bad'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
