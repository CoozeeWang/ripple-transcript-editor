// The launcher runs before browser preferences are available. Keep both languages visible.
const messages = {
  "等待启动或停止操作超时，请稍后重试。": {
    "zh": "等待 Ripple 启动或停止超时。请稍后重试。",
    "en": "Timed out waiting for Ripple to start or stop. Try again later."
  },
  "端口 {{v0}} 由其他程序使用，已保留该程序。": {
    "zh": "端口 {{v0}} 正被其他程序使用，因此未停止该程序。",
    "en": "Port {{v0}} is in use by another application, so that application was left running."
  },
  "等待超时：{{v0}}": {
    "zh": "等待超时：{{v0}}",
    "en": "Timed out waiting for {{v0}}."
  },
  "专用 Chrome 实例未响应退出信号，清理残留进程…": {
    "zh": "Ripple 使用的 Google Chrome 实例未响应退出请求，正在清理残留进程…",
    "en": "The Google Chrome instance used by Ripple didn’t respond to the shutdown request. Cleaning up remaining processes…"
  },
  "专用 Chrome 实例仍未退出，请关闭 Ripple 窗口后重试。": {
    "zh": "Ripple 使用的 Google Chrome 实例仍在运行。请关闭 Ripple 窗口后重试。",
    "en": "The Google Chrome instance used by Ripple is still running. Close the Ripple window and try again."
  },
  "已停止 Ripple。": {
    "zh": "已停止 Ripple。",
    "en": "Ripple stopped."
  },
  "找不到 uv，请先安装 uv。": {
    "zh": "未找到 uv。请先安装 uv。",
    "en": "uv wasn’t found. Install uv first."
  },
  "后台端口由其他程序使用，未停止该程序。": {
    "zh": "Ripple 本地服务使用的端口正被其他程序占用，因此未停止该程序。",
    "en": "The port used by Ripple’s local service is in use by another application, so that application was left running."
  },
  "后台正以开发热重载模式运行，请通过开发终端重启。": {
    "zh": "Ripple 本地服务正以开发热重载模式运行。请从开发终端重启。",
    "en": "Ripple’s local service is running with development hot reload. Restart it from the development terminal."
  },
  "后台仍在处理请求，稍后重试；编辑窗口已保留。": {
    "zh": "Ripple 本地服务仍在处理请求，请稍后重试。编辑窗口会保持打开。",
    "en": "Ripple’s local service is still processing requests. Try again later; the editor window will remain open."
  },
  "后台更新失败，请查看 .logs/backend.log。": {
    "zh": "Ripple 本地服务更新失败。请查看 .logs/backend.log。",
    "en": "Ripple’s local service update failed. See .logs/backend.log."
  },
  "后台仍缺少编辑接口，请检查安装文件。": {
    "zh": "Ripple 本地服务仍缺少编辑功能。请检查安装文件。",
    "en": "Ripple’s local service still lacks editing support. Check the installation files."
  },
  "后台已更新，编辑窗口与稿件已保留。": {
    "zh": "Ripple 本地服务已更新。编辑窗口和转录稿均已保留。",
    "en": "Ripple’s local service was updated. The editor window and transcripts were preserved."
  },
  "找不到 npm，请先安装 Node.js。": {
    "zh": "未找到 npm。请先安装 Node.js。",
    "en": "npm wasn’t found. Install Node.js first."
  },
  "前端依赖尚未安装，请先在 frontend 目录运行 npm install。": {
    "zh": "前端依赖尚未安装。请先在 frontend 目录运行 npm install。",
    "en": "Frontend dependencies aren’t installed. Run npm install in the frontend directory first."
  },
  "正在启动，请稍候…": {
    "zh": "正在启动 Ripple…",
    "en": "Starting Ripple…"
  },
  "端口 {{v0}} 被其他程序占用（PID {{v1}}），未关闭该程序。": {
    "zh": "端口 {{v0}} 正被其他程序使用（PID {{v1}}），因此未关闭该程序。",
    "en": "Port {{v0}} is in use by another application (PID {{v1}}), so that application was left running."
  },
  "检测到旧版后台，正在载入编辑引擎功能…": {
    "zh": "检测到旧版 Ripple 本地服务，正在加载编辑功能…",
    "en": "An older version of Ripple’s local service was detected. Loading editing support…"
  },
  "复用 Ripple 已运行的服务，重新打开窗口…": {
    "zh": "正在复用已运行的 Ripple 服务并重新打开窗口…",
    "en": "Reusing the running Ripple services and reopening the window…"
  },
  "启动失败，详见 .logs/ 目录。": {
    "zh": "Ripple 启动失败。详情请查看 .logs/ 目录。",
    "en": "Ripple failed to start. See the .logs/ directory for details."
  },
  "服务启动失败，请查看 .logs/backend.log 和 .logs/frontend.log。": {
    "zh": "Ripple 服务启动失败。请查看 .logs/backend.log 和 .logs/frontend.log。",
    "en": "Ripple services failed to start. See .logs/backend.log and .logs/frontend.log."
  },
  "Chrome 应用进程未能启动，请检查 Chrome 是否已安装。": {
    "zh": "无法启动 Ripple 使用的 Google Chrome 进程。请确认已安装 Google Chrome。",
    "en": "Couldn’t start the Google Chrome process used by Ripple. Make sure Google Chrome is installed."
  },
  "已打开。关闭应用窗口即自动停止；也可双击 stop 脚本停止。": {
    "zh": "Ripple 已打开。关闭 Ripple 窗口即可自动停止；也可以双击停止脚本。",
    "en": "Ripple is open. Close the Ripple window to stop it automatically, or double-click the stop script."
  },
  "watch 启动，pid={{v0}}": {
    "zh": "窗口监控已启动，PID={{v0}}",
    "en": "Window monitor started, PID={{v0}}."
  },
  "初始检测完成，chromeWasUp={{v0}}": {
    "zh": "初始检测完成，Chrome 已运行={{v0}}",
    "en": "Initial check complete, Chrome already running={{v0}}."
  },
  "未能打开应用窗口，正在清理本次服务。": {
    "zh": "无法打开 Ripple 窗口。正在停止本次启动的服务。",
    "en": "Couldn’t open the Ripple window. Stopping services started by this launch."
  },
  "检测到窗口关闭，开始清理": {
    "zh": "检测到 Ripple 窗口已关闭，正在停止相关服务。",
    "en": "The Ripple window closed. Stopping Ripple services."
  },
  "清理完成，watch 退出": {
    "zh": "清理完成，窗口监控已停止。",
    "en": "Cleanup complete. Window monitor stopped."
  },
  "未知命令：{{v0}}": {
    "zh": "未知命令：{{v0}}",
    "en": "Unknown command: {{v0}}"
  }
};
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(messages).map(([source, copy]) => ({
  pattern: new RegExp('^' + source.split(/(\{\{v\d+\}\})/).map(part => /^\{\{v\d+\}\}$/.test(part) ? `(?<${part.slice(2, -2)}>.*?)` : escape(part)).join('') + '$', 's'), copy,
}));
export function bilingualLauncherMessage(message) {
  for (const {pattern, copy} of templates) {
    const match = pattern.exec(message);
    if (match) {
      const render = text => text.replace(/\{\{(v\d+)\}\}/g, (_, name) => match.groups?.[name] ?? '');
      return `${render(copy.zh)}\n${render(copy.en)}`;
    }
  }
  return message;
}
