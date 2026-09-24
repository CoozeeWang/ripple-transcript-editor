@echo off
rem 薄入口：真正的启动/监视/停止逻辑在 scripts\launcher.mjs（跨平台）。
cd /d "%~dp0"
node scripts\launcher.mjs start

if errorlevel 1 (
  echo Ripple failed to start. See the error above.
  pause
  exit /b 1
)
