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

To transcribe, create or open an interview, choose an audio file, then click **转录音频**. Paste an ElevenLabs API key once and save it locally. When launched with the project launcher, the key is written to the adjacent local data directory (`ripple-local/.env`) and is never returned to the browser.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / pause when focus is outside an editor field |
| `↑` / `↓` | Select previous / next segment |
| `Cmd + F` | Open find and replace |
| `Cmd + Enter` | Split at the text cursor |
| `Cmd + Z` | Undo |
| `Cmd + Shift + Z` | Redo |

## AI-assisted editing

Open **设置 → 编辑引擎** to configure a text model separately from transcription. The first version supports Chat Completions-compatible endpoints with JSON-object output; use the provider's base URL (without `/chat/completions`), model ID, and API key. Local HTTP services are supported on loopback addresses. The launcher checks for the editing configuration route for multi-engine configuration before reusing an existing backend and refreshes older services. `node scripts/launcher.mjs refresh-backend` can refresh the backend while keeping the editor window open.

In an editable transcript, choose **AI 辅助编辑**:

1. **选择编辑方案** offers three alternatives, in order: **常用方案**, **从已有修订中生成方案**, and **自定义方案**. Choose a preset or saved plan directly; no testing or model-tuning step is required. To generate a new plan, select a range you have corrected, compare it with the original transcript, and review the generated rules. Rules can be unchecked, edited, or supplemented. Custom plans use the same rule editor. Confirm a named plan for this document only, or explicitly save it as a reusable common plan. Generated plans save reusable rules only, excluding source examples and model summaries. Existing common plans are updated only through an explicit update action.
2. On the same page, **选择编辑范围** offers **全文 / 指定范围**. The footer identifies the active plan next to **开始 AI 辅助编辑**. Only this action sends the text for editing. Generating a plan also calls the selected model; writing or selecting rules does not.

Completed AI output is saved as a new editing version and opens directly in the normal main editor. It defaults to single-column insertion/deletion marks against the version used for this AI run. The source remains intact. The version badge row lets users select another comparison version and toggle marks with **显示修改痕迹**, **⌘⇧Y** on macOS, or **Ctrl+Shift+Y** elsewhere. Ordinary editing also supports this comparison mode. Editing, saving, and undo use the normal manuscript workflow; individual review confirmations are not required. Comparison decorations never become saved text. Click a marked text change to accept it (keep the current wording and hide that mark) or reject it (restore that portion of the comparison version). Each action is undoable; confirmations are saved with the editing version, scoped to its comparison source, and excluded from exports. No per-segment approval is required.

Generation drafts are checkpointed under the transcript container's `ai-review/` directory, outside the version manifest. Reopening AI editing on the same source restores plan selection, unfinished rules, or recoverable generated output. Legacy review decisions remain recoverable; legacy trial candidates migrate into plan rule review without restarting tests. Incomplete generation cannot be published. A changed source blocks publication from an older snapshot. A failed version save keeps completed output available to retry without another model request; a successful save clears the draft.

Editing runs at most two batches concurrently, with up to 32 segments and 6000 characters per batch. Checkpoints retain source order; cancellation or a failed batch stops further requests. Reported rule conflicts stop generation. Explicit deletion and same-speaker merging are applied to the new version. Merging preserves paragraph boundaries, word timestamps, annotations, and highlights. Deletion removes the selected segment and its annotations/highlights, without silently merging neighbours. Merges stay within a request batch and cannot target a deleted segment.

Each engine has named credential profiles, with independent editing/transcription defaults and show/hide controls. The old single editing configuration migrates automatically. The editing dialog can choose a saved profile for each run and displays its requested model name.

Configuration and named preferences (including interview excerpts) live in the local data directory's `ai-editing.json`. API keys are omitted from lists and returned only when you explicitly reveal or edit a saved credential profile. Text requests contain only the selected text, speaker names, preference description, and examples; no audio is sent. Cancelling stops later batches and retains completed batches in the review draft; the remote provider may continue processing a request already sent.

Limits: at most 20 examples / 24,000 combined characters per preference; each edit request contains up to 32 segments / 6,000 characters. Longer selections use at most two concurrent batches. A single segment over 6,000 characters must be split first. Preference changes require user confirmation; native non-compatible provider protocols and model retraining are outside this version. Model output is validated structurally; factual fidelity and editing taste still require human review.

The isolated visual fixture at `/tests/ai-editor.html` uses synthetic data and in-memory responses. Automated tests mock model calls; a live provider and real editing quality must be evaluated after configuring your text model. Protocol reference: [JSON output](https://api-docs.deepseek.com/guides/json_mode/).

## Naming and compatibility

The product is named **Ripple**. Startup scripts resolve paths relative to the checkout, while local interviews and settings live in the separate `ripple-local/` directory. Historical reviews retain the former product name. Existing `te-*` storage keys and transcript format identifiers are preserved so saved preferences and interview files remain compatible.

## Project structure

- `frontend/`: React + TypeScript editor UI
- `backend/`: FastAPI localhost service and local file access
- `docs/`: project documentation
- `mock-data/`: safe, synthetic transcripts for development
- `ripple-local/`: local interviews, configuration, credentials, and logs (outside Git)

## Development

### One-click start (macOS / Windows)

Double-click `start.command` on macOS (or `start.bat` on Windows). It starts both local services and opens the editor in a dedicated Chrome app window, using an isolated profile so it won't touch your regular Chrome.

Close that app window and both services stop automatically — no orphaned processes, nothing left running in the background. You can also double-click `stop.command` / `stop.bat` to stop manually. The lifecycle is managed by `scripts/launcher.mjs`.

### Manual start

Run the backend with a separate local data directory:

```bash
export RIPPLE_DATA_DIR="/absolute/path/to/ripple-local"
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

Word timing in editable versions keeps provenance back to the model's original transcript. Replacements inherit the replaced source range; insertions use a separate approximate anchor. Comparison selection does not reassign unchanged text to a different source. Segments with replacement, approximate, or unresolved timing show “含近似定位”. This preserves existing audio references; it does not perform acoustic forced alignment. Origin metadata is saved locally and omitted from JSON exports.
