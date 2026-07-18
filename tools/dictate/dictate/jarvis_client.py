"""Small shared HTTP client for talking to Jarvis's local companion API
(app/api/system/*). Every call here fails open: connection refused (Jarvis
not running), timeout, non-200, or bad JSON all resolve to `None` rather than
raising -- callers decide the fallback. An unconfigured jarvis_url/
jarvis_token is treated as a valid "not set up yet" state, also `None`, not an
error. This mirrors the "Jarvis down" pattern used elsewhere in this codebase
(e.g. the voice pipeline's failure handling): the companion process must keep
working with Jarvis switched off.
"""

import json
import urllib.error
import urllib.request

# The /cleanup route aborts its own model call at 4s server-side; give the
# round trip a little more room than that before we give up client-side.
TIMEOUT_SECONDS = 6


def is_configured(cfg: dict) -> bool:
    return bool((cfg.get("jarvis_url") or "").strip()) and bool(
        (cfg.get("jarvis_token") or "").strip()
    )


def post_json(cfg: dict, path: str, payload: dict) -> dict | None:
    """POST JSON to {jarvis_url}{path} with the bearer token from cfg.

    Returns the parsed JSON response body, or None if jarvis_url/jarvis_token
    aren't configured yet, or on any connection error, timeout, non-2xx
    status, or unparseable body.
    """
    if not is_configured(cfg):
        return None

    base = cfg["jarvis_url"].strip().rstrip("/")
    token = cfg["jarvis_token"].strip()

    request = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        print(f"[jarvis] {path} unreachable or failed ({e}); continuing without it")
        return None
