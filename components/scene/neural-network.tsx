'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useThemeStore, writeLiveAccentSrgb, type CoreState } from '@/lib/theme-engine'

/**
 * The Neural Network — Jarvis's mind. Phase 3 §2.1 (tasks/PHASE3_DESIGN.md),
 * elevated 2026-07-12 (Yash: "add real computer graphics, 3D effects") into a
 * holographic energy field rather than a flat dot-scatter. It arcs around and
 * behind the Arc Reactor, centered on it, and never outshines the core.
 *
 * Real-CG techniques in play (all inside a zero-per-frame-alloc budget):
 *  - ENERGY-GLOW NODES: a single `THREE.Points` cloud drawn through a custom
 *    additive ShaderMaterial. Each point is a soft radial glow (no hard
 *    polygon facets), so overlapping nodes read as a luminous field.
 *  - TRUE Z-DEPTH SCALING (2.5D pseudo-projection): `gl_PointSize` is
 *    attenuated by `1 / -viewZ` in the vertex shader, so nearer nodes are
 *    genuinely larger — perspective, not a fake.
 *  - DEPTH CUEING: front-facing nodes (after the group's live Y-rotation) are
 *    brighter and bigger, back nodes recede — the rotation reads volumetric.
 *  - RADIAL SWEEP RADAR: each node's azimuth (atan2 of its x/z, precomputed)
 *    is compared to a rotating sweep angle; a narrow Gaussian lights the wedge
 *    the sweep is crossing — a classic HUD radar scan.
 *  - ADDITIVE ARC EDGES: connections are quadratic-bezier arcs bowed outward
 *    from center (not chords), additively blended into filaments; energy
 *    pulses ride the same curves.
 *  - COLOR LIFE: at idle the field walks the OKLCH hue wheel on its own; any
 *    active OS state snaps it to the state accent.
 *  - FUNCTION: the bright hub anchors double as clickable shortcuts into the
 *    HUD panels (hover → label, click → open).
 *
 * Choreography (§3 network row):
 *   idle      shimmer + slow radar + hue walk · 1 pulse / 1.6s
 *   listening shimmer ×1.5 · pulses converge on the reactor-facing node · 1 / 0.5s
 *   thinking  pulse storm 1 / 0.18s (pool-capped) · rotation ×2.5 · edges brighten
 *   speaking  half-rectified node-scale wave radiating outward, 1.1s · 1 / 0.8s
 * Reduced motion: rotation/shimmer/waves/sweep frozen, pulses off, colors land.
 */

// ---------------------------------------------------------------------------
// Build-time lattice construction (all plain math, runs once per mount)
// ---------------------------------------------------------------------------

// Screen-filling field (Yash 2026-07-12): not a center cluster — a network
// that spans the whole viewport, denser, wider, and auto-morphing. Counts up,
// radii widened (flatter + broader), edge reach/caps scaled to keep it richly
// connected across the larger volume.
const SHELL_COUNT = 320
const INTERIOR_COUNT = 64
const NODE_COUNT = SHELL_COUNT + INTERIOR_COUNT
const HUB_COUNT = 15
const EDGE_DISTANCE = 0.74
const EDGE_DEGREE_CAP = 6
const EDGE_HUB_DEGREE_CAP = 9
const EDGE_TOTAL_CAP = 940
const PULSE_POOL = 40
/** Logical pool cap when the perf governor drops quality (§5). */
const PULSE_POOL_LOW = 18

const RX = 3.5
const RY = 2.3
const RZ = 2.2

/** Base scale of the whole lattice group (breathing multiplies this). At this
 * scale RX·scale ≈ 13.6 world units half-width — past the viewport edges at
 * z −7.2, so the field runs off all four sides and reads as full-screen. */
const GROUP_SCALE = 3.9
/** World position of the lattice group — on the camera→reactor sight line so
 * it reads as centered on the reactor (camera [0,0.6,7.2] → [0,-0.15,0]). */
const GROUP_POS: [number, number, number] = [0, -0.9, -7.2]

/** Auto design-change (Yash 2026-07-12): the field morphs through a set of
 * distinct silhouettes — organic sphere, spiral disc, ring/torus, rippled
 * sheet — in random order, holding briefly on each, so it keeps "forming
 * different shapes." Every node also drifts on its own slow flow on top. */
const CONFIG_COUNT = 4
const MORPH_TIME = 5.5
/** Extra hold (as a fraction of MORPH_TIME) to rest on each shape before the
 * next morph begins. */
const MORPH_HOLD = 0.55
const FLOW_AMP = 0.13

