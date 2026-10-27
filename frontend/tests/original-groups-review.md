# Original manuscript grouping review

Use an isolated frontend origin with `RIPPLE_DATA_DIR` outside the repository. Open `/tests/original-groups-review.html?lang=zh-CN`; languages also include `zh-TW` and `en`. Add `view=editor` for the real editor and its current/comparison menus. Add `legacy=1` to omit persisted group IDs and exercise conservative in-memory backfill from word provenance. All files and names are synthetic. Reload resets the fixture. Fetch returns synthetic configuration and XHR uploads are denied; no provider or real project is accessed.

The project contains original A with manual, AI and separately copied edits, original B with one edit, and an unlinked imported manuscript. Check that all A edits have the same indentation, belong to A and retain their names, that B stays separate, and that the import remains unlinked. Switching the current version does not change the hierarchy. Check selection, rename, copy, keyboard focus, disabled controls and the same layout in the editor menu at 1280 × 1000 and 920 × 700.

Original groups move together when reordered. Editing models may reorder within their original group; dragging them over another original must not reassign ownership. Existing version/action IDs and file paths remain intact. The real filesystem/store regression suite also covers source identity across session movement, association with colliding model IDs, soft deletion and restoration, read-only legacy backfill, unknown/ambiguous sources and retained audio/manuscript bytes.

These browser and synthetic filesystem checks do not represent Mac or Windows installed-app acceptance or system-menu visual acceptance.
