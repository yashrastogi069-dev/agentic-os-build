# JARVIS_BUILD_STATE.md

Cross-session resume contract. Read this (and `tasks/PLAN.md`, `tasks/lessons.md`)
before starting any new work on this project.

## Current Phase (updated 2026-07-10 ~21:05 IST)

**Phase 0, 1, 2 COMPLETE. Phase 3 Chunks A + B COMPLETE and pushed**
(commits through `cf476df`). Chunks C (Arc Reactor) and D (neural network +
choreography + perf) NOT YET STARTED.

**BLOCKED on Yash's Claude usage limit, resets ~1:12am IST 2026-07-10/11.**
The session is chaining hourly ScheduleWakeup check-ins until reset, then
resuming automatically. If you are a fresh session picking this up instead,
do the NEXT STEPS below in order.

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
