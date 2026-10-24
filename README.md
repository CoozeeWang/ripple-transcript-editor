# Ripple

Ripple is a local-first desktop app for organizing recordings and editing long-form interview transcripts while listening to the source audio. The interface supports Simplified Chinese, Traditional Chinese (Taiwan), and English; switching language does not translate manuscript text or project names.

## Current desktop workflow

- Create or open a `.ripple` project folder, organize sessions, and add recordings or existing manuscripts.
- Copy audio into the project or keep a reference to the original file. Import DOCX, TXT, SRT, VTT, or JSON manuscripts; untimed text stays untimed.
- Move recordings and their transcripts, versions, and annotations to another session in the same project, preserving recording details and external audio references.
- Transcribe through a configured transcription engine, then keep the original transcript read-only and create named editable versions.
- Edit text and speakers, split/merge segments, find/replace, undo/redo, annotate, highlight, and compare versions.
- Use timestamps, playback speed, and skip controls to review audio. Approximate word positions are identified rather than presented as acoustic alignment.
- Save edits locally and export manuscripts or project materials. See [projects and storage](docs/projects.md) and [saving and export](docs/SAVING_AND_EXPORT.md).

Audio is submitted to the selected transcription service only when transcription is explicitly started. Provider availability, account permissions, prices, and actual transcription quality require separate checks with that service. See [transcription engines](docs/engine-presets.md).

The project folder contains its index, sessions, project-owned audio, and manuscript versions. External audio references, device credentials, and app preferences have separate storage and portability limits; a project copy is not a backup of every referenced audio file or device setting. Do not rename internal files manually. Legacy formats remain readable where supported; see [project storage and import](docs/projects.md).

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd + O` / `Ctrl + O` | Open another project in the desktop app |

| `Space` | Play / pause when focus is outside an editor field |
| `↑` / `↓` | Select previous / next segment |
| `↑` / `↓` with a project session row focused | Focus and select the previous / next session |
| `Cmd + F` / `Ctrl + F` | Open find and replace |
| `Cmd + Enter` | Split at the text cursor |
| `Cmd + Z` / `Ctrl + Z` | Undo |
| `Cmd + Shift + Z` / `Ctrl + Shift + Z` | Redo |
| `Cmd + S` / `Ctrl + S` | Save the current transcript |
| `Cmd + E` / `Ctrl + Shift + E` | Open export |

The desktop **File → Recent Projects** submenu opens projects already listed on the welcome screen. If access has expired, Ripple asks you to reselect the original project folder.

## MCP connection

The personal desktop MCP connection lets external AI clients read a precisely selected version in the current project, including an unopened manuscript, and save edits in Ripple. Specify the manuscript and exact version; AI asks when the version is missing. Background saves leave the open editor unchanged; edits to the active manuscript can open normal source/result comparison. It also adds annotations and highlights to the current editable version, preserving human marks and text; AI-created annotations have a distinct label. The current tunnel setup is tested with ChatGPT. Choose ChatGPT, Claude Desktop or WorkBuddy in settings. Personal ChatGPT tunnels and local client exports are described in [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).

## AI-assisted editing

Ripple has no built-in AI editing model, saved editing plans, or editing credential store. In **Settings → AI-assisted editing**, configure an external AI application through the MCP connection. The application can read and analyse a selected manuscript in the current project, save a new editable version or explicitly update the selected editable version, and add AI-labelled annotations or highlights. Original transcripts remain read-only. Task rules agreed through MCP apply only to that task. Future interview preferences require explicit user agreement and can be viewed, replaced or cleared through MCP. See [MCP connection](docs/AI_CONNECTOR.md) and [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).

## Naming and compatibility

The product is named **Ripple**. Startup scripts resolve paths relative to the checkout. The launcher uses a sibling `ripple-work/` directory for local data, creating it when needed; `RIPPLE_DATA_DIR` can point to another absolute path. This directory is outside the product repository. If it is itself a Git repository, local credentials and generated data must be ignored there. Historical reviews retain the former product name. Existing `te-*` storage keys and transcript format identifiers are preserved so saved preferences and interview files remain compatible.

## Project structure

- `frontend/`: React + TypeScript editor UI
- `backend/`: FastAPI localhost service and local file access
- `docs/`: project documentation
- `mock-data/`: safe, synthetic transcripts for development
- local data outside this repository: interviews, configuration, and credentials (see the launcher default above)

## Development

### Ripple Dev (native macOS window)

Double-click `start-dev.command` to open **Ripple Dev** directly from the current checkout. Frontend changes refresh automatically, Python changes reload the backend, and Rust changes rebuild the native window. No repeated packaging or installation is needed. Development settings and backend data are isolated from the installed app. Close the installed Ripple first, and keep the launcher terminal open. See [native development setup and limits](desktop/README.md#native-development-on-macos).

### One-click start (macOS / Windows)

Double-click `start.command` on macOS (or `start.bat` on Windows). It starts both local services and opens the editor in a dedicated Chrome app window, using an isolated profile so it won't touch your regular Chrome.

Close that app window and both services stop automatically — no orphaned processes, nothing left running in the background. You can also double-click `stop.command` / `stop.bat` to stop manually. The lifecycle is managed by `scripts/launcher.mjs`.

### Manual start

Run the backend with a separate local data directory:

```bash
export RIPPLE_DATA_DIR="/absolute/path/to/local-data"
cd backend
uv sync --locked
uv run uvicorn app.main:app --reload --port 8000
```

In another terminal, run the frontend:

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The frontend proxies `/api` requests to the backend.

## Privacy

Real audio, transcripts, `.env`, and API keys must not be committed. The `interviews/` directory and common audio formats are ignored by Git. Audio is sent to ElevenLabs only when the user explicitly starts a transcription.


### Session, recording, and version names

Projects, sessions, recordings, manuscripts, and editable versions have distinct names. Renaming a manuscript does not rename its session or source audio. The original transcript is read-only; creating a named editable version preserves it, and cancelling the naming dialog creates no version. Imported manuscripts are editable unless explicitly marked as an original. Legacy standalone-file naming rules should not be applied to project storage. See [project organization](docs/projects.md).

## Code health and acceptance

See [product documentation](docs/README.md) for the current development and acceptance boundaries. Automated checks are separate from desktop acceptance. As of 2026-10-20, Mac internal build b83 has been accepted by the maintainer; Windows packaging/installed acceptance and the new manual release-download flow still need installed-app checks. This is not a public release announcement. See [verification boundaries](docs/README.md#验证状态与发布前待验).

For contributors, [development workflow](docs/WORKFLOW.md) defines branches, checks, review and delivery. [Ripple Stylebook](docs/STYLEBOOK.md) records current interface rules; read the relevant sections when changing visible behavior. Private planning and acceptance records remain outside this public source repository.

Word timing in editable versions keeps provenance back to the model's original transcript. Replacements inherit the replaced source range; insertions use a separate approximate anchor. Comparison selection does not reassign unchanged text to a different source. Segments with replacement, approximate, or unresolved timing show “含近似定位”. This preserves existing audio references; it does not perform acoustic forced alignment. Origin metadata is saved locally and omitted from JSON exports.

The public relay is retained as development history and is not the default connection route. Ripple does not require its developer to operate a public server. See [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).
