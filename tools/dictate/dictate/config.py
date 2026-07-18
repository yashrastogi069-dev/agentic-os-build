import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULTS = {
    "hotkey": "ctrl_r",
    "model": "base",
    "language": "en",
    "compute_type": "int8",
    "cpu_threads": 4,
    "beam_size": 1,
    "show_overlay": True,
    "injection_mode": "paste",
    "paste_delay_ms": 300,
    "restore_clipboard": True,
    "llm_cleanup_enabled": False,
    "llm_model": "llama3.2:3b",
    "jarvis_url": "http://127.0.0.1:3000",
    "jarvis_token": "",
}


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as e:
            print(f"[config] could not read {CONFIG_PATH.name} ({e}); using defaults")
    return cfg
