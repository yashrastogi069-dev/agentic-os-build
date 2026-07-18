# Generates scripts\test.wav (16 kHz mono) using Windows built-in TTS,
# so the STT stage can be smoke-tested without a human speaking.
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$out = Join-Path $PSScriptRoot "test.wav"
$synth.SetOutputToWaveFile($out, $fmt)
$synth.Speak("Hello, this is a test of the local dictation system. The quick brown fox jumps over the lazy dog.")
$synth.Dispose()
Write-Output "Wrote $out"