/** Live connect/disconnect (Yash 2026-07-12): edges continuously join and
 * break, so the graph keeps forming new shapes. Roughly ACTIVE_FRACTION of
 * edges are lit at any moment; every JOIN_INTERVAL a batch is retired and an
 * equal batch is re-lit, each fading over ~0.4s. */
const JOIN_INTERVAL = 0.42
const JOIN_BATCH = 7
const ACTIVE_FRACTION = 0.62

/** Curved edges: each rendered as ARC_SEGMENTS straight chords sampling a
 * quadratic bezier bowed ARC_BOW×length outward from center. */
const ARC_SEGMENTS = 6
const ARC_BOW = 0.22

/** Point-size perspective attenuation numerator (px·world-units). Tuned live
 * so hubs read as crisp ~20px marks and smalls ~7px at the ~14u view distance. */
const POINT_ATTEN = 230

/** HDR-ish brightness the shader emits raw into the HDR buffer; hubs cross
 * the bloom threshold (1.0), mids/smalls stay under it (selective bloom). */
const HDR_PULSES = 2.0

/** Idle color walk: the field drifts around the OKLCH hue wheel on its own
 * (a clearly different color roughly every few seconds), instead of sitting on
 * one fixed accent. Active states override with the OS state accent. */
const CYCLE_DEG_PER_S = 14

/** Radar sweep: angular speed (rad/s), lobe width (rad), and brightness gain. */
const SWEEP_SPEED = 0.85
const SWEEP_SIGMA = 0.4
const SWEEP_GAIN = 0.85

const TWO_PI = Math.PI * 2

const PULSE_INTERVAL: Record<CoreState, number> = {
  idle: 1.6,
  listening: 0.5,
  thinking: 0.18,
  speaking: 0.8,
}

interface Lattice {
  /** xyz per node, local space — configuration A (organic shell). Also the
   * home layout for edge topology, hubs, azimuth, and convergence. */
  positions: Float32Array
  /** CONFIG_COUNT stacked shape configurations (sphere/disc/torus/sheet), each
   * NODE_COUNT×xyz; the field morphs between them in random order. */
  configs: Float32Array
  /** Per-node slow-flow frequency (xyz) and phase (xyz) so every node drifts. */
  flowFreq: Float32Array
  flowPhase: Float32Array
  /** Per-node point base size (hub 2.4 / mid 1.3 / small 0.8 / interior 0.55). */
  sizes: Float32Array
  /** Per-node base brightness (hub 1.3 / mid 0.6 / small 0.4 / interior 0.3). */
  shades: Float32Array
  /** Per-node shimmer phase (0..2π) and speed (0.5..1.2 Hz). */
  phases: Float32Array
  speeds: Float32Array
  /** Per-node normalized distance from lattice center (speaking wave). */
  radials: Float32Array
  /** Per-node azimuth atan2(z,x) for the radar sweep. */
  azimuth: Float32Array
  /** Edge endpoints as node indices. */
  edgeA: Uint16Array
  edgeB: Uint16Array
  edgeCount: number
  /** Per-edge bow vector (xyz): control point = live midpoint + this, so arcs
   * follow the nodes as they morph/flow instead of snapping straight. */
  edgeBow: Float32Array
  /** Line positions buffer (edgeCount × ARC_SEGMENTS segments × 2 × xyz),
   * rebuilt each frame from live positions. */
  linePositions: Float32Array
  /** Node index nearest the reactor (listening convergence target). */
  targetNode: number
  /** Edge indices whose midpoint is in the nearest 40% to targetNode. */
  convergeEdges: Uint16Array
  /** For each edge, 1 if B is closer to targetNode than A, else 0. */
  towardB: Uint8Array
}

