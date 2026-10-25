@echo off
rem One-step installer for Delamain on Windows: double-click this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 pause
