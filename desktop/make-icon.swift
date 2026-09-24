import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Give the transparent mark the same visual margin as nearby macOS app icons.
let artwork = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = CGImageSourceCreateWithURL(artwork as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width == 1024, image.height == 1024,
      let context = CGContext(
        data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
        bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      ) else {
    fatalError("Expected 1024 × 1024 Ripple artwork")
}

context.clear(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let inset: CGFloat = 80
context.draw(image, in: CGRect(x: inset, y: inset, width: 1024 - 2 * inset, height: 1024 - 2 * inset))
guard let result = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not create desktop icon")
}
CGImageDestinationAddImage(destination, result, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not save desktop icon")
}
