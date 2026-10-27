# Synthetic notice review

Run Vite locally, then open `/tests/notice-review.html?scope=project&lang=zh-CN`.

- `scope`: `project`, `editor`, `settings`, `tasks`, `progress` or `recovery`.
- `lang`: `zh-CN`, `zh-TW` or `en`.
- Review 820px and 1100px viewports. The fixture uses the same application-shell width rules as the product. Progress uses the actual embedded error state (no task), with refresh and close together; recovery intentionally retains its refresh action. The JSON report checks message/close alignment, row overflow and viewport boundaries.
- Project and settings completion samples remain visible initially for inspection. Enable **Live four-second timers**, then **Publish feedback** to check expiry. AI completion always uses its production timer. Publish again to inspect it.
- Check the close control with Tab or arrow-key focus, hover and click. Closing feedback must leave other notices/results intact. Required error, authorization and pending-work instructions remain until handled or dismissed.

All text and task records are synthetic. This page does not open project files, call a transcription provider or change connector configuration. An isolated WKWebView review is native-engine evidence; installed Mac and Windows/WebView2 acceptance are separate.

## Ownership and navigation regressions

`AIConnectorProvider.test.tsx` and `useConnectorFeedback.test.tsx` exercise the window provider as well as the embedded error: editor → project/welcome, project A → B, late failure/success after navigation, dismiss/retry and independent damaged-journal warnings. A page-local query error is cleared; ongoing work and durable recovery records are retained. Recovery warnings appear only for their project.

`ProjectWorkspace.test.tsx` checks completed import feedback across editor/settings/session navigation. `ProjectBoard.test.tsx` keeps manuscript-designation failures attached to the affected session. `usePersistence.test.tsx` checks feedback cleanup on document/version changes and a delayed manual-save success. Failed saves retain the existing navigation protection and diagnostics.

Source review also includes contextual field validation, loading/readiness status, transcription/import progress, comparison and audio-access warnings, recovery/confirmation dialogs, deletion undo and OS alerts. They have different lifetimes: form errors remain beside the form; active progress follows its task; confirmations wait for a decision. These unchanged families are not all rendered by this fixture. OS-drawn dialogs and Windows installed acceptance require separate native checks.
