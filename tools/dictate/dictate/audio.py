import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000  # what Whisper expects


class Recorder:
    """Push-to-talk microphone capture. start() opens the stream, stop() returns
    everything captured as one mono float32 array at 16 kHz."""

    def __init__(self, on_level=None):
        self._chunks = []
        self._stream = None
        self.on_level = on_level  # gets RMS of each chunk (for the wave overlay)

    def start(self):
        self._chunks = []
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            callback=self._on_audio,
        )
        self._stream.start()

    def _on_audio(self, indata, frames, time_info, status):
        self._chunks.append(indata.copy())
        if self.on_level is not None:
            self.on_level(float(np.sqrt((indata ** 2).mean())))

    def stop(self) -> np.ndarray:
        if self._stream is None:
            return np.zeros(0, dtype=np.float32)
        self._stream.stop()
        self._stream.close()
        self._stream = None
        if not self._chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self._chunks)[:, 0]
