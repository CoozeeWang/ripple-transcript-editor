// Draws the Finder background for the Mac drag-to-Applications installer.
// Usage: swift dmg-background.swift /path/to/background.png
import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fatalError("Pass an output PNG path")
}

let width = 800
let height = 520
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

let paper = NSColor(calibratedRed: 1, green: 0.992, blue: 0.973, alpha: 1)
let ink = NSColor(calibratedRed: 0.149, green: 0.149, blue: 0.129, alpha: 1)
let muted = NSColor(calibratedRed: 0.424, green: 0.416, blue: 0.376, alpha: 1)
let teal = NSColor(calibratedRed: 0.125, green: 0.333, blue: 0.376, alpha: 1)
let pale = NSColor(calibratedRed: 0.898, green: 0.937, blue: 0.941, alpha: 1)

func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: radius, yRadius: radius).fill()
}
func label(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular,
           color: NSColor = ink) {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [
        .font: font, .foregroundColor: color
    ])
}

paper.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
box(34, 410, 732, 74, radius: 18, color: pale)
label("Ripple", x: 58, y: 441, size: 26, weight: .semibold, color: teal)
label("拖到“应用程序”  ·  拖到「應用程式」  ·  Drag to Applications", x: 58, y: 418,
      size: 14, color: teal)

// Finder draws the app and Applications icons above this area.
let arrow = NSBezierPath()
arrow.lineWidth = 5
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 347, y: 305))
arrow.line(to: NSPoint(x: 453, y: 305))
arrow.move(to: NSPoint(x: 437, y: 320))
arrow.line(to: NSPoint(x: 453, y: 305))
arrow.line(to: NSPoint(x: 437, y: 290))
teal.setStroke()
arrow.stroke()

box(34, 124, 732, 120, radius: 14, color: .white)
label("首次安装 · 第一次安裝 · First install", x: 54, y: 212, size: 15,
      weight: .semibold, color: teal)
label("把左侧 Ripple 拖到右侧“应用程序”。", x: 54, y: 184, size: 13)
label("將左側 Ripple 拖到右側「應用程式」。", x: 54, y: 162, size: 13)
label("Drag Ripple onto Applications.", x: 54, y: 140, size: 13)

box(34, 18, 732, 96, radius: 14, color: pale)
label("更新旧版 · 更新舊版 · Update", x: 54, y: 83, size: 15,
      weight: .semibold, color: teal)
label("先退出 Ripple，再拖入；如 Finder 询问，选择“替换”。", x: 54, y: 61, size: 12, color: ink)
label("先結束 Ripple，再拖入；如 Finder 詢問，選擇「取代」。", x: 54, y: 43, size: 12, color: ink)
label("Quit Ripple, drag it over, then choose Replace in Finder.", x: 54, y: 25,
      size: 12, color: muted)

NSGraphicsContext.current?.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Unable to draw DMG background")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
