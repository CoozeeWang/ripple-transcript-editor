#!/bin/zsh
set -u

# 薄入口：真正的启动/监视/停止逻辑在 scripts/launcher.mjs（跨平台）。
project_dir="${0:A:h}"
if ! node "$project_dir/scripts/launcher.mjs" start; then
  print "\nRipple 启动失败，请查看上面的错误。按回车关闭窗口。\nRipple failed to start. See the error above. Press Enter to close."
  read -r
  exit 1
fi

# 启动完成（服务已后台运行），尝试关闭这个终端窗口。
# 前台执行 osascript（不用 `&`），否则脚本 exit 后它可能被 SIGHUP 终止。
sleep 1
if osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1; then
  exit 0
fi

cat <<'EOF'

应用已在独立窗口打开。这个终端窗口没能自动关闭（macOS 自动化权限未授权）。
一次性解决（二选一，之后每次都能自动关窗口）：
  ① Terminal → 设置 → 描述文件 → Shell → 「当 shell 退出时」选「关闭窗口」
  ② 系统设置 → 隐私与安全性 → 自动化 → 勾选「终端」

现在可以直接关掉本窗口（⌘W），不影响已运行的应用。

Ripple opened in its own window. This terminal could not close automatically.
You may close this terminal (Command+W); Ripple will keep running.
For automatic closing, choose Terminal > Settings > Profiles > Shell >
When the shell exits > Close the window; or enable Terminal automation
in System Settings > Privacy & Security > Automation.
EOF
exit 0
