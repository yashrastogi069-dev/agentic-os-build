# AGENTIC OS — Complete Handoff Document

A local-first personal AI operating system. Everything runs on your laptop: SQLite for memory, Ollama for embeddings, Groq for the brain, whisper.cpp + Piper for voice, and an MCP server so Claude Code can watch and operate the OS.

**This document is the complete map of the project** — every file, all the logic, all setup steps. The actual source code lives in the project itself; see "How to get this code onto your machine" at the bottom.

---

## 1. What was built (all phases complete)

| Phase | Feature | Status |
|---|---|---|
| 1 | SQLite + sqlite-vec data layer, memory engine with Ollama embeddings | Done |
| 1 | Agent chat (ToolLoopAgent: Groq default, Ollama fallback) | Done |
| 1 | MCP server for Claude Code (8 tools) | Done |
| 1 | Dark HUD command-center shell with honest service health dots | Done |
| 1 | Seed-data fallback with "DISCONNECTED · SEED DATA" badges | Done |
| 2 | GitHub connector (PAT) — repos, PRs, issues, notifications → feed | Done |
| 2 | Obsidian connector (Local REST API) — vault indexing into memory | Done |
| 2 | Obsidian notes panel — browse / search / read notes in the UI | Done |
| 2 | Unified events feed + "brief me" | Done |
| 3 | Voice loop: whisper.cpp STT → Groq → Piper TTS (all audio local) | Done |
| + | 3D neural core (React Three Fiber) — movable, reacts to agent state | Done |
| + | Skill Factory: create / run / rate skills, SKILL.md export | Done |
| + | Loop Engine: run logging, feedback, versioned refinement | Done |
| + | GitHub deploy: commits `.claude/skills/<name>/SKILL.md` to your repos | Done |

Deferred (listed in README roadmap): Telegram / Google / Apple connectors, usage-pattern auto-discovery, Cloudflare Tunnel recipe.

---

## 2. Complete file inventory and logic

### App shell

| File | What it does |
|---|---|
| `app/layout.tsx` | Root layout. Geist + Geist Mono fonts, `bg-background` on `<html>`, metadata ("Agentic OS"). |
| `app/globals.css` | Tailwind v4 theme. Dark HUD tokens: near-black background (`oklch(0.13 0.02 240)`), cyan primary, amber accent. **Important:** tokens are defined under `:root, .dark` so the shadcn dark-mode layer can't override them. Custom `--success`/`--warning` tokens, scanline + glow utility classes. |
| `app/page.tsx` | The dashboard. Left column: agent chat. Center: 3D neural core stage. Right column: tabbed panels (feed / notes / memory / skills / settings). Chat state drives the core animation via `onStateChange`. |

### Components

| File | Logic |
|---|---|
| `components/status-bar.tsx` | Polls `/api/health` via SWR (10s refresh). Renders a dot per service (db, ollama, groq, obsidian, github, whisper, piper): green = ok, gray = offline. Settings shortcut button. |
| `components/core-stage.tsx` | Client-only wrapper (`next/dynamic`, `ssr: false`) around the 3D canvas. Exports `CoreState = 'idle' \| 'listening' \| 'thinking' \| 'speaking'`. |
| `components/neural-core.tsx` | React Three Fiber scene. ~60 nodes on a fibonacci sphere, connected by distance-threshold edges. Nodes pulse, edges glow. Color/speed react to `CoreState`: cyan idle, green listening, amber fast-pulse thinking, blue speaking. OrbitControls = drag to rotate (the "movable" requirement). |
| `components/chat-panel.tsx` | `useChat` from `@ai-sdk/react` with `DefaultChatTransport` → `/api/chat`. Quick-action chips ("brief me", etc.). **Voice loop:** mic button → `WavRecorder` → POST `/api/voice/transcribe` → sends transcript as chat message with `voiceReplyPending` flag → when the reply finishes streaming, POSTs the text to `/api/voice/speak` and plays the returned WAV. Voice state drives the neural core. |
| `components/feed-panel.tsx` | SWR on `/api/feed` (60s refresh). "Sync" button POSTs to trigger connector pulls. Renders seed events with red "DISCONNECTED · SEED DATA" badge when `seeded: true` or fetch fails. |
| `components/notes-panel.tsx` | Obsidian vault browser: directory listing with up-navigation, full-text search with snippets, markdown note reader. Talks to `/api/obsidian/notes`. Honest disconnected state with setup hint. |
| `components/memory-panel.tsx` | Semantic search box → `/api/memories?q=...`. Lists memories with category/source/score. Seed fallback + badge like the feed. |
| `components/skills-panel.tsx` | The Skill Factory UI. List view (status chip, version, run health) → detail view (instructions, run-with-input, run history with thumbs up/down rating, refine button showing proposed diff, deploy-to-GitHub form, SKILL.md preview). Create form for new skills. |
| `components/settings-panel.tsx` | Connector config stored in SQLite via `/api/settings`: Obsidian (port + API key), GitHub (username), MCP key generate/revoke + copy-paste `claude mcp add` command, "index vault" button → `/api/obsidian/index`. |

