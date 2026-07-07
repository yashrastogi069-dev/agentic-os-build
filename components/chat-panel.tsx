'use client'

import { useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { CoreState } from '@/components/core-stage'
import { WavRecorder } from '@/lib/voice/recorder'

type VoiceState = 'off' | 'recording' | 'transcribing' | 'speaking'

export function ChatPanel({
  onStateChange,
}: {
  onStateChange?: (state: CoreState) => void
}) {
  const [input, setInput] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('off')
  const [voiceError, setVoiceError] = useState('')
  const recorderRef = useRef<WavRecorder | null>(null)
  const voiceReplyPending = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    onStateChange?.(
      voiceState === 'recording'
        ? 'listening'
        : voiceState === 'speaking'
          ? 'speaking'
          : busy || voiceState === 'transcribing'
            ? 'thinking'
            : 'idle',
    )
  }, [busy, voiceState, onStateChange])

  // Voice loop tail: when a voice-initiated turn finishes, speak the reply via Piper.
  useEffect(() => {
    if (status !== 'ready' || !voiceReplyPending.current) return
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return
    voiceReplyPending.current = false

    const text = lastMessage.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .trim()
    if (!text) return

    let cancelled = false
    setVoiceState('speaking')
    ;(async () => {
      try {
        const res = await fetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 1200) }),
        })
        if (!res.ok) {
          const json = (await res.json()) as { error?: string }
          throw new Error(json.error ?? 'speech failed')
        }
        const url = URL.createObjectURL(await res.blob())
        if (cancelled) return
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setVoiceState('off')
        }
        await audio.play()
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'speech failed')
        setVoiceState('off')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status, messages])

  async function toggleMic() {
    setVoiceError('')
    if (voiceState === 'speaking') {
      audioRef.current?.pause()
      setVoiceState('off')
      return
    }
    if (voiceState === 'recording') {
      setVoiceState('transcribing')
      try {
        const wav = await recorderRef.current!.stop()
        recorderRef.current = null
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: wav,
        })
        const json = (await res.json()) as { text?: string; error?: string }
        if (!res.ok || !json.text) {
          throw new Error(json.error ?? 'nothing transcribed')
        }
        voiceReplyPending.current = true
        sendMessage({ text: json.text })
        setVoiceState('off')
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'transcription failed')
        setVoiceState('off')
      }
      return
    }
    try {
      const recorder = new WavRecorder()
      await recorder.start()
      recorderRef.current = recorder
      setVoiceState('recording')
    } catch {
      setVoiceError('microphone access denied')
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  function submit() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    sendMessage({ text })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-3"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="p-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {'> AGENT READY. Ask anything — I remember what matters.'}
            <br />
            {'> try: "remember that I prefer dark roast coffee"'}
            <br />
            {'> try: "what do you know about me?"'}
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[92%] rounded-md border px-3 py-2 text-sm leading-relaxed ${
              message.role === 'user'
                ? 'ml-auto border-primary/30 bg-primary/10 text-foreground'
                : 'border-border bg-card text-card-foreground'
            }`}
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {message.role === 'user' ? 'you' : 'agent'}
            </p>
            {message.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <p key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </p>
                )
              }
              if (part.type.startsWith('tool-')) {
                return (
                  <p
                    key={i}
                    className="my-1 font-mono text-[10px] text-primary/80"
                  >
                    {'[tool] '}
                    {part.type.replace('tool-', '')}
                  </p>
                )
              }
              return null
            })}
          </div>
        ))}
        {busy && (
          <p className="animate-pulse px-2 font-mono text-xs text-primary">
            processing…
          </p>
        )}
        {error && (
          <p className="px-2 font-mono text-xs text-destructive">
            {'[error] '}
            {error.message}
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border px-3 pt-2">
        {['brief me', "what's new on github?", 'what do you know about me?'].map(
          (quick) => (
            <button
              key={quick}
              type="button"
              disabled={busy}
              onClick={() => sendMessage({ text: quick })}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              {quick}
            </button>
          ),
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t-0 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="font-mono text-primary" aria-hidden="true">
          {'>'}
        </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !(e.nativeEvent.isComposing || e.keyCode === 229)
            ) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="command the OS…"
          aria-label="Message the agent"
          className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy || voiceState === 'transcribing'}
          aria-label={
            voiceState === 'recording'
              ? 'Stop recording and send'
              : voiceState === 'speaking'
                ? 'Stop speaking'
                : 'Start voice input'
          }
          className={`rounded-sm border px-3 py-1 font-mono text-xs uppercase tracking-widest transition-colors disabled:opacity-40 ${
            voiceState === 'recording'
              ? 'animate-pulse border-destructive/60 bg-destructive/15 text-destructive'
              : voiceState === 'speaking'
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
          }`}
        >
          {voiceState === 'recording'
            ? 'stop'
            : voiceState === 'transcribing'
              ? '…'
              : voiceState === 'speaking'
                ? 'mute'
                : 'mic'}
        </button>
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
        >
          send
        </button>
      </form>
      {voiceError && (
        <p className="px-3 pb-2 font-mono text-[10px] text-destructive">
          {'[voice] '}
          {voiceError}
        </p>
      )}
    </div>
  )
}
