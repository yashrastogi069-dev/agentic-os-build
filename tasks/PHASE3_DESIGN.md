# PHASE 3 DESIGN SPEC — "The Stage": Arc Reactor + Neural Network + Living Theme

**Author: Fable (design authority) · Date: 2026-07-10 · Status: authoritative for Phase 3 execution**
**Bar: an obvious visual leap. If a screenshot of the new build could be mistaken for the old 3-column grid, the phase has failed.**

## 0. Concept

The OS is no longer a page with a widget in the middle — it is a **room**. A deep-space command bridge fills the entire viewport as one WebGL scene: a holographic floor receding into darkness, two layers of drifting starfield, and floating dust catching the light. In this room live two distinct beings: the **Neural Network** — Jarvis's mind, a constellation lattice that breathes color and drives the entire OS palette — arcing behind and above the **Arc Reactor** — Jarvis's heart and mouth, a machined, counter-rotating ring assembly you click to talk to. Every functional panel floats over this room as chrome-less HUD glass. No dividing lines anywhere.

## 1. Composition & layout

### 1.1 Z-layers (top to bottom)

| z | Layer | Notes |
|---|---|---|
| 50 | Toasts / voice error line | existing behavior |
| 40 | Summoned overlay panel (feed/notes/memory/skills/settings) | one at a time |
| 30 | Chat dock (left), edge rail (right), status strip (top), core readout (bottom) | persistent HUD |
| 10 | Vignette + scrim gradients (CSS, pointer-events-none) | legibility layer |
| 0 | The 3D stage (`position: fixed; inset: 0`) | single Canvas |

### 1.2 The open layout (≥1024px)

- **Top — status strip.** Keep `StatusBar` component and its full contents, but restyle its container: no `border-b`, background `transparent`, a top-edge scrim (CSS gradient `oklch(0.10 0.01 235 / 85%) → transparent`, height ~96px, z-10) provides legibility. Phase 4 rebuilds internals; Phase 3 only un-boxes it.
- **Left — chat dock.** `ChatPanel` lives in a 400px column, full height under the status strip, `margin: 12px`, `border-radius: var(--radius-xl)`, background `oklch(0.13 0.01 235 / 62%)` + `backdrop-blur(20px)`, **1px border only on the right edge as a faded gradient** (`transparent → border → transparent`) — a light edge, not a box. Collapsible via a chevron button in its header (and `Ctrl+B`): collapses to a 48px rail with a chat glyph; 250ms `--ease-out-expo` slide. All chat functionality (messages, tool chips, quick actions, mic button, input) unchanged inside.
- **Right — edge rail.** A vertical icon rail (48px wide, vertically centered, right: 12px): five icons — Activity (feed), StickyNote (notes), Database (memory), Zap (skills), Settings2 (settings). Click (or `Alt+1..5`) summons the **overlay panel**: 420px, slides in from the right 220ms `--ease-out-expo`, same glass treatment as chat dock, close via ×, Esc, re-click, or clicking the stage. Exactly one open at a time; the active rail icon gets `text-primary` + a 2px `--accent-live` indicator bar. Focus moves into the panel on open, returns to the rail on close. The five existing panel components mount unmodified inside.
- **Center — the stage.** Everything between chat dock and rail belongs to the reactor. **Reactor primacy rule:** the reactor group is framed at the visual center of *free* space — the camera rig lerps its x-offset (`+0.55` world units when chat is open, `−0.35` more when an overlay is open, 400ms `--ease-in-out-quint`) so the reactor always re-centers in whatever room the HUD leaves. Nothing may overlap the reactor's bounding circle at 1280px+ with chat open and one overlay open.
- **Bottom — core readout.** Replaces `core-stage.tsx`'s caption: bottom-center, pointer-events-none, mono 10px uppercase tracked: `core // {state}` + `{n} memories · {brain} brain` (keeps `useHealth()` data). Plus, only while hovering the reactor: "TALK TO JARVIS · ALT+J" fades in (150ms).

### 1.3 Responsive & fallback

