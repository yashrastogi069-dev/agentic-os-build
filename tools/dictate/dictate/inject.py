import time

import pyperclip
from pynput.keyboard import Controller, Key

_kb = Controller()


def _send_paste(combo: str):
    if combo == "shift_insert":
        with _kb.pressed(Key.shift):
            _kb.press(Key.insert)
            _kb.release(Key.insert)
    else:  # ctrl_v
        with _kb.pressed(Key.ctrl):
            _kb.press("v")
            _kb.release("v")


def inject_text(text: str, cfg: dict):
    """Insert text at the cursor of whatever app is focused.

    injection_mode in config.json:
      "paste"              - clipboard + Ctrl+V (default; instant, best Unicode)
      "paste_shift_insert" - clipboard + Shift+Insert (terminals where Ctrl+V fails)
      "type"               - per-character synthetic typing (no clipboard touched;
                             slowest, for the rare app that blocks paste entirely)
    """
    if not text:
        return
    mode = cfg.get("injection_mode", "paste")

    if mode == "type":
        _kb.type(text)
        return

    saved = None
    if cfg.get("restore_clipboard", True):
        try:
            saved = pyperclip.paste()
        except Exception:
            saved = None
    pyperclip.copy(text)
    time.sleep(0.05)  # let the clipboard settle before pasting
    _send_paste("shift_insert" if mode == "paste_shift_insert" else "ctrl_v")
    if saved is not None:
        # wait for the target app to consume the paste before restoring
        time.sleep(cfg.get("paste_delay_ms", 300) / 1000)
        try:
            pyperclip.copy(saved)
        except Exception:
            pass


# backwards-compatible alias
paste_text = inject_text
