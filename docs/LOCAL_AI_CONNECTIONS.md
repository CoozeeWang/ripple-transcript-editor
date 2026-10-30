# Local AI connections

Open Settings → AI-assisted editing → MCP connection. Choose ChatGPT, Claude Desktop or WorkBuddy, follow that client's instructions, and explicitly enable access to manuscripts in the current project. Selection chooses the setup view; it does not stop other configured clients. Selection and access preference survive restart; each client's saved setup is retained when switching. Uncheck Enable MCP connection to disconnect the editor session. This retains configuration and does not uninstall an extension or delete a third-party account.

Ripple does not operate or require a shared public connection server. Local connection does not mean an offline model: requested interview text is still sent to the chosen AI service. Audio is not sent.

## ChatGPT web

Use a separate tunnel for each computer when running Ripple simultaneously. Sharing one tunnel between computers can send a summary request to one computer and its page request to another, invalidating the snapshot.

On Windows, Ripple's tunnel process inherits explicit HTTP/HTTPS/ALL_PROXY environment variables. When none is present, it reads the current user's static Windows Internet proxy and applies its HTTPS endpoint to the tunnel child only, preserving local loopback access and proxy exclusions. This does not change system settings or save proxy credentials. PAC auto-configuration scripts are not resolved by this fallback; use a static system proxy, an explicit HTTPS_PROXY, or your network administrator's approved route when needed. A successful local readiness check alone does not prove cloud polling or an actual ChatGPT tool call.

Ripple’s current acceptance covers ChatGPT web. Desktop availability and invocation must be verified separately, even when using the same personal tunnel.

