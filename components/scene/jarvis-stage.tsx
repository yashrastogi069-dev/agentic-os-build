'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useThemeStore, writeLiveAccentSrgb, type CoreState } from '@/lib/theme-engine'
import { SpaceEnvironment } from '@/components/scene/environment'
import { ArcReactor } from '@/components/scene/arc-reactor'
import { Poster } from '@/components/scene/poster'

/**
 * The single WebGL stage — Phase 3 §2 (tasks/PHASE3_DESIGN.md). One
 * `<Canvas>` for everything 3D: environment (starfield/grid/dust), the Arc
 * Reactor assembly (Chunk C, tasks/CHUNK_C_BRIEF.md), and — Chunk D — the
 * neural network lattice.
 *
 * CHUNK C SCOPE (§7 step 3): the real reactor (components/scene/
 * arc-reactor.tsx), selective bloom (§2.4: threshold 1.0 + HDR emissives =
 * only emissives bloom), a RoomEnvironment reflection map so the machined
 * metal actually reads as metal (CHUNK_C_BRIEF §1 trap 1), and the full
 * CameraRig (§2.3: mouse parallax + idle Lissajous drift + HUD re-centering
 * x-offset). Still deliberately NOT built here (Chunk D): the neural
 * network, the perf governor's fps sampling (the quality store field and
 * the composer's reaction to it are wired now).
 */

function probeWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    )
  } catch {
    return false
  }
}

/**
 * Scene-wide environment map — PMREMGenerator over three's procedural
 * RoomEnvironment. One-time cost at mount, zero draw calls per frame; gives
 * the reactor's `metalness: 0.85` surfaces something to reflect so they
 * read as machined metal instead of black silhouette (CHUNK_C_BRIEF §1).
 */
function SceneEnvironmentMap() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envScene = new RoomEnvironment()
    const envRT = pmrem.fromScene(envScene, 0.04)
    scene.environment = envRT.texture
    return () => {
      scene.environment = null
      envRT.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}

/**
 * Camera rig — §2.3. Fixed base at [0, 0.6, 7.2] looking at [0, 0.35, 0],
 * three additive offsets all lerped 0.06/frame:
 *  (a) mouse parallax ±0.28x / ±0.16y from the normalized pointer,
 *  (b) idle Lissajous drift ±0.08 (periods 19s / 23s),
 *  (c) the HUD re-centering x-offset (§1.2 reactor primacy rule): +0.55
 *      when the chat dock is open, −0.35 more when an overlay is open —
 *      read from the theme store via getState() (HudShell writes it).
 * No OrbitControls — parallax gives life without fighting HUD pointer
 * events. Reduced motion: parallax and drift are disabled; the HUD offset
 * still applies (it's a composition correction, not an animation) but
 * snaps instead of gliding.
 */
const CAMERA_BASE = { x: 0, y: 0.6, z: 7.2 } as const

function CameraRig() {
  const pointer = useRef({ x: 0, y: 0 })
  const offset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', handlePointerMove)
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [])

  useFrame(({ camera, clock }) => {
    const { chatOpen, overlayOpen, reducedMotion } = useThemeStore.getState()
    const hudX = (chatOpen ? 0.55 : 0) + (overlayOpen ? -0.35 : 0)

    if (reducedMotion) {
      offset.current.x = hudX
      offset.current.y = 0
    } else {
      const t = clock.getElapsedTime()
      const targetX =
        pointer.current.x * 0.28 + 0.08 * Math.sin((t * Math.PI * 2) / 19) + hudX
      const targetY =
        -pointer.current.y * 0.16 + 0.08 * Math.sin((t * Math.PI * 2) / 23)
      offset.current.x += (targetX - offset.current.x) * 0.06
      offset.current.y += (targetY - offset.current.y) * 0.06
    }

    camera.position.set(
      CAMERA_BASE.x + offset.current.x,
      CAMERA_BASE.y + offset.current.y,
      CAMERA_BASE.z,
    )
    camera.lookAt(0, 0.35, 0)
  })

  return null
}

/**
 * ambientLight 0.15 + the point light at the reactor core, per spec §2. The
 * intensity follows §3's point-light row exactly (idle 2.0 / listening 3.5 /
 * thinking 6.0 / speaking 4.5), eased 0.1/frame — this is the light that
 * paints the live accent onto the machined rings ("the glowing of the core
 * and colours", Yash 2026-07-11).
 */
