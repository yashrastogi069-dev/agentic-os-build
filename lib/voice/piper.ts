import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { readFile, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PIPER_BIN, PIPER_VOICE } from "./paths"
import { VoiceUnavailableError } from "./stt"

/**
 * Persistent Piper daemon (--json-input). One process serves every synth
 * call; a one-shot spawn per request blows the first-chunk latency budget
 * (see tasks/PHASE6_BENCH.md: 1065-3092ms one-shot vs 116-335ms warm daemon).
 * globalThis-guarded singleton so Next.js HMR never leaks a duplicate
 * process (same pattern as lib/db/index.ts).
 */

const IDLE_UNLOAD_MS = 5 * 60 * 1000
const SYNTH_TIMEOUT_MS = 20_000

type PendingRequest = {
  resolve: () => void
  reject: (err: Error) => void
}

type PiperDaemon = {
  proc: ChildProcessWithoutNullStreams
  tempDir: string
  pending: Map<string, PendingRequest>
  stdoutBuffer: string
  stderrTail: string
  idleTimer: NodeJS.Timeout | null
  crashedError: Error | null
}

type GlobalWithPiper = typeof globalThis & {
  __jarvisPiperDaemon?: PiperDaemon | null
  __jarvisPiperQueue?: Promise<unknown>
  __jarvisPiperCounter?: number
}

const g = globalThis as GlobalWithPiper

function assertInstalled(): void {
  if (!existsSync(PIPER_BIN) || !existsSync(PIPER_VOICE)) {
    throw new VoiceUnavailableError(
      `Piper TTS is not installed (looked for the binary at ${PIPER_BIN} and the voice model ` +
        `at ${PIPER_VOICE}). Run scripts/setup-voice.ps1 to install it.`,
    )
  }
}

function scheduleIdleUnload(daemon: PiperDaemon): void {
  if (daemon.idleTimer) clearTimeout(daemon.idleTimer)
  const timer = setTimeout(() => {
    if (g.__jarvisPiperDaemon === daemon) g.__jarvisPiperDaemon = null
    try {
      daemon.proc.kill()
    } catch {
      // already dead
    }
    void rm(daemon.tempDir, { recursive: true, force: true }).catch(() => {})
  }, IDLE_UNLOAD_MS)
  timer.unref()
  daemon.idleTimer = timer
}

function failAllPending(daemon: PiperDaemon, err: Error): void {
  for (const pending of daemon.pending.values()) pending.reject(err)
  daemon.pending.clear()
}

function handleStdoutLine(daemon: PiperDaemon, line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  // Piper prints the output file path on stdout when a line finishes.
  // Match on exact path first, then basename (in case Piper normalizes
  // slashes differently than what we sent).
  const pending = daemon.pending.get(trimmed)
  if (pending) {
    daemon.pending.delete(trimmed)
    pending.resolve()
    return
  }
  for (const [outPath, entry] of daemon.pending) {
    if (trimmed.endsWith(path.basename(outPath))) {
      daemon.pending.delete(outPath)
      entry.resolve()
      return
    }
  }
}

function startDaemon(): PiperDaemon {
  assertInstalled()
  const tempDir = mkdtempSync(path.join(tmpdir(), "jarvis-piper-"))
  const proc = spawn(
    PIPER_BIN,
    ["--model", PIPER_VOICE, "--json-input", "--output_dir", tempDir],
    { windowsHide: true },
  )

  const daemon: PiperDaemon = {
    proc,
    tempDir,
    pending: new Map(),
    stdoutBuffer: "",
    stderrTail: "",
    idleTimer: null,
    crashedError: null,
  }

  proc.stdout.setEncoding("utf8")
  proc.stdout.on("data", (chunk: string) => {
    daemon.stdoutBuffer += chunk
    let idx: number
    while ((idx = daemon.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = daemon.stdoutBuffer.slice(0, idx)
      daemon.stdoutBuffer = daemon.stdoutBuffer.slice(idx + 1)
      handleStdoutLine(daemon, line)
    }
  })

  proc.stderr.setEncoding("utf8")
  proc.stderr.on("data", (chunk: string) => {
    daemon.stderrTail = (daemon.stderrTail + chunk).slice(-2000)
  })

  proc.on("exit", (code, signal) => {
    const err = new Error(
      `piper daemon exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"}): ` +
        `${daemon.stderrTail.trim() || "no stderr output"}`,
    )
    daemon.crashedError = err
    failAllPending(daemon, err)
    if (daemon.idleTimer) clearTimeout(daemon.idleTimer)
    if (g.__jarvisPiperDaemon === daemon) g.__jarvisPiperDaemon = null
  })

  proc.on("error", (err) => {
    daemon.crashedError = err
    failAllPending(daemon, err)
    if (daemon.idleTimer) clearTimeout(daemon.idleTimer)
    if (g.__jarvisPiperDaemon === daemon) g.__jarvisPiperDaemon = null
  })

  scheduleIdleUnload(daemon)
  return daemon
}

function getDaemon(): PiperDaemon {
  if (!g.__jarvisPiperDaemon || g.__jarvisPiperDaemon.crashedError) {
    g.__jarvisPiperDaemon = startDaemon()
  } else {
    scheduleIdleUnload(g.__jarvisPiperDaemon)
  }
  return g.__jarvisPiperDaemon
}

async function runSynthesis(text: string): Promise<{ wav: Buffer; synthMs: number }> {
  const daemon = getDaemon()
  const t0 = performance.now()
  g.__jarvisPiperCounter = (g.__jarvisPiperCounter ?? 0) + 1
  const outPath = path.join(
    daemon.tempDir,
    `req-${process.pid}-${Date.now()}-${g.__jarvisPiperCounter}.wav`,
  )

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      daemon.pending.delete(outPath)
      reject(new Error(`piper synth timed out after ${SYNTH_TIMEOUT_MS}ms waiting for output`))
    }, SYNTH_TIMEOUT_MS)

    daemon.pending.set(outPath, {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    })

    const line = `${JSON.stringify({ text, output_file: outPath })}\n`
    daemon.proc.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timer)
        daemon.pending.delete(outPath)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })

  const wav = await readFile(outPath)
  await unlink(outPath).catch(() => {})
  return { wav, synthMs: Math.round(performance.now() - t0) }
}

/**
 * Synthesize speech via the persistent Piper daemon. Requests are serialized
 * through an internal queue since Piper processes json-input lines
 * sequentially on one stdin/stdout pair — interleaved writers would corrupt
 * ordering.
 */
export async function synthesize(text: string): Promise<{ wav: Buffer; synthMs: number }> {
  assertInstalled()
  const previous = g.__jarvisPiperQueue ?? Promise.resolve()
  const run = previous.then(
    () => runSynthesis(text),
    () => runSynthesis(text),
  )
  // Keep the shared queue tail settled so a rejection here never becomes an
  // unhandled rejection; the caller still observes it via the returned `run`.
  g.__jarvisPiperQueue = run.catch(() => {})
  return run
}

export async function ttsStatus(): Promise<{
  ok: boolean
  daemonUp: boolean
  binPresent: boolean
  voicePresent: boolean
}> {
  const binPresent = existsSync(PIPER_BIN)
  const voicePresent = existsSync(PIPER_VOICE)
  const daemonUp = !!g.__jarvisPiperDaemon && !g.__jarvisPiperDaemon.crashedError
  return { ok: binPresent && voicePresent, daemonUp, binPresent, voicePresent }
}
