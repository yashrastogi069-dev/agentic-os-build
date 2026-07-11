'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useThemeStore, writeLiveAccentSrgb, type CoreState } from '@/lib/theme-engine'

/**
 * The Arc Reactor — Phase 3 §2.2 (tasks/PHASE3_DESIGN.md), refined by
 * tasks/CHUNK_C_BRIEF.md (Fable pre-flight pass, authoritative where it adds
 * detail). A machined instrument, not a movie prop: ≥60% dark metal, few
 * bright lines, one live hue. No triangle, no glyphs, no ring lettering.
 *
 * Assembly (12 draw calls, per the §5 budget):
 *   1 triangular core face · 1 core bezel · 2 halo sprites (tight + wide
 *   light-spill) · 1 coil glow annulus · 1 coil-segment InstancedMesh ·
 *   1 mid annulus · 1 mid-tick InstancedMesh · 1 outer torus · 1 outer-tick
 *   metal InstancedMesh · 1 outer index-tick InstancedMesh · 2 gyro tori —
 *   the invisible hitbox renders nothing (colorWrite off).
 *
 * Core shape: Mark-VI-style rounded TRIANGLE (Yash 2026-07-11, explicit
 * instruction superseding the earlier triangle reversal), machined bezel
 * frame, no glyphs, no ring lettering.
 *
 * Light treatment (Yash 2026-07-11: "like the real one — the glowing of the
 * core and colours"): the core's radial texture is white-hot at the center
 * and hands off to the live accent toward the rim (the movie reactor reads
 * near-white in the middle; the color lives in the falloff), layered over a
 * tight bright halo plus a wide soft spill sprite. The actual light cast on
 * the rings comes from jarvis-stage.tsx's ReactorLight (state-driven
 * intensity), so the metal visibly catches the accent color.
 *
 * Choreography (§3 reactor row, eased 0.08–0.14/frame, all targets read via
 * getState() — zero React re-renders, zero per-frame allocations):
 *   idle      core breathes ±3% (4s), base ring rates
 *   listening core ×1.4 brighter, coil ×2, core scale +0.15·micLevel
 *   thinking  mid ring ×4 with ±0.4 rad seek oscillation, tick flicker
 *   speaking  core amplitude-pulse ~7Hz smoothed, gyro ×2
 * Hover: outer ring rate ×3 (rate is lerped, never the angle).
 */

// ---------------------------------------------------------------------------
// Constants — geometry per §2.2, HDR multipliers per CHUNK_C_BRIEF §2.
// ---------------------------------------------------------------------------

const CORE_RADIUS = 0.42
/** Triangular core (Yash 2026-07-11, explicit new instruction superseding
 * the earlier triangle reversal): Mark-VI-style triangle, apex up, crisp
 * corners (0.14 rounding — the real piece is machined, not blobby). The
 * emissive face (0.50) tucks UNDER the bezel's inner edge (0.46) so the
 * glow hugs the frame with no dark gap ring, like the prop's glass line. */
// Sized to clear the coil glow annulus (starts r 0.56) with a dark moat —
// live-verified 2026-07-11: at bezel 0.58 the triangle corners bled into
// the glowing circle ("edges mixing with circle", Yash).
const CORE_TRI_RADIUS = 0.44
const CORE_TRI_CORNER = 0.14
/** Bezel = a uniform-width tube following the triangle path. An extruded
 * outline (outer shape + scaled hole) widened at the corners — the classic
 * offset-path artifact Yash flagged twice — a tube cross-section cannot. */
const BEZEL_MID_RADIUS = 0.42
const BEZEL_TUBE_RADIUS = 0.048
const CORE_CLAMPS = 3
const COIL_INNER = 0.62
const COIL_OUTER = 0.92
const MID_INNER = 1.02
const MID_OUTER = 1.18
const OUTER_RADIUS = 1.3
const GYRO_A_RADIUS = 1.55
const GYRO_B_RADIUS = 1.78
const HITBOX_RADIUS = 1.4

const COIL_SEGMENTS = 10
const MID_TICKS = 30
const OUTER_TICKS = 60
const OUTER_INDEX_TICKS = 8

