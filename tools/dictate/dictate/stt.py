import numpy as np

from .audio import SAMPLE_RATE

MIN_SECONDS = 0.3   # ignore accidental key taps
MIN_PEAK = 0.01     # ignore near-silent recordings (Whisper hallucinates on silence)


class Transcriber:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._model = None

    def load(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # slow import, keep it lazy

            self._model = WhisperModel(
                self.cfg["model"],
                device="cpu",
                compute_type=self.cfg["compute_type"],
                cpu_threads=self.cfg["cpu_threads"],
            )
        return self._model

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < SAMPLE_RATE * MIN_SECONDS:
            return ""
        if float(np.abs(audio).max(initial=0.0)) < MIN_PEAK:
            return ""
        segments, _info = self.load().transcribe(
            audio,
            language=self.cfg["language"],
            beam_size=self.cfg["beam_size"],
            vad_filter=True,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()