Use your own OpenAI Secure MCP Tunnel. Create it on the OpenAI connection platform, download the official tunnel-client, then select the executable and enter the Tunnel ID and Runtime API key in Ripple. The ID identifies the tunnel; the runtime key authorizes that transport and is not a model API key. Existing configuration is reused, including its protected key. Add Ripple in ChatGPT using that tunnel. This is a personal/private connection, not a publicly distributed ChatGPT plugin. See [personal tunnel setup](AI_CONNECTOR.md) and [OpenAI's tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

The ChatGPT setup card guides these actions in four steps. Each time it opens, Ripple checks the public latest-release metadata from `openai/tunnel-client` and recommends the full ZIP for the host operating system and chip. This request sends no credentials, local paths or transcript content. It times out after eight seconds; if the query fails or there is no matching full archive, use **Check again** or the [official latest downloads page](https://github.com/openai/tunnel-client/releases/latest). Recommendations do not install or replace a program automatically. On macOS, the second step explains **System Settings → Privacy & Security → Allow Anyway / Open Anyway** when the official client is blocked. After saving and enabling the connection, wait for actual tunnel readiness before adding a custom MCP server in ChatGPT. Changing tunnels requires a new custom connection; reconnecting an old plugin keeps its old tunnel.

## Claude Desktop

Choose **Add to Claude (Beta)** in Ripple to generate the local MCPB and request opening it in Claude Desktop; complete installation and allow the Ripple tools there. If automatic opening is unavailable or fails, use Ripple’s manual extension export/folder actions, then in Claude Desktop choose Settings → Extensions → Advanced settings → Install Extension and select `Ripple.mcpb`. An accepted open request does not prove installation. Claude supplies Node.js; the extension launches Ripple's bundled Python and the shared stdio adapter, so users do not install Python separately. The export is specific to this computer and the current Ripple app location; re-export/reinstall if you move the app. It contains paths, not secret values. See [Claude's installation instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## WorkBuddy

Choose **Add to WorkBuddy** and confirm. Ripple backs up and merges its local configuration, preserving other connections; invalid existing configuration is left unchanged. In WorkBuddy, open Experts · Skills · Connectors → Connectors → Custom connectors and enable Ripple. If it is missing, restart WorkBuddy and check again. Once enabled, ask directly in a conversation. Manual export remains available: preserve the command, argument array and environment values separately, and do not replace unrelated `mcpServers` entries. Keep Ripple open and test a read request. Export again after moving the app. WorkBuddy supports local stdio services; see [official connector documentation](https://open.workbuddy.cn/docs/connector).

## Delete a connection configuration

The AI application list shows **Configured** or **Not configured**, referring to saved setup on this computer rather than a live external connection. Automatically generated credentials alone do not count as configured. The delete action is hidden when setup is absent or its status cannot be read.

Select the AI application and choose **Delete ChatGPT / Claude / WorkBuddy connection configuration**, then confirm its name and scope. Ripple removes only that application's configuration and credentials stored by Ripple on this computer. It retains other clients, the editor access preference, projects, transcripts and the downloaded tunnel-client. Old client credentials are revoked immediately and remain revoked after restarting Ripple; explicitly adding or saving the configuration again creates a new credential. Reconnect in the AI application after adding it again.

Deletion does not uninstall extensions or remove registrations inside ChatGPT, Claude or WorkBuddy, and does not revoke an OpenAI tunnel or Runtime API key. Manage those separately in the relevant application or OpenAI settings. If the selected client has a request in progress, finish editing and check the saved result before retrying deletion. Cancellation changes nothing; failure keeps a retry available.

## Connection recovery and reinstalling

Ripple supervises its own ChatGPT tunnel while MCP is enabled, including when settings are closed. Exits retry with exponential delays from five seconds to five minutes. A running client gets two minutes to restore readiness before Ripple replaces that owned process; a minute of stable readiness resets the backoff. Turning MCP off stops recovery. Local broker readiness and tunnel readiness have separate labels, and Reconnect remains available while enabled. Reconnection never replays an editing or save request: check the existing task status before retrying an uncertain write.

Saving setup retains the selected tunnel-client and its companion runtime/licensing files in Ripple's per-user application data. Existing setups migrate when next started. Upgrades and reinstalls that retain this data reuse the tunnel identity and protected key, and rebuild the adapter command against the current installed app location. Removing application data or revoking the remote key requires setup again. A missing previously selected download needs reselection if it was removed before migration. No runtime is downloaded automatically. Network access, remote tunnel availability and valid account authorization are still required.

A bounded local connection event log records timestamps, lifecycle events and exit codes, without transcript content, request payloads or secret values. It is diagnostic evidence, not proof that an external client successfully invoked a tool. Windows source behavior is shared; Windows installation and native acceptance remain separate.

## Verification and limits

A ready local broker/transport does not prove that the AI application installed or called it. Verify with an actual read request before attempting edits. All clients share the same 27 tools and current-project boundary. Specify the exact interview, recording and version; AI asks when the version is missing rather than selecting a default. Project tools can edit an unopened manuscript without switching the editor. Before editing, ask whether to update the current editable version or create a new one. Incremental tasks save each batch into the same agreed target version. Annotations and highlights retain human marks. Unknown writes must be checked via task status before retrying.

As of 2026-10-20, the Mac b83 interface has maintainer acceptance. This does not revalidate every external account or client operation. Windows packages/native and real-client acceptance, plus reconnection after a manual app upgrade, remain pending before Release. Installation export or protocol tests do not establish a real Claude/WorkBuddy account acceptance result. No model subscription or third-party service price is included in Ripple's local connection.

Windows 自动打开 Claude 扩展前会查询 `.mcpb` 的有效打开程序；无关联、第三方选择器或未识别的处理程序均转为手动安装，不修改默认应用。手动安装说明和导出入口始终可用，添加后展开说明。Claude 的本机配置、打开请求、实际安装与读取连接分别核验；扩展是否安装请在 Claude 内确认。官方手动安装路径见 [Claude 桌面扩展说明](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)。

### Windows upgrades with an active connector

Save unfinished manuscript changes and exit Ripple normally before upgrading. The installer checks for this installation's desktop, backend and adapter processes before replacing files. It stops only Ripple's own adapters after potential writers have exited; it does not close Claude, WorkBuddy or other MCP services. If an adapter immediately returns, temporarily disable only the Ripple connector in its client and choose Retry. Unresolved file locks show the resource and, where Windows can identify it, its owning application/PID. Cancel leaves the preflight without replacing files; files cannot be skipped with Ignore.

After installation, open Ripple first. If a client does not reconnect automatically, click its reconnect action, re-enable its Ripple connector, or restart that client. Keep existing connection settings and keys. The AI in a chat cannot repair a disconnected transport itself.


### Connected, but a chat reports no editing tools

Check the task state separately: cancelled tasks retain saved work but cannot resume; see [safe continuation](AI_CONNECTOR.md#task-rules-preferences-and-safe-continuation). Cancellation does not hide writing tools. Use `connection_capabilities` to inspect the server catalogue, then rediscover tools in the affected client. The diagnostic cannot see that chat’s loaded tools or permissions and does not perform a trial write. If necessary, compare a fresh session with the same plugin. Do not infer that reinstallation or broader permissions are needed merely because a model reports missing tools. After an upgrade that changes tools or input fields, refresh the client metadata where supported.
