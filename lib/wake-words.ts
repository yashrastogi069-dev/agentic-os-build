import crypto from "node:crypto"
import { getConnectorConfig, setConnectorConfig } from "@/lib/settings"
import type { WakeWordEntry } from "@/lib/wake-words-match"

/**
 * Wake-word registry — Phase 6 wake-word system (SERVER-ONLY: touches the DB
 * via lib/settings). The pure phrase-matching used in the browser lives in
 * lib/wake-words-match.ts; the client wake-word listener fetches this
 * registry's entries via /api/wake-words and matches there.
 *
 * Extensible phrase -> action mapping, persisted via connector_settings
 * ("wakeWords" key, matching lib/settings.ts's key-value pattern). Only the
 * default "jarvis" -> "activate-voice" action is wired to real behavior
 * today (components/voice/wake-word-listener.tsx dispatches
 * `jarvis:toggle-mic` for it); any other `action` string is dispatched as a
 * generic `jarvis:wake-action` CustomEvent so future features can listen for
 * their own action id without touching this file or the detection logic.
 */

const CONNECTOR_KEY = "wakeWords"
const LISTENING_CONNECTOR_KEY = "wakeWordListening"

export type { WakeWordEntry }

interface WakeWordStore extends Record<string, unknown> {
  entries: WakeWordEntry[]
}

const DEFAULT_ENTRIES: WakeWordEntry[] = [
  { id: "default-jarvis", phrase: "jarvis", action: "activate-voice", enabled: true },
]

function readStore(): WakeWordStore {
  const config = getConnectorConfig<WakeWordStore>(CONNECTOR_KEY)
  if (!config || !Array.isArray(config.entries)) {
    const seeded: WakeWordStore = { entries: DEFAULT_ENTRIES.map((e) => ({ ...e })) }
    setConnectorConfig(CONNECTOR_KEY, seeded)
    return seeded
  }
  return config
}

function writeStore(store: WakeWordStore): void {
  setConnectorConfig(CONNECTOR_KEY, store)
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase()
}

export function listWakeWords(): WakeWordEntry[] {
  return readStore().entries
}

export function addWakeWord(phrase: string, action: string): WakeWordEntry {
  const normalized = normalizePhrase(phrase)
  if (!normalized) {
    throw new Error("Wake phrase cannot be empty.")
  }
  if (!action.trim()) {
    throw new Error("Wake word action cannot be empty.")
  }
  const store = readStore()
  const duplicate = store.entries.some((e) => normalizePhrase(e.phrase) === normalized)
  if (duplicate) {
    throw new Error(`A wake word with the phrase "${normalized}" already exists.`)
  }
  const entry: WakeWordEntry = {
    id: crypto.randomUUID(),
    phrase: normalized,
    action: action.trim(),
    enabled: true,
  }
  store.entries = [...store.entries, entry]
  writeStore(store)
  return entry
}

export function removeWakeWord(id: string): void {
  const store = readStore()
  const exists = store.entries.some((e) => e.id === id)
  if (!exists) {
    throw new Error(`No wake word with id "${id}" found.`)
  }
  store.entries = store.entries.filter((e) => e.id !== id)
  writeStore(store)
}

export function setWakeWordEnabled(id: string, enabled: boolean): WakeWordEntry {
  const store = readStore()
  const index = store.entries.findIndex((e) => e.id === id)
  if (index === -1) {
    throw new Error(`No wake word with id "${id}" found.`)
  }
  const updated: WakeWordEntry = { ...store.entries[index], enabled }
  store.entries = [...store.entries.slice(0, index), updated, ...store.entries.slice(index + 1)]
  writeStore(store)
  return updated
}

/* ---------- Background listening toggle ---------- */

export function getWakeListeningEnabled(): boolean {
  const config = getConnectorConfig<{ enabled: boolean }>(LISTENING_CONNECTOR_KEY)
  return config?.enabled !== false
}

export function setWakeListeningEnabled(enabled: boolean): void {
  setConnectorConfig(LISTENING_CONNECTOR_KEY, { enabled })
}
