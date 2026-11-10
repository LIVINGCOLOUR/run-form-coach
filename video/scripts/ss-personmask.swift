// SS の報告動画の録画で、人とトレッドミルだけ残し、ほかを濃くぼかす（カーテンやエアコンが目に入らないように）。
//   swiftc -O scripts/ss-personmask.swift -o <道具> && <道具> <入力.mp4> <骨格の点.json> <出力.mp4> [残す形を見る.png]
// 残す形 = Mac の Vision の人物の切り抜き（少し太らせる）＋骨格の点を結ぶ太い線（速く動く足先の取りこぼしを埋める）
//        ＋トレッドミルの形（録画のカメラは動かないので決まった多角形）。境目は少しぼかしてなじませる。
// 背景：録画をそのままぼかすと、体とカーテンに映る体の影が黒い影になって残った。そこで1回目に録画を全部見て、
//   体とそのまわり（影を含む）にかからないコマから、場所ごとにいちばん明るい色を集めて「人のいない部屋」を作り、
//   それを濃くぼかして全部のコマの背景にする（カメラは動かないので背景は止まったままでよい）。
// 骨格の点.json は、1コマごとの 33 点（[x, y, 確からしさ]、0〜1）か null の配列。入力とコマの順をそろえる
//   （ss-clip.mp4 には ss-data.json の frames[].p、ss-clip2.mp4 には ss-pts2.json の frames）。
// 出力は video/public/private/ss-clip-bg.mp4・ss-clip2-bg.mp4（git に入れない）。トレッドミルの形は、録画を撮り直したら合わせ直す。
import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision

let args = CommandLine.arguments
guard args.count >= 4 else { print("使い方: <道具> <入力.mp4> <骨格の点.json> <出力.mp4> [残す形を見る.png]"); exit(1) }
let inURL = URL(fileURLWithPath: args[1])
let pts = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [Any]
let outURL = URL(fileURLWithPath: args[3])
let debugPng = args.count > 4 ? args[4] : nil
try? FileManager.default.removeItem(at: outURL)

let BLUR = 60.0 // 背景のぼかし（濃いめ）
let DARK = -0.05 // 背景を少しだけ暗く（骨格の線を見やすく）
let LIMB_W = 70.0 // 骨格の線の太さ（1080 幅で）
let GROW = 6.0 // 切り抜きを太らせる幅
let FEATHER = 6.0 // 境目のぼかし
// トレッドミル（1080×1920、左上が原点）。11月9日の録画の位置
let TREAD: [(Double, Double)] = [(76, 846), (200, 862), (320, 900), (516, 950), (516, 1012), (340, 1012), (330, 1380), (1000, 1410), (1080, 1424), (1080, 1680), (470, 1680), (450, 1730), (110, 1730), (95, 1610), (220, 1300), (250, 1010), (190, 990), (80, 935)]
// 骨格の線（MediaPipe の番号）
let BONES = [(11, 12), (11, 23), (12, 24), (23, 24), (11, 13), (13, 15), (12, 14), (14, 16), (15, 19), (16, 20), (23, 25), (25, 27), (24, 26), (26, 28), (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32), (0, 11), (0, 12)]

let asset = AVURLAsset(url: inURL)
let track = asset.tracks(withMediaType: .video)[0]
let size = track.naturalSize
let W = Int(size.width), H = Int(size.height)
let ctx = CIContext()
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = .accurate
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
let gray = CGColorSpaceCreateDeviceGray()
let rgb = CGColorSpaceCreateDeviceRGB()
let full = CGRect(x: 0, y: 0, width: W, height: H)

// トレッドミルと骨格の線を、白黒の絵にする（CoreImage は左下が原点なので y を返す）
func shapes(_ p: [[Double]]?, tread: Bool = true) -> CIImage {
  let cg = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  cg.setFillColor(gray: 0, alpha: 1)
  cg.fill(CGRect(x: 0, y: 0, width: W, height: H))
  cg.setFillColor(gray: 1, alpha: 1)
  if tread {
  cg.move(to: CGPoint(x: TREAD[0].0, y: Double(H) - TREAD[0].1))
  for q in TREAD.dropFirst() { cg.addLine(to: CGPoint(x: q.0, y: Double(H) - q.1)) }
  cg.closePath()
  cg.fillPath()
  }
  if let p {
    cg.setStrokeColor(gray: 1, alpha: 1)
    cg.setLineWidth(LIMB_W)
    cg.setLineCap(.round)
    for (a, b) in BONES where p[a][2] > 0.3 && p[b][2] > 0.3 {
      cg.move(to: CGPoint(x: p[a][0] * Double(W), y: Double(H) - p[a][1] * Double(H)))
      cg.addLine(to: CGPoint(x: p[b][0] * Double(W), y: Double(H) - p[b][1] * Double(H)))
      cg.strokePath()
    }
    // 頭（鼻と耳のまわり）
    let hx = (p[7][0] + p[8][0]) / 2 * Double(W), hy = Double(H) - (p[7][1] + p[8][1]) / 2 * Double(H)
    cg.fillEllipse(in: CGRect(x: hx - 95, y: hy - 95, width: 190, height: 190))
  }
  return CIImage(cgImage: cg.makeImage()!)
}

func reader() throws -> (AVAssetReader, AVAssetReaderTrackOutput) {
  let r = try AVAssetReader(asset: asset)
  let o = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  r.add(o)
  r.startReading()
  return (r, o)
}

// 1コマの人の切り抜き（入力の大きさ）
func personOf(_ px: CVPixelBuffer) throws -> CIImage {
  try VNImageRequestHandler(cvPixelBuffer: px).perform([req])
  let m = CIImage(cvPixelBuffer: req.results![0].pixelBuffer)
  return m.transformed(by: CGAffineTransform(scaleX: size.width / m.extent.width, y: size.height / m.extent.height)).cropped(to: full)
}

