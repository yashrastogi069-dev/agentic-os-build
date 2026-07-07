'use client'

import { useHealth } from '@/components/status-bar'

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking'

/**
 * Center stage — placeholder for the future 3D neural core (r3f, later phase).
 * A pulsing ring system that reacts to the agent state, plus live OS stats.
 */
export function CoreStage({ state }: { state: CoreState }) {
  const { data } = useHealth()

  const stateColor =
    state === 'thinking'
      ? 'border-warning/60'
      : state === 'listening' || state === 'speaking'
        ? 'border-primary/80'
        : 'border-primary/35'

  return (
    <div className="relative flex h-full min-h-48 flex-col items-center justify-center gap-6 overflow-hidden">
      <div className="relative flex items-center justify-center" aria-hidden="true">
        <div
          className={`animate-core-pulse absolute size-44 rounded-full border ${stateColor}`}
          style={{ animationDelay: '0s' }}
        />
        <div
          className={`animate-core-pulse absolute size-32 rounded-full border ${stateColor}`}
          style={{ animationDelay: '0.5s' }}
        />
        <div
          className={`animate-core-pulse absolute size-20 rounded-full border ${stateColor}`}
          style={{ animationDelay: '1s' }}
        />
        <div className="glow-primary size-10 rounded-full bg-primary/20 ring-1 ring-primary/60" />
      </div>

      <div className="z-10 flex flex-col items-center gap-1 pt-40">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          core // {state}
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
    </div>
  )
}
