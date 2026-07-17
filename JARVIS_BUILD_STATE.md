# JARVIS_BUILD_STATE.md

Cross-session resume contract. Read this (and `tasks/PLAN.md`, `tasks/lessons.md`)
before starting any new work on this project.

## Current Phase (updated 2026-07-17, live)

**Phase 0, 1, 2, 3 (all chunks) COMPLETE. Phase 4 SHIPPED. Phase 6 CLOSED
2026-07-17** — Yash tested live on his own :3000 dev server and confirmed
voice works end-to-end (talk to Jarvis, it replies, hands-free via
hotkey). His own words: "its working now but needs improvement... complete
this phase first." Chunks A-E + H + I shipped and live-verified this
session; chunks F (latency instrumentation + tone-prefs Settings UI) and G
(formal verification matrix + Fable taste pass) are explicitly DEFERRED,
not abandoned — see "Phase 6 polish backlog" below. They roll into a
future polish pass, not blocking further phases. **Now starting Phase 5:
connector registry refactor (Canva explicitly excluded — deferred to the
end, per Yash 2026-07-17)** — see "Connector registry decision" below —
then Phase 7.

### Phase 6 — Voice mode 1 + assistant intelligence core (CORE DONE 2026-07-17)

LIVE SMOKE TEST PASSED on :3100 (2026-07-17): `pnpm build` green (all 24
routes generate); `/` returns 200; `/api/health` db.ok + memory intact;
`/api/voice/status` reports Piper installed (binPresent/voicePresent) with
honest STT-sidecar-down state; end-to-end reminder pipeline verified — a
past-due task fired a dedupe-keyed notification via the instrumentation-
started scheduler, appeared in the queue AND the feed, and acked cleanly;
`/api/voice/speak` synthesized real audio (HTTP 200, 89KB wav);
`/api/wake-words` returns the seeded "jarvis" entry. Full spec:
`tasks/MASTER_PLAN_V2.md` §5. Benchmarks: `tasks/PHASE6_BENCH.md`.

- **Chunk C — client voice loop**: SHIPPED, commit 940750a. AudioWorklet
  recorder (`public/worklets/capture-processor.js` + `lib/voice/recorder.ts`
  WorkletRecorder w/ 300ms pre-roll), `lib/voice/vad.ts` (energy VAD,
  auto speech start/end), `lib/voice/sentence-chunker.ts`,
  `lib/voice/tts-queue.ts` (gapless scheduled playback, barge-in w/ 60ms
  fade, abort in-flight synth), `components/voice/voice-controller.tsx`
  (state machine idle/listening/transcribing/thinking/speaking, owns the
  toggle-mic listener + mic button, follow-up window). Barge-in works: you
  can interrupt mid-sentence.
- **Chunk E — reminder scheduler + notifications + tasks panel**: SHIPPED,
  commit 94039ce. `lib/scheduler.ts` (globalThis-guarded 30s interval,
  dedupe-keyed firing, recurrence advance, missed-while-off announce-once),
  `instrumentation.ts` (starts scheduler on server boot), `app/api/
  notifications` (SSE live push + JSON fallback + ack/snooze),
  `app/api/tasks(/[id])` REST, `components/hud/notification-toasts.tsx`
  (EventSource toasts, speaks reminder aloud during a voice session),
  `components/tasks-panel.tsx` (6th HUD panel, Alt+6).
- **Chunk H — wake-word system** (NEW, user-requested): SHIPPED, commits
  00881e4 + 40a968f (client/server boundary fix). Say "Jarvis" to activate
  hands-free; extensible phrase->action registry (add more trigger words
  later). `lib/wake-words.ts` (server registry) + `lib/wake-words-match.ts`
  (pure client-safe matcher) + `app/api/wake-words` + `components/voice/
  wake-word-listener.tsx` (own recorder+VAD, pauses during a conversation,
  honest "listening" indicator, self-disables on mic-denied). Wake-word
  tools in the agent so "add a wake word X" works via chat.
- **Chunk I — full read+write connectors** (NEW, user-requested): SHIPPED,
  commit 6f0a4b5. GitHub createIssue/commentOnIssue (confirmation-gated),
  Google createCalendarEvent + sendGmail (gmail scope widened — EXISTING
  GOOGLE CONNECTIONS MUST RECONNECT in Settings for the new consent grant),
  Apple createCalendarEvent (CalDAV PUT). Obsidian/Telegram already had
  write. Visible-to-others actions preview-then-confirm before firing.
- **Voice hotkey**: changed to Right Alt alone (was Alt+J), commit 8d8ddd4.
- **Chunk A — Windows voice foundation + benchmark spike** and **Chunk B —
  server voice infra**: SHIPPED (see below, unchanged).

