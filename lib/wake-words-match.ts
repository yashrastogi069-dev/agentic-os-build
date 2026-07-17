/**
 * Pure wake-phrase matching — Phase 6 wake-word system.
 *
 * This module has NO server dependencies (no DB, no settings, no node:fs) so
 * it is safe to import into the client wake-word listener. The persisted
 * registry (add/remove/enable, read/write of the listening toggle) lives in
 * lib/wake-words.ts, which is server-only; the client fetches the entry list
 * via /api/wake-words and runs the matching here in the browser.
 */

export interface WakeWordEntry {
  id: string
  phrase: string
  action: string
  enabled: boolean
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Returns the first ENABLED entry whose phrase appears as a whole
 * word/phrase in the transcript, or null. Deliberately simple word-boundary
 * matching, not fuzzy — false negatives (user repeats) are acceptable, false
 * positives (random speech firing an action) are the thing to avoid.
 */
export function matchWakePhrase(
  transcript: string,
  entries: WakeWordEntry[],
): WakeWordEntry | null {
  const normalizedTranscript = normalize(transcript)
  if (!normalizedTranscript) return null

  for (const entry of entries) {
    if (!entry.enabled) continue
    const normalizedPhrase = normalize(entry.phrase)
    if (!normalizedPhrase) continue
    const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "u")
    if (pattern.test(` ${normalizedTranscript} `)) {
      return entry
    }
  }
  return null
}
