# MCP connection

Ripple's personal local MCP connection lets ChatGPT read the currently open interview on request, discuss editing rules, and create a new editing version. Ripple opens the result against its source in the normal version comparison. It never offers to overwrite the source version.

The simplified connection uses Ripple's connection service and device pairing. It exposes editing, analysis, annotations and highlights to external AI applications through the same MCP tools. The service is not deployed publicly yet; current development builds use a local test service. See [connection service](CONNECTION_SERVICE.md) for deployment boundaries and developer instructions.

## First-time connection

1. Add **Ripple** in your AI application. Follow its authorization link.
2. In Ripple open **Settings → AI-assisted editing → Connect Ripple** and select **Show pairing code**.
3. Enter that code on the Ripple authorization page opened by the AI application, check the requested access, and authorize. The code expires after 10 minutes and works once only.
4. Select Ripple in the AI application's conversation. The desktop connection becomes enabled after pairing succeeds.

Authorization is remembered across restarts. The connection switch pauses access without removing authorization; **Disconnect and revoke** removes it. Requests only access the currently open interview, not the file system or audio. Text sent to external AI leaves the computer and passes through the connection service. Start with a synthetic interview. Editing-engine API settings remain separate.

Older internal testing builds used the official OpenAI tunnel and manually configured credentials. Those fields are not part of the new user flow. Existing test connections do not automatically migrate to a new service; adding the deployed Ripple connection and authorizing it is necessary. The already configured ChatGPT test plugin should be retained until public deployment and compatibility testing are complete.

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

For source runs, set `RIPPLE_DATA_DIR` to an absolute directory outside the repository. The desktop backend generates owner-only connector credentials there. The native window retrieves its role key through a Tauri command; public HTTP routes never return credentials. New builds run the outbound relay worker with protected credentials. Never enable raw HTTP logs containing manuscript text.

Automated source, browser fixtures, native builds, actual ChatGPT conversations, and installed-app acceptance are separate evidence. A successful MCP handshake is not an editing-quality or desktop acceptance result. Windows, ChatGPT desktop, and a second AI application require their own validation before compatibility is promised.

## Annotations and highlights

After upgrading Ripple with new MCP tools, keep the desktop application running with its MCP connection ready. In the ChatGPT plugin management page, use **Refresh tools**, then start a new chat with Ripple. Installing a desktop build alone does not refresh the tool list available to ChatGPT; older chats may retain the earlier capabilities.

Annotations and highlights are added to the current editable version, without creating another version or changing text, speakers, word timestamps, or existing human marks. AI-created annotations display an **AI annotation** label and support ordinary editing/deletion. The batch is undoable in Ripple. The original read-only transcript cannot receive marks.

Use `prepare_interview_marks` with explicit segment IDs or `whole_interview: true` and the user's instructions. Stage every scoped segment through `stage_interview_marks`, including empty marks for reviewed segments. Each highlight contains a verified text quotation and UTF-16 start/end offsets (end exclusive) at grapheme boundaries. After agreement, `apply_interview_marks` saves once to the current version and opens the relevant sidebar. It returns counts and a saved status, without listing the manuscript. Existing identical notes or highlight ranges are retained once.

Use `interview_marks_status` to recover uncertain outcomes. A failed save keeps applied marks in Ripple for manual saving; repeating the same task does not repeat the write. Cancel draft tasks with `cancel_interview_marks`. Changed source text or a switched version invalidates an outstanding task.
