# tools/dictate

Local, offline push-to-talk dictation for Windows: hold a hotkey (default
Right-Ctrl), talk, release, and the transcript is pasted at the cursor in
whatever app is focused. Speech-to-text runs on-device via faster-whisper;
no audio ever leaves the machine. Adopted from the standalone prototype at
`Desktop/Whisper clone` (Phase 7 Chunk 0, repo adoption only).

A second hotkey (default F8) is "ask Jarvis anywhere": hold it, ask a
question, release, and the same on-device transcription is sent to Jarvis's
`/api/system/command` for one full agent turn, with the answer shown as a
Windows toast notification.

## Setup

1. `python -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`
2. Copy `config.example.json` to `config.json` and adjust settings if needed
   (hotkey, ask_hotkey, model size, language). `config.json` is gitignored —
   it is a machine-local settings file and is never committed.
3. Run with `run.bat` (console window, shows transcripts) or `run_silent.bat`
   (no window, pythonw). Use `run_admin.bat` if dictation needs to reach an
   elevated window.

## Current state

This runs as a standalone tool by default (works fully with Jarvis switched
off) but now talks to Jarvis's local `app/api/system/*` surface when
`jarvis_url`/`jarvis_token` are set in `config.json`:

- **Cleanup** (`dictate/cleanup.py`, opt-in via `llm_cleanup_enabled`): posts
  the raw transcript to `POST {jarvis_url}/api/system/cleanup` for
  punctuation/casing/filler cleanup, and pastes the cleaned text instead.
- **Observe** (`dictate/main.py` + `dictate/winfocus.py`): a best-effort,
  fire-and-forget `POST {jarvis_url}/api/system/observe` with the transcript
  and the foreground window title/process captured at the moment recording
  started, so Jarvis's feed knows what you were dictating into.
- **Tray icon** (`dictate/tray.py`, requires `pystray` + `Pillow`): a minimal
  system tray icon confirms the tool is running, with a right-click Quit that
  stops the hotkey listener and exits cleanly.
- **Ask Jarvis anywhere** (`dictate/main.py` + `dictate/toast.py`, hotkey
  `ask_hotkey`, default F8): hold it, speak a question, release. The
  transcript is POSTed to `POST {jarvis_url}/api/system/command` for one
  full, tool-capable agent turn (no conversation/session threading — this is
  a one-shot ask, by design). The reply is shown as a Windows toast via
  pystray's `Icon.notify()` (already a dependency, no new notification
  library added). If Jarvis is unreachable, unconfigured, or answers with
  nothing, the toast says so honestly instead of staying silent or faking an
  answer.

Both HTTP calls fail open: if Jarvis isn't running, the token is wrong, the
call times out, or `jarvis_url`/`jarvis_token` are simply unset, dictation
still works with the raw transcript — cleanup/observe never block or break
the paste. `dictate/jarvis_client.py` holds the shared request/fallback logic.
Proactive-notification wiring (reminders/events pushed unprompted) is a later
Phase 7 chunk, not part of this one.