function buildLattice(): Lattice {
  const positions = new Float32Array(NODE_COUNT * 3)

  // Free-flow organic shell (Yash 2026-07-12: "not an oval"). Fibonacci gives
  // even angular coverage; layered trig noise on the radius makes the surface
  // lumpy, and a per-node shell thickness fills a volume instead of a skin.
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < SHELL_COUNT; i++) {
    const y0 = 1 - (i / (SHELL_COUNT - 1)) * 2
    const rr = Math.sqrt(Math.max(0, 1 - y0 * y0))
    const theta = golden * i
    const ux = Math.cos(theta) * rr
    const uy = y0
    const uz = Math.sin(theta) * rr
    const lump =
      1 +
      0.3 * Math.sin(ux * 3.1 + uz * 2.3) +
      0.18 * Math.sin(uy * 4.7 + ux * 1.9) +
      0.12 * Math.sin(uz * 6.1 + uy * 3.3)
    const shell = 0.68 + Math.random() * 0.34
    const rad = lump * shell
    positions[i * 3] = ux * rad * RX
    positions[i * 3 + 1] = uy * rad * RY
    positions[i * 3 + 2] = uz * rad * RZ
  }
  // Interior fill: cube-root radial sampling keeps density even.
  for (let i = SHELL_COUNT; i < NODE_COUNT; i++) {
    const u = Math.random()
    const radius = Math.cbrt(u) * 0.8
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius * RX
    positions[i * 3 + 1] = Math.cos(phi) * radius * RY
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius * RZ
  }

  // Shape configurations the field morphs between. All derived from each node's
  // config-0 position so the graph keeps its identity (edges don't scramble):
  //  0 organic sphere (base) · 1 spiral disc · 2 ring/torus · 3 rippled sheet.
  const configs = new Float32Array(CONFIG_COUNT * NODE_COUNT * 3)
  const STRIDE = NODE_COUNT * 3
  for (let i = 0; i < NODE_COUNT; i++) {
    const i3 = i * 3
    const bx = positions[i3]
    const by = positions[i3 + 1]
    const bz = positions[i3 + 2]
    const len = Math.hypot(bx, by, bz) || 1
    const uy = by / len

    // 0 — sphere (base).
    configs[i3] = bx
    configs[i3 + 1] = by
    configs[i3 + 2] = bz

    // 1 — spiral disc: twist by radius, widen XZ, flatten Y.
    const rr = Math.hypot(bx, bz)
    const spin = rr * 0.6
    const cs = Math.cos(spin)
    const sn = Math.sin(spin)
    configs[STRIDE + i3] = (bx * cs - bz * sn) * 1.35
    configs[STRIDE + i3 + 1] = by * 0.4
    configs[STRIDE + i3 + 2] = (bx * sn + bz * cs) * 1.35

    // 2 — torus ring: big-ring angle from azimuth, tube angle from elevation.
    const a1 = Math.atan2(bz, bx)
    const a2 = Math.asin(Math.max(-1, Math.min(1, uy))) * 2
    const majorR = 2.7
    const minorR = 0.9
    const tubeR = majorR + minorR * Math.cos(a2)
    configs[2 * STRIDE + i3] = tubeR * Math.cos(a1)
    configs[2 * STRIDE + i3 + 1] = minorR * Math.sin(a2)
    configs[2 * STRIDE + i3 + 2] = tubeR * Math.sin(a1)

    // 3 — rippled sheet: spread flat on XZ with a sinusoidal height field.
    configs[3 * STRIDE + i3] = bx * 1.55
    configs[3 * STRIDE + i3 + 1] = 0.95 * Math.sin(bx * 1.05 + bz * 0.7) + by * 0.12
    configs[3 * STRIDE + i3 + 2] = bz * 1.55
  }

  // Per-node slow flow: random low frequencies + phases per axis.
  const flowFreq = new Float32Array(NODE_COUNT * 3)
  const flowPhase = new Float32Array(NODE_COUNT * 3)
  for (let i = 0; i < NODE_COUNT * 3; i++) {
    flowFreq[i] = 0.15 + Math.random() * 0.35
    flowPhase[i] = Math.random() * Math.PI * 2
  }

  const dist2 = (a: number, b: number): number => {
    const dx = positions[a * 3] - positions[b * 3]
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1]
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2]
    return dx * dx + dy * dy + dz * dz
  }

  // Hubs: greedy farthest-point sampling over the shell — spread apart, so
  // the bright anchors structure the whole constellation.
  const hubs: number[] = [0]
  const minDist = new Float64Array(SHELL_COUNT).fill(Infinity)
  while (hubs.length < HUB_COUNT) {
    const latest = hubs[hubs.length - 1]
    let best = -1
    let bestDist = -1
    for (let i = 0; i < SHELL_COUNT; i++) {
      const d = dist2(i, latest)
      if (d < minDist[i]) minDist[i] = d
      if (!hubs.includes(i) && minDist[i] > bestDist) {
        bestDist = minDist[i]
        best = i
      }
    }
    hubs.push(best)
  }
  const hubSet = new Set(hubs)

  const sizes = new Float32Array(NODE_COUNT)
  const shades = new Float32Array(NODE_COUNT)
  for (let i = 0; i < NODE_COUNT; i++) {
    if (i >= SHELL_COUNT) {
      sizes[i] = 0.5
      shades[i] = 0.32
    } else if (hubSet.has(i)) {
      sizes[i] = 1.7
      shades[i] = 1.25
    } else if (i % 3 === 0) {
      sizes[i] = 1.0
      shades[i] = 0.62
    } else {
      sizes[i] = 0.62
      shades[i] = 0.42
    }
  }

  const phases = new Float32Array(NODE_COUNT)
  const speeds = new Float32Array(NODE_COUNT)
  const radials = new Float32Array(NODE_COUNT)
  const azimuth = new Float32Array(NODE_COUNT)
  let maxRadial = 0
  for (let i = 0; i < NODE_COUNT; i++) {
    phases[i] = Math.random() * Math.PI * 2
    speeds[i] = 0.5 + Math.random() * 0.7
    const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    radials[i] = r
    if (r > maxRadial) maxRadial = r
    azimuth[i] = Math.atan2(positions[i * 3 + 2], positions[i * 3])
  }
  for (let i = 0; i < NODE_COUNT; i++) radials[i] /= maxRadial

  // Edges: all pairs under the distance threshold, ascending by length,
  // admitted under per-node degree caps until the total cap.
  const candidates: Array<{ a: number; b: number; d: number }> = []
  const threshold2 = EDGE_DISTANCE * EDGE_DISTANCE
  for (let a = 0; a < NODE_COUNT; a++) {
    for (let b = a + 1; b < NODE_COUNT; b++) {
      const d = dist2(a, b)
      if (d < threshold2) candidates.push({ a, b, d })
    }
  }
  candidates.sort((p, q) => p.d - q.d)
  const degree = new Uint8Array(NODE_COUNT)
  const edgeAList: number[] = []
  const edgeBList: number[] = []
  for (const { a, b } of candidates) {
    if (edgeAList.length >= EDGE_TOTAL_CAP) break
    const capA = hubSet.has(a) ? EDGE_HUB_DEGREE_CAP : EDGE_DEGREE_CAP
    const capB = hubSet.has(b) ? EDGE_HUB_DEGREE_CAP : EDGE_DEGREE_CAP
    if (degree[a] >= capA || degree[b] >= capB) continue
    degree[a]++
    degree[b]++
    edgeAList.push(a)
    edgeBList.push(b)
  }
  const edgeCount = edgeAList.length
  const edgeA = new Uint16Array(edgeAList)
  const edgeB = new Uint16Array(edgeBList)

  // Per-edge bow VECTOR = outward radial offset for the arc's control point.
  // Stored as a delta from the midpoint so the arc follows the nodes as they
  // morph and flow (control = live midpoint + bow), instead of snapping flat.
  const edgeBow = new Float32Array(edgeCount * 3)
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeA[e]
    const b = edgeB[e]
    const mx = (positions[a * 3] + positions[b * 3]) * 0.5
    const my = (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5
    const mz = (positions[a * 3 + 2] + positions[b * 3 + 2]) * 0.5
    const mlen = Math.hypot(mx, my, mz) || 1
    const len = Math.sqrt(dist2(a, b))
    const bow = ARC_BOW * len
    edgeBow[e * 3] = (mx / mlen) * bow
    edgeBow[e * 3 + 1] = (my / mlen) * bow
    edgeBow[e * 3 + 2] = (mz / mlen) * bow
  }

  // Initial line buffer (rebuilt each frame in useFrame from live positions).
  const linePositions = new Float32Array(edgeCount * ARC_SEGMENTS * 6)

  // Listening convergence target: the node nearest the reactor. The group
  // sits on the camera→reactor axis (GROUP_POS), so the lattice reads as
  // centered ON the reactor from the viewer's seat. Reactor at [0,-0.15,0]
  // world → local = (reactor − group) / GROUP_SCALE.
  const target = {
    x: (0 - GROUP_POS[0]) / GROUP_SCALE,
    y: (-0.15 - GROUP_POS[1]) / GROUP_SCALE,
    z: (0 - GROUP_POS[2]) / GROUP_SCALE,
  }
  let targetNode = 0
  let bestT = Infinity
  for (let i = 0; i < NODE_COUNT; i++) {
    const dx = positions[i * 3] - target.x
    const dy = positions[i * 3 + 1] - target.y
    const dz = positions[i * 3 + 2] - target.z
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestT) {
      bestT = d
      targetNode = i
    }
  }

  const distToTarget = (n: number): number => dist2(n, targetNode)
  const edgeOrder = Array.from({ length: edgeCount }, (_, e) => e).sort((e1, e2) => {
    const m1 = Math.min(distToTarget(edgeA[e1]), distToTarget(edgeB[e1]))
    const m2 = Math.min(distToTarget(edgeA[e2]), distToTarget(edgeB[e2]))
    return m1 - m2
  })
  const convergeEdges = new Uint16Array(edgeOrder.slice(0, Math.max(1, Math.floor(edgeCount * 0.4))))
  const towardB = new Uint8Array(edgeCount)
  for (let e = 0; e < edgeCount; e++) {
    towardB[e] = distToTarget(edgeB[e]) < distToTarget(edgeA[e]) ? 1 : 0
  }

  return {
    positions,
    configs,
    flowFreq,
    flowPhase,
    sizes,
    shades,
    phases,
    speeds,
    radials,
    azimuth,
    edgeA,
    edgeB,
    edgeCount,
    edgeBow,
    linePositions,
    targetNode,
    convergeEdges,
    towardB,
  }
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// Custom additive glow-point shader: soft radial sprite, per-point size &
// color, and TRUE perspective size attenuation (2.5D pseudo-projection).
const NODE_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uAtten;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective size attenuation, clamped so a node that drifts near the
    // camera can't balloon into a screen-eating blob.
    gl_PointSize = min(aSize * (uAtten / max(0.001, -mv.z)), 30.0);
  }
