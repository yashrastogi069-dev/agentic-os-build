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

## Claude Code integration (MCP)

The OS is an MCP server at `http://localhost:3000/api/mcp`, exposing tools like `get_updates_feed`, `search_memory`, `save_memory`, and `get_status`.

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
  api/obsidian/index  vault -> memory indexing
  api/health          service probes for the status bar
lib/
  db/                 SQLite + sqlite-vec bootstrap
  memory.ts           chunking, embeddings, vector + keyword recall
  agent.ts            ToolLoopAgent (Groq default, Ollama fallback)
  connectors/         github.ts, obsidian.ts
  voice/              WAV recorder (client) + binary paths (server)
```

## Roadmap (next phases)

- 3D neural core (React Three Fiber) reacting to agent state
- Telegram, Google Calendar/Gmail, Apple Calendar (CalDAV) connectors
- Skill Factory: interview-driven discovery of repeated tasks → SKILL.md generation → GitHub deploy
- Loop Engine: run scoring, versioned skill refinement, continuous discovery
