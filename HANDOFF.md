# JARVIS — Handoff Document

Status as of **2026-07-11, ~04:25 IST**. This is the authoritative "where are
we right now" map. For the forward plan see `tasks/PLAN.md` and
`tasks/PHASE3_DESIGN.md`; for the standing rules see `CLAUDE.md` and
`tasks/lessons.md`.

**Project:** a local-first personal AI operating system — "Jarvis." SQLite +
sqlite-vec for memory, a multi-provider AI brain (no single-vendor lock-in),
Ollama for embeddings, an MCP server so Claude Code can watch/operate the OS,
and a from-scratch redesign into a real Iron-Man-style HUD: an open 3D stage
with an interactive Arc Reactor and a color-driving neural network, replacing
the original v0-generated boxed 3-column layout.

**Origin:** cloned from a v0.dev export
(`github.com/yashrastogi069-dev/agentic-os-build`, branch
`v0/yashrastogi069-6856-5f5f7ef9`) into `Desktop/Jarvis`, now developed on a
fresh branch **`jarvis-build`** — the only branch this project uses.

---

## 1. What's fully built and working

### Foundation (Phase 0)
- Env provisioned (`.env.local`, gitignored): Gemini, Groq, OpenRouter,
  NVIDIA, Tavily, Serper, Firecrawl keys live. `GITHUB_TOKEN` intentionally
  empty (add a classic PAT to enable the GitHub connector).
- `package.json` cleaned (renamed `jarvis`, dead fields removed,
  `@vercel/analytics` removed — this is a local-first OS, not hosted).
- `next.config.mjs`: `ignoreBuildErrors` removed (typecheck is genuinely
  clean), `turbopack.root` set.
- `pnpm-workspace.yaml`: `hono@4.12.25` override restored (CVE pin for
  `mcp-handler`), `onlyBuiltDependencies` correct.
- Ollama installed (0.31.1) and running locally with `nomic-embed-text`
  pulled.

### Brain rewire (Phase 1)
- **`lib/providers.ts`** — failsafe chain: **Gemini 2.5 Flash → Groq Llama
  3.3 70B → OpenRouter free rotation → NVIDIA NIM → Ollama local**.
  Per-provider cooldowns on 429/5xx, `FORCE_DISABLE_PROVIDERS` test hook,
  live status surfaced via `/api/health` and the status bar (`brain: <id>`).
  Verified live: chat streams from Gemini, memory-save tool call round-trips
  end-to-end, `webSearch` (Tavily→Serper) returns live results, failover to
  Groq confirmed when Gemini is disabled.
- **`lib/research.ts`** — `webSearch` + `fetchPage` (Firecrawl) added to the
  agent's toolset, graceful degradation on failure.
- Data correctness fixes: all timestamps unified to milliseconds
  (`scripts/normalize-timestamps.mjs`, idempotent, backs up the DB first);
  the `lib/skills.ts` analyzed-flag update bug (missing `.where()`, was
  marking unrelated rows) fixed.
- `app/api/chat` hardened: zod validation, 50-message history cap, honest
  error responses instead of unhandled 500s.

### Design system (Phase 2)
- `app/globals.css` rewritten to the **Arc Reactor OKLCH palette**:
  near-black `#07090C`-family base, ice-cyan `#38E1FF` primary, hot-gold
  accent, a `--accent-live` CSS variable contract that Phase 3's theme
  engine now drives in real time (`--ring`, `.glow-primary`, `.text-glow`
  all derive from it).
- Space Grotesk added as the display font (`next/font/google`), Geist Mono
  kept for data/HUD readouts.
- Motion token layer (`--ease-out-expo`, `--ease-out-quint`, duration
  scale) with mandatory `prefers-reduced-motion` overrides on every
  keyframe utility.
- Contrast-verified (`scripts/verify-contrast.mjs`).

### Existing connectors (pre-dated this build, confirmed present and honest)
GitHub (PAT), Obsidian (Local REST API, vault indexing + browsing), Telegram
(bot long-poll), Google (OAuth + Gmail/Calendar, read-only), Apple (iCloud
CalDAV). All feed into the unified events feed with real
"DISCONNECTED · SEED DATA" fallback badges when not configured — no fake
data pretending to be live. **Not yet deep-audited or extended in this
build** — that's Phase 5.

### Skill Factory (pre-dated this build, confirmed present)
Create/run/rate/refine skills, versioned refinement loop, SKILL.md export,
GitHub deploy-to-repo. Usage-observation loop (`agent_runs` table,
`/api/skills/discover`) already exists for auto-suggesting skills from
behavior. **Not yet used for the big "mine 93 Claude session transcripts"
task** — that's Phase 8, hasn't started.

---

