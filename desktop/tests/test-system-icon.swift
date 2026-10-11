import AppKit

// Inspect the built resource, not the drawing parameters. This catches differing
// margins/aspect ratios between the small Dock and large Launchpad representations.
guard CommandLine.arguments.count == 4 else {
    fatalError("Pass the system ICNS, approved master PNG and in-app PNG")
}
let image = NSImage(contentsOfFile: CommandLine.arguments[1])!
var sizes = Set<Int>()
for case let rep as NSBitmapImageRep in image.representations {
    let side = rep.pixelsWide
    precondition(rep.pixelsHigh == side)
    var left = side, top = side, right = 0, bottom = 0
    for y in 0..<side { for x in 0..<side {
        if rep.colorAt(x: x, y: y)!.alphaComponent > 16.0 / 255.0 {
            left = min(left, x); top = min(top, y)
            right = max(right, x + 1); bottom = max(bottom, y + 1)
        }
    }}
    let width = right - left, height = bottom - top
    let expected = Double(side) * 840 / 1024
    precondition(abs(Double(width) - expected) <= 1.1, "Unexpected visible width at \(side)")
    precondition(abs(Double(height) - expected) <= 1.1, "Unexpected visible height at \(side)")
    precondition(abs(width - height) <= 1, "Non-square body at \(side)")
    precondition(abs(left + right - side) <= 1 && abs(top + bottom - side) <= 1, "Off-center body")
    sizes.insert(side)
    print("\(side): visible \(width)x\(height), centered")
}
precondition(Set([16, 32, 64, 128, 256, 512, 1024]).isSubset(of: sizes), "Missing ICNS sizes")
let master = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
let appPNG = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
precondition(master == appPNG, "In-app artwork changed")
