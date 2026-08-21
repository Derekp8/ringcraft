@echo off
setlocal EnableExtensions
title Project Ringcraft Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Project Ringcraft requires Node.js.
  echo Install Node.js 24 or a current LTS release, then run this launcher again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node scripts\launch-local.mjs %*
if errorlevel 1 (
  echo.
  echo Ringcraft did not launch successfully. Review the error above.
  pause
  exit /b 1
)