## 2. Phase 3 — "The Stage": in progress, THIS is the current focus

The big visual transformation: killing the old boxed 3-column grid entirely
and replacing it with a full-viewport 3D scene (space environment, an
interactive Arc Reactor, a color-driving neural network) with the
functional UI floating over it as open glass HUD panels — no dividing
lines. Full design spec: **`tasks/PHASE3_DESIGN.md`** (Fable-authored,
Yash-approved, read it before touching scene/HUD code).

Built as 4 sequential chunks, each independently gated (typecheck, build,
live verification) and committed:

| Chunk | Status | What it is |
|---|---|---|
| **A — Theme engine** | ✅ DONE, committed (`944aa1e`), pushed | `lib/theme-engine.ts` (zustand store), `components/theme-engine-provider.tsx` (rAF drift/snap loop), `--accent-live` writer. Live-verified: idle hue drifts continuously, snaps to state color on a real chat turn, freezes correctly under reduced-motion emulation. |
| **B — Stage + HUD restructure** | ✅ DONE, committed (`97e15af`, `4958ce4`), pushed | `components/scene/jarvis-stage.tsx` (WebGL Canvas, space environment, placeholder reactor), `environment.tsx` (starfield/grid/dust), `poster.tsx` (no-WebGL/mobile CSS fallback), `components/hud/*` (hud-shell, edge-rail, panel-overlay, core-readout — the open glass layout), `app/page.tsx` fully rewritten, old `core-stage.tsx`/`neural-core.tsx` deleted. Live-verified via Playwright: full-bleed space environment, glass chat dock, edge rail with all 5 panel icons, `<1024px` responsive fallback, zero console errors, zero boxed borders. **However: see the open issue below — this passed every functional gate but Yash's live visual judgment is that it looks monochrome and dated, not futuristic.** |
| **C — Arc Reactor** | ⏳ NOT STARTED | Full ring-assembly geometry (coil/mid/outer rings + precessing gyro rings, per `PHASE3_DESIGN.md` §2.2 — the *original* Fable design; a literal "exact Iron Man triangle" version was explored and explicitly reverted by Yash), bloom post-processing, click/hover-to-talk mic wiring. **Hard rule: Opus at xhigh effort only, no compromise** (pin `model:'opus'` explicitly — session-model inheritance caused a near-miss once already). |
| **D — Neural network + choreography + perf** | ⏳ NOT STARTED | The lattice (140+24 instanced nodes, edge pulses), the full per-agent-state animation table (idle/listening/thinking/speaking — colors, rates, light intensity), the performance governor (auto quality-drop below 40fps), final reduced-motion/tab-hidden correctness. Same Opus-xhigh no-compromise rule. |

### Open issue blocking Chunk C/D start: Chunk B visual quality

Yash's direct feedback after seeing Chunk B live: *"the hub has one colour
only, it does not look futuristic/modern, the theme is very boring and
old."* This is a real, unresolved problem — Chunk B is functionally
correct but fails on taste. Working hypothesis (see `lessons.md` item 11a):
the `.hud-glass` panels are likely too uniformly dark/desaturated at rest,
so the Arc Reactor palette only reads through the 3D canvas and never
reaches the HUD chrome itself.

