/**
 * AudioWorkletProcessor — mic capture for Jarvis Phase 6 Chunk C.
 *
 * Runs in the AudioWorkletGlobalScope (no imports/exports beyond
 * registerProcessor; fetched directly by the browser, not bundled).
 *
 * Batches 128-sample process() callbacks into ~2048-sample chunks and posts
 * them to the main thread as a transferable Float32Array, alongside a cheap
 * per-chunk RMS energy value for VAD.
 */

const BATCH_SIZE = 2048

class JarvisCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(BATCH_SIZE)
    this.writeIndex = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (!channel || channel.length === 0) {
      // No mic data this callback (e.g. track momentarily muted) — keep alive.
      return true
    }

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.writeIndex++] = channel[i]
      if (this.writeIndex >= BATCH_SIZE) {
        this.flush()
      }
    }

    return true
  }

  flush() {
    const chunk = this.buffer.slice(0, this.writeIndex)
    let sumSquares = 0
    for (let i = 0; i < chunk.length; i++) {
      sumSquares += chunk[i] * chunk[i]
    }
    const rms = Math.sqrt(sumSquares / chunk.length)

    this.port.postMessage({ type: "chunk", rms, pcm: chunk }, [chunk.buffer])

    this.buffer = new Float32Array(BATCH_SIZE)
    this.writeIndex = 0
  }
}

registerProcessor("jarvis-capture-processor", JarvisCaptureProcessor)
