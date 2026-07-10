'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { useHealth } from '@/components/status-bar'
import type { CoreState } from '@/lib/theme-engine'

// Canonical home is lib/theme-engine.ts (Phase 3 §4 — the zustand theme
// store owns CoreState now). Re-exported here so existing imports of
// `@/components/core-stage` keep working without touching every importer
// in this chunk; Chunk B removes this indirection when it rewrites the UI.
export type { CoreState }

// The 3D neural core is client-only (WebGL). Using lazy + a mount guard keeps
// server rendering intact (no next/dynamic ssr:false bail-out, which 500s the
// initial HTML response) while still excluding three.js from the server bundle.
const NeuralCore = lazy(() =>
  import('@/components/neural-core').then((mod) => ({ default: mod.NeuralCore })),
)

function CoreFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="animate-pulse font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        initializing neural core…
      </p>
    </div>
  )
}

/**
 * Center stage — the movable glowing 3D neural network.
 * Drag to rotate, scroll to zoom. Reacts to agent state (idle/listening/thinking/speaking).
 */
export function CoreStage({ state }: { state: CoreState }) {
  const { data } = useHealth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="relative flex h-full min-h-48 flex-col overflow-hidden">
      <div className="absolute inset-0">
        {mounted ? (
          <Suspense fallback={<CoreFallback />}>
            <NeuralCore state={state} />
          </Suspense>
        ) : (
          <CoreFallback />
        )}
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