/** HDR multipliers — only values ≥1.4 cross the bloom threshold of 1.0. */
const HDR_CORE = 2.4
const HDR_COIL_GLOW = 1.8
const HDR_MID_TICK = 1.6
const HDR_OUTER_INDEX = 1.5
// 1.55, not the brief's 1.9: live-verified 2026-07-11 — at 1.9 the two gyro
// tori out-bloomed the core and read as neon hoops, violating guardrail #3
// (the network/rings never outshine the core).
const HDR_GYRO = 1.55

/** Base rotation rates, rad/s (§2.2). Idle max surface speed ≈0.026 u/s ✓. */
const RATE_COIL = 0.05
const RATE_MID = -0.09
const RATE_OUTER = 0.02
const RATE_GYRO_A = 0.03
const RATE_GYRO_B = -0.045

/** Per-state choreography targets (§3 reactor row + CHUNK_C_BRIEF §5). */
const STATE_TARGETS: Record<
  CoreState,
  { coil: number; mid: number; gyro: number; coreBright: number; seek: number; flicker: number }
> = {
  idle: { coil: 1, mid: 1, gyro: 1, coreBright: 1, seek: 0, flicker: 0 },
  listening: { coil: 2, mid: 1, gyro: 1, coreBright: 1.4, seek: 0, flicker: 0 },
  thinking: { coil: 1, mid: 4, gyro: 1, coreBright: 1.15, seek: 1, flicker: 1 },
  speaking: { coil: 1, mid: 1, gyro: 2, coreBright: 1.2, seek: 0, flicker: 0 },
}

/** Easing rate for all per-frame target chasing (§3: 0.08–0.14/frame). */
const EASE = 0.1

// ---------------------------------------------------------------------------
// Texture helpers — built once per mount, disposed on unmount.
// ---------------------------------------------------------------------------

/**
 * Radial gradient canvas texture. `stops` are [offset, r, g, b, a] rows —
 * the core disc goes white-hot center → accent-tinted rim (the tint itself
 * comes from the material color; the texture carries the white→dim ramp).
 */
