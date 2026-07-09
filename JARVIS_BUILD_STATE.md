# JARVIS_BUILD_STATE.md

Cross-session resume contract. Read this (and `tasks/PLAN.md`, `tasks/lessons.md`)
before starting any new work on this project.

## Current Phase

**Phase 0 — Foundation & hygiene: COMPLETE.** All gates pass (see below).

Next executor should start Phase 1 (Brain rewire + research chain) per
`tasks/PLAN.md` section 3.

## Phase Gate Results (actual command output, 2026-07-08)

- `pnpm typecheck` (`tsc --noEmit`, with `ignoreBuildErrors` removed from
  `next.config.mjs`): **exit 0**, no errors.
- `pnpm build` (Turbopack): **succeeded**. No workspace-root warning (fixed by
  `turbopack: { root: import.meta.dirname }`). Route manifest generated
  cleanly (`/`, `/api/*` all present, `(app)` static + 15 dynamic API routes).
- Dev server on port 3100 (`node_modules/.bin/next dev -p 3100`): ready in
  2.4s. `curl -s localhost:3100/api/health` returned:
  ```json
  {
    "db": { "ok": true, "vec": true, "memories": { "total": 0, "byCategory": {} } },
    "ollama": {
      "ok": true,
      "embeddingModel": { "name": "nomic-embed-text", "pulled": true },
      "chatModel": { "name": "llama3.2:3b", "pulled": false }
    },
    "groq": { "configured": false },
    "github": { "configured": false },
    "chat": { "brain": "groq", "groqModel": "llama-3.3-70b-versatile" }
  }
  ```
  `db.ok=true`, `db.vec=true`, `ollama.ok=true` — all Phase 0 gate criteria met.
  Server was killed after the check (PIDs for `next dev -p 3100` terminated,
  confirmed via a follow-up `curl` connection-refused).
