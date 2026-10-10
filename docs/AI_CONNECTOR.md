# MCP connection

Ripple's personal local MCP connection lets ChatGPT read the currently open interview on request, discuss editing rules, and create a new editing version. Ripple opens the result against its source in the normal version comparison. It never offers to overwrite the source version.

## First-time setup

1. Use a Ripple desktop build that includes the connector. Open **Settings → AI assistance → MCP connection → First-time connection setup**.
2. Create or select your private tunnel in [OpenAI tunnel settings](https://platform.openai.com/settings/organization/tunnels), associate the target ChatGPT workspace, and obtain a runtime key with tunnel access. Download the official `tunnel-client` from that page. Account/workspace access and platform permissions must be verified for your account.
3. Select that executable, enter the tunnel ID and runtime key, and save. The key is kept in protected local application data, outside interview files and exports. Leaving the key blank on a later setup retains the existing key.
4. Add the tunnel connection in ChatGPT using the platform's custom MCP connection flow. Enable **Enable MCP connection (remember this choice)** in Ripple. Ripple starts the configured client and checks its readiness; disabling the connection or closing Ripple stops it.

The first use requires explicit enabling. That choice persists: enabled connections recover when Ripple restarts, and explicitly disabled connections stay disabled. Switching the current interview does not require enabling again; requests still only access the currently open interview. Text sent to an external AI leaves the computer; source audio is not sent. A locally hosted bridge does not make ChatGPT analysis offline. Start testing with a synthetic interview. Connection setup does not change the application's separate editing-engine API settings.

## Editing and analysis

Ask in ChatGPT: “I've edited part of v1. Look at my corrections and continue from this paragraph.” Specify the start paragraph or a precise position. If the start is missing or ambiguous, ChatGPT must ask. It reads selected original/current pairs (recorded merged or split source groups include their full comparison context) to discuss consequential style rules; those pairs can include previous AI changes, so their human authorship must be confirmed rather than inferred.

Once the rules and scope are agreed, ChatGPT stages all paragraphs in that range, including unchanged paragraphs, then publishes one new version. Rules are saved for this interview without raw examples. Saving them for other interviews is an explicit action through the existing common-plan settings. Unchanged words retain their original timing, replacements inherit their source range, and inserted words have approximate timing through the same algorithms used for manual editing.

ChatGPT normally gives short explanations and a completion summary. Full differences belong in Ripple; it should reproduce full text or a complete changes list only when requested. For analysis, it should cite relevant snippets and timestamps, distinguish evidence from interpretation, and state when it has read only part of the interview. Analysis does not edit the manuscript.

## Recovery and limits

- Changing the source, selecting another version/interview, or closing the interview invalidates an old snapshot. Read again and agree on the new scope before proceeding.
- Unfinished batches remain unpublished. Within the same enabled editor session, ChatGPT can inspect task status and continue missing paragraphs. Closing the app or disabling the connection clears transient tasks; confirmed interview rules remain saved. Retry a completed task through its status/result instead of starting another task.
- Repeated publication of a task returns the same result. A timeout means the outcome may be unknown: inspect task status and the Ripple version list before starting another operation.
- Name conflicts use a new suggested name, never overwrite. If a conflict arises after preparation, refresh the current source and prepare again. No text changes means no new version.
- The first connector edits text without changing speakers, splitting or merging paragraphs. It accepts up to 32 paragraphs per staging call, paginates text reads, and rejects individual paragraphs longer than 12,000 UTF-16 code units for editing; split those in Ripple first. Read pagination supports longer paragraphs without splitting grapheme clusters.
- Only one enabled Ripple window may answer. Turn off other connected windows if the current interview is ambiguous.
- Platform tool permission prompts are separate from conversational style agreement. A matching confirmation summary records the agreed plan; it does not authenticate a human chat message.

## Developer entry point

The bundled Python interpreter exposes `python -m app.connector_mcp --credential-file /path/to/app-data/connector/client.key`, with optional `--url http://127.0.0.1:18701`. The MCP adapter reads only its credential file and calls the local authenticated bridge. It never takes project paths. Window and client keys have different roles.

For source runs, set `RIPPLE_DATA_DIR` to an absolute directory outside the repository. The desktop backend generates owner-only connector credentials there. The native window retrieves its role key through a Tauri command; public HTTP routes never return credentials. Tunnel configuration contains a file reference to its key, not the key itself. Never enable raw tunnel HTTP logs containing manuscript text.

Automated source, browser fixtures, native builds, actual ChatGPT conversations, and installed-app acceptance are separate evidence. A successful MCP handshake is not an editing-quality or desktop acceptance result. Windows, ChatGPT desktop, and a second AI application require their own validation before compatibility is promised.
