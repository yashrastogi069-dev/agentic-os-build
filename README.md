# Agentic OS

A local-first personal AI operating system. Runs entirely on your machine: SQLite memory with semantic recall, an agent with tools, connectors for GitHub and Obsidian, a local voice loop, and an MCP server so Claude Code can watch and operate the OS.

Everything is free/open source. The only paid things are your own API keys (Groq has a free tier).

## Quick start

```bash
pnpm install
cp .env.example .env.local   # then fill in your keys (see below)
pnpm dev                     # http://localhost:3000
```

The SQLite database is created automatically at `data/agentic-os.db` on first run. The OS works immediately — services that aren't set up yet just show as offline in the status bar.

## Environment variables (.env.local)

| Variable | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | recommended | Chat + voice brain (free at console.groq.com) |
| `GITHUB_TOKEN` | optional | GitHub connector (classic PAT with `repo`, `notifications` scopes) |
| `OLLAMA_URL` | optional | Defaults to `http://127.0.0.1:11434` |
| `WHISPER_BIN` / `WHISPER_MODEL` / `PIPER_BIN` / `PIPER_VOICE` | optional | Override voice binary/model paths |

## Local services

### 1. Ollama (memory embeddings + offline chat fallback)

```bash
# install: https://ollama.com
ollama pull nomic-embed-text   # embeddings — required for semantic memory
ollama pull llama3.2:3b        # offline chat fallback — optional
```

Without Ollama the OS still runs; memory falls back to keyword search.

### 2. Voice stack (whisper.cpp + Piper)

```bash
./scripts/setup-voice.sh
```

Builds whisper.cpp (needs git, cmake, C++ compiler), downloads the tiny.en model (~75 MB), the Piper binary, and one voice (~60 MB) into `./bin` and `./models`. Then use the `mic` button in chat: record → local transcription → Groq answer → local speech.

### 3. Obsidian connector

1. Install the **Local REST API** community plugin in Obsidian.
2. In plugin settings, enable the **non-encrypted (HTTP) server** on port `27123` and copy the API key.
3. Paste the key in the OS: Settings tab → obsidian vault → save.
4. Click **index vault into memory** to make all notes semantically searchable.

Requires Obsidian running on the same machine.

### 4. GitHub connector

Add `GITHUB_TOKEN` to `.env.local` and restart. The agent can then read notifications, PRs, issues, and commits. Use **sync** in the feed panel to pull events.

## Skill Factory + Loop Engine

Turn repeated tasks into versioned, deployable skills (Skills tab, or tell the agent "save this as a skill").

- **Create**: name + description + step-by-step instructions. The agent can create skills from chat; Claude Code can create them via MCP (`create_skill`).
- **Run**: execute a skill with any input — runs via the OS brain (Groq/Ollama) and are logged to `skill_runs`.
- **Rate**: mark each run good/bad (with optional feedback) from the run history.
- **Refine**: once a skill has negative runs, click **refine** — the Loop Engine analyzes failures and proposes revised instructions. Apply to bump the version (v1 → v2 …).
- **Deploy**: enter `owner/repo` and click **deploy → github** — commits `.claude/skills/<name>/SKILL.md` (Claude Code-compatible format) via the Contents API using your `GITHUB_TOKEN`. Re-deploy anytime after refinements.

## Claude Code integration (MCP)

The OS is an MCP server at `http://localhost:3000/api/mcp`, exposing: `search_memory`, `save_memory`, `get_updates_feed`, `get_agent_status`, `list_skills`, `run_skill`, `create_skill`, and `get_skill_runs`.

1. Open Settings tab → claude code / mcp.
2. Click **copy claude setup command** and run it in your terminal:

```bash
claude mcp add --transport http agentic-os http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <your-key>"
```

Now Claude Code can query your memory, read the feed, and watch the OS when you ask it to. Rotate the key anytime from Settings.

## Architecture

```
app/
  api/chat            agent chat (streaming, tool loop)
  api/[transport]     MCP server (Claude Code)
  api/voice/*         local STT (whisper.cpp) + TTS (Piper)
  api/feed            unified connector events + sync
  api/memories        memory CRUD + semantic recall
  api/obsidian/*      vault indexing + notes browse/search/read
  api/skills/*        Skill Factory + Loop Engine (create/run/rate/refine/deploy)
  api/health          service probes for the status bar
lib/
  db/                 SQLite + sqlite-vec bootstrap
  memory.ts           chunking, embeddings, vector + keyword recall
  agent.ts            ToolLoopAgent (Groq default, Ollama fallback)
  skills.ts           Skill Factory + Loop Engine (SKILL.md export, GitHub deploy)
  connectors/         github.ts, obsidian.ts
  voice/              WAV recorder (client) + binary paths (server)
components/
  neural-core.tsx     3D neural network (drag to rotate, reacts to agent state)
```

## Roadmap (next phases)

- Telegram, Google Calendar/Gmail, Apple Calendar (CalDAV) connectors
- Usage-pattern discovery: automatic detection of repeated tasks from OS usage
- Cloudflare Tunnel + Access recipe for phone access