**This must be fixed FIRST, before Chunk C or D starts.** The required
process (already written into `JARVIS_BUILD_STATE.md`'s NEXT STEPS):
1. Start the dev server, take real screenshots.
2. Run a genuine Fable design review of those screenshots — model `fable`,
   high effort — explicitly invoking the `impeccable`, `ui-ux-pro-max`,
   `emilkowal-animations`, and taste design skills, asking pointedly: does
   this read as futuristic/modern/vibrant, or monochrome/boring/dated?
3. Get concrete, specific fixes (exact color/opacity/gradient/accent
   changes, not vague direction).
4. Apply them, re-screenshot, confirm the improvement.

Only after that redesign is confirmed does Chunk C begin.

### Yash's standing instructions for the rest of Phase 3

- **Use Fable more actively on Chunks C and D** — not just as an emergency
  contact for design ambiguities, but a real pre-flight design-refinement
  pass before each chunk's executor builds, and a real advisory screenshot
  review after each chunk completes.
- **Hold point:** once the B redesign + Chunks C and D are all done,
  **stop and wait for Yash's explicit approval** before starting Phase 4 or
  anything further. Do not auto-advance past this checkpoint.

---

## 3. What's next after Phase 3 (approval-gated, not started)

Per `tasks/PLAN.md`'s phase plan — unchanged in substance, only Phase 3 has
been elaborated/re-scoped:

- **Phase 4** — Shell & panels redesign: restyle every panel to the new
  system, **migrate all icons from lucide-react to Phosphor**
  (`@phosphor-icons/react`, thin/duotone — Yash's explicit call, overriding
  Fable's "keep lucide" recommendation), registry-driven status dots
  covering all connectors including the newer ones.
- **Phase 5** — Connector framework refactor + Google/Telegram/local-system
  depth: a proper `{id, probe(), sync(), tools}` registry, OAuth CSRF fix
  (missing `state` param), a new local-system connector (filesystem watch,
  no external keys), deeper Obsidian (daily-note append, auto-index).
- **Phase 6** — Voice, mode 1: the in-OS Jarvis you talk to. Streaming
  `mic → VAD → whisper.cpp STT → brain → sentence-chunked TTS → speaker`
  with barge-in. Runs via Workflow at Opus xhigh (same no-compromise rule
  as Phase 3). Windows-specific setup script needed (prebuilt whisper.cpp +
  Piper binaries — the repo's existing `setup-voice.sh` is bash-only and
  will not work as-is on Windows).
- **Phase 7** — Voice, mode 2: a separate WhisperFlow-style global-dictation
  utility (Python, system-wide hotkey, works in any Windows app — this is
  necessarily a companion tool outside the Next.js app, browsers can't do
  system-wide text injection).
- **Phase 8** — Skill mining: fan out subagents across all ~93 Claude Code
  session transcripts on this machine (`~/.claude/projects/**/*.jsonl`,
  privacy-guarded extraction — never copy secrets/tokens verbatim), 
  synthesize into ranked skill proposals, get Yash's sign-off, create the
  approved ones in the Skill Factory.
- **Phase 9** — Harden & ship: full regression pass, rewrite this document
  and the README to match final reality, draft PR `jarvis-build → main`.

---

## 4. Known environment gotchas (don't rediscover these)

- **pnpm** is at `C:\Users\win 10\AppData\Roaming\npm\pnpm`, not
  necessarily on PATH in every shell — use the full path or prepend it.
- **Turbopack cache corruption**: repeatedly force-killing a dev server
  mid-compile can corrupt `.next`, causing every subsequent compile of `/`
  to hang indefinitely (not just slow). If a compile hangs past ~2 minutes
  with no progress in the log, delete `.next` and retry before assuming a
  code bug — this already happened once and wasted real debugging time.
- **First compile of `/` is genuinely slow** (8s+ cold) because it's the
  heaviest route (three.js/@react-three/fiber). This is normal, not a bug.
- **Dev server runs on port 3100**, not the Next.js default 3000, to avoid
  clashing with other local projects.
- **Windows paths with spaces** (`win 10`): always use `spawn` without
  `shell:true` in any code that shells out (voice binaries especially).
- **Workflow `agent()` calls default to inheriting the session's current
  model** — if you toggle `/model` mid-session, already-queued-but-not-yet-run
  Workflow chunks can silently pick up the wrong model. Always pin
  `model: 'opus'` explicitly for anything under the "no compromise" rule.

---

## 5. File map (current, not the stale original)

Key files added/changed by this build beyond the original v0 export:

```
CLAUDE.md                          session bootstrap + standing rules
HANDOFF.md                         this file
JARVIS_BUILD_STATE.md              cross-session resume contract (phase/chunk status)
tasks/PLAN.md                      Fable's master build plan
tasks/PHASE3_DESIGN.md             Fable's Phase 3 visual/technical spec
tasks/lessons.md                   self-improvement log (every Yash correction)

lib/providers.ts                   brain failsafe chain
lib/research.ts                    webSearch / fetchPage agent tools
lib/theme-engine.ts                zustand store driving the live OS accent color
scripts/normalize-timestamps.mjs   one-time DB timestamp migration
scripts/verify-contrast.mjs        Phase 2 contrast audit

components/theme-engine-provider.tsx
components/scene/jarvis-stage.tsx  the single WebGL canvas (env + reactor + network)
components/scene/environment.tsx   starfield / grid floor / dust
components/scene/poster.tsx        no-WebGL / mobile CSS fallback
components/scene/arc-reactor.tsx   NOT YET BUILT (Chunk C)
components/scene/neural-network.tsx NOT YET BUILT (Chunk D)
components/hud/hud-shell.tsx       layout orchestrator (chat dock, hotkeys)
components/hud/edge-rail.tsx       5-icon panel-summon rail
components/hud/panel-overlay.tsx   summonable glass panel
components/hud/core-readout.tsx    bottom state/health caption

components/core-stage.tsx          DELETED (superseded by scene/*)
components/neural-core.tsx         DELETED (superseded by scene/*)
```

Everything else (API routes, connectors, memory engine, skill factory,
MCP server) is the pre-existing build, functionally intact and not yet
touched by the redesign except where noted above.
