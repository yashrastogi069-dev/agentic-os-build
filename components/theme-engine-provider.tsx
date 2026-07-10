'use client'

import { useEffect, useRef } from 'react'
import { themeEngine, useThemeStore } from '@/lib/theme-engine'

/**
 * Mounted once in app/layout.tsx, wrapping the whole app.
 *
 * Owns the single requestAnimationFrame loop that drives the theme engine
 * (Phase 3 §4): idle hue drift, eased state snaps, and the throttled
 * --accent-live CSS var write. Renders nothing — it is a data layer, not UI.
 *
 * - Wires `prefers-reduced-motion` into the store so the engine freezes
 *   drift and snaps instantly instead of easing.
 * - Pauses the loop while the tab is hidden (`visibilitychange`) and resumes
 *   on return; the engine's absolute-timestamp math means no catch-up jump.
 * - Stops the loop on unmount.
 */
export function ThemeEngineProvider({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyReducedMotion = () => {
      useThemeStore.setState({ reducedMotion: mql.matches })
    }
    applyReducedMotion()
    mql.addEventListener('change', applyReducedMotion)

    function loop(timestamp: number) {
      themeEngine.step(timestamp)
      frameRef.current = requestAnimationFrame(loop)
    }

    function start() {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(loop)
    }

    function stop() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop()
      } else {
        start()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (!document.hidden) start()

    return () => {
      stop()
      mql.removeEventListener('change', applyReducedMotion)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return <>{children}</>
}
