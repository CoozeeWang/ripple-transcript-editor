# MCP connection

Ripple's personal local MCP connection lets ChatGPT read the currently open interview on request, discuss editing rules, and create a new editing version. Ripple opens the result against its source in the normal version comparison. It never offers to overwrite the source version.

The settings describe these capabilities for external AI applications. The currently packaged graphical setup uses the OpenAI tunnel client and has been tested with ChatGPT. MCP is the service protocol; it does not imply that this tunnel setup works with every AI application. The transport and authorization for another client need separate setup and validation.

## First-time setup

1. Use a Ripple desktop build that includes the connector. Open **Settings → AI-assisted editing → MCP connection → Connection setup**.
2. Create or select your private tunnel in [OpenAI tunnel settings](https://platform.openai.com/settings/organization/tunnels), associate the target ChatGPT workspace, and obtain a runtime key with tunnel access. Download the official `tunnel-client` from that page. Account/workspace access and platform permissions must be verified for your account.
3. Select that executable, enter the tunnel ID and runtime key, and save. The key is kept in protected local application data, outside interview files and exports. Leaving the key blank on a later setup retains the existing key.
4. Add the tunnel connection in ChatGPT using the platform's custom MCP connection flow. Enable **Enable MCP connection** in Ripple. Ripple starts the configured client and checks its readiness; disabling the connection or closing Ripple stops it.

The first use requires explicit enabling. That choice persists: enabled connections recover when Ripple restarts, and explicitly disabled connections stay disabled. Switching the current interview does not require enabling again; requests still only access the currently open interview. Text sent to an external AI leaves the computer; source audio is not sent. A locally hosted bridge does not make ChatGPT analysis offline. Start testing with a synthetic interview. Connection setup does not change the application's separate editing-engine API settings.

The connection program (`tunnel-client`) carries requests between Ripple and the connection platform. The connection identifier (`Tunnel ID`) selects the tunnel created on that platform. The connection key (`Runtime API key`) authorizes that program to use the tunnel; it is separate from an editing model's API key. These fields configure the existing transport and do not select which model the external AI application uses.

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

## Annotations and highlights

Annotations and highlights are added to the current editable version, without creating another version or changing text, speakers, word timestamps, or existing human marks. AI-created annotations display an **AI annotation** label and support ordinary editing/deletion. The batch is undoable in Ripple. The original read-only transcript cannot receive marks.

Use `prepare_interview_marks` with explicit segment IDs or `whole_interview: true` and the user's instructions. Stage every scoped segment through `stage_interview_marks`, including empty marks for reviewed segments. Each highlight contains a verified text quotation and UTF-16 start/end offsets (end exclusive) at grapheme boundaries. After agreement, `apply_interview_marks` saves once to the current version and opens the relevant sidebar. It returns counts and a saved status, without listing the manuscript. Existing identical notes or highlight ranges are retained once.

Use `interview_marks_status` to recover uncertain outcomes. A failed save keeps applied marks in Ripple for manual saving; repeating the same task does not repeat the write. Cancel draft tasks with `cancel_interview_marks`. Changed source text or a switched version invalidates an outstanding task.

The connection configuration card follows the transcription-engine credentials layout. Saved configuration is shown before editing; **Edit configuration** changes the program or tunnel, while a blank key retains the saved key. Secret contents are never returned by the configuration-status command. These fields configure the OpenAI tunnel transport, rather than universal MCP requirements.
