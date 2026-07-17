'use client'

import { useEffect, useRef, useState } from 'react'
import { useThemeStore, type CoreState } from '@/lib/theme-engine'
import { WorkletRecorder } from '@/lib/voice/recorder'
import { EnergyVad } from '@/lib/voice/vad'
import { SentenceChunker } from '@/lib/voice/sentence-chunker'
import { TtsQueue } from '@/lib/voice/tts-queue'

/** How long the mic stays open for a follow-up turn after Jarvis finishes speaking. */
const FOLLOW_UP_WINDOW_MS = 7000
/** Throttle for writing live mic level into the theme store. */
const MIC_LEVEL_WRITE_INTERVAL_MS = 75

type VoiceControllerState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'

function toCoreState(state: VoiceControllerState): CoreState {
  if (state === 'listening') return 'listening'
  if (state === 'speaking') return 'speaking'
  if (state === 'transcribing' || state === 'thinking') return 'thinking'
  return 'idle'
}

export function VoiceController({
  onStateChange,
  onSendMessage,
  isAssistantStreaming,
  latestAssistantText,
}: {
  onStateChange?: (state: CoreState) => void
  onSendMessage: (text: string) => void
  isAssistantStreaming: boolean
  latestAssistantText: string
}) {
  const [state, setState] = useState<VoiceControllerState>('idle')
  const [error, setError] = useState('')

  const recorderRef = useRef<WorkletRecorder | null>(null)
  const vadRef = useRef<EnergyVad | null>(null)
  const chunkerRef = useRef(new SentenceChunker())
  const ttsQueueRef = useRef<TtsQueue | null>(null)

  const stateRef = useRef(state)
  stateRef.current = state
  const followUpTimerRef = useRef<number | null>(null)
  const lastMicWriteRef = useRef(0)
  const explicitlyStoppedRef = useRef(false)
  const seenTextLengthRef = useRef(0)
  const wasStreamingRef = useRef(false)

  // Report coreState transitions upward.
  useEffect(() => {
    onStateChange?.(toCoreState(state))
  }, [state, onStateChange])

  // Tell components/voice/wake-word-listener.tsx when a conversation turn is
  // active so it can release the mic (avoids two components fighting over
  // getUserMedia, and avoids "Jarvis" spoken mid-conversation double-triggering).
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('jarvis:conversation-active', { detail: { active: state !== 'idle' } }),
    )
  }, [state])

  function clearFollowUpTimer() {
    if (followUpTimerRef.current !== null) {
      window.clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }
  }

  function writeMicLevel(level: number) {
    const now = performance.now()
    if (now - lastMicWriteRef.current < MIC_LEVEL_WRITE_INTERVAL_MS) return
    lastMicWriteRef.current = now
    useThemeStore.setState({ micLevel: level })
  }

  async function ensureTtsQueue(): Promise<TtsQueue> {
    if (!ttsQueueRef.current) {
      const queue = new TtsQueue()
      queue.onPlaybackStateChange = (playing) => {
        if (!playing && stateRef.current === 'speaking') {
          // Last chunk's audio has genuinely finished — open the follow-up window.
          if (explicitlyStoppedRef.current) {
            transitionToIdle()
          } else {
            beginListening(true)
          }
        }
      }
      ttsQueueRef.current = queue
    }
    return ttsQueueRef.current
  }

  async function ensureRecorder(): Promise<WorkletRecorder> {
    if (recorderRef.current) return recorderRef.current
    const recorder = new WorkletRecorder()
    const vad = new EnergyVad()
    vad.onSpeechStart = () => {
      recorder.markSpeechStart()
      if (stateRef.current === 'speaking') {
        // Barge-in: user started talking while Jarvis was speaking.
        ttsQueueRef.current?.stop()
        setState('listening')
      }
    }
    vad.onSpeechEnd = () => {
      if (stateRef.current !== 'listening') return
      void finishListeningTurn(recorder)
    }
    recorder.onSample = (rms, nowMs) => {
      vad.push(rms, nowMs)
      if (stateRef.current === 'listening') {
        writeMicLevel(recorder.level)
      }
    }

    await recorder.start()
    recorderRef.current = recorder
    vadRef.current = vad
    return recorder
  }

  async function finishListeningTurn(recorder: WorkletRecorder) {
    clearFollowUpTimer()
    setState('transcribing')
    useThemeStore.setState({ micLevel: 0 })
    try {
      const wav = recorder.finishUtterance()
      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok || !json.text) {
        throw new Error(json.error ?? 'nothing transcribed')
      }
      chunkerRef.current.reset()
      seenTextLengthRef.current = 0
      wasStreamingRef.current = false
      setState('thinking')
      onSendMessage(json.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'transcription failed')
      // Silence, no clip to send — go back to listening rather than dying.
      beginListening(false)
    }
  }

  function beginListening(followUp: boolean) {
    clearFollowUpTimer()
    if (followUp) {
      followUpTimerRef.current = window.setTimeout(() => {
        if (stateRef.current === 'listening') {
          transitionToIdle()
        }
      }, FOLLOW_UP_WINDOW_MS)
    }
    setState('listening')
  }

  function transitionToIdle() {
    clearFollowUpTimer()
    vadRef.current?.reset()
    useThemeStore.setState({ micLevel: 0 })
    setState('idle')
  }

  async function stopEverything() {
    explicitlyStoppedRef.current = true
    clearFollowUpTimer()
    ttsQueueRef.current?.stop()
    useThemeStore.setState({ micLevel: 0 })
    const recorder = recorderRef.current
    recorderRef.current = null
    vadRef.current = null
    if (recorder) {
      await recorder.stop().catch(() => undefined)
    }
    setState('idle')
  }

  async function toggle() {
    setError('')
    if (state === 'idle') {
      explicitlyStoppedRef.current = false
      try {
        await ensureRecorder()
        await ensureTtsQueue()
        beginListening(false)
      } catch (err) {
        setError(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'microphone access denied'
            : err instanceof Error
              ? err.message
              : 'microphone access denied',
        )
        await stopEverything()
      }
      return
    }
    // Any other state: user wants to stop the conversation entirely.
    await stopEverything()
  }

  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(() => {
    function handleToggleMic() {
      void toggleRef.current()
    }
    window.addEventListener('jarvis:toggle-mic', handleToggleMic)
    return () => window.removeEventListener('jarvis:toggle-mic', handleToggleMic)
  }, [])

  // Sentence-stream TTS: chunk the delta of the accumulating assistant reply
  // and enqueue completed sentences as they appear.
  useEffect(() => {
    if (stateRef.current !== 'thinking' && stateRef.current !== 'speaking') return

    const total = latestAssistantText.length
    const prevLength = seenTextLengthRef.current
    if (total > prevLength) {
      const delta = latestAssistantText.slice(prevLength)
      seenTextLengthRef.current = total
      const chunks = chunkerRef.current.push(delta)
      if (chunks.length > 0) {
        if (stateRef.current === 'thinking') setState('speaking')
        void ensureTtsQueue().then((queue) => {
          for (const chunk of chunks) queue.enqueue(chunk)
        })
      }
    }

    if (!isAssistantStreaming && wasStreamingRef.current) {
      const final = chunkerRef.current.finalize()
      if (final) {
        if (stateRef.current === 'thinking') setState('speaking')
        void ensureTtsQueue().then((queue) => queue.enqueue(final))
      } else if (stateRef.current === 'thinking') {
        // No speakable content came back at all — don't hang in 'thinking'.
        if (explicitlyStoppedRef.current) transitionToIdle()
        else beginListening(true)
      }
    }
    wasStreamingRef.current = isAssistantStreaming
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAssistantText, isAssistantStreaming])

  // Full teardown on unmount.
  useEffect(() => {
    return () => {
      clearFollowUpTimer()
      ttsQueueRef.current?.stop()
      recorderRef.current?.stop().catch(() => undefined)
    }
  }, [])

  const label =
    state === 'listening'
      ? 'Stop listening'
      : state === 'speaking'
        ? 'Interrupt and stop'
        : state === 'transcribing' || state === 'thinking'
          ? 'Working…'
          : 'Start voice input'

  const displayText =
    state === 'listening'
      ? 'listen'
      : state === 'transcribing'
        ? '…'
        : state === 'thinking'
          ? '…'
          : state === 'speaking'
            ? 'mute'
            : 'mic'

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={state === 'transcribing'}
        aria-label={label}
        className={`rounded-sm border px-3 py-1 font-mono text-xs uppercase tracking-widest transition-colors disabled:opacity-40 ${
          state === 'listening'
            ? 'animate-pulse border-destructive/60 bg-destructive/15 text-destructive'
            : state === 'speaking'
              ? 'border-accent/60 bg-accent/15 text-accent'
              : 'border-[oklch(from_var(--accent-live)_l_c_h_/_30%)] text-primary hover:border-[oklch(from_var(--accent-live)_l_c_h_/_55%)]'
        }`}
      >
        {displayText}
      </button>
      {error && (
        <p className="absolute -bottom-6 right-3 whitespace-nowrap font-mono text-[10px] text-destructive">
          {'[voice] '}
          {error}
        </p>
      )}
    </>
  )
}
