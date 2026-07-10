'use client'

import { useEffect, useState } from 'react'
import { useHealth } from '@/components/status-bar'
import { useThemeStore } from '@/lib/theme-engine'

/**
 * Bottom-center state/health caption — Phase 3 §1.2. Replaces
 * `core-stage.tsx`'s caption. Pointer-events-none: it's a readout, not a
 * control.
 *
 * The "TALK TO JARVIS · ALT+J" hover affordance listens for the
 * `jarvis:reactor-hover` window event. In this chunk that event is
 * dispatched by `jarvis-stage.tsx`'s placeholder sphere; Chunk C's real Arc
 * Reactor hitbox dispatches the same event, so this component needs no
 * changes when that ships.
 */
export function CoreReadout() {
  const coreState = useThemeStore((state) => state.coreState)
  const { data } = useHealth()
  const [reactorHovered, setReactorHovered] = useState(false)

  useEffect(() => {
    function handleHover(event: Event) {
      const detail = (event as CustomEvent<{ hovering: boolean }>).detail
      setReactorHovered(Boolean(detail?.hovering))
    }
    window.addEventListener('jarvis:reactor-hover', handleHover)
    return () => window.removeEventListener('jarvis:reactor-hover', handleHover)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex flex-col items-center gap-1 px-4 text-center">
      <p
        className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary transition-opacity duration-150"
        style={{ opacity: reactorHovered ? 1 : 0 }}
        aria-hidden={!reactorHovered}
      >
        talk to jarvis · alt+j
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        core // {coreState}
      </p>
      <p className="font-mono text-xs text-muted-foreground">
        {data ? (
          <>
            <span className="text-primary">{data.db.memories.total}</span> memories ·{' '}
            <span className="text-primary">{data.chat.brain}</span> brain
          </>
        ) : (
          'probing services…'
        )}
      </p>
    </div>
  )
}
