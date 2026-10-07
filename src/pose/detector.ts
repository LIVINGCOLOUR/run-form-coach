import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Frame } from '../core/types'
import { OneEuro } from '../core/filter'

let landmarker: PoseLandmarker | null = null

// 軽いモデルは止まっていても点が揺れ、直立の判定などに時間がかかったので、精度の高いモデルを使う
// （電池と発熱は、コマ数の上限と間引きで抑える）
export async function loadLandmarker(model: 'lite' | 'full' = 'full'): Promise<PoseLandmarker> {
  if (landmarker) return landmarker
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`)
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 2,
      // 人のいない部屋でも、あいまいな人影を返すことがあるので、確かさの線を上げる
      minPoseDetectionConfidence: 0.7,
      minPosePresenceConfidence: 0.7,
      minTrackingConfidence: 0.5,
    })
  try {
    landmarker = await make('GPU')
  } catch {
    landmarker = await make('CPU')
  }
  return landmarker
}

// 複数人が映ったときは、一番大きく映っている1人だけを追う
function largest(poses: { x: number; y: number; visibility?: number }[][]) {
  let best = poses[0]
  let bestArea = -1
  for (const p of poses) {
    const xs = p.map((q) => q.x)
    const ys = p.map((q) => q.y)
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    if (area > bestArea) {
      bestArea = area
      best = p
    }
  }
  return best
}

export interface PoseTick {
  frame: Frame | null // ピクセル座標。なめらかにしたもの
  skipped?: boolean // 省電力のため骨格を取らなかったコマ（frame は null）
  t: number // 秒
  width: number
  height: number
}

const MAX_FPS = 15 // 骨格を取るのは毎秒15コマまで

// video から骨格を取り続ける。stop() で止める
// want(t) が false のコマは骨格を取らず、skipped として知らせるだけにする
export function runPose(video: HTMLVideoElement, lm: PoseLandmarker, onTick: (p: PoseTick) => void, clock: () => number, want: (t: number) => boolean = () => true, maxFps = MAX_FPS) {
  const filters: OneEuro[] = Array.from({ length: 66 }, () => new OneEuro())
  let stopped = false
  let lastVideoTime = -1
  let lastTs = 0
  let lastRun = -1e9

  const step = () => {
    if (stopped) return
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const t = clock()
      if (t - lastRun < 1 / maxFps - 0.005) return schedule()
      lastRun = t
      if (!want(t)) {
        onTick({ frame: null, t, width: video.videoWidth, height: video.videoHeight, skipped: true })
        return schedule()
      }
      const ts = Math.max(lastTs + 1, Math.round(t * 1000))
      lastTs = ts
      const res = lm.detectForVideo(video, ts)
      const w = video.videoWidth
      const h = video.videoHeight
      if (res.landmarks.length) {
        const pose = largest(res.landmarks)
        const frame: Frame = pose.map((p, i) => ({
          x: filters[i * 2].filter(p.x * w, t),
          y: filters[i * 2 + 1].filter(p.y * h, t),
          v: p.visibility ?? 1,
        }))
        onTick({ frame, t, width: w, height: h })
      } else {
        onTick({ frame: null, t, width: w, height: h })
      }
    }
    schedule()
  }
  const schedule = () => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step)
    else requestAnimationFrame(step)
  }
  schedule()
  return { stop: () => (stopped = true) }
}

// 使っているレンズ（画面に出す）
export let cameraLens: 'ultra' | 'normal' = 'normal'

export async function openCamera(video: HTMLVideoElement, facing: 'front' | 'back' = 'front'): Promise<MediaStream> {
  // 骨格の推定は小さい画像で十分。解像度とコマ数を下げて、電池と発熱を抑える
  const size = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }
  let stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing === 'front' ? 'user' : 'environment', ...size } })
  cameraLens = 'normal'
  if (facing === 'back') {
    // 背面は、超広角（0.5倍）があればそちらを使う。近くに置いても全身が入る
    // 機種の名前は、カメラの許可をもらったあとでないと読めないので、一度開いてから探す
    const devices = await navigator.mediaDevices.enumerateDevices()
    const ultra = devices.find((d) => d.kind === 'videoinput' && /超広角|ultra ?wide/i.test(d.label))
    if (ultra) {
      stream.getTracks().forEach((t) => t.stop())
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: ultra.deviceId }, ...size } })
      cameraLens = 'ultra'
    } else {
      // 超広角が別のカメラとして見えない機種では、ズームを一番引いた状態にしてみる
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min: number } }
      if (caps.zoom && caps.zoom.min < 1) {
        await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] }).catch(() => {})
        cameraLens = 'ultra'
      }
    }
  }
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return stream
}
