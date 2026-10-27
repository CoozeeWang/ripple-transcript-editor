# Synthetic AAC playback sample

`synthetic-32k.aac` is a generated two-second, 440 Hz sine wave encoded as mono AAC LC at 32 kHz. It contains no speech, recordings or private data.

Generated with FFmpeg:

```sh
ffmpeg -v error -f lavfi -i 'sine=frequency=440:sample_rate=32000:duration=2' -ac 1 -c:a aac -b:a 192k -f adts synthetic-32k.aac
```

The browser fixture repeats its 64 ADTS frames 2048 times in memory, producing 131072 frames (about 70 minutes). It never writes a long audio file or calls a transcription provider. This reproduces a WebKit playback failure caused by too many Blob fragments with a small public sample.

To run the fixture:

1. Run `npm run dev -- --host 127.0.0.1 --port 5184 --strictPort` in `frontend/`.
2. Open `http://127.0.0.1:5184/tests/aac-playback.html` in a browser. The test runs muted and reports byte checks, playback and seeking results. If the browser blocks automatic playback, click **Run synthetic playback check** to grant the required interaction and retry.
3. On macOS, run `swift desktop/tests/aac-playback.swift http://127.0.0.1:5184/tests/aac-playback.html` from the repository root for a system WKWebView check. It uses an isolated data store and a background test window. It does not open or modify a Ripple project.

Chromium results on macOS are useful for the shared Blob/HTMLMediaElement path, but do not replace installed Windows WebView2 acceptance. Original-audio writes, transcription calls, project persistence, application installation and full user-interface acceptance are outside this fixture.
