import AppKit

// Normalize only the system rendition. The approved master and in-app PNG stay intact.
// Installed peer icons have about 840 x 840 bodies on a 1024 canvas. Measure the
// master and verify the final raster so interpolation cannot silently add pixels.
let source = NSImage(contentsOfFile: CommandLine.arguments[1])!
let side = 1024
let bodySide = 840
func bounds(_ rep: NSBitmapImageRep) -> NSRect {
    var left = rep.pixelsWide, top = rep.pixelsHigh, right = 0, bottom = 0
    for y in 0..<rep.pixelsHigh { for x in 0..<rep.pixelsWide {
        if rep.colorAt(x: x, y: y)!.alphaComponent > 16.0 / 255.0 {
            left = min(left, x); top = min(top, y)
            right = max(right, x + 1); bottom = max(bottom, y + 1)
        }
    }}
    return NSRect(x: left, y: top, width: right - left, height: bottom - top)
}
let master = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))!
precondition(master.pixelsWide == side && master.pixelsHigh == side)
let masterBody = bounds(master)
var width = CGFloat(bodySide * side) / masterBody.width
var height = CGFloat(bodySide * side) / masterBody.height
var final: NSBitmapImageRep?
for _ in 0..<3 {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current!.imageInterpolation = .high
    source.draw(in: NSRect(x: (1024 - width) / 2, y: (1024 - height) / 2, width: width, height: height),
        from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    let body = bounds(bitmap)
    if body.width == CGFloat(bodySide) && body.height == CGFloat(bodySide) {
        precondition(body.midX == 512 && body.midY == 512)
        final = bitmap; break
    }
    width *= CGFloat(bodySide) / body.width
    height *= CGFloat(bodySide) / body.height
}
guard let final else { fatalError("System icon raster did not reach its fixed square geometry") }
try final.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
