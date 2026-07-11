# CHUNK D BUILD BRIEF — Neural Network + Choreography + Perf Governor (Fable pre-flight, 2026-07-11)

Refines `tasks/PHASE3_DESIGN.md` §2.1/§3/§4/§5/§8 for the executor. Where
this adds detail, it wins. Material patterns follow `tasks/CHUNK_C_BRIEF.md`;
per-frame idioms follow `components/scene/environment.tsx`.

## 1. Verdict on §2.1/§3

Buildable. Three traps:

- **Point-cloud trap: uniform nodes.** Fix with 3 size tiers baked at build:
  8 **hubs** (×1.6 scale, picked spread-apart on the shell via
  farthest-point sampling from the 140), ~44 mids (×1.0), rest smalls
  (×0.6). The 24 interior nodes are all smalls — they exist for depth
  parallax, not attention.
- **Spaghetti trap: raw 0.62 distance threshold** gives some nodes 10+
  edges. Cap per-node degree at 5 (keep shortest), bias +1 extra allowance
  for hubs, hard total cap 380. Degree-capped short edges read as
  structure; uncapped reads as string art.
- **Screensaver trap: symmetric motion.** Rotation stays y-only
  0.0012/frame with a ±0.02 rad x wobble (period 31s). The fog (0.055 exp2
  at 5.5–9 units) attenuates it naturally — do NOT brighten to compensate;
  the dimming IS the depth.

## 2. Visual recipe (exact)

- **Nodes:** one InstancedMesh, icosahedron det 0,
  `meshBasicMaterial({ toneMapped: false })`, material color = live accent
  **×1.2**. Per-instance grayscale via `instanceColor` (Chunk C's flicker
  pattern): hubs 1.3 (effective ~1.56 — the only nodes that bloom, mildly),
  mids 0.8, smalls 0.55. Interior nodes 0.45.
- **Edges:** LineSegments, `LineBasicMaterial` additive, transparent,
  `depthWrite:false`, color = accent **×0.6** — edges NEVER bloom. Opacity
  0.10 idle → 0.22 thinking (lerped 0.1/frame).
- **Pulses:** InstancedMesh pool 24, plane quads with the radial
  CanvasTexture pattern (environment.tsx `makeDustTexture`, tighter stops
  0/0.6/1.0 → 1/0.4/0), additive, depthWrite false, color accent **×2.0** —
  blooms, but stays under the core's ×2.4. Local scale 0.06 (×3.4 group).
  Inactive = scale 0.
- **Shared accent, zero alloc:** ONE `useFrame` in the NeuralNetwork
  parent: `writeLiveAccentSrgb(getState().hue, rgbScratch)` once, then
  `scratch.setRGB(...,SRGBColorSpace).multiplyScalar(X);
  material.color.copy(scratch)` for the 3 materials. One conversion per
  frame for the whole lattice. Pre-allocated: `Object3D` dummy, 2 scratch
  Colors, Float32Arrays for phases/tiers/edge endpoints.

## 3. Choreography algorithms (per §3 row)

Precompute at build: per-node `phase[i]` (random 0–2π), `speed[i]` (0.5–1.2
Hz), `radial[i]` = normalized distance from lattice center (0–1);
`targetNode` = index minimizing world distance to reactor `[0,-0.15,0]`;
per-edge `towardEnd` = whichever endpoint is euclidean-closer to
`targetNode`.

- **Shimmer 0.04 amp** = per-node scale
  `tier[i] × (1 + amp·sin(t·speed[i]·2π + phase[i]))`, amp 0.04 idle / 0.06
  listening (×1.5). Recompose all 164 instance matrices each frame via the
  dummy; one `instanceMatrix.needsUpdate`.
- **Pulse mechanics:** spawn accumulator (own clamped-delta time, NOT
  `clock.getElapsedTime()`). Interval per state: idle 1.6s, listening 0.5s,
  thinking 0.18s, speaking 0.8s. Each pulse:
  `{edgeIndex, t, duration: 600–900ms}`; position =
  `lerp(A, B, easeInOutQuad(t))`; scale ramps in over first 15%, out over
  last 25%. Pool full → recycle oldest.
