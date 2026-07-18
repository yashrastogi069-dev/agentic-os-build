@echo off
rem Starts dictation with NO console window (pythonw). Feedback = beeps + wave overlay.
rem To stop it: Task Manager -> find "pythonw.exe" -> End task.
cd /d "%~dp0"
start "" "%~dp0.venv\Scripts\pythonw.exe" -m dictate.main
