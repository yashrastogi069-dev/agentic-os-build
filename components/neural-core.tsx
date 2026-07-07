'use client'

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CoreState } from '@/components/core-stage'

/**
 * 3D neural core — a glowing, movable neural network.
 * Drag to rotate, scroll to zoom. Color + motion react to the agent state:
 * idle = calm cyan, thinking = amber flicker, listening/speaking = bright pulse.
 */

const NODE_COUNT = 96
const MAX_LINK_DIST = 1.35

const STATE_COLORS: Record<CoreState, string> = {
  idle: '#22d3ee',
  listening: '#67e8f9',
  thinking: '#fbbf24',
  speaking: '#a5f3fc',
}

const STATE_SPEED: Record<CoreState, number> = {
  idle: 0.35,
  listening: 1.2,
  thinking: 2.2,
  speaking: 1.6,
}

function buildNetwork() {
  const positions: THREE.Vector3[] = []
  // Nodes on a fuzzy sphere shell + a few interior ones for depth
  for (let i = 0; i < NODE_COUNT; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / NODE_COUNT)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    const radius = i % 5 === 0 ? 0.9 + Math.random() * 0.7 : 1.7 + Math.random() * 0.35
    positions.push(
      new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      ),
    )
  }
  const links: Array<[number, number]> = []
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (positions[i].distanceTo(positions[j]) < MAX_LINK_DIST) {
        links.push([i, j])
      }
    }
  }
  return { positions, links }
}

function Network({ state }: { state: CoreState }) {
  const groupRef = useRef<THREE.Group>(null)
  const nodesRef = useRef<THREE.InstancedMesh>(null)
  const linesRef = useRef<THREE.LineSegments>(null)
  const coreRef = useRef<THREE.Mesh>(null)

  const { positions, links } = useMemo(buildNetwork, [])

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const vertices = new Float32Array(links.length * 6)
    links.forEach(([a, b], i) => {
      vertices.set([...positions[a].toArray(), ...positions[b].toArray()], i * 6)
    })
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    return geometry
  }, [positions, links])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = STATE_COLORS[state]

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const speed = STATE_SPEED[state]

    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0012 * (state === 'idle' ? 1 : 2)
    }
    if (nodesRef.current) {
      positions.forEach((base, i) => {
        const wobble = 1 + 0.04 * Math.sin(t * speed + i * 1.7)
        dummy.position.copy(base).multiplyScalar(wobble)
        const scale = 0.028 + 0.014 * (0.5 + 0.5 * Math.sin(t * speed * 2 + i))
        dummy.scale.setScalar(scale)
        dummy.updateMatrix()
        nodesRef.current!.setMatrixAt(i, dummy.matrix)
      })
      nodesRef.current.instanceMatrix.needsUpdate = true
    }
    if (linesRef.current) {
      const material = linesRef.current.material as THREE.LineBasicMaterial
      material.opacity = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(t * speed))
    }
    if (coreRef.current) {
      const pulse = 1 + 0.12 * Math.sin(t * speed * 1.5)
      coreRef.current.scale.setScalar(pulse)
    }
  })

  return (
    <group ref={groupRef}>
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[0.34, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
      </mesh>
      <instancedMesh ref={nodesRef} args={[undefined, undefined, NODE_COUNT]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </instancedMesh>
      <lineSegments ref={linesRef} geometry={lineGeometry}>
        <lineBasicMaterial color={color} transparent opacity={0.18} />
      </lineSegments>
    </group>
  )
}

export function NeuralCore({ state }: { state: CoreState }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4.6], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 1.5]}
      className="touch-none"
      aria-label="Interactive 3D neural core visualization"
    >
      <Network state={state} />
      <OrbitControls
        enablePan={false}
        minDistance={2.5}
        maxDistance={8}
        autoRotate={false}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}
