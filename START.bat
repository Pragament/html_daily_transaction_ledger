@echo off
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py) || (set PY=python)
start "" http://localhost:8765/index.html
%PY% -m http.server 8765
pause
