import type { Frame } from './types'
import { L, KEY_POINTS } from './landmarks'
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
export function bodyVisible(frame: Frame, minV = 0.5): boolean {
  return KEY_POINTS.every((i) => frame[i].v >= minV)
}
