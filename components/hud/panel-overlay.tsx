'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Summonable glass panel — Phase 3 §1.2/§6. One at a time; focus trap; closes
 * on Esc, the × button, or an outside click (which also covers "clicking the
 * stage" per §1.2, since the stage/poster is outside the panel by
 * construction).
 *
 * `excludeRef` lets the caller pass its rail/tab-bar container so re-clicking
 * the already-open panel's own rail icon doesn't race the outside-click
 * handler into closing-then-reopening (the rail button's own onClick owns
 * the toggle; this component must not also react to that same click).
 *
 * `variant="floating"` is the desktop 420px panel (§1.2); `variant="fullscreen"`
 * is the <1024px full-screen panel (§1.3) — same close/focus-trap behavior,
 * different chrome.
 */
export function PanelOverlay({
  title,
  onClose,
  excludeRef,
  variant = 'floating',
  children,
}: {
  title: string
  onClose: () => void
  excludeRef?: React.RefObject<HTMLElement | null>
  variant?: 'floating' | 'fullscreen'
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the panel on open (§1.2).
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  // Outside click (incl. clicking the stage) closes — excluding the rail so
  // its own click handler can toggle without a mousedown/click race.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (excludeRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, excludeRef])

  // Esc closes; Tab/Shift+Tab cycles focus within the panel (focus trap).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={
        variant === 'floating'
          ? 'hud-glass hud-glass-accent-edge enter-slide-left pointer-events-auto fixed bottom-3 right-[76px] top-24 z-40 flex w-[420px] max-w-[calc(100vw-96px)] flex-col rounded-[var(--radius-xl)]'
          : // Near-opaque (not the standard 62%-alpha glass): this sits over the
            // status strip + chat transcript, not the abstract 3D stage, so it
            // must fully occlude that text rather than let it bleed through
            // and collide with the panel's own header (Phase 3 §8.5).
            'hud-glass-solid enter-fade pointer-events-auto fixed inset-0 z-40 flex flex-col pt-[max(0.5rem,env(safe-area-inset-top))]'
      }
    >
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/80">
          {title}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Close ${title} panel`}
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
