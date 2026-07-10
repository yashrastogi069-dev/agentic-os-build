'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useThemeStore, writeLiveAccentSrgb } from '@/lib/theme-engine'
import { SpaceEnvironment } from '@/components/scene/environment'
import { Poster } from '@/components/scene/poster'

/**
 * The single WebGL stage — Phase 3 §2 (tasks/PHASE3_DESIGN.md). One
 * `<Canvas>` for everything 3D: environment (starfield/grid/dust) plus,
 * later chunks, the Arc Reactor and neural network.
 *
 * CHUNK B SCOPE (§7 step 2): mount the stage, prove the z-layers and
 * composition work, and seed the scene with the environment plus ONE
 * placeholder emissive icosahedron standing in for the reactor position.
 * Deliberately NOT built here (owned by later chunks so each chunk ships a
 * self-contained, independently-verifiable diff):
 *  - The real Arc Reactor assembly (§2.2) — Chunk C.
 *  - The neural network lattice (§2.1) — Chunk D.
 *  - The bloom `EffectComposer` (§2.4) — Chunk C.
 *  - The perf governor (rolling-fps quality downgrade, §5) — Chunk D, once
 *    there's enough on screen for it to matter.
 *  - The full `CameraRig` (mouse parallax + idle Lissajous drift + the
 *    chat/overlay HUD x-offset re-centering lerp, §2.3) — Chunk C's
 *    verification explicitly covers "camera re-centering lerps", so the
 *    camera here stays at the spec's static base position or the reactor
 *    hitbox/hover model would need to be re-verified twice. This chunk's
 *    placeholder hover still works correctly at the base camera position.
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

/** Placeholder standing in for the Arc Reactor group until Chunk C. */
function ReactorPlaceholder() {
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const scratchColor = useMemo(() => new THREE.Color(), [])
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])

  useFrame(({ clock }) => {
    const { hue, energy, reducedMotion } = useThemeStore.getState()
    writeLiveAccentSrgb(hue, rgbScratch)
    scratchColor.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    if (materialRef.current) {
      materialRef.current.color.copy(scratchColor)
    }
    if (meshRef.current) {
      const breathe = reducedMotion
        ? 1
        : 1 + 0.05 * Math.sin(clock.getElapsedTime() * 1.4) * (0.5 + energy * 0.5)
      meshRef.current.scale.setScalar(breathe)
    }
  })

  return (
    <mesh
      ref={meshRef}
      position={[0, -0.15, 0]}
      onPointerOver={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
        window.dispatchEvent(
          new CustomEvent('jarvis:reactor-hover', { detail: { hovering: true } }),
        )
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'auto'
        window.dispatchEvent(
          new CustomEvent('jarvis:reactor-hover', { detail: { hovering: false } }),
        )
      }}
    >
      <icosahedronGeometry args={[0.62, 1]} />
      <meshBasicMaterial ref={materialRef} toneMapped={false} />
    </mesh>
  )
}

/** ambientLight 0.15 + a point light at the reactor core, per spec §2. */
function ReactorLight() {
  const lightRef = useRef<THREE.PointLight>(null)
  const scratchColor = useMemo(() => new THREE.Color(), [])
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])

  useFrame(() => {
    const { hue, energy } = useThemeStore.getState()
    writeLiveAccentSrgb(hue, rgbScratch)
    scratchColor.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    if (lightRef.current) {
      lightRef.current.color.copy(scratchColor)
      lightRef.current.intensity = 2 + energy * 4
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
      <fog attach="fog" args={[0x07090c, 0.055]} />
      <ambientLight intensity={0.15} />
      <ReactorLight />
      <SpaceEnvironment />
      <ReactorPlaceholder />
      <ReducedMotionInvalidator />
    </>
  )
}

export function JarvisStage() {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null)
  const [tabHidden, setTabHidden] = useState(false)
  const reducedMotion = useThemeStore((state) => state.reducedMotion)

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
      camera={{ position: [0, 0.6, 7.2], fov: 42 }}
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
      </Suspense>
    </Canvas>
  )
}
