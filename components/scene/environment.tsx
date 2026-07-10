'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useThemeStore, writeLiveAccentSrgb } from '@/lib/theme-engine'

/**
 * Space environment — Phase 3 §2.1 (tasks/PHASE3_DESIGN.md). Two starfield
 * shells (far/near), a shader-driven anti-aliased grid floor with radial
 * fade + slow scroll, and additive dust motes.
 *
 * Perf budget (§5): every geometry/material/texture below is created once
 * via `useMemo`; `useFrame` callbacks only mutate already-allocated typed
 * arrays, uniforms, and scratch `THREE.Color`/plain-object instances — no
 * `new` inside the frame loop.
 *
 * Judgment call (documented per the chunk brief, task 2): the grid floor
 * uses a real custom `ShaderMaterial` with `fwidth`-based anti-aliased lines
 * rather than falling back to `GridHelper`. Three's default WebGL2 context
 * supports `fwidth` natively (with `extensions.derivatives` set for a
 * WebGL1 fallback), so the authoring risk was low and the visual payoff
 * (radial fade, live-accent color, subtle scroll) is meaningfully closer to
 * the "obvious visual leap" bar than a flat `GridHelper` would be.
 */

// ---------------------------------------------------------------------------
// Starfields
// ---------------------------------------------------------------------------

function buildShellPositions(count: number, rMin: number, rMax: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const radius = rMin + Math.random() * (rMax - rMin)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    // Flatten vertically so the shell reads as sky/space around the stage
    // rather than a sphere the camera sits inside.
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.55
    positions[i * 3 + 2] = radius * Math.cos(phi)
  }
  return positions
}

function Starfield({
  count,
  rMin,
  rMax,
  size,
  opacity,
  driftRate,
}: {
  count: number
  rMin: number
  rMax: number
  size: number
  opacity: number
  /** Radians/frame at 60fps idle rotation — kept small per the motion-restraint guardrail (§8.4). */
  driftRate: number
}) {
  const pointsRef = useRef<THREE.Points>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(buildShellPositions(count, rMin, rMax), 3))
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, rMin, rMax])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: new THREE.Color('#cfe6f2'),
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    [size, opacity],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame(() => {
    if (useThemeStore.getState().reducedMotion || !pointsRef.current) return
    pointsRef.current.rotation.y += driftRate
  })

  return <points ref={pointsRef} geometry={geometry} material={material} />
}

// ---------------------------------------------------------------------------
// Grid floor — custom shader, anti-aliased lines + radial fade + slow scroll
// ---------------------------------------------------------------------------

const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldXZ;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const GRID_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFadeRadius;
  varying vec2 vWorldXZ;

  float gridLines(vec2 coord) {
    vec2 grid = abs(fract(coord - 0.5) - 0.5);
    vec2 widths = max(fwidth(coord), vec2(0.0001));
    vec2 lines = 1.0 - smoothstep(vec2(0.0), widths * 1.5, grid);
    return max(lines.x, lines.y);
  }

  void main() {
    vec2 scrolled = vWorldXZ + vec2(0.0, -uTime * 0.008);
    float line = gridLines(scrolled);
    float dist = length(vWorldXZ);
    float fade = 1.0 - smoothstep(uFadeRadius * 0.35, uFadeRadius, dist);
    float alpha = line * uOpacity * fade;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

function GridFloor() {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const rgbScratch = useMemo(() => ({ r: 0, g: 0, b: 0 }), [])

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#38e1ff') },
      uTime: { value: 0 },
      uOpacity: { value: 0.07 },
      uFadeRadius: { value: 24 },
    }),
    [],
  )

  useFrame(({ clock }) => {
    const { hue, reducedMotion } = useThemeStore.getState()
    writeLiveAccentSrgb(hue, rgbScratch)
    uniforms.uColor.value.setRGB(rgbScratch.r, rgbScratch.g, rgbScratch.b, THREE.SRGBColorSpace)
    if (!reducedMotion) {
      uniforms.uTime.value = clock.getElapsedTime()
    }
  })

  return (
    <mesh position={[0, -3.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[60, 60, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={GRID_VERTEX_SHADER}
        fragmentShader={GRID_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Dust motes — additive sprites, gentle drift
// ---------------------------------------------------------------------------

const DUST_COUNT = 64

function buildDust(count: number) {
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const radius = 3 + Math.random() * 6
    const theta = Math.random() * Math.PI * 2
    const y = (Math.random() - 0.5) * 4
    positions[i * 3] = radius * Math.cos(theta)
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = radius * Math.sin(theta)
    speeds[i] = 0.3 + Math.random() * 0.7
  }
  return { positions, speeds }
}

function makeDustTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function DustMotes() {
  const pointsRef = useRef<THREE.Points>(null)
  const { positions, speeds } = useMemo(() => buildDust(DUST_COUNT), [])
  const basePositions = useMemo(() => positions.slice(), [positions])
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions])

  const texture = useMemo(() => makeDustTexture(), [])
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: texture,
        color: new THREE.Color('#bfe0ff'),
        size: 0.14,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [texture],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    }
  }, [geometry, material, texture])

  useFrame(({ clock }) => {
    if (useThemeStore.getState().reducedMotion || !pointsRef.current) return
    const t = clock.getElapsedTime()
    const array = pointsRef.current.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < DUST_COUNT; i++) {
      const idx = i * 3
      array[idx] = basePositions[idx] + Math.sin(t * 0.02 * speeds[i] + i) * 0.4
      array[idx + 1] = basePositions[idx + 1] + Math.cos(t * 0.015 * speeds[i] + i) * 0.3
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true
  })

  return <points ref={pointsRef} geometry={geometry} material={material} />
}

// ---------------------------------------------------------------------------
// Composed environment
// ---------------------------------------------------------------------------

export function SpaceEnvironment() {
  return (
    <>
      <Starfield count={1100} rMin={40} rMax={70} size={0.06} opacity={0.55} driftRate={0.000012} />
      <Starfield count={500} rMin={18} rMax={35} size={0.1} opacity={0.8} driftRate={0.00003} />
      <GridFloor />
      <DustMotes />
    </>
  )
}
