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

type ApiTask = {
  id: number
  title: string
  notes: string | null
  status: 'open' | 'done'
  dueAt: number | null
  remindAt: number | null
  recurrence: string | null
  lastFiredAt: number | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

/** Forward-looking relative time — "in 2h", "tomorrow", "overdue". */
function timeUntil(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'overdue'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `in ${s}s`
  if (s < 3600) return `in ${Math.floor(s / 60)}m`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`
  const days = Math.floor(s / 86400)
  if (days === 1) return 'tomorrow'
  return `in ${days}d`
}

export function TasksPanel() {
  const { data, error, isLoading, mutate } = useSWR<{ tasks: ApiTask[] }>('/api/tasks?status=open', fetcher, {
    refreshInterval: 30_000,
  })
  const [title, setTitle] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const tasks = data?.tasks ?? []

  async function addTask(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          remindAt: remindAt ? new Date(remindAt).toISOString() : undefined,
        }),
      })
      if (res.ok) {
        const { task } = (await res.json()) as { task: ApiTask }
        await mutate({ tasks: [...tasks, task] }, { revalidate: true })
        setTitle('')
        setRemindAt('')
      }
    } finally {
      setAdding(false)
    }
  }

  async function completeTask(id: number) {
    setBusyId(id)
    try {
      await fetch(`/api/tasks/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      })
      await mutate({ tasks: tasks.filter((t) => t.id !== id) }, { revalidate: true })
    } finally {
      setBusyId(null)
    }
  }

  async function snoozeTask(id: number) {
    setBusyId(id)
    try {
      await fetch(`/api/tasks/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', minutes: 10 }),
      })
      await mutate()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <PanelSectionHeading>tasks &amp; reminders</PanelSectionHeading>
        {error && <span className="font-mono text-[10px] uppercase tracking-widest text-destructive">error</span>}
      </div>

      <form onSubmit={addTask} className="mb-3 flex flex-col gap-2">
        <HudInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="new task…"
          aria-label="Task title"
        />
        <div className="flex items-center gap-2">
          <HudInput
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            aria-label="Remind at"
            wrapperClassName="flex-1"
            className="numeric"
          />
          <AccentButton type="submit" disabled={adding || !title.trim()}>
            {adding ? 'adding…' : 'add'}
          </AccentButton>
        </div>
      </form>

      {isLoading && (
        <p className="animate-pulse font-mono text-xs text-muted-foreground">loading tasks…</p>
      )}
      {error && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {'> could not reach the task store.'}
          <br />
          {'> check the app is running and try again.'}
        </p>
      )}
      {!error && tasks.length === 0 && !isLoading && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {'> no open tasks.'}
          <br />
          {'> add one above, or ask Jarvis to set a reminder.'}
        </p>
      )}

      <StaggerList
        items={tasks}
        keyFn={(task) => task.id}
        renderItem={(task) => (
          <HairlineRow>
            <div className="flex items-center justify-between gap-2">
              <span className="numeric font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {task.remindAt ? timeUntil(task.remindAt) : task.dueAt ? `due ${timeUntil(task.dueAt)}` : 'no date'}
                {task.recurrence ? ` · ${task.recurrence}` : ''}
              </span>
            </div>
            <p className="mt-1 text-pretty text-sm text-foreground">{task.title}</p>
            {task.notes && (
              <p className="mt-0.5 text-pretty text-xs text-muted-foreground">{task.notes}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <GhostButton onClick={() => completeTask(task.id)} disabled={busyId === task.id}>
                {busyId === task.id ? '…' : 'complete'}
              </GhostButton>
              <GhostButton onClick={() => snoozeTask(task.id)} disabled={busyId === task.id}>
                snooze 10m
              </GhostButton>
            </div>
          </HairlineRow>
        )}
      />
    </div>
  )
}
