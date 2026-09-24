#!/bin/zsh
set -u

# 薄入口：真正的停止逻辑在 scripts/launcher.mjs（跨平台）。
project_dir="${0:A:h}"
node "$project_dir/scripts/launcher.mjs" stop

# 前台尝试关闭终端窗口（不用 `&`）。失败（权限未授权）也不影响停止结果。
sleep 1
osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1
exit 0