- **<1024px:** no Canvas. `components/scene/poster.tsx` renders a pure-CSS reactor emblem (three concentric ring divs with `conic-gradient` tick marks, `--accent-live` glow, `animate-core-pulse` on the core) as a fixed background at 20% opacity behind a single-column layout: status strip, chat filling the screen, and a **bottom tab bar** with the same five icons opening the panels full-screen. All functionality preserved.
- **No WebGL (any size):** detect via `canvas.getContext('webgl2') ?? getContext('webgl')` probe in `jarvis-stage.tsx` before mounting Canvas; on failure render the same poster full-opacity-dimmed. Theme engine still runs (it's DOM-only), so the OS still breathes color.
- **`prefers-reduced-motion`:** see §4.

## 2. The 3D scene (one Canvas, no second context)

`<Canvas camera={{ position: [0, 0.6, 7.2], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }} frameloop="always">` — frameloop toggled to `"never"` on `visibilitychange` hidden and in reduced-motion (render once on state change via `invalidate()`).

### 2.1 Scene graph

```
<JarvisStage>                        components/scene/jarvis-stage.tsx
├─ <CameraRig/>                      mouse parallax + idle drift + HUD offset lerp
├─ fog: THREE.FogExp2(0x07090c, 0.055)
├─ ambientLight 0.15 · pointLight at reactor core (color = live accent, intensity 2–6 by energy)
├─ <SpaceEnvironment/>               environment.tsx
│  ├─ Starfield far: THREE.Points, 1100 pts, r 40–70 shell, size 0.06, opacity 0.55
│  ├─ Starfield near: THREE.Points, 500 pts, r 18–35, size 0.1, opacity 0.8, parallax ×1.6
│  ├─ GridFloor: 60×60 plane at y=−3.2, custom ShaderMaterial — anti-aliased grid lines
│  │   (fwidth), line color = live accent at 7% alpha, radial distance fade to 0 by r=24,
│  │   slow uv scroll 0.008/s toward camera
│  └─ DustMotes: 64 additive sprites, r 3–9 around origin, drift 0.02/s, opacity 0.05–0.12
├─ <NeuralNetwork/>                  neural-network.tsx — position [0, 2.1, −5.5], scale 3.4
│  ├─ nodes: InstancedMesh, 140 × icosahedron(det 0), fibonacci ellipsoid shell (rx 1.9, ry 1.1, rz 1.4) + 24 interior
│  ├─ edges: LineSegments (links < 0.62 normalized dist, cap ~380), additive, opacity 0.10–0.22
│  ├─ pulses: InstancedMesh pool of 24 additive glow sprites traveling random edges, 600–900ms each, spawn rate by state
│  └─ hover: raycast (throttled to pointermove, layer-masked) → hovered node scales ×1.8 + 2 nearest edges brighten, 180ms lerp
├─ <ArcReactor/>                     arc-reactor.tsx — position [0, −0.15, 0]
│  └─ (assembly below)
└─ <EffectComposer>                  bloom (see 2.4)
```

### 2.2 The Arc Reactor (design it once, properly)

Machined instrument, not movie prop. Total diameter ~2.6 world units. All emissive parts use `meshBasicMaterial` with HDR color (`new THREE.Color(accent).multiplyScalar(2.2)`) so only they cross the bloom threshold; structural parts use `meshStandardMaterial({ color: 0x1a2028, metalness: 0.85, roughness: 0.35 })`.

1. **Core** (r 0.42): a flat emissive disc (circleGeometry, 48 seg) + a 0.55r additive radial-gradient sprite behind it (soft halo, cheap fake volumetric) + the point light. Breathes: scale 1±0.03 sine, 4s period at idle.
2. **Coil ring** (r 0.62–0.92): **10 trapezoidal segments** (instanced box, angled) — the classic palladium coil — dark metal with a thin emissive strip inset on each segment's inner face. Rotation **+0.05 rad/s** idle.
3. **Mid ring** (r 1.02–1.18): thin metal annulus + **30 instanced emissive tick marks** on its face. Counter-rotates **−0.09 rad/s**.
4. **Outer ring** (r 1.30): torus (0.03 tube) dark metal + **60 fine ticks** (instanced, alternating heights, 8 of them emissive as "index marks"). Rotates **+0.02 rad/s**.
5. **Gyro rings**: two thin emissive-edged torus rings, r 1.55 and 1.78, tilted 65° and 78°, precessing at 0.03 and 0.045 rad/s in opposite senses — gives the assembly true 3D depth against the flat rings.
6. Whole group tilted **12° toward camera** (x-rotation) so ring depth reads immediately.

**Interaction:** invisible circle hitbox (r 1.4) on the reactor. Hover → cursor pointer, outer ring rate ×3 for the hover duration (lerped 180ms), the DOM "TALK TO JARVIS" label fades in. **Click (or Alt+J)** dispatches `window.dispatchEvent(new CustomEvent('jarvis:toggle-mic'))`; `chat-panel.tsx` adds one `useEffect` listener that calls its existing `toggleMic()`. Zero refactor of the voice flow now; Phase 6 replaces the bus with real streaming voice and feeds `micLevel` into the store (the store field exists from day one; reactor core scale adds `+0.15 × micLevel` when listening).

### 2.3 Camera

Fixed base at `[0, 0.6, 7.2]` looking at `[0, 0.35, 0]`. Three additive offsets, all lerped at 0.06/frame: (a) mouse parallax ±0.28x/±0.16y from normalized pointer, (b) idle Lissajous drift ±0.08 (periods 19s/23s), (c) the HUD re-centering x-offset from §1.2. No OrbitControls — the stage is not a toy to drag; parallax gives life without fighting HUD pointer events.

### 2.4 Post-processing — decision: yes, add it

Add **`@react-three/postprocessing@^3.0.4`** (built for r3f v9; pulls `postprocessing@^6.37`, compatible with three 0.185). One `EffectComposer` with a single **Bloom** effect: `mipmapBlur, luminanceThreshold: 1.0, intensity: 0.75, radius: 0.6`. Threshold 1.0 + HDR-multiplied emissives = **selective bloom for free**: only reactor emissives, pulses, and index ticks bloom; text scrims and dark metal never do. No other effects — no god-rays, no chromatic aberration, no noise (kitsch, and perf).

## 3. Animation choreography

Global state machine mirrors `CoreState`. All 3D transitions are store-value lerps (the scene reads targets and eases at ~0.08–0.14/frame); all DOM transitions use Phase 2 motion tokens.

| | **idle** | **listening** | **thinking** | **speaking** |
|---|---|---|---|---|
| Hue (oklch) | drifts 205→255→205, 45s sine | snap **213** (ice cyan) | snap **75** (hot gold) | snap **195** (bright ice) |
| Energy | 0.35 | 0.80 | 1.00 | 0.90 |
| Network | node shimmer 0.04 amp; 1 pulse per ~1.6s; rotation 0.0012/frame | shimmer ×1.5; pulses converge **toward the node nearest the reactor**; 1 per 0.5s | pulse storm: 1 per 0.18s (pool-capped at 24); rotation ×2.5; edge opacity 0.22 | rhythmic wave: node scale wave radiating outward, 1.1s period; pulses 1 per 0.8s |
| Reactor | breathing core (4s), base ring rates | core brightens ×1.4; coil ring rate ×2; core scale follows `micLevel` | mid ring ×4 + brief ±0.4 rad "seek" oscillations; ticks flicker (per-instance emissive 0.7–1.3 noise) | core amplitude-pulse at ~7Hz smoothed (placeholder sine until Phase 6 supplies playback amplitude); gyro rings ×2 |
| Background | grid scroll 0.008/s; dust drift | dust brightens 1.3× | grid scroll ×2; near stars twinkle amp ×2 | grid pulses brightness with core |
| Point light | intensity 2.0 | 3.5 | 6.0 | 4.5 |

**State snap:** hue/energy lerp to target over **240ms, `--ease-out-quint`-equivalent curve in JS** (store interpolates; both DOM and R3F read the same interpolated value — one source of truth, no double easing).
**Micro-interactions:** node hover 180ms; reactor hover 180ms; panel open/close 220ms `--ease-out-expo` slide+fade (translateX 24px); chat collapse 250ms; no bounce anywhere, all entrances <300ms.

## 4. Theme propagation (`lib/theme-engine.ts`)

**Decision: add `zustand@^5.0.8`** (PLAN 2.2 already names it; ~1.2KB; its transient `getState()`/`subscribe` API is exactly what per-frame R3F reads need — a module-level hand-rolled store would reimplement zustand's selector/equality machinery badly).

```ts
interface ThemeState {
  coreState: CoreState            // moved here from core-stage.tsx
  hue: number; energy: number     // LIVE interpolated values (engine-written)
  micLevel: number                // 0..1, Phase 6 feeds this
  quality: 'high' | 'low'        // perf governor
  reducedMotion: boolean
  setCoreState(s: CoreState): void
}
```

**One rAF loop** (started by `components/theme-engine-provider.tsx`, mounted in `app/layout.tsx`): each frame it (1) advances idle drift or eases hue/energy toward the state target (240ms snap), writing via `store.setState` **without notifying React** for hue/energy (transient); (2) at **max 10Hz** writes `document.documentElement.style.setProperty('--accent-live', 'oklch(0.84 0.14 ${hue})')` — and nothing else; globals.css already derives `--ring`, `.glow-primary`, `.text-glow` from it (verified at globals.css:97,162,166). Fixed L/C keeps every derived contrast pair in Phase 2's audited range.
**R3F reads:** `useThemeStore.getState()` inside `useFrame` — zero React re-renders per frame. Materials update color via `color.setStyle`/OKLCH→sRGB conversion helper in theme-engine (one `THREE.Color` scratch object, no allocs).
**Reduced motion:** engine detects `matchMedia('(prefers-reduced-motion: reduce)')` → drift frozen at hue 213, snaps instant (no 240ms lerp), rAF drops to state-change-only; Canvas `frameloop="never"` + `invalidate()` on state change (static but correctly-colored render); pulses/shimmer/rotation disabled; DOM falls into Phase 2's existing reduced-motion CSS layer.
**Tab hidden:** `visibilitychange` → pause engine rAF + set frameloop `"never"`; resume with clock delta clamped (max 0.1s step) so no jump.

## 5. Performance budget & fallbacks

- **Target:** 60fps at 1920×1080, dpr ≤1.5, on Intel Iris Xe-class integrated graphics; main-thread scripting <30% at idle (Phase 3 gate).
- **Draw calls: ≤ 22 total.** Stars 2, grid 1, dust 1, network nodes 1 (instanced), edges 1, pulses 1 (instanced pool 24 — hard cap, recycle oldest), reactor ≈ 11 (core, halo, 5 instanced tick/segment sets, 2 tori, 2 gyro), composer 1 chain. Triangles < 120k. **Zero per-frame allocations** in `useFrame` (pre-allocated scratch Vector3/Color/Object3D — enforce in review).
- **Perf governor** (in `jarvis-stage.tsx`): rolling 60-frame fps; if <40 sustained 3s → `quality:'low'`: composer unmounted (HDR emissives still read bright via the halo sprites), near starfield hidden, dust hidden, pulse pool 12, dpr 1. One-way per session (no oscillation).
- **Fallback ladder:** WebGL absent → poster (§1.3). <1024px → poster + tab-bar layout. Reduced motion → static render. All three keep every function reachable.

## 6. Component / file plan

**Create**
- `lib/theme-engine.ts` — zustand store, `CoreState` type (canonical home), drift/snap engine, 10Hz CSS writer, OKLCH→THREE.Color helper.
- `components/theme-engine-provider.tsx` — client component; starts/stops the rAF loop, visibility + reduced-motion wiring.
- `components/scene/jarvis-stage.tsx` — WebGL probe, Canvas, CameraRig, perf governor, Suspense, composer.
- `components/scene/environment.tsx` — starfields, grid-floor shader, dust.
- `components/scene/neural-network.tsx` — lattice, edges, pulse pool, hover raycast, per-state choreography.
- `components/scene/arc-reactor.tsx` — ring assembly, interaction hitbox, `jarvis:toggle-mic` dispatch.
- `components/scene/poster.tsx` — CSS reactor emblem fallback.
- `components/hud/hud-shell.tsx` — layout orchestrator: chat dock (collapse state), edge rail, overlay manager, hotkeys (Ctrl+B, Alt+1..5, Alt+J, Esc).
- `components/hud/edge-rail.tsx` — five-icon rail + active indicator.
- `components/hud/panel-overlay.tsx` — summonable glass panel, focus trap, Esc/outside-click close.
- `components/hud/core-readout.tsx` — bottom state/health caption + hover affordance label.

**Modify**
- `app/page.tsx` — full restructure: fixed stage z-0, `<HudShell>` above it; keep `coreState` handoff but write into the store (delete local `useState`; ChatPanel's `onStateChange` now calls `useThemeStore.setState`… simplest: HudShell passes `setCoreState` from the store as `onStateChange`, ChatPanel unchanged).
- `app/layout.tsx` — mount `ThemeEngineProvider`.
- `app/globals.css` — add `.hud-glass`, `.hud-scrim-top`, `.hud-edge-fade`, vignette utility; nothing removed.
- `components/chat-panel.tsx` — import `CoreState` from `lib/theme-engine`; add the `jarvis:toggle-mic` listener effect. No other changes.
- `components/status-bar.tsx` — container restyle only (transparent, no border).
- `package.json` — add `zustand@^5.0.8`, `@react-three/postprocessing@^3.0.4`.

**Delete**
- `components/core-stage.tsx`, `components/neural-core.tsx` (superseded; PLAN §1 item 13 closes).

NOTE (icons): edge-rail icons above are named via lucide (Activity/StickyNote/Database/Zap/Settings2)
per Fable's spec draft — Phase 4 migrates all icons to Phosphor per Yash's approved plan (PLAN.md 2.7).
Phase 3 executor may use lucide equivalents now (already installed) OR Phosphor if trivial; either is
fine since Phase 4 sweeps icons project-wide regardless.

## 7. Implementation sequence (Workflow of xhigh executors)

1. **Chunk A — Theme engine.** Add zustand; build `lib/theme-engine.ts` + provider; migrate `CoreState` (update chat-panel/core-stage imports so nothing breaks yet); wire ChatPanel state into the store; old UI untouched. ✅ Verify: typecheck + build green; in devtools, `--accent-live` hue drifts at idle and snaps gold while a chat turn streams; reduced-motion emulation freezes drift.
2. **Chunk B — Stage + HUD restructure.** `jarvis-stage.tsx` with environment + a placeholder emissive sphere; rewrite `app/page.tsx` to the open layout; hud-shell/edge-rail/panel-overlay/core-readout; poster fallback; delete core-stage/neural-core. ✅ Verify: build; screenshots at 1280/1536/1920 — no boxes, space environment full-bleed; every panel + chat + mic reachable by mouse AND keyboard; <1024px tab-bar layout screenshot; WebGL-disabled screenshot.
3. **Chunk C — Arc Reactor.** Full assembly per §2.2, bloom composer, hover/click → mic event, camera re-centering lerps. ✅ Verify: screenshots + short recording; clicking the reactor starts recording (mic button in chat flips to "stop"); hover affordance visible; bloom only on emissives.
4. **Chunk D — Neural network + choreography + perf.** Lattice, pulses, hover, full per-state table (§3), perf governor, tab-hidden pause, reduced-motion static render. ✅ Verify: recording of idle drift + a full chat turn (idle→thinking→idle) with UI accents following; DevTools perf trace 60fps / <30% main thread idle; reduced-motion + hidden-tab checks; final Yash screenshot set.

## 8. Taste guardrails (what makes this cheap, and the rules that prevent it)

1. **Glow discipline.** Bloom threshold stays at 1.0 — if everything glows, nothing does. Only the core, emissive ticks, pulses, and halo may exceed it. No DOM glow beyond Phase 2's `.glow-primary`/`.text-glow`.
2. **No lens flares, no god-rays, no film grain, no scanlines, no hexagon overlays.** These are the five fastest routes to "AI-generated sci-fi slop."
3. **Dark metal is the luxury.** ≥60% of the reactor's surface area is non-emissive machined metal. The contrast between matte structure and few bright lines is what reads "premium instrument."
4. **Motion restraint** (emilkowal): ease-out only for entrances, <300ms UI motion, no bounce/elastic/overshoot, continuous 3D motion slow enough that a screenshot always looks composed (max idle ring speed keeps any point under ~0.1 units/s).
5. **Legibility is non-negotiable.** Text sits on scrims/glass, never raw over stars; Phase 2's 4.5:1 body contrast holds because glass panels are ≥62% opaque dark.
6. **One accent at a time.** The live hue owns the screen; gold appears only as the thinking state or Phase 2's sparse `--accent` usage — never both saturated at once.
7. **Restraint in count.** 5 HUD regions max on screen; if a future feature needs surface area, it becomes an overlay, not a new persistent panel.

### Critical files referenced
- `app/page.tsx` — the layout being replaced by the open HUD composition
- `app/globals.css` — the `--accent-live` contract, motion tokens, and new HUD utilities
- `components/neural-core.tsx` — existing R3F patterns (instancing, lazy mount) superseded by the scene modules
- `components/chat-panel.tsx` — `CoreState` import migration, mic event listener, `onStateChange` → store wiring
- `components/core-stage.tsx` — canonical `CoreState` home being moved to `lib/theme-engine.ts` before deletion
