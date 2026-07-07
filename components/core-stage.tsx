'use client'

import dynamic from 'next/dynamic'
import { useHealth } from '@/components/status-bar'

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking'

// The 3D neural core is client-only (WebGL) — load it lazily with a fallback.
const NeuralCore = dynamic(
  () => import('@/components/neural-core').then((mod) => mod.NeuralCore),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <p className="animate-pulse font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          initializing neural core…
        </p>
      </div>
    ),
  },
)

/**
 * Center stage — the movable glowing 3D neural network.
 * Drag to rotate, scroll to zoom. Reacts to agent state (idle/listening/thinking/speaking).
 */
export function CoreStage({ state }: { state: CoreState }) {
  const { data } = useHealth()

  return (
    <div className="relative flex h-full min-h-48 flex-col overflow-hidden">
      <div className="absolute inset-0">
        <NeuralCore state={state} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-1">
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
