# Transcribe audio review

Serve the frontend on an isolated origin, with `RIPPLE_DATA_DIR` pointing outside the repository. Open `/tests/retranscription-review.html?lang=zh-CN`; `zh-TW` and `en` are also supported.

The real editor, settings dialog, transcription hook and model store operate on an in-memory synthetic audio file and transcript. Fetch and XHR are replaced with local simulations; unexpected requests are rejected. No user project, real credentials or provider endpoint is accessed. Reloading resets the synthetic data.

Check the title-row icon, hover label, keyboard focus, preservation notice, engine/account selection and options. Cancel before confirmation: the submission counter stays at zero. Confirm: it increments once and the title-row icon becomes disabled with a reason. Use **Simulate success** or **Simulate failure**, or the editor's cancellation button; inspect the version selector and retained old marks. Review at 1280 × 900 and 920 × 600, including scrolling inside the dialog and reaching its footer.

Automated tests in `retranscription.test.tsx` exercise the real model store with mocked provider results, compare retained audio/manuscript bytes, and verify cancellation, failure, duplicate submission and account-activation cancellation. Browser and synthetic filesystem evidence does not replace Mac or Windows installed-app acceptance.