- **Listening convergence:** spawn only on edges whose midpoint is in the
  nearest-40% to `targetNode` (precompute sorted edge list once); travel
  toward `towardEnd`. Flow visibly drains to one point — that's
  "attention".
- **Thinking:** random edges, random direction, interval 0.18s pool-capped;
  rotation ×2.5 (0.003/frame); edge opacity → 0.22.
- **Speaking wave:**
  `scale[i] = tier[i] × shimmer × (1 + 0.10 · max(0, sin(2π·(tWave/1.1 − radial[i]·0.8))))`
  — half-rectified so it reads as a ring radiating outward, not a jelly
  wobble.
- **Background/light rows** (this chunk owns them): dust opacity
  0.16→0.21 in listening; grid scroll ×2 in thinking — **GridFloor must
  switch `uTime` from `clock.getElapsedTime()` to a rate-scaled
  accumulator** (small edit to environment.tsx); grid
  `uOpacity = 0.14·(1 + 0.3·corePulse)` in speaking; near-star twinkle =
  material opacity `0.8 + 0.05·sin(t·1.7)`, amp ×2 thinking; point light
  intensity targets 2.0/3.5/6.0/4.5, all lerped 0.08–0.14/frame (never
  stepped).

## 4. Perf governor

Small component inside Canvas in `jarvis-stage.tsx`. `useFrame((_, delta))`:
ring buffer `Float32Array(60)` of deltas → fps = 60/sum; fps<40 →
`badTime += delta` else reset; `badTime ≥ 3` →
`useThemeStore.getState().setQuality('low')`, then stop sampling forever.
**One-way because** recovery would remount the composer (shader recompile
jank) → fps drops → re-downgrade: an oscillator. Low = composer
conditionally unrendered via React subscription
`useThemeStore(s => s.quality)` at the jarvis-stage level (one re-render,
never per-frame — matches Chunk C brief §4; toneMapped:false + halo sprites
keep it bright), near starfield + dust unrendered, pulse pool logical cap
12 (keep the InstancedMesh, never activate >12), `useThree(s =>
s.setDpr)(1)`.

## 5. Reduced-motion / tab-hidden checklist

- Reduced motion: all rotations/shimmer/waves/pulses/twinkle/scroll frozen
  (existing `getState().reducedMotion` early-return idiom); pulses all
  deactivated. Colors MUST still land: `frameloop="never"` + a module-level
  `useThemeStore.subscribe` on `coreState` (and `quality`) calling
  `invalidate()` — engine snaps hue instantly in RM, so one invalidate per
  state change renders correctly. Also invalidate on reactor/node hover.
- Tab hidden: provider pauses rAF + frameloop `"never"`; on resume clamp
  every accumulator delta to 0.1s — no pulse burst, no wave jump, no NaN at
  delta 0.
- Hover raycast stays throttled to pointermove and layer-masked (§2.1) —
  never in useFrame.

## 6. Top 5 network guardrails

1. **Edges never bloom, never exceed 0.22 opacity, degree cap 5.** Edge
   spaghetti is the single fastest route to screensaver.
2. **Three node tiers, only 8 hubs bloom.** Uniform dots = point cloud.
3. **Pulse brightness ×2.0 < core ×2.4, pool hard-capped.** An idle
   screenshot shows ≤2 pulses. The network never outshines the reactor.
4. **It stays behind.** Position/scale exactly as specced; fog dims it —
   never compensate with brightness or by pulling it forward.
5. **No literal connections:** no lines to the reactor, no labels, no
   glyphs, no particles bridging network and reactor. The relationship is
   compositional.

Verify per §7.4: recording of idle→thinking→idle with UI accents following;
perf trace 60fps / <30% main thread idle; reduced-motion static-but-correctly-
colored render; hidden-tab resume with no jump; governor tested via CPU
throttle.
