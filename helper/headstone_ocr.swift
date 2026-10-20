// Usage: headstone_ocr <image path>
// Prints JSON: { lines:[{text,confidence,x,y,w,h}], exif:{lat,lon,date,make,model}, width, height }
import Foundation
import Vision
import ImageIO

func exifInfo(_ url: URL) -> [String: Any] {
    var out: [String: Any] = [:]
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return out }
    if let w = props[kCGImagePropertyPixelWidth] as? Int { out["width"] = w }
    if let h = props[kCGImagePropertyPixelHeight] as? Int { out["height"] = h }
    if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
       var lat = gps[kCGImagePropertyGPSLatitude] as? Double,
       var lon = gps[kCGImagePropertyGPSLongitude] as? Double {
        if (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" { lat = -lat }
        if (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" { lon = -lon }
        out["lat"] = lat
        out["lon"] = lon
    }
    if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
       let d = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
        out["date"] = d  // "yyyy:MM:dd HH:mm:ss"
    }
    if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
        if let m = tiff[kCGImagePropertyTIFFMake] as? String { out["make"] = m }
        if let m = tiff[kCGImagePropertyTIFFModel] as? String { out["model"] = m }
    }
    return out
}

func ocr(_ url: URL) -> [[String: Any]] {
    var lines: [[String: Any]] = []
    let handler = VNImageRequestHandler(url: url, options: [:])
    let req = VNRecognizeTextRequest { r, _ in
        for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
            guard let top = o.topCandidates(1).first else { continue }
            let b = o.boundingBox  // normalized, origin bottom-left
            lines.append(["text": top.string, "confidence": Double(top.confidence),
                          "x": b.origin.x, "y": 1 - b.origin.y - b.size.height, "w": b.size.width, "h": b.size.height])
        }
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false  // names and dates, not prose
    req.minimumTextHeight = 0.01
    try? handler.perform([req])
    return lines
}

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: headstone_ocr <image>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var result: [String: Any] = ["exif": exifInfo(url), "lines": ocr(url)]
let data = try JSONSerialization.data(withJSONObject: result, options: [])
FileHandle.standardOutput.write(data)
