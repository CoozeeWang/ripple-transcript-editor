# Synthetic notice review

Run Vite locally, then open `/tests/notice-review.html?scope=project&lang=zh-CN`.

- `scope`: `project`, `editor`, `settings` or `tasks`.
- `lang`: `zh-CN`, `zh-TW` or `en`.
- Review 820px and 1100px viewports. The fixture uses the same application-shell width rules as the product. The JSON report checks message/close alignment, row overflow and viewport boundaries.
- Project and settings completion samples remain visible initially for inspection. Enable **Live four-second timers**, then **Publish feedback** to check expiry. AI completion always uses its production timer. Publish again to inspect it.
- Check the close control with Tab or arrow-key focus, hover and click. Closing feedback must leave other notices/results intact. Required error, authorization and pending-work instructions remain until handled or dismissed.

All text and task records are synthetic. This page does not open project files, call a transcription provider or change connector configuration. An isolated WKWebView review is native-engine evidence; installed Mac and Windows/WebView2 acceptance are separate.
