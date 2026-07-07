import path from "node:path"

/**
 * Local voice binary locations. scripts/setup-voice.sh downloads everything
 * into ./bin and ./models. Override with env vars if you keep them elsewhere.
 */

const BIN_DIR = path.join(process.cwd(), "bin")
const MODELS_DIR = path.join(process.cwd(), "models")

export const WHISPER_BIN =
  process.env.WHISPER_BIN ?? path.join(BIN_DIR, "whisper-cli")

export const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? path.join(MODELS_DIR, "ggml-tiny.en.bin")

export const PIPER_BIN = process.env.PIPER_BIN ?? path.join(BIN_DIR, "piper")

export const PIPER_VOICE =
  process.env.PIPER_VOICE ?? path.join(MODELS_DIR, "en_US-lessac-medium.onnx")
