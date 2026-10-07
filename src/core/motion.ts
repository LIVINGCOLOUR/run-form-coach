import type { Frame } from './types'
import { L, HEAD_POINTS, KEY_PAIRS } from './landmarks'
import { legLength } from './geometry'

// 「走っている」を見分ける。左右の脚が交互に入れ替わるリズムで見る
//   前後：左右の足首の前後の開き（トレッドミルで大きく入れ替わる）
//   上下：左右の膝と足首の高さの差（その場で走るときや、フォームがコンパクトな人はこちらが主）
// どちらかが十分に大きく揺れていて、毎秒2歩以上のリズムで左右が入れ替わっていれば走っているとする
// （歩きはおよそ毎秒1.5〜2歩、走りは2.5〜3歩）
const MIN_SD = { x: 0.1, y: 0.04 } // 脚の長さに対する揺れの大きさ
const MIN_STEPS_PER_SEC = 2

export class MotionDetector {
  private xs: { t: number; x: number; y: number }[] = []
  private windowSec: number
  constructor(windowSec = 2) {
    this.windowSec = windowSec
  }

  update(frame: Frame, t: number): boolean {
    const leg = legLength(frame)
    if (leg > 0) {
      this.xs.push({
        t,
        x: (frame[L.leftAnkle].x - frame[L.rightAnkle].x) / leg,
        y: (frame[L.leftAnkle].y - frame[L.rightAnkle].y + frame[L.leftKnee].y - frame[L.rightKnee].y) / leg,
      })
    }
    while (this.xs.length && t - this.xs[0].t > this.windowSec) this.xs.shift()
    if (this.xs.length < 10) return false
    const span = this.xs[this.xs.length - 1].t - this.xs[0].t
    if (span < this.windowSec * 0.7) return false
    return (['x', 'y'] as const).some((k) => {
      const v = this.xs.map((p) => p[k])
      const m = v.reduce((a, b) => a + b, 0) / v.length
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)
      if (sd < MIN_SD[k]) return false
      return steps(v, m, sd * 0.4) / span >= MIN_STEPS_PER_SEC
    })
  }
}

// 左右が入れ替わった回数（＝歩数）。真ん中付近の小さな揺れで数えないよう、帯を越えたときだけ数える
function steps(v: number[], mean: number, band: number): number {
  let side = 0
  let n = 0
  for (const x of v) {
    const s = x > mean + band ? 1 : x < mean - band ? -1 : 0
    if (s === 0) continue
    if (side !== 0 && s !== side) n++
    side = s
  }
  return n
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
