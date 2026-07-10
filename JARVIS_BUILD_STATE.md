# JARVIS_BUILD_STATE.md

Cross-session resume contract. Read this (and `tasks/PLAN.md`, `tasks/lessons.md`)
before starting any new work on this project.

## Current Phase

**Phase 1 — Brain rewire + research chain: COMPLETE** (2026-07-09).
Next executor starts **Phase 2 — Design system: Arc Reactor identity** per
`tasks/PLAN.md` section 3. Yash's standing instruction (2026-07-09): run the
next phases back-to-back with Opus (high) executors and batch the deep
review/verification passes after 2-3 phases instead of per-phase.

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

## Next Step

**Phase 2 — Design system: Arc Reactor identity** (`tasks/PLAN.md` §3):
globals.css rewrite (near-black #07090C, ice-cyan #38E1FF, hot-gold #FFB020,
--accent-live plumbing), Space Grotesk, motion utilities + reduced-motion
layer, contrast audit. Then Phase 3 (neural core + arc reactor + theme engine)
per Yash's batch instruction, with the combined review after.