### Library (all server logic)

| File | Logic |
|---|---|
| `lib/db/index.ts` | SQLite bootstrap at `data/agentic-os.db` (WAL mode). Loads sqlite-vec extension; sets `vecAvailable` flag. Idempotent DDL for all tables + `vec_memories` virtual table (768-dim). Connection cached on `globalThis` to survive HMR; `SCHEMA_VERSION` constant forces re-init when tables are added. |
| `lib/db/schema.ts` | Drizzle schema: `memories` (content, category, source, timestamps), `events` (source, title, payload JSON, external_id for dedupe), `connector_settings` (per-connector JSON config), `skills` (name, description, instructions, source_task, status, version, deployed_to), `skill_runs` (skill_id, version, input, output, rating -1/0/1, feedback). |
| `lib/memory.ts` | The memory engine. `saveMemory`: chunks text (~1200 chars, sentence-boundary), embeds each chunk via Ollama `nomic-embed-text`, stores vector in `vec_memories`. `recallMemory`: embeds query → sqlite-vec KNN (`vec_distance_cosine`) → falls back to FTS-style keyword LIKE scoring when Ollama or vec is unavailable. `listMemories`, `deleteMemory`. |
| `lib/ollama.ts` | Thin fetch client for `http://127.0.0.1:11434`: `embed()` (nomic-embed-text), `isOllamaUp()` probe, model listing. |
| `lib/agent.ts` | The brain. `runAgent`/`streamAgent` using AI SDK `ToolLoopAgent`. Model selection: Groq (`llama-3.3-70b-versatile` via `@ai-sdk/groq`) when `GROQ_API_KEY` is set, else Ollama `llama3.2:3b` via `@ai-sdk/openai-compatible`. Tools: memory (save/recall/list), feed (getUpdates, syncConnectors), skills (saveAsSkill, listSkills, runSkill), obsidian (searchNotes, readNote), github (repos, PRs, notifications). System prompt describes the OS and instructs the agent to offer skill-saving when it spots repeated tasks. |
| `lib/skills.ts` | Skill Factory + Loop Engine. `createSkill`, `listSkills`, `getSkill`, `runSkill` (executes instructions + input through the brain, logs to `skill_runs`), `rateRun` (thumbs + feedback), `skillHealth` (run count / success rate), `refineSkill` (feeds negative runs to the brain → proposed revised instructions → `applyRefinement` bumps version), `generateSkillMd` (Claude-compatible SKILL.md with frontmatter), `deploySkillToGithub` (GitHub Contents API PUT to `.claude/skills/<name>/SKILL.md`, records deploy target + SHA). |
| `lib/events.ts` | Unified feed store. `addEvent` (dedupes on `external_id`), `getRecentEvents` (optional source filter). |
| `lib/connectors/github.ts` | PAT-authenticated GitHub API client: recent repos, PRs, issues, notifications. `syncGithubToFeed()` maps them into events. Probe for the health bar. |
| `lib/connectors/obsidian.ts` | Local REST API client (`https://127.0.0.1:27123`, self-signed cert handled). List vault files, read note, search. `indexVaultToMemory()` walks all `.md` files → `saveMemory` per note. `syncObsidianToFeed()` records a daily vault snapshot event. |
| `lib/settings.ts` | Read/write per-connector JSON config in `connector_settings` (Obsidian port/key, GitHub username, MCP API key). |
| `lib/seed-data.ts` | Clearly `[seed]`-prefixed sample events and memories, shared by API fallbacks and client-side fetch-failure fallbacks. |
| `lib/voice/paths.ts` | Resolves `bin/whisper`, `bin/piper`, `models/*.bin`, `models/*.onnx` paths + existence checks for health probes. |
| `lib/voice/recorder.ts` | Browser `WavRecorder`: getUserMedia → AudioContext → 16kHz mono 16-bit PCM WAV blob (what whisper.cpp expects). |
| `lib/utils.ts` | `cn()` class-name helper (default). |

### API routes

| Route | Logic |
|---|---|
| `app/api/chat/route.ts` | POST — streams the agent's `UIMessage` response for `useChat`. |
| `app/api/[transport]/route.ts` | The MCP server (`mcp-handler`). Bearer-key auth against the stored MCP key. Tools: `search_memory`, `save_memory`, `get_updates_feed`, `get_agent_status`, `list_skills`, `run_skill`, `create_skill`, `get_skill_runs`. This is how Claude Code watches/operates the OS. |
| `app/api/health/route.ts` | Probes every service (db + vec, Ollama, Groq key, Obsidian, GitHub, whisper/piper binaries) → status bar JSON. |
| `app/api/memories/route.ts` | GET list/recall (seed fallback), POST save, DELETE. |
| `app/api/feed/route.ts` | GET recent events (seed fallback), POST triggers GitHub + Obsidian sync. |
| `app/api/obsidian/index/route.ts` | POST — index the whole vault into memory. |
| `app/api/obsidian/notes/route.ts` | GET — browse dirs / read note / search vault. |
| `app/api/settings/route.ts` | GET/POST connector settings, MCP key generation. |
| `app/api/skills/route.ts` | GET list (with health), POST create. |
| `app/api/skills/[id]/route.ts` | GET detail + runs + SKILL.md, POST actions: run, rate, refine, apply-refinement, deploy. |
| `app/api/voice/transcribe/route.ts` | POST WAV body → writes temp file → spawns `bin/whisper` (tiny.en) → returns transcript text. |
| `app/api/voice/speak/route.ts` | POST `{ text }` → spawns `bin/piper` → returns WAV audio. |

