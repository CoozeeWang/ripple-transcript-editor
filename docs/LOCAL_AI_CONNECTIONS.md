# Local AI connections

Open Settings → AI-assisted editing → MCP connection. Choose ChatGPT, Claude Desktop or WorkBuddy, follow that client's instructions, and explicitly enable access to manuscripts in the current project. Selection chooses the setup view; it does not stop other configured clients. Selection and access preference survive restart; each client's saved setup is retained when switching. Uncheck Enable MCP connection to disconnect the editor session. This retains configuration and does not uninstall an extension or delete a third-party account.

Ripple does not operate or require a shared public connection server. Local connection does not mean an offline model: requested interview text is still sent to the chosen AI service. Audio is not sent.

## ChatGPT web

Ripple’s current acceptance covers ChatGPT web. Desktop availability and invocation must be verified separately, even when using the same personal tunnel.

Use your own OpenAI Secure MCP Tunnel. Create it on the OpenAI connection platform, download the official tunnel-client, then select the executable and enter the Tunnel ID and Runtime API key in Ripple. The ID identifies the tunnel; the runtime key authorizes that transport and is not a model API key. Existing configuration is reused, including its protected key. Add Ripple in ChatGPT using that tunnel. This is a personal/private connection, not a publicly distributed ChatGPT plugin. See [personal tunnel setup](AI_CONNECTOR.md) and [OpenAI's tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

The ChatGPT setup card guides these actions in four steps. Each time it opens, Ripple checks the public latest-release metadata from `openai/tunnel-client` and recommends the full ZIP for the host operating system and chip. This request sends no credentials, local paths or transcript content. It times out after eight seconds; if the query fails or there is no matching full archive, use **Check again** or the [official latest downloads page](https://github.com/openai/tunnel-client/releases/latest). Recommendations do not install or replace a program automatically. On macOS, the second step explains **System Settings → Privacy & Security → Allow Anyway / Open Anyway** when the official client is blocked. After saving and enabling the connection, wait for actual tunnel readiness before adding a custom MCP server in ChatGPT. Changing tunnels requires a new custom connection; reconnecting an old plugin keeps its old tunnel.

## Claude Desktop

Export Ripple.mcpb from Ripple. In Claude Desktop, use Settings → Extensions → Advanced settings → Install Extension. Install that file and allow the Ripple tools. Claude supplies Node.js; the extension launches Ripple's bundled Python and the shared stdio adapter, so users do not install Python separately. The export is specific to this computer and the current Ripple app location; re-export/reinstall if you move the app. It contains paths, not secret values. See [Claude's installation instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## WorkBuddy

Export Ripple-WorkBuddy.json. In WorkBuddy, open Experts · Skills · Connectors → Connectors → Custom connector → Add MCP. Add the exported Ripple entry to the existing mcpServers object and save, preserving any other services already configured. Preserve the command, argument array and environment values separately; do not concatenate them into an unquoted shell command. Allow the tools, keep Ripple open and test a read request. Export again after moving the app. WorkBuddy supports local stdio services; see [official connector documentation](https://open.workbuddy.cn/docs/connector).

## Delete a connection configuration

The AI application list shows **Configured** or **Not configured**, referring to saved setup on this computer rather than a live external connection. Automatically generated credentials alone do not count as configured. The delete action is hidden when setup is absent or its status cannot be read.

Select the AI application and choose **Delete ChatGPT / Claude / WorkBuddy connection configuration**, then confirm its name and scope. Ripple removes only that application's configuration and credentials stored by Ripple on this computer. It retains other clients, the editor access preference, projects, transcripts and the downloaded tunnel-client. Old client credentials are revoked immediately and remain revoked after restarting Ripple; explicitly adding or saving the configuration again creates a new credential. Reconnect in the AI application after adding it again.

Deletion does not uninstall extensions or remove registrations inside ChatGPT, Claude or WorkBuddy, and does not revoke an OpenAI tunnel or Runtime API key. Manage those separately in the relevant application or OpenAI settings. If the selected client has a request in progress, finish editing and check the saved result before retrying deletion. Cancellation changes nothing; failure keeps a retry available.

## Verification and limits

A ready local broker/transport does not prove that the AI application installed or called it. Verify with an actual read request before attempting edits. All clients share the same 20 tools and current-project boundary. Specify the exact interview, recording and version; AI asks when the version is missing rather than selecting a default. Project tools can edit an unopened manuscript without switching the editor. Before editing, ask whether to update the current editable version or create a new one. Incremental tasks save each batch into the same agreed target version. Annotations and highlights retain human marks. Unknown writes must be checked via task status before retrying.

macOS is the initial packaged target. Windows native packaging and real-client acceptance must be recorded separately. Installation export or protocol tests do not establish a real Claude/WorkBuddy account acceptance result. No model subscription or third-party service price is included in Ripple's local connection.
