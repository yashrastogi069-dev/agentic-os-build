# setup-voice.ps1 — Windows voice binaries for Jarvis (Phase 6).
# Idempotent: skips anything already present. Pinned versions only.
#
# Installs:
#   bin/piper/piper.exe            Piper TTS 2023.11.14-2 (rhasspy/piper)
#   models/en_US-lessac-medium.onnx(+.json)  Piper voice (rhasspy/piper-voices v1.0.0)
#   tools/stt-server/.venv         faster-whisper sidecar env (reuses the
#                                  HuggingFace model cache; no model download
#                                  if the dictation tool already pulled it)
#
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/setup-voice.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$PiperZipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
$VoiceBase = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"

$binDir = Join-Path $root "bin"
$modelsDir = Join-Path $root "models"
$piperExe = Join-Path $binDir "piper\piper.exe"
$voiceOnnx = Join-Path $modelsDir "en_US-lessac-medium.onnx"
$voiceJson = Join-Path $modelsDir "en_US-lessac-medium.onnx.json"

New-Item -ItemType Directory -Force $binDir | Out-Null
New-Item -ItemType Directory -Force $modelsDir | Out-Null

if (-not (Test-Path $piperExe)) {
    Write-Host "Downloading Piper (pinned 2023.11.14-2)..."
    $zip = Join-Path $env:TEMP "piper_windows_amd64.zip"
    Invoke-WebRequest -Uri $PiperZipUrl -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $binDir -Force
    Remove-Item $zip
    if (-not (Test-Path $piperExe)) { throw "piper.exe missing after extract — release layout changed?" }
    Write-Host "Piper installed: $piperExe"
} else {
    Write-Host "Piper already present: $piperExe"
}

foreach ($pair in @(@($voiceOnnx, "$VoiceBase/en_US-lessac-medium.onnx"),
                    @($voiceJson, "$VoiceBase/en_US-lessac-medium.onnx.json"))) {
    $dest = $pair[0]; $url = $pair[1]
    if (-not (Test-Path $dest)) {
        Write-Host "Downloading $(Split-Path -Leaf $dest)..."
        Invoke-WebRequest -Uri $url -OutFile $dest
    } else {
        Write-Host "Voice file already present: $(Split-Path -Leaf $dest)"
    }
}

$sttDir = Join-Path $root "tools\stt-server"
$sttPython = Join-Path $sttDir ".venv\Scripts\python.exe"
if (-not (Test-Path $sttPython)) {
    Write-Host "Creating STT sidecar venv..."
    python -m venv (Join-Path $sttDir ".venv")
    & $sttPython -m pip install --quiet -r (Join-Path $sttDir "requirements.txt")
} else {
    Write-Host "STT sidecar venv already present"
}
& $sttPython -c "import faster_whisper; print('faster-whisper', faster_whisper.__version__, 'ready')"

Write-Host ""
Write-Host "Voice setup complete. Verify with: piper --help / GET http://127.0.0.1:8765/health after starting the sidecar."
