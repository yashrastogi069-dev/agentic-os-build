"""Smoke test for the STT stage: transcribe a 16 kHz mono WAV.
Usage: .venv\\Scripts\\python scripts\\test_stt.py scripts\\test.wav
"""
import sys
import time
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dictate.config import load_config
from dictate.stt import Transcriber


def main():
    wav_path = sys.argv[1]
    with wave.open(wav_path, "rb") as w:
        assert w.getframerate() == 16000, f"expected 16 kHz wav, got {w.getframerate()}"
        assert w.getnchannels() == 1, "expected mono wav"
        raw = w.readframes(w.getnframes())
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    cfg = load_config()
    tr = Transcriber(cfg)
    t0 = time.time()
    tr.load()
    load_s = time.time() - t0
    t0 = time.time()
    text = tr.transcribe(audio)
    stt_s = time.time() - t0

    secs = audio.size / 16000
    print(f"model={cfg['model']} load={load_s:.1f}s | {secs:.1f}s audio -> {stt_s:.1f}s")
    print(f"TRANSCRIPT: {text}")

    # silence guard check
    silent = tr.transcribe(np.zeros(16000, dtype=np.float32))
    print(f"SILENCE GUARD: {'ok (empty)' if silent == '' else 'FAILED: ' + silent!r}")


if __name__ == "__main__":
    main()
