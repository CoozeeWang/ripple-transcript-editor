# Synthetic project interaction review

Serve the frontend on an isolated localhost port. This fixture uses the real ProjectBoard, project-index writer, native handle serialization and recent-project service with synthetic files and mocked native authorization. It never accesses real files or providers.

Open `/tests/project-interaction-review.html?lang=zh-CN` (`zh-TW` and `en` also supported). Drag the dots beside a session or recording; release over another row, a gap or a recording's manuscript import area. The actual synthetic index is saved and verified; the synthetic WAV contents remain unchanged.

With `review=1`, modes `default`, `sort-session`, `sort-nested`, `sort-gap` exercise ordering with an internal transfer also advertising Files. These are scripted DOM events, not proof of actual OS pointer dragging. `recent-warning` and `recent-busy` render the actual recent-record feedback component. Run `recent-write` then navigate to `recent-read` to verify migration and persistence across page reload, with the old database deliberately unavailable on read; authorization remains prompt. The old database/preferences belong only to this test origin.

Automated states report JSON in the output element and optional WebKit message handler. Check widths 920/1100 and all three languages. Native cursor appearance, installed-app dragging, actual system menus and Windows native acceptance remain separate checks.
