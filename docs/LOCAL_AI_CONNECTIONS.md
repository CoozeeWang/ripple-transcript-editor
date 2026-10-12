# Local AI connections

Open Settings → AI-assisted editing → MCP connection. Choose ChatGPT, Claude Desktop or WorkBuddy, follow that client's instructions, and explicitly enable access to the current interview. One client is active at a time. Selection and access preference survive restart; each client's saved setup is retained when switching. Uncheck Enable MCP connection to disconnect the editor session. This retains configuration and does not uninstall an extension or delete a third-party account.

Ripple does not operate or require a shared public connection server. Local connection does not mean an offline model: requested interview text is still sent to the chosen AI service. Audio is not sent.

## ChatGPT web

Ripple’s current acceptance covers ChatGPT web. Desktop availability and invocation must be verified separately, even when using the same personal tunnel.

Use your own OpenAI Secure MCP Tunnel. Create it on the OpenAI connection platform, download the official tunnel-client, then select the executable and enter the Tunnel ID and Runtime API key in Ripple. The ID identifies the tunnel; the runtime key authorizes that transport and is not a model API key. Existing configuration is reused, including its protected key. Add Ripple in ChatGPT using that tunnel. This is a personal/private connection, not a publicly distributed ChatGPT plugin. See [personal tunnel setup](AI_CONNECTOR.md) and [OpenAI's tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Claude Desktop

Export Ripple.mcpb from Ripple. In Claude Desktop, use Settings → Extensions → Advanced settings → Install Extension. Install that file and allow the Ripple tools. Claude supplies Node.js; the extension launches Ripple's bundled Python and the shared stdio adapter, so users do not install Python separately. The export is specific to this computer and the current Ripple app location; re-export/reinstall if you move the app. It contains paths, not secret values. See [Claude's installation instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## WorkBuddy

Export Ripple-WorkBuddy.json. In WorkBuddy, open Experts · Skills · Connectors → Connectors → Custom connector → Add MCP. Add the exported Ripple entry to the existing mcpServers object and save, preserving any other services already configured. Preserve the command, argument array and environment values separately; do not concatenate them into an unquoted shell command. Allow the tools, keep Ripple open and test a read request. Export again after moving the app. WorkBuddy supports local stdio services; see [official connector documentation](https://open.workbuddy.cn/docs/connector).

## Verification and limits

A ready local broker/transport does not prove that the AI application installed or called it. Verify with an actual read request before attempting edits. All clients share the same 17 tools and current-interview restrictions. Before editing, ask whether to update the current editable version or create a new one. Incremental tasks save each batch into the same agreed target version. Annotations and highlights retain human marks. Unknown writes must be checked via task status before retrying.

macOS is the initial packaged target. Windows native packaging and real-client acceptance must be recorded separately. Installation export or protocol tests do not establish a real Claude/WorkBuddy account acceptance result. No model subscription or third-party service price is included in Ripple's local connection.
