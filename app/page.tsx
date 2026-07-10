'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { HudShell } from '@/components/hud/hud-shell'
import { Poster } from '@/components/scene/poster'

// The 3D stage is client-only (WebGL). Lazy + a mount guard keeps server
// rendering intact (no next/dynamic ssr:false bail-out — see the same note
// in the Chunk A-era core-stage.tsx this file replaces) while excluding
// three.js from the server bundle and, on <1024px viewports, from the
// client bundle too (the dynamic import below is only ever requested when
// `isDesktop` is true).
const JarvisStage = lazy(() =>
  import('@/components/scene/jarvis-stage').then((mod) => ({ default: mod.JarvisStage })),
)

/** Tracks the same 1024px breakpoint Tailwind's `lg:` variant uses, so the
 * stage-mount decision here and HudShell's layout switch never disagree. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    setIsDesktop(mql.matches)
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const isDesktop = useIsDesktop()

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      {/* The stage — z-0, full-viewport, fixed. Phase 3 §1.1/§2. */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        {mounted && isDesktop ? (
          <Suspense fallback={<Poster variant="fallback" />}>
            <JarvisStage />
          </Suspense>
        ) : (
          <Poster variant={mounted ? 'mobile' : 'fallback'} />
        )}
      </div>

      {/* The HUD — floats above the stage as open, chrome-less overlays. */}
      <HudShell isDesktop={mounted && isDesktop} />
    </main>
  )
}
