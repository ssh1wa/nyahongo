@echo off
rem Keep this file ASCII-only: cmd misparses UTF-8 batch files.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
uv run nihongo ui --lan
pause
