# Save-first project review fixture

Run the frontend Vite development server with `RIPPLE_DATA_DIR` pointing outside the repository. Open `/tests/project-create-review.html?lang=en` (also `zh-CN` and `zh-TW`). The fixture uses the real workspace and project store with an in-memory filesystem, a synthetic silent WAV, a TXT manuscript and local mock provider responses. It cannot read user files. Reload clears its synthetic projects.

- New project shows only its name and save action, with no session/material operations.
- Save opens the synthetic picker and publishes a verified empty index. The next focus is Add session.
- Add a session, confirm, import synthetic audio, choose copy and confirm. Check rename/delete controls and open the audio editor. Return and import the synthetic standalone manuscript; its filename is preserved.
- `mode=cancel` cancels the first picker only; the name remains and a retry succeeds.
- `mode=error` simulates a denied location; the name and actionable error remain. `mode=busy` holds the picker pending to inspect disabled actions.
- `review=1&mode=default|named|cancel|error|busy|saved` drives the corresponding synthetic UI state for browser/WebKit screenshots. It reports layout, focus, absence of premature material writes and save ordering through an optional WebKit `review` message handler.

Check 920px and 1100px widths in all three languages, plus button hover and keyboard focus. Native directory dialogs and Windows installed-app behavior require separate platform acceptance; this fixture replaces the picker and is not evidence for those system surfaces.
