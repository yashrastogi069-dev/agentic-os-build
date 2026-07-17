/**
 * Gapless sequential playback of Piper-synthesized sentence chunks, with
 * barge-in support. Every enqueued chunk fires its /api/voice/speak request
 * immediately (so TTS latency for chunk N+1 is hidden behind playback of
 * chunk N), and a single shared AudioContext schedules buffers back-to-back
 * via computed start times for truly gapless playback.
 */

interface QueuedItem {
  id: number
  text: string
  controller: AbortController
  bufferPromise: Promise<AudioBuffer | null>
}

export class TtsQueue {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private nextId = 0
  private queue: QueuedItem[] = []
  private playIndex = 0
  private nextStartTime = 0
  private currentSource: AudioBufferSourceNode | null = null
  /** Bumped on every stop() so any in-flight drain()/playBuffer() loop from before the stop bails out. */
  private generation = 0
  private _isPlaying = false

  onPlaybackStateChange: ((playing: boolean) => void) | null = null

  get isPlaying(): boolean {
    return this._isPlaying
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = 1
      this.gain.connect(this.ctx.destination)
      this.nextStartTime = this.ctx.currentTime
    }
    return this.ctx
  }

  /** Push a sentence chunk. Fires its synth request immediately. */
  enqueue(text: string): void {
    const ctx = this.ensureContext()
    const id = this.nextId++
    const controller = new AbortController()
    const generation = this.generation

    const bufferPromise = fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1200) }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(json.error ?? `speak request failed (${res.status})`)
        }
        const arrayBuffer = await res.arrayBuffer()
        return await ctx.decodeAudioData(arrayBuffer)
      })
      .catch((err) => {
        if (controller.signal.aborted) return null
        console.warn("[tts-queue] chunk synth failed, skipping:", err)
        return null
      })

    this.queue.push({ id, text, controller, bufferPromise })
    void this.drain(generation)
  }

  /** Plays queued items strictly in enqueue order once each one's synth resolves. */
  private async drain(generation: number): Promise<void> {
    if (this._isPlaying) return
    this._isPlaying = true
    this.setPlaying(true)

    while (this.playIndex < this.queue.length && generation === this.generation) {
      const item = this.queue[this.playIndex]
      const buffer = await item.bufferPromise
      if (generation !== this.generation) break
      this.playIndex++

      if (!buffer) continue // chunk failed — skip, keep going

      await this.playBuffer(buffer, generation)
    }

    this._isPlaying = false
    this.setPlaying(false)
  }

  private playBuffer(buffer: AudioBuffer, generation: number): Promise<void> {
    const ctx = this.ensureContext()
    return new Promise((resolve) => {
      if (generation !== this.generation) {
        resolve()
        return
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = this.gain!
      source.connect(gain)

      const startAt = Math.max(this.nextStartTime, ctx.currentTime)
      this.nextStartTime = startAt + buffer.duration
      this.currentSource = source

      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null
        resolve()
      }
      source.start(startAt)
    })
  }

  private setPlaying(playing: boolean): void {
    this.onPlaybackStateChange?.(playing)
  }

  /**
   * Immediate hard stop (barge-in): fades out any currently-playing source,
   * stops it, aborts in-flight synth fetches, and clears the pending queue.
   */
  stop(): void {
    this.generation++

    for (const item of this.queue.slice(this.playIndex)) {
      item.controller.abort()
    }

    const ctx = this.ctx
    const source = this.currentSource
    const gain = this.gain
    if (ctx && source && gain) {
      const now = ctx.currentTime
      const fadeSeconds = 0.06
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(0, now + fadeSeconds)
        source.stop(now + fadeSeconds)
      } catch {
        try {
          source.stop()
        } catch {
          // already stopped
        }
      }
      // Restore gain for the next utterance after the fade completes.
      window.setTimeout(() => {
        if (this.gain && ctx) {
          this.gain.gain.cancelScheduledValues(ctx.currentTime)
          this.gain.gain.setValueAtTime(1, ctx.currentTime)
        }
      }, fadeSeconds * 1000 + 20)
    }

    this.currentSource = null
    this.queue = []
    this.playIndex = 0
    this.nextId = 0
    if (ctx) this.nextStartTime = ctx.currentTime

    if (this._isPlaying) {
      this._isPlaying = false
      this.setPlaying(false)
    }
  }
}