- `git status`: only intended files touched (`.env.example`, `.gitignore`,
  `app/layout.tsx`, `next.config.mjs`, `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `tsconfig.tsbuildinfo` deletion, `tasks/` new).
  `.env.local` confirmed absent from `git status` and from `git diff`
  (verified gitignored via `git check-ignore -v .env.local` →
  `.gitignore:10:.env*.local`).

## Task Checklist (plan section 3, Phase 0)

1. `.env.local` provisioned from `C:\Users\win 10\Desktop\keys.evn` — Gemini,
   OpenRouter, NVIDIA, Tavily, Serper (trimmed), Firecrawl keys mapped in;
   Supabase and Scrapegraph keys deliberately excluded; `GITHUB_TOKEN` left
   empty with a comment. `.env.example` updated with the same variable names
   (no values). File confirmed gitignored, never printed.
2. `package.json`: `name` → `jarvis`; added `"typecheck": "tsc --noEmit"`;
   removed `@vercel/analytics` dependency and its import + `<Analytics />`
   usage in `app/layout.tsx`; removed the dead `pnpm.overrides` /
   `onlyBuiltDependencies` field (pnpm 11 ignores it; already superseded by
   `pnpm-workspace.yaml`). `shadcn` dependency **kept** — `app/globals.css:3`
   has `@import 'shadcn/tailwind.css';`, confirming it is a real runtime
   import, not just the CLI, so removing it would break the build.
3. `pnpm-workspace.yaml`: restored the dropped `overrides: { hono: 4.12.25 }`
   pin. `pnpm install` run; verified only one `hono@4.12.25` entry resolves
   anywhere in `pnpm-lock.yaml` (checked `@hono/node-server` and `mcp-handler`
   transitive deps too — all pin to `4.12.25`, confirmed via
   `node_modules/.pnpm/hono@4.12.25`).
4. `next.config.mjs`: removed `typescript.ignoreBuildErrors` entirely; added
   `turbopack: { root: import.meta.dirname }` per
   `node_modules/next/dist/docs/.../turbopack.md` (`root` is the documented
   key for manually setting the Turbopack project root; the workspace-root
   auto-detection warning is now gone from `pnpm build` output).
5. `.gitignore`: added `next-env.d.ts` and `tsconfig.tsbuildinfo`.
   `git rm --cached tsconfig.tsbuildinfo` run (was tracked, ~500KB build
   artifact; now untracked and ignored). `next-env.d.ts` was already
   untracked, now also explicitly ignored going forward.
6. Ollama: see Environment Notes below — installed via winget, running,
   `nomic-embed-text` pulled successfully.

## Blockers

None outstanding for Phase 0. Carried into Phase 1 (not blockers, just scope):

- `GITHUB_TOKEN` is empty — GitHub connector and skill deploy will throw
  until a classic PAT (repo + notifications scopes) is added to `.env.local`
  by Yash. Documented, not fixed here (out of Phase 0 scope; env plumbing
  only, no code changes to the connector).
- `chatModel` (`llama3.2:3b`) not pulled — optional per the plan ("Ollama +
  nomic-embed-text (+ llama3.2:3b optional)"). Skipped to keep Phase 0 tight;
  the keyword fallback and the Phase 1 provider chain (Gemini → OpenRouter →
  NVIDIA → Ollama) do not require the local chat model for correctness. Pull
  it later with `ollama pull llama3.2:3b` if a Phase 6 voice-latency test
  wants a local option.
- `GROQ_API_KEY` still empty in `.env.local` — current brain
  (`lib/agent.ts:20-33`) is Groq → Ollama chat, so chat is still dead until
  Phase 1's provider rewire lands. This is the documented P0 item #1 in the
  plan, explicitly deferred to Phase 1.

## Next Step

**Phase 1 — Brain rewire + research chain** (Opus xhigh), per
`tasks/PLAN.md` section 3:
- New `lib/providers.ts` failsafe chain: Gemini 2.5 Flash → OpenRouter free
  models → NVIDIA NIM → Ollama local. Keys for the first three are now live
  in `.env.local` from this Phase 0 run.
- Rewrite `getChatModel()`, add settings brain picker + provider status.
- Harden `/api/chat` (body validation, try/catch, message-history cap).
- Fix `lib/skills.ts:271` missing `.where()` clause.
- Timestamp normalization (ms vs seconds) — backup DB first.
- Add research tools (`webSearch` via Tavily → Serper, `fetchPage` via
  Firecrawl) to the agent toolset — keys are live in `.env.local`.
- Update `.env.example` further if new variable names are introduced.
- GATE: streaming tool-calling chat demonstrated end-to-end ("remember X" →
  memory row written); kill primary key → visible failover to next provider;
  `webSearch` live; typecheck/build stay green.

Report back to Fable for advisory review after Phase 1 completes, per the
plan's per-phase checkpoint rule.

## Environment Notes

- **Ollama**: was absent at session start (`ollama --version` → command not
  found; no `C:\Users\win 10\AppData\Local\Programs\Ollama\ollama.exe`).
  Installed via `winget install --id Ollama.Ollama --accept-source-agreements
  --accept-package-agreements --silent` — succeeded (`Successfully installed`,
  version 0.31.1). The installed tray app (`ollama app.exe`) did not bring up
  the API server cleanly on first launch (log rotation lock error, "timed out
  waiting for server to start" on `ollama pull`); resolved by killing the
  stuck tray/setup processes and starting the server directly with
  `ollama.exe serve`, which came up clean and logged
  `Listening on 127.0.0.1:11434`. `ollama pull nomic-embed-text` succeeded
  (274 MB). `/api/health` confirms `ollama.ok=true` and the embedding model
  `pulled=true`. **Action for Yash**: on future machine restarts, if the
  status bar shows Ollama offline, check whether `ollama app.exe` auto-starts
  the server; if not, run `ollama serve` manually or investigate the log
  rotation lock (`C:\Users\win 10\AppData\Local\Ollama\app.log` /
  `app-1.log` contention) — likely a leftover handle from the installer's own
  process, not expected to recur on a clean boot.
- **GITHUB_TOKEN**: intentionally left empty in both `.env.local` and
  `.env.example`, with a comment directing Yash to add a classic PAT with
  `repo` + `notifications` scopes when he wants the GitHub connector /
  skill-deploy tools live.
- **pnpm path**: `pnpm` (11.10.0) resolves on PATH in both Git Bash and
  PowerShell in this environment; no need for the full
  `C:\Users\win 10\AppData\Roaming\npm\pnpm` path during this session.
- **Secrets discipline**: `keys.evn` was read once to source values; no key
  value was echoed to any command output, commit message, or tracked file
  during this session. `.env.local` is confirmed gitignored via
  `git check-ignore -v .env.local`.
- **KeysJarvis.env**: an untracked `KeysJarvis.env` file appeared at the repo
  root mid-run (not created by this executor; contents never read or
  printed). It was NOT covered by the `.env*.local` gitignore pattern, so it
  was added to `.gitignore` explicitly to guarantee it can never be staged.
  If it duplicates `keys.evn`, consider deleting it from the repo folder and
  keeping secrets only in `Desktop\keys.evn` and `.env.local`.
- **tasks/ directory**: `tasks/PLAN.md` (approved master plan) and
  `tasks/lessons.md` (self-improvement log) were present on disk but
  untracked at session start. Committed in this run's docs commit as
  legitimate project documentation needed for cross-session continuity — no
  secrets in either file (verified by reading both in full before staging).
