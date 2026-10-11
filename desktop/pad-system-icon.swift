import AppKit

// Keep the paper master intact; only system icons need additional transparent margin.
let source = NSImage(contentsOfFile: CommandLine.arguments[1])!
let side = 1024
let scaled = 952 // 93% of the master canvas, rounded to whole pixels.
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current!.imageInterpolation = .high
source.draw(in: NSRect(x: (side-scaled)/2, y: (side-scaled)/2, width: scaled, height: scaled),
    from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
