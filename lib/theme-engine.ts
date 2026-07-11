'use client'

/**
 * Theme engine — Phase 3 §4 (tasks/PHASE3_DESIGN.md).
 *
 * The neural core drives the whole OS palette. This module owns:
 *  - the zustand store (`ThemeState`) that is the canonical home of
 *    `CoreState` (moved here from components/core-stage.tsx, which now just
 *    re-exports it for backward compat),
 *  - the drift/snap engine: idle ambient hue drift, and a 240ms eased snap
 *    to the target hue/energy whenever `coreState` changes,
 *  - a 10Hz-throttled writer for `--accent-live` on `document.documentElement`
 *    (globals.css derives --ring, .glow-primary, .text-glow from it — see
 *    globals.css:97,111,162,166),
 *  - an OKLCH -> sRGB helper for later R3F material colors (THREE.Color has
 *    no native oklch() parser, so scene code converts here and calls
 *    `color.setRGB(r, g, b, THREE.SRGBColorSpace)` on one scratch object).
 *
 * The rAF loop itself lives in components/theme-engine-provider.tsx, which
 * calls `themeEngine.step(timestamp)` once per frame. Nothing in this file
 * touches the DOM outside of `step()`'s throttled CSS var write, and nothing
 * here imports `three` — modules that only need the `CoreState` type (e.g.
 * chat-panel.tsx) stay free of any runtime theme-engine/three.js bundle cost.
 */

import { create } from 'zustand'

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface ThemeState {
  coreState: CoreState
  /** Live interpolated OKLCH hue (engine-written; read via getState() in rAF/useFrame consumers). */
  hue: number
  /** Live interpolated 0..1 energy value (engine-written). */
  energy: number
  /** 0..1, Phase 6 feeds this from mic input during 'listening'. */
  micLevel: number
  /** Perf governor field (set by jarvis-stage.tsx's rolling-fps monitor, §5). */
  quality: 'high' | 'low'
  reducedMotion: boolean
  /**
   * HUD layout bridge (§1.2 "Reactor primacy rule"). HudShell writes these;
   * the scene's CameraRig reads them via getState() in useFrame to lerp the
   * reactor back to the visual center of the *free* space the HUD leaves.
   * Chat dock (left) open pushes the framing right; an overlay (right) open
   * pulls it back. Booleans, not the offset itself, so the easing curve stays
   * owned by the camera rig (one source of truth for motion).
   */
  chatOpen: boolean
  overlayOpen: boolean
  setCoreState: (state: CoreState) => void
  setQuality: (quality: 'high' | 'low') => void
  setHudLayout: (layout: { chatOpen?: boolean; overlayOpen?: boolean }) => void
}

// ---------------------------------------------------------------------------
// Palette constants (Phase 3 design spec §3 "Animation choreography" + §4).
// ---------------------------------------------------------------------------

/** Idle drift sweeps 205 -> 255 -> 205 over 45s: mid 230, amplitude 25. */
const IDLE_DRIFT_MID = 230
const IDLE_DRIFT_AMPLITUDE = 25
const IDLE_DRIFT_PERIOD_S = 45
const IDLE_DRIFT_START_HUE = IDLE_DRIFT_MID - IDLE_DRIFT_AMPLITUDE // 205

/** Reduced motion freezes idle at a single fixed hue instead of drifting. */
const IDLE_REDUCED_MOTION_HUE = 213

const STATE_HUE: Record<Exclude<CoreState, 'idle'>, number> = {
  listening: 213,
  thinking: 75,
  speaking: 195,
}

const STATE_ENERGY: Record<CoreState, number> = {
  idle: 0.35,
  listening: 0.8,
  thinking: 1.0,
  speaking: 0.9,
}

/** Eased snap duration when coreState changes. */
const SNAP_DURATION_MS = 240
/** Max write rate for the --accent-live CSS var. */
const ACCENT_WRITE_INTERVAL_MS = 100 // 10Hz

/** Fixed OKLCH lightness/chroma for the live accent; only hue moves. */
const THEME_L = 0.84
const THEME_C = 0.14

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useThemeStore = create<ThemeState>((set) => ({
  coreState: 'idle',
  hue: IDLE_DRIFT_START_HUE,
  energy: STATE_ENERGY.idle,
  micLevel: 0,
  quality: 'high',
  reducedMotion: prefersReducedMotion(),
  chatOpen: true,
  overlayOpen: false,
  setCoreState: (state) => set({ coreState: state }),
  setQuality: (quality) => set({ quality }),
  setHudLayout: (layout) => set(layout),
}))

// ---------------------------------------------------------------------------
// Drift / snap engine
// ---------------------------------------------------------------------------

function idleDriftHue(elapsedSeconds: number): number {
  return (
    IDLE_DRIFT_MID -
    IDLE_DRIFT_AMPLITUDE * Math.cos((2 * Math.PI * elapsedSeconds) / IDLE_DRIFT_PERIOD_S)
  )
}

