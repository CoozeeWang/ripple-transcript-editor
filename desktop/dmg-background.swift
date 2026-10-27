// Draw the minimal Finder background for Ripple's drag-to-Applications DMG.
// Usage: swift dmg-background.swift /path/to/background.png
import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fatalError("Pass an output PNG path")
}

let width = 660
let height = 400
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

NSColor(calibratedRed: 0.965, green: 0.961, blue: 0.941, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()

let arrow = NSBezierPath()
arrow.lineWidth = 5
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 270, y: 210))
arrow.line(to: NSPoint(x: 390, y: 210))
arrow.move(to: NSPoint(x: 372, y: 227))
arrow.line(to: NSPoint(x: 390, y: 210))
arrow.line(to: NSPoint(x: 372, y: 193))
NSColor(calibratedRed: 0.125, green: 0.333, blue: 0.376, alpha: 1).setStroke()
arrow.stroke()

NSGraphicsContext.current?.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Unable to draw DMG background")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
