/**
 * Splits a growing streamed text response into speakable sentence-ish chunks
 * as they complete, so TTS (lib/voice/tts-queue.ts) can start speaking the
 * first sentence while the brain is still generating the rest.
 *
 * Intentionally pragmatic, not a real sentence tokenizer: false negatives
 * (a chunk that runs slightly long) are fine; false positives (a mid-sentence
 * cut, e.g. inside "U.S." or "3.14") are worse for TTS naturalness, so the
 * boundary guard biases toward NOT splitting when unsure.
 */

const BOUNDARY_CHARS = new Set([".", "!", "?", "\n"])

export class SentenceChunker {
  private buffer = ""
  /** How much of `buffer` (from the start) has already been emitted as chunks. */
  private emittedUpTo = 0

  /**
   * Accepts an incremental text delta (as it arrives from a streaming chat
   * response) and returns zero or more newly-completed chunks.
   */
  push(deltaText: string): string[] {
    if (!deltaText) return []
    this.buffer += deltaText

    const chunks: string[] = []
    let scanFrom = this.emittedUpTo

    for (let i = scanFrom; i < this.buffer.length; i++) {
      const ch = this.buffer[i]
      if (!BOUNDARY_CHARS.has(ch)) continue
      if (this.isFalseBoundary(i)) continue

      // Consume trailing whitespace after the boundary char, if any is
      // already present; otherwise this could still be mid-stream (e.g. the
      // delta ended exactly on the period) — still safe to split here since
      // the boundary char itself is confirmed non-abbreviation/non-decimal.
      let end = i + 1
      while (end < this.buffer.length && /\s/.test(this.buffer[end])) end++

      const raw = this.buffer.slice(this.emittedUpTo, end).trim()
      if (raw.length > 0) {
        const cleaned = stripMarkdown(raw)
        if (cleaned.length > 0) chunks.push(cleaned)
      }
      this.emittedUpTo = end
    }

    return chunks
  }

  /**
   * True if the boundary character at `index` looks like an abbreviation
   * (e.g. "U.S.") or a decimal point (e.g. "3.14") rather than a real
   * sentence end. Only meaningful for '.', but harmless to call for others.
   */
  private isFalseBoundary(index: number): boolean {
    const ch = this.buffer[index]
    if (ch !== ".") return false

    const prev = this.buffer[index - 1]
    const prevPrev = this.buffer[index - 2]
    const next = this.buffer[index + 1]
    const nextNext = this.buffer[index + 2]

    // Decimal: digit '.' digit, e.g. "3.14"
    if (prev && /\d/.test(prev) && next && /\d/.test(next)) return true

    // Abbreviation: single uppercase letter (optionally preceded by another
    // "X." pair) immediately before the period, e.g. "U.S." — the char
    // before that uppercase letter must be a boundary/space/start-of-string
    // or another period, not a lowercase letter (which would be a normal
    // capitalized word ending a sentence, e.g. "...ended.").
    if (prev && /[A-Z]/.test(prev)) {
      const beforePrev = this.buffer[index - 2]
      if (beforePrev === undefined || beforePrev === "." || /\s/.test(beforePrev)) {
        return true
      }
      // e.g. "U.S." — prevPrev is '.', already covered above.
      void prevPrev
      void nextNext
      return false
    }

    return false
  }

  /** Flush any trailing partial sentence at stream end. Returns null if nothing pending. */
  finalize(): string | null {
    const remaining = this.buffer.slice(this.emittedUpTo).trim()
    this.emittedUpTo = this.buffer.length
    if (remaining.length === 0) return null
    const cleaned = stripMarkdown(remaining)
    return cleaned.length > 0 ? cleaned : null
  }

  /** Reset for a new streaming turn. */
  reset(): void {
    this.buffer = ""
    this.emittedUpTo = 0
  }
}

/** Strip markdown syntax that would sound bad read aloud. Simple regex-based, not a full parser. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/__([^_]+)__/g, "$1") // bold (underscore)
    .replace(/_([^_]+)_/g, "$1") // italic (underscore)
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/^\s*[-*]\s+/gm, "") // bullet list markers at line start
    .replace(/\s+/g, " ")
    .trim()
}