function quinticEaseOut(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  return 1 - Math.pow(1 - clamped, 5)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function targetForState(state: CoreState, atMs: number, idleEnteredAt: number) {
  if (state === 'idle') {
    const elapsedS = Math.max(0, (atMs - idleEnteredAt) / 1000)
    return { hue: idleDriftHue(elapsedS), energy: STATE_ENERGY.idle }
  }
  return { hue: STATE_HUE[state], energy: STATE_ENERGY[state] }
}

function accentLiveValue(hue: number): string {
  return `oklch(${THEME_L} ${THEME_C} ${hue.toFixed(2)})`
}

/**
 * Single stateful engine instance. Created once per module load (the module
 * itself is the singleton boundary — components/theme-engine-provider.tsx
 * mounts exactly one rAF loop that calls `step()`).
 */
function createThemeEngine() {
  let prevCoreState: CoreState | null = null
  let idleEnteredAt = 0
  let transitionStart = 0
  let fromHue = IDLE_DRIFT_START_HUE
  let fromEnergy = STATE_ENERGY.idle
  let toHue = IDLE_DRIFT_START_HUE
  let toEnergy = STATE_ENERGY.idle
  let lastAccentWrite = 0

  function step(nowMs: number) {
    const { coreState, reducedMotion } = useThemeStore.getState()

    if (coreState !== prevCoreState) {
      if (coreState === 'idle') idleEnteredAt = nowMs
      const current = useThemeStore.getState()
      fromHue = current.hue
      fromEnergy = current.energy
      transitionStart = nowMs
      const target = targetForState(coreState, nowMs, idleEnteredAt)
      toHue = target.hue
      toEnergy = target.energy
      prevCoreState = coreState
    }

    let hue: number
    let energy: number

    if (reducedMotion) {
      // Instant snap, no easing window; idle is frozen (not drifting).
      hue = coreState === 'idle' ? IDLE_REDUCED_MOTION_HUE : STATE_HUE[coreState]
      energy = STATE_ENERGY[coreState]
    } else {
      const progress = quinticEaseOut((nowMs - transitionStart) / SNAP_DURATION_MS)
      if (progress >= 1) {
        // Transition finished: track the live target directly — continuous
        // idle drift, or the held constant for an active state.
        const target = targetForState(coreState, nowMs, idleEnteredAt)
        hue = target.hue
        energy = target.energy
      } else {
        hue = lerp(fromHue, toHue, progress)
        energy = lerp(fromEnergy, toEnergy, progress)
      }
    }

    // Transient write: hue/energy are read imperatively via getState() in
    // rAF/useFrame consumers, so this does not trigger React re-renders for
    // components that only subscribe to `coreState`.
    useThemeStore.setState({ hue, energy })

    if (nowMs - lastAccentWrite >= ACCENT_WRITE_INTERVAL_MS) {
      lastAccentWrite = nowMs
      document.documentElement.style.setProperty('--accent-live', accentLiveValue(hue))
    }
  }

  return { step }
}

export const themeEngine = createThemeEngine()

// ---------------------------------------------------------------------------
// OKLCH -> sRGB (Björn Ottosson's OKLab conversion), for R3F material colors.
// ---------------------------------------------------------------------------

function gammaEncode(v: number): number {
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

/**
 * Core OKLCH -> sRGB conversion, writing into a caller-owned `out` object
 * instead of allocating. This is the zero-allocation entry point scene code
 * (jarvis-stage.tsx, environment.tsx, and Chunk C/D's arc-reactor.tsx /
 * neural-network.tsx) should call from inside `useFrame`, per the Phase 3
 * perf budget (§5: "Zero per-frame allocations in useFrame").
 */
function oklchToSrgbInto(
  l: number,
  c: number,
  hueDeg: number,
  out: { r: number; g: number; b: number },
): void {
  const hRad = (hueDeg * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  // OKLab -> LMS
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  // LMS -> linear sRGB
  const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  out.r = gammaEncode(rLin)
  out.g = gammaEncode(gLin)
  out.b = gammaEncode(bLin)
}

/**
 * Converts an OKLCH color to gamma-encoded sRGB channels in [0, 1] — ready
 * for `threeColor.setRGB(r, g, b, THREE.SRGBColorSpace)` on a scratch
 * THREE.Color, since THREE.Color.setStyle() cannot parse oklch() strings.
 *
 * Allocates a small result object each call — fine for one-off reads, but
 * NOT for `useFrame`/rAF hot paths. Use `writeLiveAccentSrgb` there instead.
 */
export function oklchToSrgb(l: number, c: number, hueDeg: number): { r: number; g: number; b: number } {
  const out = { r: 0, g: 0, b: 0 }
  oklchToSrgbInto(l, c, hueDeg, out)
  return out
}

/** The live theme accent (fixed L/C, live hue) as sRGB channels. */
export function liveAccentSrgb(hue: number): { r: number; g: number; b: number } {
  return oklchToSrgb(THEME_L, THEME_C, hue)
}

/**
 * Zero-allocation variant of `liveAccentSrgb` for `useFrame`/rAF hot paths:
 * mutates a caller-owned scratch object instead of returning a new one.
 *
 *   const rgb = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])
 *   const color = useMemo(() => new THREE.Color(), [])
 *   useFrame(() => {
 *     writeLiveAccentSrgb(useThemeStore.getState().hue, rgb)
 *     color.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace)
 *   })
 */
export function writeLiveAccentSrgb(hue: number, out: { r: number; g: number; b: number }): void {
  oklchToSrgbInto(THEME_L, THEME_C, hue, out)
}