- **Brain-dead bug found + fixed live (2026-07-17)**: after the chunks above
  shipped, Yash's live test on his own :3000 dev server hit "An error
  occurred, Jarvis can't talk back" on every turn. Root cause: turn context
  was injected as a `role:"system"` UIMessage; the `ai` package's agent
  rejects system messages in `prompt`/`messages` at runtime
  (`AI_InvalidPromptError`) even though `UIMessage`'s type allows the role —
  took down every provider in the chain identically. Fixed in commit
  `a61bc16`: context now rides `streamOsAgentResponse(messages, {
  extraContext, onSessionPersist })` instead. Verified live with curl
  against Yash's own server: the same request that 500'd now streams a real
  Gemini reply.
- **Voice-flooding + chat-echo bug found + fixed live (2026-07-17)**:
  always-on wake-word listening was transcribing all room noise (198
  transcribe calls in one session, latency climbing to 14s) and the
  follow-up window auto-reopened the mic so Jarvis's own TTS got
  re-transcribed back into the chat as fake user turns. Fixed in commit
  `6f18548`: wake-word listening now defaults OFF (hotkey/reactor-click
  activation only, per Yash's explicit instruction), and voice is strictly
  turn-based (`TtsQueue.onPlaybackStateChange` calls `stopEverything()`
  when speech ends, no auto-reopen). Voice-originated user turns are tagged
  `metadata:{voice:true}` and filtered out of the chat render
  (`components/chat-panel.tsx`) — spoken words no longer echo into the
  transcript, though the turn is still sent to the brain and persisted.
- **PHASE 6 CLOSED 2026-07-17**: Yash tested live and confirmed "its
  working now" — talk to Jarvis via the Right-Alt hotkey, it transcribes,
  replies through the brain chain, speaks back, all without flooding the
  chat. His own assessment: "needs a lot of improvement" — that improvement
  work is captured, not lost, in the "Phase 6 polish backlog" task (see
  session task list / re-derivable from this file's "Chunk F/G" description
  above) and is explicitly NOT blocking the next phase. **Remaining
  (deferred, not blocking)**: Chunk F (latency instrumentation to hit
  p50<=1.8s + a tone-prefs Settings UI — the prefs already work + persist
  via the agent's setPreference tool today, the UI is convenience), Chunk G
  (formal verification matrix + Fable taste pass on the new surfaces).

### Phase 5 progress log (updated as chunks land, 2026-07-17)

- **Chunk 5A-1/5A-2 (registry skeleton + agent.ts wiring)**: SHIPPED
  2026-07-17, commit `728d655`. Sonnet executor, Fable-reviewed (SHIP
  AS-IS, independently re-ran tests/typecheck). `lib/connectors/registry.ts`
  new; `lib/agent.ts` consumes `connectorTools` + `connectorPromptLines()`.
- **Chunk 5A-3/5A-4 (feed + health + status-bar onto registry)**: SHIPPED
  2026-07-17, commit `241c848`. Sonnet executor (switched from an initial
  Opus dispatch per Yash's "opus for important ones, sonnet for this one"
  before any files were written — no wasted work). No Fable review this
  chunk per Yash's explicit "don't do the review" instruction; committed
  on the executor's own self-reported gates (typecheck/build/test/live
  probes all passed).
- **Chunk 5B (OAuth extraction + PKCE + CSRF fix + rotation fix)**: IN
  PROGRESS 2026-07-17, Opus executor (agent id `a7a50a0692ad2db2d` —
  intentionally Opus, this is the security-sensitive chunk touching
  Yash's real Google OAuth credentials). Hit TWO session-limit
  interruptions (first reset 6pm Asia/Calcutta window, second reset
  11:40pm) — both times resumed the SAME agent via SendMessage after
  confirming via `git status` what was already written on disk, never
  restarted from scratch. As of the second resume: `lib/connectors/
  oauth.ts` exists (new generic OAuth module: buildAuthUrl/
  handleOAuthCallback/getAccessToken/disconnect/isConnected, state-based
  CSRF protection, PKCE-ready, refresh-token rotation), `google.ts`
  already migrated onto it (`googleOAuth: OAuthDescriptor` const defined).
  Still to confirm before this chunk can commit: old google.ts OAuth
  functions fully removed (not left dangling), `/api/google/auth` +
  `/api/google/callback` routes flipped onto the module with real state
  validation, new `tests/oauth.test.ts`, full gate pass. **Not yet
  committed.** Once this lands and gates pass, the SCOPED Phase 5
  refactor (registry + OAuth, Canva excluded) is done — Yash's explicit
  instruction is to stop there, no Phase 7 / Canva without his go-ahead.

### Connector registry decision (Fable medium-effort review, 2026-07-17;
### scope trimmed by Yash 2026-07-17)

For "add tools like Canva in future": build a minimal slice of Phase 5 next
(NOT the full phase). In scope: `lib/connectors/registry.ts`
(`{id,label,promptHint,probe,sync?,tools,auth?}`) that health/feed/status/
agent-tools iterate; `lib/connectors/oauth.ts` extracted from google.ts but
built for refresh-token ROTATION + PKCE (Google needs neither, a future
OAuth-PKCE connector will) with the CSRF `state` fix folded in; migrate the
existing 5 connectors (GitHub, Obsidian, Telegram, Google, Apple) onto the
registry to prove the pattern. Two gaps Fable caught: `lib/agent.ts`
INSTRUCTIONS hardcodes per-connector capability prose (needs a `promptHint`
per registry entry or new tools stay invisible to the model), and Google's
OAuth can't be copied verbatim for a future PKCE connector. **Canva is
explicitly OUT of this phase** (Yash: "leave the canva slice out of phase
5 we will do that later in the end") — add it as a NEW connector on top of
the finished registry once the registry itself ships, not as this phase's
proof case. Deferred: MCP key masking, local-fs connector, Obsidian depth,
live matrix. "Memory not just read-only" = write-capability (done), NOT
auto-ingestion.

- **Chunk A — Windows voice foundation + benchmark spike**: SHIPPED, commit 8887669. `tools/stt-server` (faster-whisper sidecar on 127.0.0.1:8765, shares dictation tool's cached model), `scripts/setup-voice.ps1` (Piper 2023.11.14-2 + en_US-lessac-medium voice, pinned/idempotent). See `tasks/PHASE6_BENCH.md` for measured numbers.
- **Chunk B — server voice infra**: SHIPPED, commit b3d85ef. `lib/voice/stt.ts` (transcribeWav chain: sidecar → guarded auto-start+retry → whisper-cli fallback → honest VoiceUnavailableError), `lib/voice/piper.ts` (persistent daemon, globalThis-guarded singleton, serialized queue, 5min idle-unload, crash recovery), rewritten `app/api/voice/transcribe` + `speak` routes, new `app/api/voice/status` route, `lib/voice/paths.ts` updated for Windows .exe suffixing and sidecar/daemon paths.
- **Chunk D groundwork + full (sessions + context core)**: SHIPPED, commits b3d85ef (schema/assistant persona) + d83e457 (sessions/tasks/notifications/agent wiring). `lib/db/schema.ts` gained `chat_sessions`, `chat_messages`, `tasks`, `notifications` (SCHEMA_VERSION 4 — shared notification queue per MASTER_PLAN_V2 §1 SS1, dedupe_key unique for Phase 7 compatibility). `lib/assistant/prompt.ts` (persona + tone/verbosity/address preferences persisted in connector_settings, text vs voice response contracts), `lib/assistant/context.ts` (per-turn context: time, session summary, open tasks <48h, top-5 memories, fail-soft). `lib/sessions.ts` (session/message CRUD + rolling summarization via generateText, fail-soft), `lib/tasks.ts` (CRUD + recurrence: daily/weekdays/weekly/monthly, completeTask spins off next occurrence), `lib/db/notifications.ts` (enqueue/list-pending/ack/snooze/mark-delivered). `lib/agent.ts` gained taskTools + preferenceTools (setPreference persists "be more casual" style requests across restarts) wired into allTools; streamOsAgentResponse gained extraContext + onSessionPersist hooks. `app/api/chat/route.ts` now creates/resumes sessions (X-Session-Id header), persists both turns, injects turn context as system message, fires summarization after each turn. New `app/api/sessions(/[id])` routes for session list/resume.
- **Gates status**: `pnpm typecheck` clean after every commit; `pnpm build`
  green; live dev-server smoke test PASSED (see top of Phase 6 section).

### Phase 4 — SHIPPED (2026-07-16)

Executed across 4A (Fable, main session) and 4B-4D (Sonnet subagent, per
Yash's "do this fast, it's not that important" instruction). The 4B-4D
subagent was cut off by the weekly usage limit right before committing;
its staged work was verified and shipped in this session.

- **4A — Phosphor icon migration**: `edge-rail.tsx`, `hud-shell.tsx`,
  `panel-overlay.tsx`, `status-bar.tsx` moved off lucide-react onto
  `@phosphor-icons/react` (thin/duotone weights).
- **4B — panel-kit + status bar/readout honesty**: new
  `components/hud/panel-kit.tsx` shared panel primitives; `status-bar.tsx`
  rewritten with data-driven `DOT_DESCRIPTORS` (db/ollama/obsidian/github/
  telegram/google/apple/voice/mcp) + `AggregateDot` collapse below `lg`;
  `core-readout.tsx` + `edge-rail.tsx` (brain-indicator fix, index-derived
  hotkeys); `app/globals.css` gained `--ease-hud` token + `enter-rise`
  keyframe.
- **4C — restyle all 5 panels onto panel-kit**: `feed-panel.tsx`,
  `memory-panel.tsx`, `notes-panel.tsx`, `settings-panel.tsx`,
  `skills-panel.tsx` all migrated.
- **4D — verify + ship**: `pnpm typecheck` 0 errors; `pnpm build` green
  (all 17 routes generated). Live-verified on dev (Playwright, :3000 —
  dev server came up on the fallback port this run, not the usual :3100):
  idle stage renders all 9 status dots + brain indicator; all 5 panels
  (Feed/Notes/Memory/Skills/Settings) open correctly on the right with
  consistent panel-kit chrome; Skills panel's "+ NEW SKILL" button present
  (replacing the old `window.prompt`); zero console errors except two
  honest 503s from Obsidian's Local REST API being offline (expected
  graceful degradation, not a bug — Notes panel showed the correct
  "OBSIDIAN DISCONNECTED" + setup instructions instead of crashing).
  Screenshots: `C:/Users/win 10/Desktop/praxis/phase4d-*.jpg`.

Committed `f3dc740`, pushed to `origin/jarvis-build`. `tasks/PLAN.md`'s
stray 1-line diff (1.5s→1s gate) was left uncommitted per standing
instruction — do not stage that file.

Deferred: a dedicated Fable taste pass on the restyled panels (batched
into a future review pass, per Phase 3's precedent) was not run this
session — the live screenshots above are the verification record.

Previous Phase 3 completion note (2026-07-11) kept below for history:

### Chunk C — what shipped (2026-07-11)

- `components/scene/arc-reactor.tsx` (NEW): full assembly — Mark-VI
  triangular core (rounded-triangle emissive face, white-hot → accent
  falloff texture, uniform-width TUBE bezel with integral corner nodes,
  3 corner struts + 3 dark mid-edge clamps matched against a real prop
  photo), coil ring of 10 wire-wound TORUS-ARC segments (winding texture
  wraps the tube) over an emissive glow annulus (light through the slots),
  mid ring annulus + 30 emissive ticks (per-instance flicker in thinking),
  outer torus + 60 ticks (8 emissive index marks), 2 precessing gyro tori,
  r1.4 invisible hitbox (hover → cursor + `jarvis:reactor-hover` + outer
  ring rate ×3 lerped; click → `jarvis:toggle-mic`), full §3 per-state
  choreography, reduced-motion freeze, zero-alloc useFrame.
- `components/scene/jarvis-stage.tsx`: placeholder removed; ArcReactor
  mounted; PMREM RoomEnvironment scene env-map; EffectComposer with Bloom
  (mipmapBlur, threshold 1.0, smoothing 0.2, intensity 0.75, radius 0.6,
  multisampling 4) + ACES ToneMapping pass (composer bypasses renderer
  tone mapping — without it the whole scene brightened vs baseline);
  composer unmounts on `quality:'low'` (React subscription); CameraRig
  (§2.3: pointer parallax ±0.28/±0.16, Lissajous ±0.08 19s/23s, HUD
  re-centering x-offset from store chatOpen/overlayOpen, all lerped
  0.06/frame); ReactorLight eased to the §3 intensity table 2/3.5/6/4.5.
- `lib/theme-engine.ts`: store gained `chatOpen`/`overlayOpen` +
  `setHudLayout` + `setQuality` (HudShell writes; CameraRig reads).
- `components/hud/hud-shell.tsx`: HUD-layout store bridge + Alt+J hotkey
  dispatching `jarvis:toggle-mic`.
- `components/chat-panel.tsx`: `jarvis:toggle-mic` listener (ref'd
  toggleMic, registered once).
- Deps added: `@react-three/postprocessing@3.0.4`, `postprocessing@6.39.2`.
- Design iterations driven live by Yash: real-coil slot-glow, torus-arc
  coil segments ("not boxes"), triangular core (EXPLICIT reversal of the
  earlier "no triangle" decision — triangle is now IN), uniform tube
  bezel corners, integral corner nodes, prop-matched struts + clamps,
  gyro HDR 1.9→1.55, envMapIntensity 0.4→0.18.

Gates: `pnpm typecheck` 0 errors; `pnpm build` green; live at 1536px:
idle/hover screenshots (hover label "TALK TO JARVIS · ALT+J" verified),
click → `jarvis:toggle-mic` event verified via instrumented listener
(counter incremented; actual recording blocked only by browser mic
permission in the test browser), full chat turn ran with the stage live,
zero console errors. Deferred to the batched review pass: a mid-stream
gold "thinking" screenshot (Gemini answered too fast to catch; the hue
snap itself was live-verified in Chunk A), reduced-motion static-render
re-check, tab-hidden resume check, perf trace (Chunk D adds the governor).

### Chunk D — SHIPPED 2026-07-12 (Fable, main session; then heavily
### art-directed live by Yash into a full holographic neural field)

Built by Fable directly in the main session (same override as Chunk C).
Brief: `tasks/CHUNK_D_BRIEF.md`. The base lattice matched the brief; Yash
then directed a substantial visual upgrade (see below). All gates green,
committed, pushed. Hold point observed (did NOT start Phase 4).

**What shipped:**
1. `components/scene/neural-network.tsx` (NEW): the lattice, rebuilt as a
   real-CG holographic energy field —
   - NODES: a single `THREE.Points` cloud through a custom additive
     ShaderMaterial — soft radial glow (no hard facets), per-point size +
     color, and TRUE perspective z-depth scaling (`gl_PointSize` ∝
     1/−viewZ, clamped 30px) = Yash's "2.5D pseudo-projection". Crisp
     disc+faint-halo frag so nodes read as precise data marks, not smoke.
   - DEPTH CUE: front-facing nodes (after live Y-rotation) brighter/bigger.
   - RADAR SWEEP: per-node azimuth (atan2 z/x) vs a rotating sweep angle,
     Gaussian lobe lights the wedge it crosses (SWEEP_SPEED 0.85).
   - SHAPE MORPH ("forming different shapes"): 4 configs — organic sphere /
     spiral disc / torus ring / rippled sheet — morphed in random order,
     ~5.5s each + hold, smoothstep-eased, per-node slow flow on top.
   - LIVE CONNECT/DISCONNECT: edges auto-join/disjoin at random (batch every
     0.42s, ~62% lit), per-vertex additive brightness eased in/out.
   - Full-screen: SHELL 320 + INTERIOR 64, RX/RY/RZ 3.5/2.3/2.2 at group
     scale 3.9 → runs off all four viewport edges; group at [0,−0.9,−7.2]
     centered on the reactor sight line.
   - COLOR LIFE: idle hue-walk (14°/s OKLCH) independent of the reactor;
     active states snap to the OS accent. Curved bezier arc edges; pulses
     ride the arcs. Per-state choreography (idle/listening/thinking/
     speaking), reduced-motion freeze, quality-'low' pool cap, zero-alloc
     useFrame with per-frame position + line-buffer rebuild.
   - NOTE: the hub-node → HUD-panel click "functionality" was built and
     verified, then REMOVED at Yash's request ("remove functionality for
     now"). The wiring hooks (`jarvis:open-panel`) are gone from
     hud-shell/core-readout; re-add later if wanted.
2. `components/scene/jarvis-stage.tsx`: NeuralNetwork mounted; camera
   lookAt re-centered on the reactor [0,−0.15,0]; PerfGovernor (60-delta
   ring buffer, fps<40 sustained 3s → setQuality('low') + dpr 1, one-way,
   skips hidden/reduced-motion); ReducedMotionInvalidator invalidates on
   quality change too.
3. `components/scene/environment.tsx`: near-starfield twinkle; GridFloor
   rate-scaled scroll + speaking opacity pulse; DustMotes 0.16→0.21 lerp
   while listening; SpaceEnvironment renders near starfield + dust only at
   quality 'high'.

Gates: typecheck 0 errors; `pnpm build` green; live at 1536px — full-screen
field, reactor centered, crisp nodes with depth, shapes morphing (sphere→
disc→torus→sheet), colors cycling, edges joining/disjoining, zero console
errors. Screenshots in `C:/Users/win 10/Desktop/praxis/` (chunkD-*.jpg).

Deferred to the batched review pass (unchanged from Chunk C): gold
"thinking" screenshot, reduced-motion static re-check, tab-hidden resume,
perf trace / governor CPU-throttle test.

Real Mark VI prop reference: `C:/Users/win 10/.claude/jobs/0d85a7ff/tmp/mk6-ref2.jpg`.

### Phase 3 status: COMPLETE (Chunks A + B + B-redesign + C + D all shipped).
HOLD POINT: awaiting Yash's explicit approval before Phase 4. A full
forward plan for Phases 4-9 is being written to `tasks/MASTER_PLAN_V2.md`.

### Higgsfield note
Yash offered a fresh Higgsfield account/CLI for reference generation
(first account: out of credits). NOT needed for C — a real Mark VI prop
photo (fetched via Tavily) was the better ground truth. If D needs
generated references, ask Yash first.

### CHECKPOINT — read this before touching Chunk C or spawning any new agent

Both Chunk C and D now run with **Fable as the executor itself** (not just
planner/advisor for an Opus executor) — Yash's explicit override of the
project's normal Opus-executes rule, for this track only. See memory
`feedback_fable_builds_not_just_plans.md`.

- **Fable pre-flight design briefs already written — do NOT regenerate
  them.** `tasks/CHUNK_C_BRIEF.md` and `tasks/CHUNK_D_BRIEF.md` exist and
  are authoritative. Re-running a Fable planning pass for either is
  wasted work.
- **A Workflow build for Chunk C is live right now:**
  - Task ID: `wh6w9ss7h`
  - Run ID: `wf_e07cd38f-5a8`
  - Script path: `C:/Users/win 10/.claude/projects/C--Users-win-10-Desktop-praxis/25b6cefd-9bc3-4adf-80b7-7c8193686909/workflows/scripts/jarvis-chunk-c-arc-reactor-fable-wf_e07cd38f-5a8.js`
    (forward slashes on purpose: Tailwind v4's content scanner parses
    `\` followed by hex digits — e.g. `...praxis\25b6ce...` — as a CSS
    unicode escape; out-of-range values hard-fail `pnpm build`. Never
    write backslash paths with hex-leading segments in non-gitignored
    files.)
  - **If you are a fresh session (post usage-limit-reset) and this file
    still shows Chunk C as "in progress": FIRST call
    `TaskOutput({task_id: "wh6w9ss7h", block: false})` to check whether it
    finished while you were gone.** If `status: completed`, read its
    result instead of rebuilding. If it's gone/expired (new session, task
    registry not carried over), do NOT write a fresh prompt from scratch —
    resume the exact same script via
    `Workflow({scriptPath: "<path above>", resumeFromRunId: "wf_e07cd38f-5a8"})`.
    Workflow caches completed `agent()` calls by exact (prompt, opts), so a
    finished build re-returns instantly with zero wasted tokens/time; only
    an unfinished or never-started call actually re-runs.
  - Only if both of the above are impossible (task registry AND run cache
    both gone — e.g. a brand new machine/repo clone) should you write a new
    build prompt, and even then, base it on `tasks/CHUNK_C_BRIEF.md`
    directly rather than re-deriving requirements.
- **Once Chunk C is confirmed done:** live-verify (screenshots, click →
  mic toggle, bloom check), get Fable's advisory screenshot review, commit,
  update this file's status line, THEN start Chunk D the same way — build
  from `tasks/CHUNK_D_BRIEF.md`, Fable as executor, xhigh.
- **Hold point unchanged:** after Chunk D ships, STOP for Yash's explicit
  approval before Phase 4. Do not auto-advance.

Original blocked-on-usage-limit note (2026-07-10/11, resolved) kept below
for history; the NEXT STEPS list under it is now superseded by the
CHECKPOINT above for anything C/D-related.

### NEXT STEPS (in order) once budget is available

1. **Fable visual design review of Chunk B — MANDATORY, do this FIRST,
   before touching C/D.** Yash's live feedback (2026-07-10): "the hub has
   one colour only, it does not look futuristic/modern, the theme is very
   boring and old." Chunk B passed all functional gates (typecheck, build,
   live DOM check, even a Playwright screenshot by its own executor) but
   FAILED on taste/vibrancy. See `tasks/lessons.md` item 11a for full
   context and the likely root cause hypothesis (`.hud-glass` panels too
   uniformly dark/desaturated; the Arc Reactor palette only reads through
   the 3D canvas, not through the HUD chrome itself).
   - Start the dev server, take real screenshots (desktop widths).
   - Run a Fable (model: fable, high effort) review of those screenshots
     explicitly invoking design skills: `impeccable`, `ui-ux-pro-max`,
     `emilkowal-animations`, and the taste-skill — asking specifically: is
     this futuristic/modern/vibrant enough for an Iron-Man-Jarvis HUD, or
     does it read as monochrome/boring/dated? Get concrete, actionable
     fixes (not vague — exact opacity/color/gradient/accent-usage changes).
   - Apply Fable's fixes via a Sonnet or Opus executor (scale to fix size).
   - Re-screenshot and confirm the improvement before moving on.
2. **Chunk C — Arc Reactor.** Opus + xhigh, NO COMPROMISE (Yash's explicit
   hard rule) — pin `model: 'opus'` explicitly in any Workflow script (do
   not rely on session-model inheritance, which caused a bug once already
   when Yash was toggling `/model` mid-session). Use Fable MORE actively
   here per Yash's 2026-07-10 instruction — not just as an emergency
   contact for ambiguities, but a real pre-flight design-refinement pass
   before the executor builds, and a real advisory screenshot review after.
   Design per `tasks/PHASE3_DESIGN.md` section 2.2 (the ORIGINAL Fable ring
   assembly — coil/mid/outer/gyro rings — Yash explicitly reverted the
   "literal Iron Man triangle" idea, do NOT reintroduce it).
3. **Chunk D — Neural network + choreography + perf.** Same Opus xhigh
   no-compromise rule, same Fable-sandwich approach.
4. A saved, ready-to-resume Workflow script for C+D already exists at
   `tasks/PLAN.md`-referenced location — check for
   `jarvis-phase3-stage-wf_*.js` under this session's workflow-scripts dir
   first before writing a new one from scratch; if unavailable, rebuild
   from `tasks/PHASE3_DESIGN.md` section 7 steps 3-4.
5. **STOP AND WAIT FOR YASH'S APPROVAL after step 3 (Chunk D) completes.**
   Yash's explicit instruction (2026-07-10 21:xx IST): once the Chunk B
   redesign is done AND Chunks C and D are complete, do NOT auto-advance
   into Phase 4 (panels + Phosphor icons) or anything further. Report full
   results (screenshots, gate outcomes, Fable's design verdicts) and hold
   the loop — do not call ScheduleWakeup to continue past this point without
   a real user message approving it.

Original Phase 1 handoff notes (still accurate, kept for reference) follow
below.

## Phase 1 — what shipped

- `lib/providers.ts` (new): failsafe chain **Gemini 2.5 Flash → Groq Llama 3.3
  70B → OpenRouter free → NVIDIA NIM → Ollama**. Per-provider cooldowns (60s on
  5xx/network, 10min on 429/quota), `FORCE_DISABLE_PROVIDERS` env test hook,
  OpenRouter free-model rotation (`meta-llama/llama-3.3-70b-instruct:free`,
  `qwen/qwen3-next-80b-a3b-instruct:free`, `openai/gpt-oss-120b:free` — all
  verified tool-capable via the live /models API on 2026-07-09),
  `getProviderStatus()` for health/settings.
- `lib/agent.ts`: `getChatModel()` → `resolveModel()`; new
  `streamOsAgentResponse()` fails over to the next provider when a stream dies
  BEFORE the first content token (after that, errors surface honestly); active
  brain emitted as a transient `data-brain` UI part.
- `lib/research.ts` (new): `webSearch` (Tavily → Serper) + `fetchPage`
  (Firecrawl, 15s timeout) added to the agent toolset; failures degrade to an
  error string the model relays honestly.
- `app/api/chat`: zod validation, 50-message history cap, honest 400/500 JSON.
- `/api/health`: `brain: { active, chain[] }`; status bar shows `brain: <id>`;
  settings panel brain section = live chain status (active/standby/cooling/
  no-key). Old groq/ollama picker replaced (chain is auto-routed).
- Timestamps unified to ms (`mode: "timestamp_ms"` everywhere) +
  `scripts/normalize-timestamps.mjs` (idempotent, backs up DB first).
- `lib/skills.ts` analyzed-flag update scoped with `inArray` (was a blanket
  UPDATE).
- `.env.example` rewritten (all Phase 1 vars, FORCE_DISABLE_PROVIDERS
  documented; stale Exa/Jina comment removed).
- Deps: `@ai-sdk/google@4.0.10`, `@openrouter/ai-sdk-provider@3.0.0`.

## Phase 1 gate results (live, 2026-07-09, dev on :3100)

- `pnpm typecheck` exit 0; `pnpm build` succeeded (all routes generated).
- `/api/health` → `db.ok=true, vec=true, ollama.ok=true`, brain.active=gemini,
  chain gemini=active | groq=ready | openrouter=ready | nvidia=ready |
  ollama=ready.
- Plain chat probe: streamed from **gemini** (data-brain part present).
- "remember that my favorite color is arc reactor blue" → `saveMemory` tool
  call streamed → GET `/api/memories?q=arc reactor` returned row id 1,
  category=preference, semantic similarity 0.55, createdAt rendered as a sane
  2026 ISO date (ms timestamps confirmed end-to-end).
- webSearch probe: `webSearch` tool fired on gemini, returned live Tavily
  results; model answered with the current Next.js version from them.
- Failover: restart with `FORCE_DISABLE_PROVIDERS=gemini` → health showed
  gemini=down, **active=groq**. (The failover chat-turn stream capture was cut
  short: Yash ordered verification stopped mid-probe to keep momentum; the
  chain-resolution proof above is the recorded evidence. Re-run the streamed
  failover turn in the batched review pass.)
- Timestamp script run against the real DB: backup
  `data/backup-pre-ts-20260709.db` written; 0 legacy rows (fresh DB) — no-op
  path verified.
- `git status` clean of secrets; `.env.local` untouched/ignored.

## Deferred / for the batched review pass (Yash's instruction)

1. Streamed failover chat turn end-to-end capture (see above).
2. NVIDIA NIM live probe (`meta/llama-3.3-70b-instruct`) — wired per the
   confirmed pin but not individually probed (chain never had to fall past
   Groq during gates).
3. `fetchPage` (Firecrawl) live probe — code path identical to webSearch's
   pattern; not individually probed.
4. Ollama chat floor untested (llama3.2:3b still not pulled — optional).

## Environment notes (delta vs Phase 0)

- Groq: GROQ_API_KEY is present in `.env.local`, so Groq joined the chain as
  provider #2 (plan 2.1 order preserved otherwise).
- OpenRouter free-model landscape shifts; rotation list lives at the top of
  `lib/providers.ts` — refresh via https://openrouter.ai/api/v1/models
  (filter `:free` + `tools`) if models 404 later.
- Dev-server processes on Windows: kill via
  `Get-NetTCPConnection -LocalPort 3100` + `Stop-Process` (bash job control
  does not span tool calls).

## Phase 3 progress

**Chunk A — Theme engine: SHIPPED** (2026-07-10). `lib/theme-engine.ts`
(zustand store, canonical `CoreState`, idle drift + 240ms quintic snap to
state hues 213/75/195, 10Hz `--accent-live` writer, OKLCH->sRGB helper) +
`components/theme-engine-provider.tsx` (rAF loop, reduced-motion +
visibilitychange), mounted in `app/layout.tsx`; `app/page.tsx` dual-writes
`coreState` (old UI untouched). Gate: typecheck/build green; live-browser
check confirmed `--accent-live` drifting at idle, frozen at 213.00 under
forced reduced-motion, snapping to 75.00 within 300ms of a real chat send.
Commits `944aa1e`, `c2c0efe` (also tracked previously-uncommitted
`tasks/PHASE3_DESIGN.md`), pushed to `origin/jarvis-build`. Next: Chunk B
(stage + HUD restructure, `tasks/PHASE3_DESIGN.md` §7.2).

**Chunk B — Stage + HUD restructure: SHIPPED** (2026-07-10). Single-Canvas
WebGL stage (`components/scene/jarvis-stage.tsx`) with WebGL2/1 probe,
visibility + reduced-motion frameloop control, and a placeholder emissive
reactor; space environment (`environment.tsx`: dual starfields, fwidth
anti-aliased shader grid floor with radial fade + live-accent color, additive
dust); CSS poster fallback (`poster.tsx`) for <1024px and no-WebGL.
`app/page.tsx` rewritten to the chrome-less open composition (fixed z-0 stage +
`HudShell` above). `components/hud/`: `hud-shell.tsx` (collapsible 400px chat
dock + Ctrl+B, single summoned overlay, Alt+1..5 hotkeys, focus return),
`edge-rail.tsx` (five icons feed/notes/memory/skills/settings, shared by the
desktop vertical rail and <1024px bottom tab-bar), `panel-overlay.tsx` (glass
panel, focus trap, Esc/outside-click), `core-readout.tsx` (bottom state/health
caption + reactor-hover affordance). globals.css HUD glass utilities added;
status-bar container un-boxed; `theme-engine.ts` gained zero-alloc
`writeLiveAccentSrgb`; `core-stage.tsx` + `neural-core.tsx` deleted.
Gates: `pnpm typecheck` 0 errors, `pnpm build` green, dev server on :3100
returned HTTP 200. Live Playwright verification at 1536px confirmed full-bleed
space environment with NO boxed 3-column grid (glass + edge-fades only), chat
dock + 5 rail icons + core readout all present; at 820px the single-column +
bottom-tab-bar fallback with the dimmed CSS poster emblem renders correctly.
Commits `97e15af` (stage + environment + glass utils), `4958ce4` (HUD layout +
deletions), pushed to `origin/jarvis-build`. Next: Chunk C (Arc Reactor
assembly + bloom composer + camera re-centering, §7.3).

**Chunk B visual redesign: SHIPPED** (2026-07-11). Yash's "monochrome/boring/
dated" verdict resolved via a real Fable design review (model fable, design
skills invoked) of live screenshots, which returned 12 exact fixes — all
applied: `.hud-glass` rebuilt as gradient glass (cyan-to-indigo tint,
saturate(140%), specular top inset, tinted hairline, drop shadow) +
`.hud-glass-accent-edge` light-catch; violet `.hud-atmosphere` grade behind
the Canvas + recolored vignette/scrim; `--background` to oklch(0.13 0.018
255); starfield per-vertex temperature palette (ice/warm/violet), grid
uOpacity 0.14 + 4th-line major pass, dust 96/0.18/0.16, fog 0x0b0d14;
placeholder reactor dressed (smooth detail-4 core, additive halo sprite,
dark-metal torus, 12° tilt); gold micro-accents (wordmark `/`, readout `//`);
chat dock input capsule + filled live-accent SEND + tinted MIC/chips +
borderless messages; status-bar glowing dots, ghost settings, display-font
wordmark; edge-rail hover/active accent washes; panel overlay enter-slide-left
+ two-tone headers; feed rows borderless with hairlines. BUG FIXED during
this pass: `.hud-glass-accent-edge`/`.hud-edge-fade` utilities set
`position: relative`, overriding Tailwind's `fixed`/`absolute` (same
specificity, later in sheet) — overlay panels rendered bottom-LEFT clipped;
positioning declarations removed from both utilities, panels verified opening
on the right (Yash confirmed live). Gates: typecheck 0 errors, build green,
before/after screenshots captured. Next: Chunk C.

## Next Step

**Phase 2 — Design system: Arc Reactor identity** (`tasks/PLAN.md` §3):
globals.css rewrite (near-black #07090C, ice-cyan #38E1FF, hot-gold #FFB020,
--accent-live plumbing), Space Grotesk, motion utilities + reduced-motion
layer, contrast audit. Then Phase 3 (neural core + arc reactor + theme engine)
per Yash's batch instruction, with the combined review after.
