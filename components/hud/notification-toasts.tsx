'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, X } from '@phosphor-icons/react'
import { useThemeStore } from '@/lib/theme-engine'

/**
 * In-tab toast stack — Phase 6E. Mounted once in hud-shell.tsx's reserved
 * z-50 top-right slot. Opens the SSE stream at /api/notifications and shows
 * a toast per pushed notification: title + body, Done (ack) and Snooze 10m
 * actions, auto-dismissed from the *visual* stack after ~8s (never
 * auto-acked — it stays in the queue until explicitly acked or snoozed, so
 * closing the tab doesn't silently drop it).
 *
 * If a voice conversation is active when a reminder arrives (coreState !==
 * 'idle'), it's also spoken: a self-contained fetch to /api/voice/speak +
 * `new Audio(URL.createObjectURL(blob))`, best-effort, never throwing into
 * the toast render path.
 */

type ToastNotification = {
  id: number
  kind: string
  title: string
  body: string | null
  dedupeKey: string
  taskId: number | null
  payload: Record<string, unknown> | null
  deliverAt: number
  channels: Record<string, number>
  ackedAt: number | null
  snoozedUntil: number | null
  createdAt: number
}

const AUTO_DISMISS_MS = 8_000
const MAX_VISIBLE = 3

async function speakReminder(text: string): Promise<void> {
  try {
    const res = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.addEventListener('ended', () => URL.revokeObjectURL(url))
    await audio.play().catch(() => {
      // Autoplay may be blocked — best-effort only.
    })
  } catch (error) {
    console.warn('[notification-toasts] speak failed', error)
  }
}

export function NotificationToasts() {
  const [toasts, setToasts] = useState<ToastNotification[]>([])
  const dismissTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const [pending, setPending] = useState<Record<number, 'ack' | 'snooze' | undefined>>({})

  useEffect(() => {
    const source = new EventSource('/api/notifications')

    source.onmessage = (event) => {
      let notif: ToastNotification
      try {
        notif = JSON.parse(event.data) as ToastNotification
      } catch {
        return
      }

      setToasts((prev) => [notif, ...prev.filter((t) => t.id !== notif.id)])

      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== notif.id))
        dismissTimers.current.delete(notif.id)
      }, AUTO_DISMISS_MS)
      dismissTimers.current.set(notif.id, timer)

      if (useThemeStore.getState().coreState !== 'idle') {
        void speakReminder(notif.body ? `${notif.title}. ${notif.body}` : notif.title)
      }
    }

    source.onerror = (event) => {
      console.warn('[notification-toasts] SSE error, browser will auto-reconnect', event)
    }

    return () => {
      source.close()
      for (const timer of dismissTimers.current.values()) clearTimeout(timer)
      dismissTimers.current.clear()
    }
  }, [])

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = dismissTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      dismissTimers.current.delete(id)
    }
  }

  async function act(id: number, action: 'ack' | 'snooze') {
    setPending((prev) => ({ ...prev, [id]: action }))
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'snooze' ? { action, minutes: 10 } : { action }),
      })
    } catch (error) {
      console.warn(`[notification-toasts] ${action} failed`, error)
    } finally {
      setPending((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      removeToast(id)
    }
  }

  const visible = toasts.slice(0, MAX_VISIBLE)
  if (visible.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2"
      aria-live="polite"
    >
      {visible.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="hud-glass enter-fade-up pointer-events-auto flex flex-col gap-2 rounded-[var(--radius-xl)] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 size-4 shrink-0 text-primary" weight="duotone" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-pretty text-sm font-medium text-foreground">{toast.title}</p>
                {toast.body && (
                  <p className="mt-0.5 text-pretty text-xs text-muted-foreground">{toast.body}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss (stays in queue)"
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => act(toast.id, 'ack')}
              disabled={pending[toast.id] !== undefined}
              className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {pending[toast.id] === 'ack' ? 'done…' : 'done'}
            </button>
            <button
              type="button"
              onClick={() => act(toast.id, 'snooze')}
              disabled={pending[toast.id] !== undefined}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {pending[toast.id] === 'snooze' ? 'snoozing…' : 'snooze 10m'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
