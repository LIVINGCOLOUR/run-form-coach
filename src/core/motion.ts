import type { Frame } from './types'
import { L, HEAD_POINTS, KEY_PAIRS } from './landmarks'
import { legLength } from './geometry'

// 両足首の前後の開きが、脚の長さに対してどれだけ揺れているかで「走っている」を見分ける
export class MotionDetector {
  private xs: { t: number; d: number }[] = []
  private windowSec: number
  private threshold: number
  constructor(windowSec = 2, threshold = 0.12) {
    this.windowSec = windowSec
    this.threshold = threshold
  }

  update(frame: Frame, t: number): boolean {
    const leg = legLength(frame)
    if (leg > 0) this.xs.push({ t, d: (frame[L.leftAnkle].x - frame[L.rightAnkle].x) / leg })
    while (this.xs.length && t - this.xs[0].t > this.windowSec) this.xs.shift()
    if (this.xs.length < 10) return false
    const m = this.xs.reduce((a, b) => a + b.d, 0) / this.xs.length
    const sd = Math.sqrt(this.xs.reduce((a, b) => a + (b.d - m) ** 2, 0) / this.xs.length)
    return sd > this.threshold
  }
}

// 全身が見えているか
// 人以外のもの（床や家具）を人と見間違えたものは、並び方と大きさで落とす
export function bodyVisible(frame: Frame, minV = 0.5, height?: number): boolean {
  if (!(HEAD_POINTS.some((i) => frame[i].v >= minV) && KEY_PAIRS.every(([a, b]) => Math.max(frame[a].v, frame[b].v) >= minV))) return false
  return plausibleBody(frame, height)
}

// 上から 頭 → 肩 → 腰 → 膝 → 足首 の順に並び、画面の高さの3割以上を占めているか
// （足首は、蹴り上げた脚が膝より上に来るので、低い方＝接地している側で見る）
export function plausibleBody(frame: Frame, height?: number): boolean {
  const y = (a: number, b: number) => (frame[a].y + frame[b].y) / 2
  const head = frame[L.nose].y
  const shoulder = y(L.leftShoulder, L.rightShoulder)
  const hip = y(L.leftHip, L.rightHip)
  const knee = y(L.leftKnee, L.rightKnee)
  const ankle = Math.max(frame[L.leftAnkle].y, frame[L.rightAnkle].y)
  if (!(head < shoulder && shoulder < hip && hip < knee && knee < ankle)) return false
  return height === undefined || ankle - head >= height * 0.3
}
