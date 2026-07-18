@echo off
rem Starts dictation ELEVATED so it can also type into admin windows
rem (regedit, elevated terminals, installers). Windows will show a UAC prompt.
powershell -Command "Start-Process -FilePath '%~dp0.venv\Scripts\pythonw.exe' -ArgumentList '-m','dictate.main' -WorkingDirectory '%~dp0' -Verb RunAs"
