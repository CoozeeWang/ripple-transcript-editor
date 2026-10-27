# Session sidebar review fixture

This fixture renders the real `ProjectWorkspace` with synthetic, in-memory project files and local mock services. It does not open an existing project, call a transcription service, or change the installed app. Use a dedicated development origin because the fixture overrides that origin's file pickers, handle database and network responses, and disables open-last-project and MCP there.

Start Vite with `RIPPLE_DATA_DIR` set to an absolute path outside the repository, then open `/tests/session-sidebar-review.html?lang=en`. Supported languages are `zh-CN`, `zh-TW` and `en`.

The `mode` parameter accepts `default`, `left`, `right`, `empty`, `long`, `new`, `busy` and `error`. Add `review=1` to exercise the chosen state and display a JSON result. `busy` leaves a synthetic file picker pending; `error` rejects a synthetic project-index write. Reload to reset either case. A WebKit host may register a `review` script-message handler to collect the same result.

Check 920 × 600 and 1100 × 900 windows in each language. Confirm the title/count/plus stay above the scrolling list, wheel input in either pane does not move the other, and no page-level vertical or horizontal scrolling appears. Check empty and long lists, selected rows, the plus tooltip and keyboard focus, both Add entries, draft retention, busy disabling and failed-save recovery. Drag session and audio grips after scrolling and check keyboard ordering. The project export and session delete controls must keep the same right edge with native scrollbars.

Automatic DOM results, browser pointer checks, isolated macOS WebKit checks, installed macOS acceptance and Windows WebView2 acceptance are separate evidence. This fixture alone does not establish installed-app or Windows acceptance.
