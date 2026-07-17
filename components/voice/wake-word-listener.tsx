'use client'

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { WorkletRecorder } from '@/lib/voice/recorder'
import { EnergyVad } from '@/lib/voice/vad'
import { matchWakePhrase, type WakeWordEntry } from '@/lib/wake-words-match'

/**
 * Always-on background wake-word listener — mounted once at the app shell
 * level (components/hud/hud-shell.tsx). Runs its own independent
 * WorkletRecorder + EnergyVad (deliberately separate from
 * components/voice/voice-controller.tsx's conversation recorder — background
 * wake-detection and active conversation are two different mic-consumer
 * concerns; sharing one recorder instance across both is a future
 * optimization, out of scope here).
 *
 * On each short speech segment it runs the same server STT call the
 * conversation flow uses (already resident/warm, ~0.5-1s per short
 * utterance per tasks/PHASE6_BENCH.md) and checks the transcript against the
 * registered wake phrases (lib/wake-words.ts) — no new ML wake-word
 * dependency, reusing the existing pipeline per the project's hand-rolled
 * pattern (see lib/voice/vad.ts).
 *
 * Pauses itself (stops its recorder, releases the mic) whenever
 * voice-controller.tsx's conversation is active, coordinated via the
 * `jarvis:conversation-active` window CustomEvent, so the two components
 * never fight over getUserMedia and "Jarvis" said mid-conversation doesn't
 * double-trigger.
 */

/** Segments longer than this are discarded without an STT call — not a plausible wake phrase. */
const MAX_UTTERANCE_MS = 6000

interface WakeWordStoreState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useWakeWordStore = create<WakeWordStoreState>((set) => ({
  // Defaults off (Yash 2026-07-17): Jarvis activates only via hotkey/reactor
  // click, not always-on background listening. See lib/wake-words.ts.
  enabled: false,
  setEnabled: (enabled) => {
    set({ enabled })
    // Persist through the server route — this module is client-side and
    // cannot touch the DB directly (lib/wake-words is server-only).
    void fetch('/api/wake-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-listening', enabled }),
    }).catch(() => undefined)
  },
}))

export function WakeWordListener() {
  const enabled = useWakeWordStore((s) => s.enabled)
  const setEnabled = useWakeWordStore((s) => s.setEnabled)

  const [conversationActive, setConversationActive] = useState(false)
  const [listening, setListening] = useState(false)
  const [unavailableReason, setUnavailableReason] = useState('')

  const recorderRef = useRef<WorkletRecorder | null>(null)
  const vadRef = useRef<EnergyVad | null>(null)
  const speechStartAtRef = useRef<number | null>(null)
  const processingRef = useRef(false)
  const stoppedByUserRef = useRef(false)
  const entriesRef = useRef<WakeWordEntry[]>([])

  // Load the registered wake phrases + persisted enabled state once on mount,
  // via the server route (the registry lives in the DB; matching runs here).
  useEffect(() => {
    let cancelled = false
    void fetch('/api/wake-words')
      .then((r) => r.json())
      .then((data: { entries?: WakeWordEntry[]; listeningEnabled?: boolean }) => {
        if (cancelled) return
        if (Array.isArray(data.entries)) entriesRef.current = data.entries
        if (typeof data.listeningEnabled === 'boolean') {
          useWakeWordStore.setState({ enabled: data.listeningEnabled })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function handleConversationActive(event: Event) {
      const detail = (event as CustomEvent<{ active: boolean }>).detail
      setConversationActive(Boolean(detail?.active))
    }
    window.addEventListener('jarvis:conversation-active', handleConversationActive)
    return () => window.removeEventListener('jarvis:conversation-active', handleConversationActive)
  }, [])

  async function teardown() {
    const recorder = recorderRef.current
    recorderRef.current = null
    vadRef.current = null
    speechStartAtRef.current = null
    processingRef.current = false
    if (recorder) {
      await recorder.stop().catch(() => undefined)
    }
    setListening(false)
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!enabled || conversationActive) {
        await teardown()
        return
      }

      stoppedByUserRef.current = false
      setUnavailableReason('')

      try {
        const recorder = new WorkletRecorder()
        const vad = new EnergyVad()

        vad.onSpeechStart = () => {
          recorder.markSpeechStart()
          speechStartAtRef.current = performance.now()
        }

        vad.onSpeechEnd = () => {
          if (processingRef.current) return
          void handleUtterance(recorder, vad)
        }

        recorder.onSample = (rms, nowMs) => {
          vad.push(rms, nowMs)
        }

        await recorder.start()
        if (cancelled) {
          await recorder.stop().catch(() => undefined)
          return
        }

        recorderRef.current = recorder
        vadRef.current = vad
        setListening(true)
      } catch (err) {
        // Mic permission denied (or any other acquisition failure) for the
        // background listener specifically — do not crash the app, and don't
        // leave the user stuck with a broken always-retrying listener.
        console.warn('[wake-word] microphone unavailable:', err)
        setUnavailableReason(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'wake-word unavailable: microphone access denied'
            : 'wake-word unavailable: microphone error',
        )
        // Disable + persist through the store's server-routed setter.
        useWakeWordStore.getState().setEnabled(false)
      }
    }

    async function handleUtterance(recorder: WorkletRecorder, vad: EnergyVad) {
      processingRef.current = true
      const startedAt = speechStartAtRef.current
      speechStartAtRef.current = null
      const durationMs = startedAt !== null ? performance.now() - startedAt : 0

      try {
        if (durationMs > MAX_UTTERANCE_MS) {
          // Wildly implausible as a wake phrase — don't waste an STT call.
          recorder.discardUtterance()
          return
        }

        const wav = recorder.finishUtterance()
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: wav,
        })
        const json = (await res.json()) as { text?: string; error?: string }
        if (!res.ok || !json.text) return

        const match = matchWakePhrase(json.text, entriesRef.current)
        if (!match) return

        if (match.action === 'activate-voice') {
          window.dispatchEvent(new CustomEvent('jarvis:toggle-mic'))
        } else {
          window.dispatchEvent(
            new CustomEvent('jarvis:wake-action', { detail: { action: match.action, phrase: match.phrase } }),
          )
        }
      } catch (err) {
        console.warn('[wake-word] utterance handling failed:', err)
      } finally {
        vad.reset()
        processingRef.current = false
      }
    }

    void run()

    return () => {
      cancelled = true
      void teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, conversationActive])

  // Full teardown on unmount.
  useEffect(() => {
    return () => {
      void teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showActiveDot = listening && enabled && !conversationActive && !unavailableReason

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-40 flex items-center gap-1.5">
      {showActiveDot && (
        <span
          className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
          aria-label="background wake-word listening active"
        >
          <span
            className="size-1.5 animate-pulse rounded-full bg-accent/70"
            aria-hidden="true"
          />
          wake
        </span>
      )}
      {unavailableReason && (
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-destructive/70">
          {unavailableReason}
        </span>
      )}
    </div>
  )
}
