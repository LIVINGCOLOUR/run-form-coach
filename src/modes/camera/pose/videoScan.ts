import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Frame } from '../../../core/types'
import type { TimedFrame } from '../slowmo'
import { largest, nextTs } from './detector'

// 撮った動画を1コマずつ止めて骨格を取る（その場の速さは要らないので、全部のコマを見る）
// iPhone のスロー動画は、書き出すと毎秒30コマの動画に引き延ばされていることが多い。
// コマの間隔は、少しだけ再生して実際に出てきたコマの時刻から求める

export interface Scan {
  frames: TimedFrame[]
  width: number
  height: number
  step: number // 動画の中でのコマの間隔（秒）
  video: HTMLVideoElement // 着地の瞬間の絵を作るのに使う
}

export function openVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error('動画を読み込めませんでした'))
  })
}

// 遅く再生して、出てきたコマの動画時刻の間隔を測る
async function frameStep(video: HTMLVideoElement): Promise<number> {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number }
  if (!v.requestVideoFrameCallback) return 1 / 30
  const times: number[] = []
  v.playbackRate = 0.25
  await v.play().catch(() => {})
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 1500)
    const cb = (_: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime)
      if (times.length >= 16) {
        clearTimeout(done)
        resolve()
      } else v.requestVideoFrameCallback!(cb)
    }
    v.requestVideoFrameCallback!(cb)
  })
  v.pause()
  v.playbackRate = 1
  const d = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((x) => x > 0)
    .sort((a, b) => a - b)
  const step = d.length ? d[Math.floor(d.length / 2)] : 1 / 30
  return Math.min(1 / 30, Math.max(1 / 960, step))
}

export function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    const timer = setTimeout(done, 3000)
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

export function detect(video: HTMLVideoElement, lm: PoseLandmarker): Frame | null {
  const res = lm.detectForVideo(video, nextTs(performance.now()))
  if (!res.landmarks.length) return null
  const w = video.videoWidth
  const h = video.videoHeight
  return largest(res.landmarks).map((p) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 1 }))
}

export async function scanVideo(file: File, lm: PoseLandmarker, onProgress: (done: number) => void, cancelled: () => boolean): Promise<Scan> {
  const video = await openVideo(file)
  const step = await frameStep(video)
  const frames: TimedFrame[] = []
  const end = video.duration
  for (let t = 0; t < end - step / 2; t += step) {
    if (cancelled()) break
    await seek(video, t)
    const f = detect(video, lm)
    if (f) frames.push({ t, f })
    onProgress(Math.min(1, t / end))
  }
  return { frames, width: video.videoWidth, height: video.videoHeight, step, video }
}
