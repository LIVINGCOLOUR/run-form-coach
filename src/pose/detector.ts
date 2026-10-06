import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Frame } from '../core/types'
import { OneEuro } from '../core/filter'

let landmarker: PoseLandmarker | null = null

export async function loadLandmarker(model: 'lite' | 'full' = 'full'): Promise<PoseLandmarker> {
  if (landmarker) return landmarker
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`)
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
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
  t: number // 秒
  width: number
  height: number
}

// video から骨格を取り続ける。stop() で止める
export function runPose(video: HTMLVideoElement, lm: PoseLandmarker, onTick: (p: PoseTick) => void, clock: () => number) {
  const filters: OneEuro[] = Array.from({ length: 66 }, () => new OneEuro())
  let stopped = false
  let lastVideoTime = -1
  let lastTs = 0

  const step = () => {
    if (stopped) return
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const t = clock()
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

export async function openCamera(video: HTMLVideoElement, facing: 'front' | 'back' = 'front'): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing === 'front' ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  })
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return stream
}