### Scripts and config

| File | Purpose |
|---|---|
| `scripts/setup-voice.sh` | Downloads/builds whisper.cpp + tiny.en model and Piper + voice model into `bin/` and `models/` (gitignored). |
| `next.config.mjs` | **Critical:** `serverExternalPackages: ["better-sqlite3", "sqlite-vec"]` — without this Turbopack bundles the native modules and sqlite-vec breaks. |
| `package.json` | Includes `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` so pnpm builds the native module. |
| `.env.example` | Template for your keys. |
| `.gitignore` | Excludes `data/` (DB), `bin/`, `models/` (voice binaries). |
| `README.md` | Full local setup guide. |

---

## 3. Dependencies (exact)

Runtime: `ai` v7, `@ai-sdk/groq`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`, `better-sqlite3`, `sqlite-vec`, `drizzle-orm`, `zod` v4, `mcp-handler` + `@modelcontextprotocol/sdk@1.26.0`, `swr`, `three` + `@react-three/fiber` + `@react-three/drei`, `next` 16, `react` 19.

Dev: `@types/better-sqlite3`, `@types/three`, `drizzle-kit`, `tailwindcss` v4, `typescript` 5.7.

---

## 4. Environment variables (`.env.local`)

```bash
# The brain (free tier at console.groq.com)
GROQ_API_KEY=gsk_...

# GitHub connector + skill deploy (classic PAT: repo + notifications scopes)
GITHUB_TOKEN=ghp_...

# Optional overrides
# OLLAMA_URL=http://127.0.0.1:11434
# OBSIDIAN_PORT=27123
```

Obsidian API key and MCP key are stored in the DB via the settings panel, not env vars.

---

## 5. Local setup (in order)

```bash
# 1. Get the code (see section 6), then:
cd agentic-os
pnpm install                        # builds better-sqlite3 native module

# 2. Ollama (memory embeddings + offline fallback brain)
#    install from https://ollama.com
ollama pull nomic-embed-text        # required for memory
ollama pull llama3.2:3b             # optional offline brain

# 3. Keys
cp .env.example .env.local          # then paste your GROQ_API_KEY, GITHUB_TOKEN

# 4. Voice (optional, ~10 min)
bash scripts/setup-voice.sh         # builds whisper.cpp + downloads Piper

# 5. Obsidian (optional)
#    Install the "Local REST API" community plugin in Obsidian,
#    copy its API key into Settings tab -> Obsidian, then "index vault".

# 6. Run
pnpm dev                            # http://localhost:3000
```

Every status dot in the top bar turns green as each service comes online. Nothing lies: gray = actually offline.

## Claude Code hookup

In the OS: Settings tab → generate MCP key → copy the command shown:

```bash
claude mcp add agentic-os http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <your-key>"
```

Claude Code can then search/save memory, read your feed, list/run/create skills, and inspect skill run history.

---

## 6. How to get this code onto your machine

You do not need to copy-paste files manually — the v0 UI exports the entire project:

**Option A — Download ZIP (fastest)**
1. Click the **three dots (⋯)** in the top-right of the Block/Preview view in v0.
2. Select **"Download ZIP"**.
3. Unzip anywhere on your laptop → `cd` into it → follow section 5 above.

**Option B — Push to GitHub (best for ongoing work)**
1. Click the **settings/gear button** (top right) → **Git** section.
2. Connect a GitHub repository — v0 pushes all project files to your repo branch.
3. `git clone` it on your laptop → follow section 5.

**Option C — shadcn CLI**
Use the shadcn CLI command from the same three-dots menu to scaffold the project into an existing directory.

All three include every file listed in section 2 (source, configs, scripts, README, this handoff). The gitignored `data/`, `bin/`, `models/` directories are created on your machine by running the app and the voice setup script.

---

## 7. Sanity checklist after local install

- `curl localhost:3000/api/health` → `db: { ok: true, vec: true }` and `ollama: true`
- Chat: "remember that I prefer dark mode" → memory tab shows it (no seed badge)
- Chat: "brief me" → agent pulls the feed
- Skills tab → create a skill → run it → rate it → refine after a thumbs-down → deploy to a repo
- Mic button: speak → transcript appears → reply is spoken back
- Neural core: drag it; watch it change color while the agent thinks
