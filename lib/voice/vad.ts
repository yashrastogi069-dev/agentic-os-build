/**
 * Energy-based voice activity detection — Phase 6 Chunk C.
 *
 * Deliberately simple (no WebRTC VAD / ML VAD dependency), matching the
 * project's hand-rolled-over-dependency pattern (see lib/voice/piper.ts's
 * daemon). Fed a stream of RMS energy samples from the AudioWorklet via
 * push(); runs a small hysteresis + sustain state machine so clicks/pops
 * don't trigger false speech-starts and brief pauses don't trigger false
 * speech-ends.
 */

export interface VadConfig {
  /** RMS above this sustained for speechStartMs declares speech started. */
  speechRmsThreshold?: number
  /** RMS below this sustained for speechEndMs declares speech ended (hysteresis vs. speechRmsThreshold). */
  silenceRmsThreshold?: number
  /** How long energy must stay above speechRmsThreshold before declaring speech started. */
  speechStartMs?: number
  /** How long energy must stay below silenceRmsThreshold before declaring speech ended (the "hangover"). */
  speechEndMs?: number
}

const DEFAULTS: Required<VadConfig> = {
  speechRmsThreshold: 0.02,
  silenceRmsThreshold: 0.012,
  speechStartMs: 150,
  speechEndMs: 700,
}

type VadState = "silence" | "speech"

export class EnergyVad {
  private config: Required<VadConfig>
  private _state: VadState = "silence"

  /** Timestamp (ms) when energy first crossed into the opposite-of-current-state zone. */
  private candidateSinceMs: number | null = null

  onSpeechStart: (() => void) | null = null
  onSpeechEnd: (() => void) | null = null

  constructor(config: VadConfig = {}) {
    this.config = { ...DEFAULTS, ...config }
  }

  get state(): VadState {
    return this._state
  }

  /** The configured silence-sustain window (ms) that gates onSpeechEnd — exposed for latency instrumentation. */
  get hangoverMs(): number {
    return this.config.speechEndMs
  }

  /** Reset the state machine (e.g. after barge-in stop, or between utterances). */
  reset(): void {
    this._state = "silence"
    this.candidateSinceMs = null
  }

  push(rms: number, nowMs: number): void {
    if (this._state === "silence") {
      if (rms >= this.config.speechRmsThreshold) {
        if (this.candidateSinceMs === null) {
          this.candidateSinceMs = nowMs
        } else if (nowMs - this.candidateSinceMs >= this.config.speechStartMs) {
          this._state = "speech"
          this.candidateSinceMs = null
          this.onSpeechStart?.()
        }
      } else {
        this.candidateSinceMs = null
      }
    } else {
      if (rms <= this.config.silenceRmsThreshold) {
        if (this.candidateSinceMs === null) {
          this.candidateSinceMs = nowMs
        } else if (nowMs - this.candidateSinceMs >= this.config.speechEndMs) {
          this._state = "silence"
          this.candidateSinceMs = null
          this.onSpeechEnd?.()
        }
      } else {
        this.candidateSinceMs = null
      }
    }
  }
}