// ---- 1回目：人のいない部屋 ----
// 体と骨格の線のまわり（ぶれた腕や足、左に出る影を含めて横に広く）を除き、場所ごとにいちばん明るい色を集める（1/4 の大きさで）
let QW = W / 4, QH = H / 4
var plate = [UInt8](repeating: 0, count: QW * QH * 4)
var seen = [UInt8](repeating: 0, count: QW * QH)
let small = CGAffineTransform(scaleX: 0.25, y: 0.25)
do {
  let (_, o) = try reader()
  var n = 0
  var img = [UInt8](repeating: 0, count: QW * QH * 4)
  var hol = [UInt8](repeating: 0, count: QW * QH * 4)
  while let sb = o.copyNextSampleBuffer() {
    guard let px = CMSampleBufferGetImageBuffer(sb) else { continue }
    let p = n < pts.count ? pts[n] as? [[Double]] : nil
    let hole = CIFilter.morphologyRectangleMaximum()
    hole.inputImage = try personOf(px).applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: shapes(p, tread: false)])
    hole.width = 401
    hole.height = 81
    let qr = CGRect(x: 0, y: 0, width: QW, height: QH)
    ctx.render(CIImage(cvPixelBuffer: px).transformed(by: small), toBitmap: &img, rowBytes: QW * 4, bounds: qr, format: .RGBA8, colorSpace: rgb)
    ctx.render(hole.outputImage!.cropped(to: full).transformed(by: small), toBitmap: &hol, rowBytes: QW * 4, bounds: qr, format: .RGBA8, colorSpace: rgb)
    for i in 0..<(QW * QH) where hol[i * 4] < 8 {
      let l = Int(img[i * 4]) + Int(img[i * 4 + 1]) + Int(img[i * 4 + 2])
      let l0 = Int(plate[i * 4]) + Int(plate[i * 4 + 1]) + Int(plate[i * 4 + 2])
      if seen[i] == 0 || l > l0 {
        for c in 0..<4 { plate[i * 4 + c] = img[i * 4 + c] }
        seen[i] = 255
      }
    }
    n += 1
  }
}
// 一度も見えなかった場所（いつも体が前にあるところ）は、行ごとに左右の見えた色を線でつなぐ（カーテンは縦のひだなので自然に見える）
for y in 0..<QH {
  var x = 0
  while x < QW {
    if seen[y * QW + x] != 0 { x += 1; continue }
    let x0 = x
    while x < QW && seen[y * QW + x] == 0 { x += 1 }
    let l = x0 - 1, r = x // 左右の見えた場所（はしなら片側だけ）
    for xi in x0..<x {
      let f = l < 0 ? 1.0 : r >= QW ? 0.0 : Double(xi - l) / Double(r - l)
      for c in 0..<4 {
        let cl = l < 0 ? Double(plate[(y * QW + r) * 4 + c]) : Double(plate[(y * QW + l) * 4 + c])
        let cr = r >= QW ? cl : Double(plate[(y * QW + r) * 4 + c])
        plate[(y * QW + xi) * 4 + c] = UInt8(cl * (1 - f) + cr * f)
      }
    }
  }
}
let pImg = CIImage(bitmapData: Data(plate), bytesPerRow: QW * 4, size: CGSize(width: QW, height: QH), format: .RGBA8, colorSpace: rgb)
  .transformed(by: CGAffineTransform(scaleX: 4, y: 4))
let adj = CIFilter.colorControls()
adj.inputImage = pImg.clampedToExtent().applyingGaussianBlur(sigma: BLUR)
adj.brightness = Float(DARK)
adj.saturation = 0.6
// 背景は1枚の絵にしておく（毎コマぼかし直さない）
let bgCG = ctx.createCGImage(adj.outputImage!.cropped(to: full), from: full)!
let background = CIImage(cgImage: bgCG)
if let debugPng {
  try ctx.writePNGRepresentation(of: pImg.cropped(to: full), to: URL(fileURLWithPath: debugPng + ".plate.png"), format: .RGBA8, colorSpace: rgb)
  try ctx.writePNGRepresentation(of: background, to: URL(fileURLWithPath: debugPng + ".bg.png"), format: .RGBA8, colorSpace: rgb)
}

// ---- 2回目：人とトレッドミルだけ残して、背景と合わせる ----
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let wIn = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 16_000_000]])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: wIn, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
writer.add(wIn)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
let (_, rOut) = try reader()
var n = 0
while let sb = rOut.copyNextSampleBuffer() {
  guard let px = CMSampleBufferGetImageBuffer(sb) else { continue }
  let t = CMSampleBufferGetPresentationTimeStamp(sb)
  let grow = CIFilter.morphologyMaximum()
  grow.inputImage = try personOf(px)
  grow.radius = Float(GROW)
  let p = n < pts.count ? pts[n] as? [[Double]] : nil
  let mask = grow.outputImage!.cropped(to: full).applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: shapes(p)])
    .clampedToExtent().applyingGaussianBlur(sigma: FEATHER).cropped(to: full)
  if let debugPng, n == 90 {
    try ctx.writePNGRepresentation(of: mask, to: URL(fileURLWithPath: debugPng), format: .RGBA8, colorSpace: rgb)
  }
  let blend = CIFilter.blendWithMask()
  blend.inputImage = CIImage(cvPixelBuffer: px)
  blend.backgroundImage = background
  blend.maskImage = mask
  var outPx: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &outPx)
  ctx.render(blend.outputImage!, to: outPx!)
  while !wIn.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(outPx!, withPresentationTime: t)
  n += 1
}
wIn.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print("コマ \(n)（骨格の点 \(pts.count)）")
