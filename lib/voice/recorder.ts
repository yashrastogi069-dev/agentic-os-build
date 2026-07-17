/**
 * Browser mic recorder — Phase 6 Chunk C. Captures PCM via an AudioWorklet
 * (public/worklets/capture-processor.js) instead of the deprecated
 * ScriptProcessorNode, keeps a short pre-roll ring buffer so speech-onset
 * audio captured just before VAD declares "speech started" isn't lost, and
 * encodes 16kHz mono WAV (what whisper.cpp expects) on demand. No external
 * deps.
 *
 * Lifecycle: start() once, then the caller (components/voice/voice-controller.tsx)
 * repeatedly calls markSpeechStart() / finishUtterance() per detected
 * utterance while the recorder keeps running continuously in the background —
 * this avoids re-doing getUserMedia/AudioContext setup for every turn of a
 * conversation.
 */

const TARGET_RATE = 16000
/** How much audio to always keep buffered before a confirmed speech start. */
const PRE_ROLL_MS = 300
/** Smoothing factor for the exposed `level` field (higher = snappier). */
const LEVEL_SMOOTHING = 0.35

export class WorkletRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private inputRate = 48000

  /** Rolling chunk buffer. Trimmed to the pre-roll window until speech starts. */
  private chunks: Float32Array[] = []
  private speechActive = false

  /** live smoothed amplitude 0..1 for visualization / theme-engine micLevel */
  level = 0

  /** Called on every worklet chunk with the raw (unsmoothed) RMS energy, for VAD. */
  onSample: ((rms: number, nowMs: number) => void) | null = null

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    })
    this.ctx = new AudioContext()
    this.inputRate = this.ctx.sampleRate
    await this.ctx.audioWorklet.addModule("/worklets/capture-processor.js")

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, "jarvis-capture-processor")
    this.chunks = []
    this.speechActive = false

    this.node.port.onmessage = (event: MessageEvent<{ type: string; rms: number; pcm: Float32Array }>) => {
      const { rms, pcm } = event.data
      this.chunks.push(pcm)
      this.level = this.level + (Math.min(1, rms * 4) - this.level) * LEVEL_SMOOTHING

      if (!this.speechActive) {
        this.trimToPreRoll()
      }

      this.onSample?.(rms, performance.now())
    }

    // Do NOT connect the worklet to destination — we don't want to hear raw
    // mic input played back through the speakers.
    this.source.connect(this.node)
  }

  /** Drop buffered chunks older than PRE_ROLL_MS, keeping the most recent tail. */
  private trimToPreRoll(): void {
    const keepSamples = Math.ceil((PRE_ROLL_MS / 1000) * this.inputRate)
    let total = 0
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      total += this.chunks[i].length
      if (total >= keepSamples) {
        this.chunks = this.chunks.slice(i)
        return
      }
    }
  }

  /**
   * Mark that VAD has declared speech started. From this point the buffer is
   * no longer trimmed, so finishUtterance() returns pre-roll + full utterance.
   */
  markSpeechStart(): void {
    this.speechActive = true
  }

  /**
   * VAD declared speech ended (or the caller wants to bail out early). Encodes
   * everything buffered since the last reset as a 16kHz mono WAV blob, then
   * resets the buffer back to pre-roll-only for the next utterance.
   */
  finishUtterance(): Blob {
    const totalLength = this.chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }

    this.speechActive = false
    this.trimToPreRoll()

    const resampled = resample(pcm, this.inputRate, TARGET_RATE)
    return encodeWav(resampled, TARGET_RATE)
  }

  /** Discard any buffered utterance audio without encoding (e.g. false-start). */
  discardUtterance(): void {
    this.speechActive = false
    this.trimToPreRoll()
  }

  /** Fully tear down the recorder (mic track, AudioContext, worklet node). */
  async stop(): Promise<void> {
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.ctx = null
    this.node = null
    this.source = null
    this.stream = null
    this.chunks = []
    this.level = 0
    this.speechActive = false
  }
}

/** @deprecated kept as an alias for callers migrating from the pre-worklet name. */
export { WorkletRecorder as WavRecorder }

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const left = Math.floor(pos)
    const right = Math.min(left + 1, input.length - 1)
    const frac = pos - left
    output[i] = input[left] * (1 - frac) + input[right] * frac
  }
  return output
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}
