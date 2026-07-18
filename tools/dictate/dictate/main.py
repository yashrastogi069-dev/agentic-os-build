import queue
import threading
import time
import winsound

from pynput import keyboard

from .audio import SAMPLE_RATE, Recorder
from .cleanup import maybe_clean
from .config import load_config
from .inject import inject_text
from .stt import Transcriber


def resolve_key(name: str):
    """'ctrl_r' / 'f8' -> pynput Key; single char like 'z' -> KeyCode."""
    if len(name) == 1:
        return keyboard.KeyCode.from_char(name)
    try:
        return getattr(keyboard.Key, name)
    except AttributeError:
        raise SystemExit(f"Unknown hotkey '{name}' in config.json (try ctrl_r, f8, pause...)")


def main():
    cfg = load_config()
    hotkey = resolve_key(cfg["hotkey"])

    overlay = None
    if cfg.get("show_overlay", True):
        from .overlay import WaveOverlay  # tkinter; must be created on the main thread
        overlay = WaveOverlay()

    print(f"Loading Whisper '{cfg['model']}' ({cfg['compute_type']}, cpu)...")
    t0 = time.time()
    transcriber = Transcriber(cfg)
    transcriber.load()
    print(f"Model ready in {time.time() - t0:.1f}s.")
    print(f"HOLD <{cfg['hotkey']}> and talk; release to paste at cursor. Ctrl+C here to quit.")

    events = queue.Queue()
    recording = False

    # Listener callbacks run on the OS input thread: do nothing slow here,
    # just push events to the queue (see PLAN.md section 5).
    def on_press(key):
        nonlocal recording
        if key == hotkey and not recording:
            recording = True
            events.put("start")

    def on_release(key):
        nonlocal recording
        if key == hotkey and recording:
            recording = False
            events.put("stop")

    def set_state(state: str):
        if overlay is not None:
            overlay.set_state(state)

    def worker():
        rec = Recorder(on_level=overlay.set_level if overlay else None)
        while True:
            ev = events.get()
            if ev == "start":
                try:
                    rec.start()
                except Exception as e:
                    print(f"! mic error: {e}")
                    continue
                set_state("recording")
                winsound.Beep(880, 80)
                print("\n* recording... (release to transcribe)", flush=True)
            elif ev == "stop":
                audio = rec.stop()
                set_state("busy")
                winsound.Beep(440, 80)
                secs = audio.size / SAMPLE_RATE
                t = time.time()
                text = maybe_clean(transcriber.transcribe(audio), cfg)
                took = time.time() - t
                if text:
                    inject_text(text, cfg)
                    print(f"  {secs:.1f}s audio -> transcribed in {took:.1f}s: {text}")
                else:
                    print(f"  (nothing heard in {secs:.1f}s of audio)")
                set_state("idle")

    threading.Thread(target=worker, daemon=True).start()
    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()

    if overlay is not None:
        try:
            overlay.run()  # blocks on the tk mainloop (main thread)
        except KeyboardInterrupt:
            pass
    else:
        listener.join()


if __name__ == "__main__":
    main()