`
const NODE_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    // A crisp filled disc (anti-aliased rim) plus a faint surrounding glow —
    // reads as a precise data node, not a fuzzy smoke puff.
    float disc = smoothstep(0.42, 0.30, d);
    float glow = smoothstep(0.5, 0.0, d);
    float a = max(disc, glow * 0.28);
    gl_FragColor = vec4(vColor, a);
  }
`

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function NeuralNetwork() {
  const groupRef = useRef<THREE.Group>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const pulsesRef = useRef<THREE.InstancedMesh>(null)
  const pulseMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const lineMatRef = useRef<THREE.LineBasicMaterial>(null)

  const lattice = useMemo(() => buildLattice(), [])

  // Points geometry + live position / color / size attributes (all updated in
  // useFrame: nodes morph A↔B and flow, so position moves too). livePositions
  // is the single source of truth the depth cue, edges, and pulses all read.
  const { pointsGeometry, livePositions, aSizeArray, aColorArray } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const live = new Float32Array(lattice.positions) // seed from config A
    geo.setAttribute('position', new THREE.BufferAttribute(live, 3))
    const aSize = new Float32Array(NODE_COUNT)
    const aColor = new Float32Array(NODE_COUNT * 3)
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3))
    return { pointsGeometry: geo, livePositions: live, aSizeArray: aSize, aColorArray: aColor }
  }, [lattice])

  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uAtten: { value: POINT_ATTEN } },
        vertexShader: NODE_VERT,
        fragmentShader: NODE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  const { lineGeometry, lineColors } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(lattice.linePositions, 3))
    const colors = new Float32Array(lattice.linePositions.length)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return { lineGeometry: geo, lineColors: colors }
  }, [lattice])

  // Per-edge live connect/disconnect state (Yash 2026-07-12): alpha eases
  // toward target; a timer randomly retires and re-lights edges so the graph
  // keeps reshaping. ~ACTIVE_FRACTION lit at start.
  const edgeAnim = useMemo(() => {
    const alpha = new Float32Array(lattice.edgeCount)
    const target = new Float32Array(lattice.edgeCount)
    for (let e = 0; e < lattice.edgeCount; e++) {
      const on = Math.random() < ACTIVE_FRACTION ? 1 : 0
      alpha[e] = on
      target[e] = on
    }
    return { alpha, target }
  }, [lattice])

  useEffect(() => {
    return () => {
      lineGeometry.dispose()
      pointsGeometry.dispose()
      pointsMaterial.dispose()
    }
  }, [lineGeometry, pointsGeometry, pointsMaterial])

  // Per-frame scratch + pulse pool state — pre-allocated, zero allocs in useFrame.
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])
  const colorScratch = useMemo(() => new THREE.Color(), [])
  const anim = useRef({
    time: 0,
    wavePhase: 0,
    cycleHue: 213,
    sweepAngle: 0,
    joinAccumulator: 0,
    morphT: 0,
    morphFrom: 0,
    morphTo: 1,
    spawnAccumulator: 0,
    edgeOpacity: 0.12,
    shimmerAmp: 0.06,
    rotationY: 0,
    hoveredNode: -1,
    hoverScale: new Float32Array(NODE_COUNT),
    // Pulse pool (struct-of-arrays): edge index, progress 0..1, duration s,
    // direction (1 = A→B), active flag.
    pulseEdge: new Int16Array(PULSE_POOL).fill(-1),
    pulseT: new Float32Array(PULSE_POOL),
    pulseDur: new Float32Array(PULSE_POOL),
    pulseDir: new Uint8Array(PULSE_POOL),
  })

  useFrame((_, delta) => {
    const { hue, coreState, reducedMotion, quality } = useThemeStore.getState()
    const a = anim.current
    const dt = Math.min(delta, 0.1)
    const group = groupRef.current
    const points = pointsRef.current
    const pulses = pulsesRef.current
    if (!group || !points || !pulses) return

    // Color: at idle the field owns its hue (slow walk); any active state
    // snaps it to the OS accent, and the walk resumes from that hue.
    const idleCycling = coreState === 'idle' && !reducedMotion
    if (idleCycling) {
      a.cycleHue = (a.cycleHue + CYCLE_DEG_PER_S * dt) % 360
    } else {
      a.cycleHue = hue
    }
    writeLiveAccentSrgb(idleCycling ? a.cycleHue : hue, rgbScratch)
    // Convert the sRGB accent to linear once; the shader emits raw into the
    // HDR buffer, so linear keeps it matched to the reactor's colors.
    colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    const baseR = colorScratch.r
    const baseG = colorScratch.g
    const baseB = colorScratch.b

    if (lineMatRef.current) {
      // Hue rides per-vertex colors (below); the material only carries the
      // state-based overall opacity. Edges brighten while thinking.
      const targetOpacity = coreState === 'thinking' ? 0.28 : 0.15
      a.edgeOpacity += (targetOpacity - a.edgeOpacity) * 0.1
      lineMatRef.current.opacity = a.edgeOpacity
    }
    if (pulseMatRef.current) {
      colorScratch.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
      colorScratch.multiplyScalar(HDR_PULSES)
      pulseMatRef.current.color.copy(colorScratch)
    }

    const shimmerTarget = coreState === 'listening' ? 0.1 : 0.06
    a.shimmerAmp += (shimmerTarget - a.shimmerAmp) * 0.1

    if (!reducedMotion) {
      a.time += dt
      a.sweepAngle = (a.sweepAngle + SWEEP_SPEED * dt) % TWO_PI
      // Rotation: livelier y-spin (×2.5 in thinking) + a two-axis wobble so
      // the denser lattice reads as a drifting, breathing brain.
      a.rotationY += 0.11 * (coreState === 'thinking' ? 2.5 : 1) * dt
      group.rotation.y = a.rotationY
      group.rotation.x = 0.05 * Math.sin((a.time * Math.PI * 2) / 23)
      group.rotation.z = 0.03 * Math.sin((a.time * Math.PI * 2) / 37)
      // Slow ±3% breathing on the whole group (faster while thinking).
      const breathe =
        1 + 0.03 * Math.sin((a.time * Math.PI * 2) / (coreState === 'thinking' ? 5 : 9))
      group.scale.setScalar(GROUP_SCALE * breathe)
      if (coreState === 'speaking') a.wavePhase += dt
    }

    // -- auto design-change: morph the whole field through distinct shapes
    //    (sphere → disc → torus → sheet, random order, brief holds) and drift
    //    every node on its own slow flow. livePositions also drives the edges
    //    and pulses, so the whole structure reshapes together ----------------
    if (!reducedMotion) {
      a.morphT += dt / MORPH_TIME
      if (a.morphT >= 1 + MORPH_HOLD) {
        a.morphFrom = a.morphTo
        let next = Math.floor(Math.random() * CONFIG_COUNT)
        if (next === a.morphFrom) next = (next + 1) % CONFIG_COUNT
        a.morphTo = next
        a.morphT = 0
      }
    }
    const raw = Math.min(1, a.morphT)
    const eased = raw * raw * (3 - 2 * raw) // smoothstep hold at both ends
    const cfg = lattice.configs
    const fromBase = a.morphFrom * NODE_COUNT * 3
    const toBase = a.morphTo * NODE_COUNT * 3
    const flowFreq = lattice.flowFreq
    const flowPhase = lattice.flowPhase
    for (let i = 0; i < NODE_COUNT; i++) {
      const i3 = i * 3
      const fx = cfg[fromBase + i3]
      const fy = cfg[fromBase + i3 + 1]
      const fz = cfg[fromBase + i3 + 2]
      let px = fx + (cfg[toBase + i3] - fx) * eased
      let py = fy + (cfg[toBase + i3 + 1] - fy) * eased
      let pz = fz + (cfg[toBase + i3 + 2] - fz) * eased
      if (!reducedMotion) {
        px += FLOW_AMP * Math.sin(a.time * flowFreq[i3] + flowPhase[i3])
        py += FLOW_AMP * Math.sin(a.time * flowFreq[i3 + 1] + flowPhase[i3 + 1])
        pz += FLOW_AMP * Math.sin(a.time * flowFreq[i3 + 2] + flowPhase[i3 + 2])
      }
      livePositions[i3] = px
      livePositions[i3 + 1] = py
      livePositions[i3 + 2] = pz
    }
    ;(pointsGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true

    // -- glow points: brightness/size = tier · shimmer · wave · hover ·
    //    depth-cue · radar sweep -------------------------------------------
    const positions = livePositions
    const cosY = Math.cos(a.rotationY)
    const sinY = Math.sin(a.rotationY)
    const sweep = a.sweepAngle
    const inv2Sigma2 = 1 / (2 * SWEEP_SIGMA * SWEEP_SIGMA)
    for (let i = 0; i < NODE_COUNT; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]

      // Depth cue: rotated world-z (Y-rotation dominates) → front nodes pop.
      const zRot = z * cosY - x * sinY
      const depth01 = Math.min(1, Math.max(0, 0.5 + (0.5 * zRot) / (RZ * 1.35)))
      const depthBright = 0.5 + 0.8 * depth01
      const depthSize = 0.6 + 0.7 * depth01

      let shimmer = 1
      let wave = 1
      let radar = 0
      if (!reducedMotion) {
        shimmer = 1 + a.shimmerAmp * Math.sin(a.time * lattice.speeds[i] * Math.PI * 2 + lattice.phases[i])
        if (coreState === 'speaking') {
          wave =
            1 +
            0.12 *
              Math.max(0, Math.sin(Math.PI * 2 * (a.wavePhase / 1.1 - lattice.radials[i] * 0.8)))
        }
        // Radar sweep: Gaussian of the wrapped angular distance to the sweep.
        let dd = lattice.azimuth[i] - sweep
        dd = dd - TWO_PI * Math.floor((dd + Math.PI) / TWO_PI)
        radar = Math.exp(-(dd * dd) * inv2Sigma2) * SWEEP_GAIN
      }

      // Hover: pointed-at node eases toward +0.8 (≈0.25/frame).
      const hoverTarget = a.hoveredNode === i ? 0.8 : 0
      a.hoverScale[i] += (hoverTarget - a.hoverScale[i]) * 0.25
      const hover = a.hoverScale[i]

      const base = lattice.shades[i]
      const brightness = base * shimmer * wave * (1 + hover) * depthBright + base * radar
      aColorArray[i * 3] = baseR * brightness
      aColorArray[i * 3 + 1] = baseG * brightness
      aColorArray[i * 3 + 2] = baseB * brightness
      aSizeArray[i] =
        lattice.sizes[i] * shimmer * (1 + 0.9 * hover) * depthSize * (1 + 0.45 * radar)
    }
    ;(pointsGeometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true
    ;(pointsGeometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true

    // -- automatic random connect/disconnect: retire a batch of lit edges and
    //    re-light an equal batch, so the graph keeps forming new shapes ------
    const edgeCount = lattice.edgeCount
    if (!reducedMotion) {
      a.joinAccumulator += dt
      while (a.joinAccumulator >= JOIN_INTERVAL) {
        a.joinAccumulator -= JOIN_INTERVAL
        for (let k = 0; k < JOIN_BATCH; k++) {
          edgeAnim.target[Math.floor(Math.random() * edgeCount)] = 0
          edgeAnim.target[Math.floor(Math.random() * edgeCount)] = 1
        }
      }
    }

    // -- rebuild arc edges from live positions (arcs follow the morph/flow);
    //    per-vertex color = accent × the edge's eased connect alpha ----------
    const lp = lattice.linePositions
    const lc = lineColors
    let lw = 0
    let lcw = 0
    for (let e = 0; e < edgeCount; e++) {
      edgeAnim.alpha[e] += (edgeAnim.target[e] - edgeAnim.alpha[e]) * 0.09
      const ea = edgeAnim.alpha[e]
      const cr = baseR * ea
      const cg = baseG * ea
      const cb = baseB * ea
      const ai = lattice.edgeA[e]
      const bi = lattice.edgeB[e]
      const ax = positions[ai * 3]
      const ay = positions[ai * 3 + 1]
      const az = positions[ai * 3 + 2]
      const bx = positions[bi * 3]
      const by = positions[bi * 3 + 1]
      const bz = positions[bi * 3 + 2]
      const cx = (ax + bx) * 0.5 + lattice.edgeBow[e * 3]
      const cy = (ay + by) * 0.5 + lattice.edgeBow[e * 3 + 1]
      const cz = (az + bz) * 0.5 + lattice.edgeBow[e * 3 + 2]
      let px = ax
      let py = ay
      let pz = az
      for (let s = 1; s <= ARC_SEGMENTS; s++) {
        const t = s / ARC_SEGMENTS
        const it = 1 - t
        const qx = it * it * ax + 2 * it * t * cx + t * t * bx
        const qy = it * it * ay + 2 * it * t * cy + t * t * by
        const qz = it * it * az + 2 * it * t * cz + t * t * bz
        lp[lw++] = px
        lp[lw++] = py
        lp[lw++] = pz
        lp[lw++] = qx
        lp[lw++] = qy
        lp[lw++] = qz
        lc[lcw++] = cr
        lc[lcw++] = cg
        lc[lcw++] = cb
        lc[lcw++] = cr
        lc[lcw++] = cg
        lc[lcw++] = cb
        px = qx
        py = qy
        pz = qz
      }
    }
    ;(lineGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(lineGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true

    // -- pulse pool (ride the arc curves) -----------------------------------
    const poolCap = quality === 'low' ? PULSE_POOL_LOW : PULSE_POOL
    if (!reducedMotion) {
      a.spawnAccumulator += dt
      const interval = PULSE_INTERVAL[coreState]
      while (a.spawnAccumulator >= interval) {
        a.spawnAccumulator -= interval
        let slot = -1
        let oldest = -1
        let oldestT = -1
        for (let p = 0; p < poolCap; p++) {
          if (a.pulseEdge[p] < 0) {
            slot = p
            break
          }
          if (a.pulseT[p] > oldestT) {
            oldestT = a.pulseT[p]
            oldest = p
          }
        }
        if (slot < 0) slot = oldest
        if (slot < 0) break
        let edge: number
        let dir: number
        if (coreState === 'listening') {
          edge = lattice.convergeEdges[Math.floor(Math.random() * lattice.convergeEdges.length)]
          dir = lattice.towardB[edge]
        } else {
          edge = Math.floor(Math.random() * lattice.edgeCount)
          dir = Math.random() < 0.5 ? 1 : 0
        }
        a.pulseEdge[slot] = edge
        a.pulseT[slot] = 0
        a.pulseDur[slot] = 0.6 + Math.random() * 0.3
        a.pulseDir[slot] = dir
      }
    }

    for (let p = 0; p < PULSE_POOL; p++) {
      const edge = a.pulseEdge[p]
      if (edge < 0 || reducedMotion || p >= poolCap) {
        if (reducedMotion || p >= poolCap) a.pulseEdge[p] = -1
        dummy.position.set(0, 0, 0)
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        pulses.setMatrixAt(p, dummy.matrix)
        continue
      }
      a.pulseT[p] += dt / a.pulseDur[p]
      if (a.pulseT[p] >= 1) {
        a.pulseEdge[p] = -1
        dummy.position.set(0, 0, 0)
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        pulses.setMatrixAt(p, dummy.matrix)
        continue
      }
      // Evaluate the edge's bezier at s (reversed if traveling B→A).
      const eased = easeInOutQuad(a.pulseT[p])
      const s = a.pulseDir[p] === 1 ? eased : 1 - eased
      const is = 1 - s
      const ai = lattice.edgeA[edge]
      const bi = lattice.edgeB[edge]
      const ax = positions[ai * 3]
      const ay = positions[ai * 3 + 1]
      const az = positions[ai * 3 + 2]
      const bx = positions[bi * 3]
      const by = positions[bi * 3 + 1]
      const bz = positions[bi * 3 + 2]
      const cx = (ax + bx) * 0.5 + lattice.edgeBow[edge * 3]
      const cy = (ay + by) * 0.5 + lattice.edgeBow[edge * 3 + 1]
      const cz = (az + bz) * 0.5 + lattice.edgeBow[edge * 3 + 2]
      dummy.position.set(
        is * is * ax + 2 * is * s * cx + s * s * bx,
        is * is * ay + 2 * is * s * cy + s * s * by,
        is * is * az + 2 * is * s * cz + s * s * bz,
      )
      // Scale ramps in over the first 15%, out over the last 25%.
      const ramp = Math.min(1, a.pulseT[p] / 0.15, (1 - a.pulseT[p]) / 0.25)
      dummy.scale.setScalar(0.035 * Math.max(0.0001, ramp))
      dummy.updateMatrix()
      pulses.setMatrixAt(p, dummy.matrix)
    }
    pulses.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={groupRef} position={GROUP_POS} scale={GROUP_SCALE}>
      <points
        ref={pointsRef}
        geometry={pointsGeometry}
        material={pointsMaterial}
        frustumCulled={false}
      />

      <lineSegments geometry={lineGeometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={lineMatRef}
          vertexColors
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      <instancedMesh ref={pulsesRef} args={[undefined, undefined, PULSE_POOL]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial ref={pulseMatRef} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
