# tools/dictate

Local, offline push-to-talk dictation for Windows: hold a hotkey (default
Right-Ctrl), talk, release, and the transcript is pasted at the cursor in
whatever app is focused. Speech-to-text runs on-device via faster-whisper;
no audio ever leaves the machine. Adopted from the standalone prototype at
`Desktop/Whisper clone` (Phase 7 Chunk 0, repo adoption only).

## Setup

1. `python -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`
2. Copy `config.example.json` to `config.json` and adjust settings if needed
   (hotkey, model size, language). `config.json` is gitignored — it is a
   machine-local settings file and is never committed.
3. Run with `run.bat` (console window, shows transcripts) or `run_silent.bat`
   (no window, pythonw). Use `run_admin.bat` if dictation needs to reach an
   elevated window.

## Current state

This runs today as a standalone tool, exactly as it did in the original
prototype — LLM cleanup is a pass-through stub (`dictate/cleanup.py`), off by
default. Later Phase 7 chunks wire this into Jarvis proper via the
`app/api/system/*` route surface (cleanup, observe, command, notifications);
that wiring is not part of this chunk.
