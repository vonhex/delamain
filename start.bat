@echo off
rem Start Delamain on http://localhost:8888 (set PORT to change it).
rem .env is optional: everything can be set in the web UI under Settings.
cd /d "%~dp0"
if exist .env for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if not "%%b"=="" set "%%a=%%b"
if "%PORT%"=="" set PORT=8888
venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port %PORT% --ws-ping-interval 60 --ws-ping-timeout 30 --log-level warning
