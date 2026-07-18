"""LLM cleanup stage -- POSTs the dictated transcript to Jarvis's
`/api/system/cleanup` for punctuation/casing/filler-word cleanup (see
app/api/system/cleanup/route.ts).

Only called when llm_cleanup_enabled is true in config.json (default False;
this stage adds a network round trip to the dictation path, so it stays
opt-in). Falls open to the original, uncleaned transcript whenever Jarvis
can't help: not running, timeout, non-200/bad JSON, or jarvis_url/
jarvis_token not configured yet in config.json. The dictation flow must never
block or fail just because cleanup is unavailable.
"""

from .jarvis_client import post_json


def maybe_clean(transcript: str, cfg: dict) -> str:
    if not cfg.get("llm_cleanup_enabled", False):
        return transcript

    body = post_json(cfg, "/api/system/cleanup", {"text": transcript})
    if not body:
        return transcript

    cleaned = body.get("text")
    if not isinstance(cleaned, str) or not cleaned.strip():
        return transcript
    return cleaned
