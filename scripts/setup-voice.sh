#!/usr/bin/env bash
# Agentic OS — local voice stack setup (whisper.cpp STT + Piper TTS).
# Downloads binaries into ./bin and models into ./models. All free/open source.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p bin models

OS="$(uname -s)"
ARCH="$(uname -m)"

echo "==> Agentic OS voice setup ($OS $ARCH)"

# ---------- whisper.cpp ----------
if [ ! -x bin/whisper-cli ]; then
  echo "==> Building whisper.cpp (requires git + cmake + a C++ compiler)"
  TMP_DIR="$(mktemp -d)"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$TMP_DIR/whisper.cpp"
  cmake -S "$TMP_DIR/whisper.cpp" -B "$TMP_DIR/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$TMP_DIR/whisper.cpp/build" --config Release -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu)" --target whisper-cli >/dev/null
  cp "$TMP_DIR/whisper.cpp/build/bin/whisper-cli" bin/whisper-cli
  rm -rf "$TMP_DIR"
  echo "    bin/whisper-cli ready"
else
  echo "==> whisper-cli already present, skipping"
fi

# ---------- whisper tiny.en model (~75 MB) ----------
if [ ! -f models/ggml-tiny.en.bin ]; then
  echo "==> Downloading whisper tiny.en model"
  curl -L -o models/ggml-tiny.en.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
else
  echo "==> whisper model already present, skipping"
fi

# ---------- Piper TTS ----------
if [ ! -x bin/piper ]; then
  echo "==> Downloading Piper TTS binary"
  case "$OS-$ARCH" in
    Linux-x86_64)  PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" ;;
    Linux-aarch64) PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz" ;;
    Darwin-arm64)  PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_aarch64.tar.gz" ;;
    Darwin-x86_64) PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz" ;;
    *) echo "!! Unsupported platform: $OS-$ARCH. Install piper manually and set PIPER_BIN."; exit 1 ;;
  esac
  TMP_TAR="$(mktemp)"
  curl -L -o "$TMP_TAR" "$PIPER_URL"
  tar -xzf "$TMP_TAR" -C bin --strip-components=1
  rm -f "$TMP_TAR"
  chmod +x bin/piper
  echo "    bin/piper ready"
else
  echo "==> piper already present, skipping"
fi

# ---------- Piper voice (~60 MB) ----------
if [ ! -f models/en_US-lessac-medium.onnx ]; then
  echo "==> Downloading Piper voice (en_US-lessac-medium)"
  curl -L -o models/en_US-lessac-medium.onnx \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
  curl -L -o models/en_US-lessac-medium.onnx.json \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
else
  echo "==> piper voice already present, skipping"
fi

echo ""
echo "==> Voice stack ready. Also make sure Ollama is running with:"
echo "    ollama pull nomic-embed-text   (embeddings for memory)"
echo "    ollama pull llama3.2:3b        (offline chat fallback, optional)"