function makeRadialTexture(stops: Array<[number, number, number, number, number]>): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    for (const [offset, r, g, b, a] of stops) {
      gradient.addColorStop(offset, `rgba(${r},${g},${b},${a})`)
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * Coil segment — a torus ARC, not a box (Yash 2026-07-11: "the inner boxes
 * still look like boxes"). The real reactor's palladium coils are rounded,
 * wire-wrapped tubes that CURVE with the ring; a torus sector gives exactly
 * that: circular cross-section, follows the arc, and its UVs put `u` along
 * the arc so a striped texture wraps around the tube like wound wire.
 * Radius 0.77 ± tube 0.145 keeps the spec's 0.62–0.92 radial band. Built
 * once; instanced 10×.
 */
const COIL_ARC_SPAN = ((Math.PI * 2) / COIL_SEGMENTS) * 0.78

function makeCoilGeometry(): THREE.TorusGeometry {
  const midRadius = (COIL_INNER + COIL_OUTER) / 2
  const tube = (COIL_OUTER - COIL_INNER) / 2 - 0.005
  return new THREE.TorusGeometry(midRadius, tube, 10, 18, COIL_ARC_SPAN)
}

/**
 * Wire-winding texture for the coil segments: ONE wire strand with a
 * cylindrical shading ramp (dark edge → lit crown → dark edge), repeated 12×
 * along the arc via texture.repeat — each repeat wraps once around the tube,
 * reading as tightly wound coil wire.
 */
function makeWindingTexture(): THREE.CanvasTexture {
  const w = 64
  const h = 8
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    gradient.addColorStop(0, '#14181e')
    gradient.addColorStop(0.28, '#3e4650')
    gradient.addColorStop(0.5, '#59626d')
    gradient.addColorStop(0.72, '#3e4650')
    gradient.addColorStop(1, '#14181e')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 1)
  texture.needsUpdate = true
  return texture
}

/**
 * Ring-shaped emissive gradient for the glow annulus BEHIND the coil
 * segments — the real reactor's signature read: the light comes THROUGH the
 * slots between the dark coil blocks, not from the blocks themselves.
 * RingGeometry's UVs are planar, so a radial canvas gradient maps cleanly;
 * fractions are relative to the annulus outer radius.
 */
function makeRingGlowTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.55, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.66, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(0.8, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.94, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** The 8 emissive index-mark slots among the 60 outer ticks, evenly spread. */
const INDEX_TICK_SLOTS = new Set(
  Array.from({ length: OUTER_INDEX_TICKS }, (_, k) => Math.round((k * OUTER_TICKS) / OUTER_INDEX_TICKS)),
)

/**
 * Rounded equilateral triangle path, apex up (vertices at 90°/210°/330°).
 * Corners rounded via quadratic curves through the true vertex —
 * `cornerFraction` is how far along each edge the rounding starts.
 */
function roundedTrianglePath<T extends THREE.Path>(path: T, radius: number, cornerFraction: number): T {
  const verts = [90, 210, 330].map((deg) => {
    const rad = (deg * Math.PI) / 180
    return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius }
  })
  for (let i = 0; i < 3; i++) {
    const prev = verts[(i + 2) % 3]
    const curr = verts[i]
    const next = verts[(i + 1) % 3]
    const fromPrev = {
      x: curr.x + (prev.x - curr.x) * cornerFraction,
      y: curr.y + (prev.y - curr.y) * cornerFraction,
    }
    const toNext = {
      x: curr.x + (next.x - curr.x) * cornerFraction,
      y: curr.y + (next.y - curr.y) * cornerFraction,
    }
    if (i === 0) path.moveTo(fromPrev.x, fromPrev.y)
    else path.lineTo(fromPrev.x, fromPrev.y)
    path.quadraticCurveTo(curr.x, curr.y, toNext.x, toNext.y)
  }
  path.closePath()
  return path
}

/** Emissive triangular core face. */
function makeCoreTriangleGeometry(): THREE.ShapeGeometry {
  const shape = roundedTrianglePath(new THREE.Shape(), CORE_TRI_RADIUS, CORE_TRI_CORNER)
  return new THREE.ShapeGeometry(shape, 24)
}

/** Dark machined bezel framing the triangular core: a closed tube swept
 * along the rounded-triangle path — uniform width everywhere, corners
 * included. */
function makeCoreBezelGeometry(): THREE.TubeGeometry {
  const outline = roundedTrianglePath(new THREE.Shape(), BEZEL_MID_RADIUS, CORE_TRI_CORNER)
  const points = outline.getPoints(72).map((p) => new THREE.Vector3(p.x, p.y, 0))
  const curve = new THREE.CatmullRomCurve3(points, true)
  return new THREE.TubeGeometry(curve, 120, BEZEL_TUBE_RADIUS, 10, true)
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function ArcReactor() {
  // --- refs to everything the frame loop mutates ---------------------------
  const coreGroupRef = useRef<THREE.Group>(null)
  const coilGroupRef = useRef<THREE.Group>(null)
  const midGroupRef = useRef<THREE.Group>(null)
  const outerGroupRef = useRef<THREE.Group>(null)
  const gyroPivotARef = useRef<THREE.Group>(null)
  const gyroPivotBRef = useRef<THREE.Group>(null)
  const midTicksRef = useRef<THREE.InstancedMesh>(null)
  const clampsRef = useRef<THREE.InstancedMesh>(null)
  const hardwareRef = useRef<THREE.InstancedMesh>(null)

  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const haloTightMatRef = useRef<THREE.SpriteMaterial>(null)
  const haloWideMatRef = useRef<THREE.SpriteMaterial>(null)
  const coilGlowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const midTickMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const outerIndexMatRef = useRef<THREE.MeshBasicMaterial>(null)

  // --- one-time resources ---------------------------------------------------
  // Core: white-hot center handing off to the material tint toward the rim —
  // alpha ramps 1.0 → 0.55 → 0.15 (CHUNK_C_BRIEF §1 trap 2). ShapeGeometry
  // UVs are raw shape x/y coordinates, so the texture transform recenters
  // the gradient on the triangle's centroid.
  const coreTexture = useMemo(() => {
    // Near-uniform blaze with a soft edge bleed — the real Mark VI face is
    // blazing white across most of its area, not a dim-rimmed hotspot.
    const texture = makeRadialTexture([
      [0, 255, 255, 255, 1.0],
      [0.5, 255, 255, 255, 0.95],
      [0.85, 255, 255, 255, 0.7],
      [1, 255, 255, 255, 0.5],
    ])
    const span = 2 * CORE_TRI_RADIUS
    texture.repeat.set(1 / span, 1 / span)
    texture.offset.set(0.5, 0.5)
    return texture
  }, [])
  const coreTriangleGeometry = useMemo(() => makeCoreTriangleGeometry(), [])
  const coreBezelGeometry = useMemo(() => makeCoreBezelGeometry(), [])
  // Tight halo: bright, hugs the core. Wide halo: the soft room light-spill.
  const haloTexture = useMemo(
    () =>
      makeRadialTexture([
        [0, 255, 255, 255, 0.9],
        [0.4, 255, 255, 255, 0.28],
        [1, 255, 255, 255, 0],
      ]),
    [],
  )

  const coilGeometry = useMemo(() => makeCoilGeometry(), [])
  const windingTexture = useMemo(() => makeWindingTexture(), [])
  const ringGlowTexture = useMemo(() => makeRingGlowTexture(), [])

  /** Structural machined metal — shared by annulus, torus, metal ticks.
   * envMapIntensity 0.18, not the brief's 0.4: live-verified 2026-07-11 —
   * RoomEnvironment at 0.4 washed the dark metal to pale silver, violating
   * §8.3 ("dark metal is the luxury"). 0.18 keeps the specular life without
   * lifting the base tone. */
  const structuralMetal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x1a2028,
        metalness: 0.85,
        roughness: 0.35,
        envMapIntensity: 0.18,
      }),
    [],
  )
  /** Coil-wire metal: the winding texture carries the strand shading; the
   * near-white multiplier keeps its tone. Slightly rougher than the
   * structural metal (wound wire scatters light more than milled faces). */
  const coilMetal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xd8d2c8,
        map: windingTexture,
        metalness: 0.7,
        roughness: 0.5,
        envMapIntensity: 0.15,
      }),
    [windingTexture],
  )
  /** One emissive material shared by both gyro tori (one HDR multiplier). */
  const gyroEmissive = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])

  useEffect(() => {
    return () => {
      coreTexture.dispose()
      haloTexture.dispose()
      windingTexture.dispose()
      ringGlowTexture.dispose()
      coilGeometry.dispose()
      coreTriangleGeometry.dispose()
      coreBezelGeometry.dispose()
      structuralMetal.dispose()
      coilMetal.dispose()
      gyroEmissive.dispose()
    }
  }, [
    coreTexture,
    haloTexture,
    windingTexture,
    ringGlowTexture,
    coilGeometry,
    coreTriangleGeometry,
    coreBezelGeometry,
    structuralMetal,
    coilMetal,
    gyroEmissive,
  ])

  // --- static instance layout (set once after mount) ------------------------
  useEffect(() => {
    const dummy = new THREE.Object3D()

    // Coil ring: 10 torus-arc segments. The geometry is already built at the
    // correct radius around the origin, so placement is rotation-only —
    // each instance turns to its slot, centered on its slice.
    const coil = coilGroupRef.current
    if (coil) {
      const segments = coil.children.find((c): c is THREE.InstancedMesh => c.name === 'coil-segments')
      if (segments) {
        for (let i = 0; i < COIL_SEGMENTS; i++) {
          const theta = (i / COIL_SEGMENTS) * Math.PI * 2
          dummy.position.set(0, 0, 0)
          dummy.rotation.set(0, 0, theta - COIL_ARC_SPAN / 2)
          dummy.scale.set(1, 1, 1)
          dummy.updateMatrix()
          segments.setMatrixAt(i, dummy.matrix)
        }
        segments.instanceMatrix.needsUpdate = true
      }
    }

    // Core bezel corner nodes: rounded joints ON the tube path at the three
    // corner apexes — continuous with the frame, not bolted-on boxes (Yash
    // 2026-07-11, third corner iteration: boxes → tabs → integral nodes).
    // The corner apex of a quadratic-rounded equilateral triangle sits at
    // |V|·(1 − 0.75·cornerFraction) from center.
    const clamps = clampsRef.current
    if (clamps) {
      const apexRadius = BEZEL_MID_RADIUS * (1 - 0.75 * CORE_TRI_CORNER)
      for (let i = 0; i < CORE_CLAMPS; i++) {
        const theta = ((90 + i * 120) * Math.PI) / 180
        dummy.position.set(Math.cos(theta) * apexRadius, Math.sin(theta) * apexRadius, 0)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(BEZEL_TUBE_RADIUS * 1.45)
        dummy.updateMatrix()
        clamps.setMatrixAt(i, dummy.matrix)
      }
      clamps.instanceMatrix.needsUpdate = true
    }

    // Core hardware (matched against a real Mark VI prop photo, 2026-07-11):
    // instances 0-2 = bright steel STRUTS anchoring the triangle's corners
    // to the coil housing; instances 3-5 = near-black CLAMP blocks on the
    // frame's mid-edges. One InstancedMesh, per-instance color carries the
    // bright/dark split.
    const hardware = hardwareRef.current
    if (hardware) {
      const apexRadius = BEZEL_MID_RADIUS * (1 - 0.75 * CORE_TRI_CORNER)
      const strutInner = apexRadius
      const strutOuter = 0.6
      for (let i = 0; i < 3; i++) {
        const theta = ((90 + i * 120) * Math.PI) / 180
        const r = (strutInner + strutOuter) / 2
        dummy.position.set(Math.cos(theta) * r, Math.sin(theta) * r, 0)
        dummy.rotation.set(0, 0, theta + Math.PI / 2)
        dummy.scale.set(0.06, strutOuter - strutInner, 0.05)
        dummy.updateMatrix()
        hardware.setMatrixAt(i, dummy.matrix)
        hardware.setColorAt(i, new THREE.Color(1, 1, 1))
      }
      // Mid-edge clamps: edge midpoints of the apex-up triangle sit at the
      // inradius (≈ R/2) at 30°/150°/270°.
      for (let i = 0; i < 3; i++) {
        const theta = ((30 + i * 120) * Math.PI) / 180
        const r = BEZEL_MID_RADIUS / 2
        dummy.position.set(Math.cos(theta) * r, Math.sin(theta) * r, 0)
        dummy.rotation.set(0, 0, theta + Math.PI / 2)
        dummy.scale.set(0.09, 0.05, 0.065)
        dummy.updateMatrix()
        hardware.setMatrixAt(3 + i, dummy.matrix)
        hardware.setColorAt(3 + i, new THREE.Color(0.12, 0.13, 0.15))
      }
      hardware.instanceMatrix.needsUpdate = true
      if (hardware.instanceColor) hardware.instanceColor.needsUpdate = true
    }

    // Mid ring: 30 emissive ticks on the annulus face, r 1.10, z +0.025.
    const midTicks = midTicksRef.current
    if (midTicks) {
      const r = (MID_INNER + MID_OUTER) / 2
      for (let i = 0; i < MID_TICKS; i++) {
        const theta = (i / MID_TICKS) * Math.PI * 2
        dummy.position.set(Math.cos(theta) * r, Math.sin(theta) * r, 0.025)
        dummy.rotation.set(0, 0, theta + Math.PI / 2)
        dummy.scale.set(0.014, 0.1, 0.014)
        dummy.updateMatrix()
        midTicks.setMatrixAt(i, dummy.matrix)
        midTicks.setColorAt(i, new THREE.Color(1, 1, 1))
      }
      midTicks.instanceMatrix.needsUpdate = true
      if (midTicks.instanceColor) midTicks.instanceColor.needsUpdate = true
    }

    // Outer ring: 60 fine ticks crossing the torus, alternating heights;
    // 8 index slots are emissive, the other 52 stay dark metal (§2.2.4).
    const outer = outerGroupRef.current
    if (outer) {
      const metalTicks = outer.children.find((c): c is THREE.InstancedMesh => c.name === 'outer-ticks-metal')
      const indexTicks = outer.children.find((c): c is THREE.InstancedMesh => c.name === 'outer-ticks-index')
      let metalCursor = 0
      let indexCursor = 0
      for (let i = 0; i < OUTER_TICKS; i++) {
        const theta = (i / OUTER_TICKS) * Math.PI * 2
        const height = i % 2 === 0 ? 0.07 : 0.045
        dummy.position.set(Math.cos(theta) * OUTER_RADIUS, Math.sin(theta) * OUTER_RADIUS, 0)
        dummy.rotation.set(0, 0, theta + Math.PI / 2)
        dummy.scale.set(0.012, height, 0.012)
        dummy.updateMatrix()
        if (INDEX_TICK_SLOTS.has(i)) {
          indexTicks?.setMatrixAt(indexCursor++, dummy.matrix)
        } else {
          metalTicks?.setMatrixAt(metalCursor++, dummy.matrix)
        }
      }
      if (metalTicks) metalTicks.instanceMatrix.needsUpdate = true
      if (indexTicks) indexTicks.instanceMatrix.needsUpdate = true
    }
  }, [])

  // --- per-frame scratch (zero allocations in useFrame, §5) -----------------
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])
  const colorScratch = useMemo(() => new THREE.Color(), [])
  const flickerScratch = useMemo(() => new THREE.Color(), [])
  const anim = useRef({
    hovering: false,
    coilRate: 1,
    midRate: 1,
    outerRate: 1,
    gyroRate: 1,
    coreBright: 1,
    seekAmp: 0,
    flickerAmp: 0,
    pulseSmooth: 0,
    coilAngle: 0,
    midAngle: 0,
    outerAngle: 0,
    gyroAngleA: 0,
    gyroAngleB: 0,
    time: 0,
  })

  useFrame((_, delta) => {
    const { hue, coreState, micLevel, reducedMotion } = useThemeStore.getState()
    const a = anim.current
    const dt = Math.min(delta, 0.1) // clamp so tab-resume never jumps
    const targets = STATE_TARGETS[coreState]

    // -- one OKLCH→sRGB conversion per frame, shared by all six emissives --
    writeLiveAccentSrgb(hue, rgbScratch)

    // -- ease every choreography value toward its state target --
    a.coilRate += (targets.coil - a.coilRate) * EASE
    a.midRate += (targets.mid - a.midRate) * EASE
    a.gyroRate += (targets.gyro - a.gyroRate) * EASE
    a.outerRate += ((a.hovering ? 3 : 1) - a.outerRate) * EASE
    a.seekAmp += (targets.seek - a.seekAmp) * EASE
    a.flickerAmp += (targets.flicker - a.flickerAmp) * EASE

    // Speaking: ~7Hz amplitude pulse, smoothed (placeholder sine until
    // Phase 6 supplies real playback amplitude).
    const rawPulse = coreState === 'speaking' ? 0.5 + 0.5 * Math.sin(a.time * Math.PI * 14) : 0
    a.pulseSmooth += (rawPulse - a.pulseSmooth) * 0.25
    const coreBrightTarget = targets.coreBright + (coreState === 'speaking' ? 0.35 * a.pulseSmooth : 0)
    a.coreBright += (coreBrightTarget - a.coreBright) * EASE

    if (!reducedMotion) {
      a.time += dt
      a.coilAngle += RATE_COIL * a.coilRate * dt
      a.midAngle += RATE_MID * a.midRate * dt
      a.outerAngle += RATE_OUTER * a.outerRate * dt
      a.gyroAngleA += RATE_GYRO_A * a.gyroRate * dt
      a.gyroAngleB += RATE_GYRO_B * a.gyroRate * dt
    }

    // -- write colors (setRGB resets the scratch each time, no accumulation) --
    if (coreMatRef.current) {
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_CORE * a.coreBright)
      coreMatRef.current.color.copy(colorScratch)
    }
    if (haloTightMatRef.current) {
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_CORE * a.coreBright)
      haloTightMatRef.current.color.copy(colorScratch)
    }
    if (haloWideMatRef.current) {
      // The wide spill stays LDR — it's glow already, it must not re-bloom.
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      haloWideMatRef.current.color.copy(colorScratch)
      haloWideMatRef.current.opacity = 0.18 + 0.1 * (a.coreBright - 1)
    }
    if (coilGlowMatRef.current) {
      // The glow annulus brightens with the core (it IS the core's light
      // escaping through the coil slots).
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_COIL_GLOW * (0.85 + 0.15 * a.coreBright))
      coilGlowMatRef.current.color.copy(colorScratch)
    }
    if (midTickMatRef.current) {
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_MID_TICK)
      midTickMatRef.current.color.copy(colorScratch)
    }
    if (outerIndexMatRef.current) {
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_OUTER_INDEX)
      outerIndexMatRef.current.color.copy(colorScratch)
    }
    colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    colorScratch.multiplyScalar(HDR_GYRO)
    gyroEmissive.color.copy(colorScratch)

    // -- thinking-state tick flicker: per-instance grayscale noise 0.7–1.3 --
    const midTicks = midTicksRef.current
    if (midTicks?.instanceColor) {
      if (a.flickerAmp > 0.01 && !reducedMotion) {
        for (let i = 0; i < MID_TICKS; i++) {
          const noise = 1 + a.flickerAmp * 0.3 * Math.sin(a.time * 13 + i * 7.3)
          flickerScratch.setScalar(noise)
          midTicks.setColorAt(i, flickerScratch)
        }
        midTicks.instanceColor.needsUpdate = true
      } else if (a.flickerAmp <= 0.01 && midTicks.userData.flickerDirty) {
        for (let i = 0; i < MID_TICKS; i++) {
          flickerScratch.setScalar(1)
          midTicks.setColorAt(i, flickerScratch)
        }
        midTicks.instanceColor.needsUpdate = true
      }
      midTicks.userData.flickerDirty = a.flickerAmp > 0.01
    }

    // -- apply motion --
    if (coilGroupRef.current) coilGroupRef.current.rotation.z = a.coilAngle
    if (midGroupRef.current) {
      // Thinking adds a bounded ±0.4 rad "seek" oscillation on top of spin.
      const seek = reducedMotion ? 0 : a.seekAmp * 0.4 * Math.sin(a.time * 2.3)
      midGroupRef.current.rotation.z = a.midAngle + seek
    }
    if (outerGroupRef.current) outerGroupRef.current.rotation.z = a.outerAngle
    if (gyroPivotARef.current) gyroPivotARef.current.rotation.y = a.gyroAngleA
    if (gyroPivotBRef.current) gyroPivotBRef.current.rotation.y = a.gyroAngleB

    // -- core breathe / listen-swell / speak-pulse --
    if (coreGroupRef.current) {
      let scale = 1
      if (!reducedMotion) {
        scale = 1 + 0.03 * Math.sin((a.time * Math.PI * 2) / 4)
        if (coreState === 'listening') scale += 0.15 * micLevel
        if (coreState === 'speaking') scale += 0.05 * a.pulseSmooth
      }
      coreGroupRef.current.scale.setScalar(scale)
    }
  })

  // --- interaction ----------------------------------------------------------
  function setHover(hovering: boolean) {
    anim.current.hovering = hovering
    document.body.style.cursor = hovering ? 'pointer' : 'auto'
    window.dispatchEvent(new CustomEvent('jarvis:reactor-hover', { detail: { hovering } }))
  }

  return (
    <group position={[0, -0.15, 0]} rotation={[-0.21, 0, 0]}>
      {/* Core — Mark-VI rounded triangle, white-hot center, accent falloff,
          breathing, framed by a machined bezel (§2.2.1 + Yash 2026-07-11). */}
      <group ref={coreGroupRef}>
        <mesh position={[0, 0, 0.03]} geometry={coreTriangleGeometry}>
          <meshBasicMaterial ref={coreMatRef} map={coreTexture} transparent toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.0]} geometry={coreBezelGeometry} material={structuralMetal} />
        <instancedMesh
          ref={clampsRef}
          args={[undefined, structuralMetal, CORE_CLAMPS]}
          frustumCulled={false}
        >
          <sphereGeometry args={[1, 14, 14]} />
        </instancedMesh>
        <instancedMesh ref={hardwareRef} args={[undefined, structuralMetal, 6]} frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
        </instancedMesh>
        {/* Tight halo — HDR, blooms with the core. */}
        <sprite scale={[1.3, 1.3, 1]} position={[0, 0, -0.02]}>
          <spriteMaterial
            ref={haloTightMatRef}
            map={haloTexture}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        {/* Wide light-spill — LDR soft glow washing over the ring assembly. */}
        <sprite scale={[3.4, 3.4, 1]} position={[0, 0, -0.06]}>
          <spriteMaterial
            ref={haloWideMatRef}
            map={haloTexture}
            transparent
            opacity={0.18}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      </group>

      {/* Coil ring — 10 wire-wound torus-arc segments (§2.2.2, reshaped per
          Yash 2026-07-11 realism feedback) over an emissive glow annulus so
          the light spills THROUGH the slots between the dark coils — the
          real reactor's signature read. The annulus replaces the spec's
          per-segment inner strips: same emissive role, honest curved
          geometry, one draw call fewer. */}
      <group ref={coilGroupRef}>
        <mesh position={[0, 0, -0.12]}>
          <ringGeometry args={[0.56, 0.98, 64]} />
          <meshBasicMaterial
            ref={coilGlowMatRef}
            map={ringGlowTexture}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <instancedMesh
          name="coil-segments"
          args={[coilGeometry, coilMetal, COIL_SEGMENTS]}
          frustumCulled={false}
        />
      </group>

      {/* Mid ring — thin metal annulus + 30 emissive ticks (§2.2.3). */}
      <group ref={midGroupRef} position={[0, 0, -0.05]}>
        <mesh material={structuralMetal}>
          <ringGeometry args={[MID_INNER, MID_OUTER, 96]} />
        </mesh>
        <instancedMesh ref={midTicksRef} args={[undefined, undefined, MID_TICKS]} frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial ref={midTickMatRef} toneMapped={false} />
        </instancedMesh>
      </group>

      {/* Outer ring — dark torus + 60 fine ticks, 8 emissive index marks (§2.2.4). */}
      <group ref={outerGroupRef} position={[0, 0, -0.1]}>
        <mesh material={structuralMetal}>
          <torusGeometry args={[OUTER_RADIUS, 0.03, 12, 128]} />
        </mesh>
        <instancedMesh
          name="outer-ticks-metal"
          args={[undefined, structuralMetal, OUTER_TICKS - OUTER_INDEX_TICKS]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
        </instancedMesh>
        <instancedMesh
          name="outer-ticks-index"
          args={[undefined, undefined, OUTER_INDEX_TICKS]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial ref={outerIndexMatRef} toneMapped={false} />
        </instancedMesh>
      </group>

      {/* Gyro rings — thin emissive tori sharing one material, tilted,
          precessing in opposite senses (§2.2.5). */}
      <group ref={gyroPivotARef}>
        <mesh rotation={[THREE.MathUtils.degToRad(65), 0, 0]} material={gyroEmissive}>
          <torusGeometry args={[GYRO_A_RADIUS, 0.012, 8, 96]} />
        </mesh>
      </group>
      <group ref={gyroPivotBRef}>
        <mesh rotation={[THREE.MathUtils.degToRad(78), 0, 0]} material={gyroEmissive}>
          <torusGeometry args={[GYRO_B_RADIUS, 0.012, 8, 96]} />
        </mesh>
      </group>

      {/* Invisible interaction hitbox (§2.2 interaction): renders nothing
          (colorWrite off) but still raycasts — visible={false} would not. */}
      <mesh
        position={[0, 0, 0.1]}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHover(true)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          setHover(false)
        }}
        onClick={(event) => {
          event.stopPropagation()
          window.dispatchEvent(new CustomEvent('jarvis:toggle-mic'))
        }}
      >
        <circleGeometry args={[HITBOX_RADIUS, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}
