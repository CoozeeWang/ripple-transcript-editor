@echo off
rem 薄入口：真正的停止逻辑在 scripts\launcher.mjs（跨平台）。
cd /d "%~dp0"
node scripts\launcher.mjs stop
