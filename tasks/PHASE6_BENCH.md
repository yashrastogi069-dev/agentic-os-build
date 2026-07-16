# Phase 6 Chunk A — voice foundation benchmarks (measured 2026-07-16)

Machine: i3-1005G1, 8 GB RAM, no GPU, Windows 11. All numbers real, not
projected. Paths in forward slashes (lesson 15).

## STT — faster-whisper sidecar (tools/stt-server, 127.0.0.1:8765)

Model: base int8, cpu_threads 4, beam 1, vad_filter on. Model weights shared
with the dictation tool via the HuggingFace hub cache
(models--Systran--faster-whisper-base) — zero duplicate download.

| Metric | Value |
|---|---|
| Cold first request (model load + decode 7.4s wav) | 4888 ms wall |
| Warm decode, 7.4s test wav (3 runs) | 1058-1262 ms |
| RTF warm | 0.142-0.209 |
| HTTP overhead (wall minus decode, warm) | ~3-5 ms |
| Transcript accuracy on test.wav | word-perfect |

Implication: a typical 3-4 s spoken command decodes in ~0.5-0.7 s warm —
inside the §5.4 STT budget (0.3-0.8 s). The client must trigger a preload
(GET /health then a warmup transcribe, or STT_PRELOAD=1) at app start so the
first real utterance never pays the 4.9 s cold path.

## TTS — Piper 1.2.0 (bin/piper/piper.exe, en_US-lessac-medium)

| Mode | Metric | Value |
|---|---|---|
| One-shot spawn | cold (spawn + model load + 4.7s audio) | 3092 ms |
| One-shot spawn | warm re-spawn, same utterance | 1065-1330 ms |
| Persistent daemon (--json-input) | warmup line incl. model load | 639 ms |
| Persistent daemon | "Good evening Yash." (1.4s audio) | 116 ms |
| Persistent daemon | 3.3s-audio sentence | 312 ms |
| Persistent daemon | 3.0s-audio sentence | 335 ms |

Implication: the persistent daemon is mandatory (one-shot spawn alone blows
the 450-700 ms first-chunk budget); warm per-sentence synth at 116-335 ms
leaves comfortable headroom. Completion signal: piper prints the output wav
path on stdout when a line finishes — lib/voice/piper.ts keys on that.
Output format: 22050 Hz 16-bit mono wav.

## Latency budget check (§5.4, typical 3.5s utterance)

VAD hangover 300-400 + STT ~550 warm + brain first sentence 700-1300 +
TTS first chunk ~300 + playback ~30 ≈ 1.9-2.6 s today. p50 ≤ 1.8 s needs the
Chunk F levers (rolling decode, clause-level first chunk); p90 ≤ 3.0 s already
clears. Both sidecar and daemon idle-unload to respect the 8 GB ceiling.