const LIGHT_INTENSITY: Record<CoreState, number> = {
  idle: 2.0,
  listening: 3.5,
  thinking: 6.0,
  speaking: 4.5,
}

function ReactorLight() {
  const lightRef = useRef<THREE.PointLight>(null)
  const scratchColor = useMemo(() => new THREE.Color(), [])
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])
  const intensity = useRef(LIGHT_INTENSITY.idle)

  useFrame(() => {
    const { hue, coreState, reducedMotion } = useThemeStore.getState()
    writeLiveAccentSrgb(hue, rgbScratch)
    scratchColor.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    const target = LIGHT_INTENSITY[coreState]
    intensity.current = reducedMotion
      ? target
      : intensity.current + (target - intensity.current) * 0.1
    if (lightRef.current) {
      lightRef.current.color.copy(scratchColor)
      lightRef.current.intensity = intensity.current
    }
  })

  return (
    <pointLight ref={lightRef} position={[0, -0.15, 0.6]} intensity={2} distance={9} decay={2} />
  )
}

/** Renders once more when reduced motion freezes the loop, so state snaps still paint. */
function ReducedMotionInvalidator() {
  const invalidate = useThree((state) => state.invalidate)
  const coreState = useThemeStore((state) => state.coreState)
  const reducedMotion = useThemeStore((state) => state.reducedMotion)

  useEffect(() => {
    if (reducedMotion) invalidate()
  }, [reducedMotion, coreState, invalidate])

  return null
}

function SceneContents() {
  return (
    <>
      <fog attach="fog" args={[0x0b0d14, 0.05]} />
      <ambientLight intensity={0.15} />
      <ReactorLight />
      <SceneEnvironmentMap />
      <SpaceEnvironment />
      <ArcReactor />
      <CameraRig />
      <ReducedMotionInvalidator />
    </>
  )
}

export function JarvisStage() {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null)
  const [tabHidden, setTabHidden] = useState(false)
  const reducedMotion = useThemeStore((state) => state.reducedMotion)
  // React subscription (one re-render per change, never per-frame): the perf
  // governor (Chunk D) flips quality to 'low' → the composer unmounts; the
  // toneMapped:false HDR colors + halo sprites keep the reactor reading
  // bright without bloom (§5, CHUNK_C_BRIEF §4).
  const quality = useThemeStore((state) => state.quality)

  useEffect(() => {
    setWebglSupported(probeWebGL())
  }, [])

  useEffect(() => {
    function handleVisibility() {
      setTabHidden(document.hidden)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  if (webglSupported !== true) {
    return <Poster variant="fallback" />
  }

  return (
    <Canvas
      camera={{ position: [CAMERA_BASE.x, CAMERA_BASE.y, CAMERA_BASE.z], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      // 'demand' (not 'never'): r3f's invalidate() is a no-op when
      // frameloop === 'never' (it early-returns — see @react-three/fiber's
      // events-*.js `invalidate()`, which checks `state.frameloop ===
      // 'never'` before doing anything). 'demand' is the mode invalidate()
      // is designed for: zero automatic rendering (same perf cost as
      // 'never' — the internal rAF loop self-cancels when nothing is
      // pending), but ReducedMotionInvalidator's on-state-change
      // invalidate() call below actually paints the static frame the spec
      // requires (§4: "static but correctly-colored render") instead of
      // silently doing nothing.
      frameloop={tabHidden || reducedMotion ? 'demand' : 'always'}
      className="touch-none"
      aria-label="Jarvis holographic command stage"
    >
      <Suspense fallback={null}>
        <SceneContents />
        {/* Selective bloom for free (§2.4): threshold 1.0 + HDR-multiplied
            emissives — only the core, halo, strips, ticks, and gyro edges
            cross it; dark metal and scrims never bloom. multisampling 4 is
            the taste/perf compromise: thin rotating metal edges shimmer
            without AA (the composer bypasses the canvas's own MSAA), and
            the governor unmounts the whole composer if fps drops anyway. */}
        {quality === 'high' && (
          <EffectComposer multisampling={4}>
            <Bloom
              mipmapBlur
              luminanceThreshold={1.0}
              luminanceSmoothing={0.2}
              intensity={0.75}
              radius={0.6}
            />
            {/* The composer bypasses the renderer's own tone mapping — without
                this pass the whole scene brightens/oversaturates vs the
                Chunk B baseline (live-verified 2026-07-11). ACES restores it. */}
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
  )
}
