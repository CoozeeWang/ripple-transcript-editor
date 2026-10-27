import Cocoa
import WebKit

// Isolated native-engine test for the public synthetic browser fixture.
// Run an existing local Vite server first; no installed Ripple app is accessed.
guard CommandLine.arguments.count == 2,
      let url = URL(string: CommandLine.arguments[1]), url.scheme == "http",
      ["127.0.0.1", "localhost"].contains(url.host ?? "") else {
    fatalError("Pass the localhost URL of tests/aac-playback.html")
}
final class Reporter: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8),
              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        print(body); fflush(stdout)
        if result["status"] as? String == "passed" { exit(0) }
        if result["status"] as? String == "failed" { exit(1) }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.mediaTypesRequiringUserActionForPlayback = []
let reporter = Reporter()
config.userContentController.add(reporter, name: "result")
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
let testWindow = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
testWindow.title = "Ripple synthetic AAC regression"
testWindow.contentView = view
testWindow.orderBack(nil)
view.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { print("AAC regression timed out"); exit(2) }
app.run()
