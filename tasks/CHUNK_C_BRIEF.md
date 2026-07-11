# CHUNK C BUILD BRIEF — Arc Reactor (Fable pre-flight design pass, 2026-07-11)

Authoritative refinement of `tasks/PHASE3_DESIGN.md` §2.2–2.4/§3/§8 for the
Chunk C executor. Where this brief adds detail, it wins; where it is silent,
the spec wins.

## 1. Verdict on §2.2

Buildable as-is, with **two traps that will make it look cheap if executed
literally**:

- **Trap 1 — metal reads black.** `meshStandardMaterial(metalness: 0.85)`
  with no environment map reflects nothing; under one point light + 0.15
  ambient the "machined metal" becomes invisible silhouette, and you're back
  to "flat glowing disc". **Fix (required):** set `scene.environment` once
  via `PMREMGenerator` + `THREE.RoomEnvironment` (ships with three, one-time
  cost, zero draw calls), and set `envMapIntensity: 0.4` on all reactor
  metals. This is the single biggest premium lever in the chunk.
- **Trap 2 — the core as a uniform disc.** A flat `circleGeometry` with one
  HDR color is a sticker. **Fix:** give the core disc a radial-gradient
  `CanvasTexture` map (reuse the `makeHaloTexture` pattern already in
  `jarvis-stage.tsx`, but tighter: stops at 0/0.65/1.0 → 1.0/0.55/0.15
  alpha) so the center is hotter than the rim. Keep the halo sprite behind
  it per spec.

Everything else in §2.2 (ring radii, counts, rates, 12° tilt, gyro rings) is
correct — build exactly those numbers. Do NOT add a triangle. Do NOT add
spokes, glyphs, or ring text.

## 2. Material recipe (exact)

- **Structural metal (one shared material for all rings/segments/ticks):**
  `meshStandardMaterial({ color: 0x1a2028, metalness: 0.85, roughness: 0.35,
  envMapIntensity: 0.4 })`. Second metal for the coil segments only:
  `0x232b35`, roughness `0.45` — two-tone metal is a machined cue.
- **Emissives — all `meshBasicMaterial({ toneMapped: false })`**, color
  written per frame. HDR multipliers (accent sRGB luminance is ~0.8, bloom
  threshold 1.0, so ≥×1.4 blooms):
  - **Core disc + halo sprite: ×2.4** (the only "hero" brightness)
  - **Coil inner strips: ×1.7**
  - **Mid-ring 30 ticks: ×1.6**
  - **Outer 8 index ticks: ×1.5** (the other 52 stay metal)
  - **Gyro ring edges: ×1.9**
- **Live accent, zero-alloc (copy `ReactorLight`'s exact pattern):** one
  `rgbScratch = {r,g,b}` + one scratch `THREE.Color` per component via
  `useMemo`; in `useFrame`:
  `writeLiveAccentSrgb(useThemeStore.getState().hue, rgbScratch)` →
  `scratch.setRGB(r,g,b, THREE.SRGBColorSpace).multiplyScalar(X)` →
  `material.color.copy(scratch)`. One conversion per frame shared across all
  reactor materials (compute once in the parent `useFrame`, not per
  material).
- **Per-instance tick flicker (thinking state):** set the flicker via
  `instanceColor` (grayscale 0.7–1.3) so
  `final = material.color × instanceColor` — material carries the live HDR
  accent, instanceColor carries the noise. No per-instance material clones.

## 3. Depth and premium cues (the 4 that matter)

1. **Z-stagger the rings:** coil ring at z 0, mid ring z −0.05, outer ring
   z −0.10, core z +0.03. Combined with the 12° tilt, the stack parallaxes
   and reads as an assembly, not a decal.
2. **Respect the gaps:** the spec's radii already leave dark gaps
   (0.42→0.62, 0.92→1.02, 1.18→1.30). Keep them empty. The gaps ARE the
   machining.
3. **Chamfer the coil segments:** instanced boxes with a slight trapezoid
   taper (scale outer face ~1.12× via a skewed BoxGeometry or 4-seg cylinder
   wedge) and rotate each 0.02 rad off-plane so specular from the point
   light glints as the ring turns. Flat axis-aligned boxes look like a UI
   mockup.
4. **Contrast ratio:** ≥60% dark metal (§8.3). If a screenshot shows more
   lit area than dark, cut emissive multipliers, never raise them.

## 4. Bloom

Confirmed as specced:
`<EffectComposer><Bloom mipmapBlur luminanceThreshold={1.0} intensity={0.75} radius={0.6} /></EffectComposer>`
from `@react-three/postprocessing@^3.0.4` (already installed). One
adjustment: pass `luminanceSmoothing={0.2}` so ticks fade in/out of bloom
without popping during flicker. Composer conditionally unmounts when
`useThemeStore quality === 'low'` (React subscribe, not per-frame) — the
halo sprite and toneMapped:false colors keep the reactor reading bright
without it.

## 5. Interaction and motion

- Keep the placeholder's exact hover contract: `onPointerOver/Out` on an
  **invisible r 1.4 circle hitbox** (single mesh — `visible={false}` won't
  raycast; use `material.opacity 0, transparent, depthWrite false`), cursor
  pointer, dispatch `jarvis:reactor-hover` (core-readout already listens).
  Hover: outer ring rate ×3, lerped over 180ms (lerp the rate, not the
  angle).
- Click + Alt+J: `window.dispatchEvent(new CustomEvent('jarvis:toggle-mic'))`
  (chat-panel listener already wired).
- Per-state rows from §3, all as rate/brightness targets eased
  0.08–0.14/frame: idle core breathe 4s ±3%; listening core ×1.4 + coil ×2 +
  `+0.15 × micLevel` scale; thinking mid ring ×4 with ±0.4 rad seek + tick
  flicker; speaking 7Hz smoothed core pulse + gyro ×2. Idle screenshot test:
  nothing over 0.1 units/s at idle (outer ring 0.02 rad/s × r1.3 = 0.026 ✓).
- CameraRig (parallax ±0.28x/±0.16y, Lissajous ±0.08, HUD x-offset lerp) is
  in this chunk's scope — build it per §2.3, lerp 0.06/frame, no
  OrbitControls. HUD layout state (`chatOpen`, `overlayOpen`) is already
  bridged into the theme store by HudShell — read via `getState()` in
  `useFrame`.

## 6. Top 5 reactor guardrails

1. **No triangle, no "Stark" glyphs, no ring lettering** — Yash reverted the
   literal Iron Man core once already.
2. **Only 5 things bloom:** core, halo, coil strips, mid ticks + 8 index
   ticks, gyro edges. If the metal blooms, the multipliers are wrong.
3. **≥60% of visible reactor area is dark metal.** Check this on the actual
   screenshot, not the intent.
4. **No lens flare, god-rays, grain, scanlines, hex overlays** (§8.2) — and
   no extra rings beyond the specced 6 elements.
5. **One hue.** Every emissive derives from the single live accent; never
   mix a fixed cyan with the live hue.

Verification per §7.3: screenshots (idle + hover + thinking), bloom isolated
to emissives, click flips the chat mic button.
