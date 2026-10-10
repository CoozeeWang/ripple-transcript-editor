# Ripple

Ripple (formerly Transcription Editor) is a local-first web app for editing long-form interview transcripts while listening to the source audio.

## Current editor

The first usable editor slice includes:

- create and switch between local interviews
- editable interview metadata: title, date/time, location, people, roles, topics, and notes
- bundled synthetic transcript data and JSON import
- audio saved locally inside its interview folder
- ElevenLabs Scribe v2 transcription with a locally stored API key
- Chinese/automatic language selection, speaker diarization, optional speaker count, and audio-event tags
- click a timestamp to seek and play
- active segment highlighting during playback
- inline transcript editing
- global speaker renaming and per-segment speaker reassignment
- split at the text cursor and merge with next segment
- undo/redo for text, speaker, split, merge, and replace operations
- find, replace, and confirmed replace all
- keyboard shortcuts for playback, navigation, search, split, undo, and redo
- playback speed and three-second skip controls
- debounced local JSON autosave
- JSON export

Each interview is stored in its own local folder. The folder can contain the source audio, `metadata.json`, the untouched `original_api_response.json`, the app-normalized `normalized_transcript.json`, and the editable `transcript.json`. Saved demo edits are written to `interviews/demo/transcript.json`. The entire `interviews/` directory is ignored by Git.

To transcribe, create or open an interview, choose an audio file, then click **转录音频**. Paste an ElevenLabs API key once and save it locally. When launched with the project launcher, the key is written to the local data directory outside this Git repository and is never returned to the browser.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / pause when focus is outside an editor field |
| `↑` / `↓` | Select previous / next segment |
| `↑` / `↓` with a project session row focused | Focus and select the previous / next session |
| `Cmd + F` | Open find and replace |
| `Cmd + Enter` | Split at the text cursor |
| `Cmd + Z` | Undo |
| `Cmd + Shift + Z` | Redo |

## MCP connection

The personal desktop MCP connection lets external AI clients read the current interview on request and publish a new editing version directly in Ripple, with automatic source/result comparison. It also adds annotations and highlights to the current editable version, preserving human marks and text; AI-created annotations have a distinct label. The current tunnel setup is tested with ChatGPT. Choose ChatGPT, Claude Desktop or WorkBuddy in settings. Personal ChatGPT tunnels and local client exports are described in [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).

## AI-assisted editing

Ripple has no built-in AI editing model, saved editing plans, or editing credential store. In **Settings → AI-assisted editing**, configure an external AI application through the MCP connection. The application can read and analyse the current interview on request, publish a new editable version for normal comparison, and add AI-labelled annotations or highlights to the current editable version. It never overwrites the source version. Rules agreed through MCP apply only to the current interview or task. See [MCP connection](docs/AI_CONNECTOR.md) and [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).

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
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

In another terminal, run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The frontend proxies `/api` requests to the backend.

## Privacy

Real audio, transcripts, `.env`, and API keys must not be committed. The `interviews/` directory and common audio formats are ignored by Git. Audio is sent to ElevenLabs only when the user explicitly starts a transcription.


### Interview and version names

The large heading is the shared interview title. Transcription opens a read-only **原始转录稿** without a naming prompt or an automatic editable v1. Creating an editable version first asks for a custom version name; cancelling creates no file. Renaming a version never changes the interview title.

Editing the title automatically updates the audio filename, its `.transcript` directory, and the transcript files inside it. Editable files and exports use `Interview title_Version name` with the appropriate extension. Original files use `Interview title_原始转录稿.json`; multiple transcription runs include source identifiers to keep them distinct. Existing ID-based filenames remain readable and are synchronized when names are changed. Conflicting names are rejected rather than overwritten; incomplete rename operations retain or restore recovery copies.

## Code health and acceptance

See [product documentation](docs/README.md) for the current development and acceptance boundaries. Automated checks are separate from desktop acceptance.

For contributors, [development workflow](docs/WORKFLOW.md) defines branches, checks, review and delivery. [Ripple Stylebook](docs/STYLEBOOK.md) records current interface rules; read the relevant sections when changing visible behavior. Private planning and acceptance records remain outside this public source repository.

Word timing in editable versions keeps provenance back to the model's original transcript. Replacements inherit the replaced source range; insertions use a separate approximate anchor. Comparison selection does not reassign unchanged text to a different source. Segments with replacement, approximate, or unresolved timing show “含近似定位”. This preserves existing audio references; it does not perform acoustic forced alignment. Origin metadata is saved locally and omitted from JSON exports.

The public relay is retained as development history and is not the default connection route. Ripple does not require its developer to operate a public server. See [Local AI connections](docs/LOCAL_AI_CONNECTIONS.md).
