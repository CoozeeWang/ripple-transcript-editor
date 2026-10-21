import AppKit
import CoreFoundation

// Run after replacing a stopped Ripple bundle. Refresh its pinned Dock tile only;
// restarting Dock or LaunchServices alone can keep the tile's old icon cache.
guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: refresh-mac-icon.swift /absolute/Ripple.app /absolute/tile-backup.plist")
}
let appURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let backupURL = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
guard let bundle = Bundle(url: appURL),
      bundle.bundleIdentifier == "studio.ripple.app",
      let iconName = bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String,
      FileManager.default.fileExists(atPath: appURL.appendingPathComponent("Contents/Resources/\(iconName)").path),
      NSRunningApplication.runningApplications(withBundleIdentifier: "studio.ripple.app").isEmpty else {
    fatalError("Require a valid, stopped Ripple application bundle")
}
let domain = "com.apple.dock" as CFString
let key = "persistent-apps" as CFString
guard var tiles = CFPreferencesCopyAppValue(key, domain) as? [[String: Any]] else {
    fatalError("Dock entries unavailable")
}
let matches = tiles.indices.filter {
    guard let data = tiles[$0]["tile-data"] as? [String: Any],
          data["bundle-identifier"] as? String == "studio.ripple.app",
          let file = data["file-data"] as? [String: Any],
          let path = file["_CFURLString"] as? String,
          let url = URL(string: path) else { return false }
    return url.standardizedFileURL == appURL
}
guard !matches.isEmpty else { print("Ripple has no pinned Dock entry; nothing to refresh"); exit(0) }
guard matches.count == 1 else { fatalError("Multiple Ripple Dock entries; leave them unchanged") }
let index = matches[0]
let original = tiles as NSArray
let backup = try PropertyListSerialization.data(fromPropertyList: tiles[index], format: .binary, options: 0)
try backup.write(to: backupURL, options: .withoutOverwriting)
let oldGUID = (tiles[index]["GUID"] as? NSNumber)?.uint32Value
var freshGUID: UInt32
repeat { freshGUID = UInt32.random(in: 1...UInt32.max) }
while freshGUID == oldGUID || tiles.contains { ($0["GUID"] as? NSNumber)?.uint32Value == freshGUID }
var data = tiles[index]["tile-data"] as! [String: Any]
data["book"] = try appURL.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
data["file-type"] = 41 // Application tile, as used by the peer application entries.
tiles[index]["tile-data"] = data
tiles[index]["GUID"] = freshGUID
guard let current = CFPreferencesCopyAppValue(key, domain) as? NSArray,
      current.isEqual(to: original as! [Any]) else { fatalError("Dock changed during refresh; retry") }
CFPreferencesSetAppValue(key, tiles as CFArray, domain)
guard CFPreferencesAppSynchronize(domain),
      let saved = CFPreferencesCopyAppValue(key, domain) as? NSArray,
      saved.isEqual(to: tiles) else { fatalError("Dock did not save the refreshed tile") }
print("Refreshed Ripple tile at its existing position; other entries preserved. Backup: \(backupURL.path)")
