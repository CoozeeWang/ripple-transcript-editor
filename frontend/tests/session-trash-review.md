# Session Trash review

Run Vite and open `/tests/session-trash-review.html?lang=zh-CN` (also `zh-TW` and `en`). The real workspace opens a synthetic project automatically. The filesystem double persists in this test origin's localStorage, allowing a reload/reopen. Providers and directory pickers are mocked; user projects are never accessed.

1. Check project Trash immediately before Settings. Export stays on the project heading. The session-delete button is smaller; its right edge aligns with Export at 920px and 1100px widths.
2. Open deletion for Synthetic session A. Cancel receives initial focus. Inspect the warning, keyboard focus, Escape, long text and busy/disabled states. Cancel once and confirm no change.
3. Confirm deletion. The other empty session becomes selected. Open project Trash and verify the session is one recoverable entry. Reload; reopen Trash and restore the same entry.
4. Confirm the recording and its versions return. Open its transcript and inspect the synthetic text and annotation. Existing project-store tests compare every material byte across delete/reopen/restore.
5. Delete the empty session as well. Deleting the last session keeps the project and project Trash accessible. Restore it from Trash or use Undo. Closing the short Undo never removes the recovery record.

Do not clear the fixture through a real user project. Permanent-clear tests run against disposable synthetic files only. Browser/isolated WebKit checks are separate from Mac/Windows installed-app acceptance.

The synthetic file picker also provides `Synthetic imported manuscript.txt`. Import it once as a standalone transcript and once into the recording. Both must show the complete filename, including `.txt`, and retain independent stored content. This exercises the same preparation/import pipeline used by external drops; no OS file picker or user document is opened.
