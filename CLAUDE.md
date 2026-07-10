# Jarvis — session bootstrap

Read in this order before doing any work on this project:

1. **HANDOFF.md** — complete current-state map: what's built, what's mid-flight,
   what's next. The single source of truth for "where are we right now."
2. **JARVIS_BUILD_STATE.md** — cross-session resume contract. Exact phase/chunk
   status, next steps in order, any hold points awaiting Yash's approval.
   Update it after every meaningful chunk of work.
3. **tasks/PLAN.md** — the full phased build plan (Fable-authored, Yash-approved).
   Architecture decisions, bug/debt list, phase sequencing.
4. **tasks/PHASE3_DESIGN.md** — Fable's authoritative visual/technical spec for
   the 3D stage (Arc Reactor + neural network + theme engine). Read before
   touching any `components/scene/*` or `components/hud/*` file.
5. **tasks/lessons.md** — self-improvement log. Every correction from Yash is
   recorded here as a standing rule. Read ALL of it, not just the latest
   entries — early rules still apply.

## Non-negotiable rules (do not re-litigate)

- **Branch: `jarvis-build` only.** Never switch to `main`/`master` or the
  original `v0/...` export branch. Never force-push.
- **Model routing:** Fable = planner/advisor + most important design/review
  work, always reviewed by Yash before executors act on it. Opus = complex
  execution. Sonnet = standard execution. Haiku = all small work (doc/md
  updates, renames, small read/write chores) — never burn Opus/Sonnet budget
  on those. Phases 3 and 6 (the hardest visual/voice work) run Opus at
  **xhigh effort with no compromise** — pin `model: 'opus'` explicitly in
  any Workflow script; never rely on session-model inheritance.
- **Never print, log, or commit secret values.** `.env.local` is gitignored
  and must stay that way. Read variable *names* from it when needed, never
  values.
- **Functional gates are not a design gate.** typecheck/build/DOM-check
  passing does not mean a visual phase is done — get real screenshots and a
  Fable design-skill review (impeccable, ui-ux-pro-max, emilkowal-animations,
  taste) before declaring any UI phase complete. See lessons.md item 11a.
- **Verification before "done."** Every phase ships with real evidence: exact
  commands run, actual output, not assumed results.
- **Batch deep-review passes** after 2-3 phases instead of per-phase, to keep
  momentum — but never skip real verification entirely.
- **Hold points.** Some phases end with an explicit stop for Yash's approval
  before continuing (currently: after Phase 3 Chunk D). Check
  JARVIS_BUILD_STATE.md for the current hold status before auto-advancing.
- **Ask, don't assume,** when a requirement is ambiguous — Yash's standing
  instruction across this whole build.

## Environment notes

- Windows 11, Node 24, pnpm 11.10 at
  `C:\Users\win 10\AppData\Roaming\npm\pnpm` (not on default PATH in some
  shells — use the full path or prepend it).
- Dev server: `node_modules/.bin/next dev -p 3100` (port 3100, not the
  default 3000). Kill stale listeners first:
  `powershell -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"`
- First Turbopack compile of `/` (the 3D stage route) is slow — 8s+ cold,
  instant warm. Do not treat a slow-but-successful first compile as a bug.
  If a compile hangs indefinitely (not just slow), the Turbopack cache is
  likely corrupted from a prior force-killed process — delete `.next` and
  retry before assuming a code bug.
- Ollama runs locally (0.31.1) with `nomic-embed-text` pulled — required for
  memory embeddings. `llama3.2:3b` optional, not pulled.
- Brain provider chain (see `lib/providers.ts`): Gemini → Groq → OpenRouter
  free → NVIDIA → Ollama, with live failover and a status indicator.
