import queue
import threading
import time
import winsound

from pynput import keyboard

from .audio import SAMPLE_RATE, Recorder
from .cleanup import maybe_clean
from .config import load_config
from .inject import inject_text
from .jarvis_client import post_json
from .stt import Transcriber
from .toast import show_toast
from .winfocus import get_foreground_window_info


def resolve_key(name: str):
    """'ctrl_r' / 'f8' -> pynput Key; single char like 'z' -> KeyCode."""
    if len(name) == 1:
        return keyboard.KeyCode.from_char(name)
    try:
        return getattr(keyboard.Key, name)
    except AttributeError:
        raise SystemExit(f"Unknown hotkey '{name}' in config.json (try ctrl_r, f8, pause...)")


def send_observation(cfg: dict, text: str, window_title: str, app: str):
    """Best-effort, fire-and-forget: tell Jarvis what got dictated and where.
    Runs on its own daemon thread so a slow/unreachable Jarvis never delays
    the next dictation. Failure is silent beyond jarvis_client's own log line
    (see app/api/system/observe/route.ts for the body shape this matches)."""
    post_json(
        cfg,
        "/api/system/observe",
        {"kind": "transcript", "text": text, "windowTitle": window_title, "app": app},
    )


def send_ask(cfg: dict, question: str, icon):
    """F8 "ask Jarvis anywhere": POST the captured question to
    /api/system/command (one-shot, no session/follow-up context -- see
    app/api/system/command/route.ts) and surface the answer as a Windows
    toast. Runs on its own daemon thread so a slow/unreachable Jarvis never
    blocks the next hotkey press.

    Every outcome is an honest toast: a real reply, an explicit "nothing to
    say" (the route can return 200 with an empty reply), or "unavailable"
    (jarvis_client.post_json returns None on any connection error, timeout,
    non-2xx status, or an unconfigured jarvis_url/jarvis_token) -- never a
    faked answer and never silence.
    """
    result = post_json(cfg, "/api/system/command", {"text": question})
    if result is None:
        show_toast(icon, "Jarvis", "Jarvis is unavailable right now.")
        return
    reply = result.get("reply")
    if isinstance(reply, str) and reply.strip():
        show_toast(icon, "Jarvis", reply.strip())
    else:
        show_toast(icon, "Jarvis", "Jarvis didn't have anything to say.")


def main():
    cfg = load_config()
    hotkey = resolve_key(cfg["hotkey"])
    ask_hotkey = resolve_key(cfg["ask_hotkey"])

    overlay = None
    if cfg.get("show_overlay", True):
        from .overlay import WaveOverlay  # tkinter; must be created on the main thread
        overlay = WaveOverlay()

    print(f"Loading Whisper '{cfg['model']}' ({cfg['compute_type']}, cpu)...")
    t0 = time.time()
    transcriber = Transcriber(cfg)
    transcriber.load()
    print(f"Model ready in {time.time() - t0:.1f}s.")
    print(f"HOLD <{cfg['hotkey']}> and talk; release to paste at cursor.")
    print(f"HOLD <{cfg['ask_hotkey']}> and talk to ask Jarvis anywhere; release for a toast reply.")
    print("Ctrl+C here to quit.")

    events = queue.Queue()
    recording = False
    tray_icon = None  # set once the tray starts; worker() reads it at call time

    # Listener callbacks run on the OS input thread: do nothing slow here,
    # just push events to the queue (see PLAN.md section 5). `recording` is
    # shared across both hotkeys so holding one blocks the other from also
    # starting a second, concurrent recording on the same Recorder.
    def on_press(key):
        nonlocal recording
        if recording:
            return
        if key == hotkey:
            recording = True
            events.put(("start", "dictate"))
        elif key == ask_hotkey:
            recording = True
            events.put(("start", "ask"))

    def on_release(key):
        nonlocal recording
        if not recording:
            return
        if key == hotkey:
            recording = False
            events.put(("stop", "dictate"))
        elif key == ask_hotkey:
            recording = False
            events.put(("stop", "ask"))

    def set_state(state: str):
        if overlay is not None:
            overlay.set_state(state)

    def worker():
        rec = Recorder(on_level=overlay.set_level if overlay else None)
        window_title, window_app = "", ""
        while True:
            ev, mode = events.get()
            if ev == "start":
                try:
                    rec.start()
                except Exception as e:
                    print(f"! mic error: {e}")
                    continue
                if mode == "dictate":
                    # Capture what's focused right now, before recording shifts
                    # anything -- this is the "observe" side-channel context.
                    window_title, window_app = get_foreground_window_info()
                set_state("recording")
                winsound.Beep(880, 80)
                label = "dictation" if mode == "dictate" else "a question for Jarvis"
                print(f"\n* recording {label}... (release to transcribe)", flush=True)
            elif ev == "stop":
                audio = rec.stop()
                set_state("busy")
                winsound.Beep(440, 80)
                secs = audio.size / SAMPLE_RATE
                t = time.time()
                raw_text = transcriber.transcribe(audio)
                took = time.time() - t
                if mode == "dictate":
                    text = maybe_clean(raw_text, cfg)
                    if text:
                        inject_text(text, cfg)
                        print(f"  {secs:.1f}s audio -> transcribed in {took:.1f}s: {text}")
                        threading.Thread(
                            target=send_observation,
                            args=(cfg, raw_text, window_title, window_app),
                            daemon=True,
                        ).start()
                    else:
                        print(f"  (nothing heard in {secs:.1f}s of audio)")
                else:  # ask
                    if raw_text:
                        print(f"  {secs:.1f}s audio -> transcribed in {took:.1f}s: {raw_text}")
                        threading.Thread(
                            target=send_ask,
                            args=(cfg, raw_text, tray_icon),
                            daemon=True,
                        ).start()
                    else:
                        print(f"  (nothing heard in {secs:.1f}s of audio)")
                set_state("idle")

    threading.Thread(target=worker, daemon=True).start()
    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()

    def quit_app():
        print("\nQuitting (tray)...")
        listener.stop()
        if overlay is not None:
            try:
                overlay.root.quit()
            except Exception:
                pass

    try:
        from .tray import start_tray
        tray_icon = start_tray(on_quit=quit_app)
    except Exception as e:
        print(f"! tray icon unavailable ({e}); Ctrl+C here to quit instead. "
              f"F8 replies will print to the console instead of toasting.")

    if overlay is not None:
        try:
            overlay.run()  # blocks on the tk mainloop (main thread)
        except KeyboardInterrupt:
            pass
    else:
        listener.join()


if __name__ == "__main__":
    main()
