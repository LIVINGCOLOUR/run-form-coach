import type { Frame } from '../../core/types'
import { HEAD_POINTS, L } from './landmarks'
import { bodyVisible } from './motion'

// 体がカメラの画面にどう収まっているか（置き方の画面と、走り出すのを待つ間に、何が足りないかを短く出すため）
//   ok：全身が入っている / none：体が映っていない / head：頭が切れている / feet：足が切れている /
//   both：頭と足の両方が切れている / hidden：端は切れていないが、体の一部（膝など）が見えていない・小さすぎる
// 見るのは、傾きを直す前の骨格の点（画面に映ったままの位置）
export type Framing = 'ok' | 'none' | 'head' | 'feet' | 'both' | 'hidden'

// 頭・足が「切れている」とみる、画面の上・下のふち（画面の高さに対する割合）。置き方の案内（Live.tsx の guide）と同じ
export const EDGE = { top: 0.04, bottom: 0.98 }

const MIN_V = 0.5

export function framing(frame: Frame | null, h: number): Framing {
  if (!frame) return 'none'
  const seen = (i: number) => frame[i].v >= MIN_V
  // 肩も腰も見えていなければ、人として映っていない
  if (!(seen(L.leftShoulder) || seen(L.rightShoulder)) && !(seen(L.leftHip) || seen(L.rightHip))) return 'none'
  // 頭：頭の点がどれも見えていない、または鼻が画面の上のふちより上
  const head = !HEAD_POINTS.some(seen) || frame[L.nose].y < h * EDGE.top
  // 足：両方の足首が見えていない、または見えている側の足首（かかと）が画面の下のふちより下
  const ankles = [L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel].filter(seen)
  const feet = !(seen(L.leftAnkle) || seen(L.rightAnkle)) || Math.max(...ankles.map((i) => frame[i].y)) > h * EDGE.bottom
  if (head && feet) return 'both'
  if (head) return 'head'
  if (feet) return 'feet'
  return bodyVisible(frame, MIN_V, h) ? 'ok' : 'hidden'
}

// 画面に出す短い言葉（声は、すでにある置き方の案内を使う。Live.tsx）
export const FRAMING_TEXT: Record<Framing, string> = {
  ok: '全身が入っています',
  none: '体が映っていません',
  head: '頭が切れています',
  feet: '足が切れています',
  both: '頭と足が切れています',
  hidden: '体の一部が見えていません',
}

// 1コマずつの判定はゆれるので、直近の窓でならす。窓のコマの半分以上が ok なら ok、
// そうでなければ ok 以外でいちばん多かったもの。窓にコマがなければ none
export class FramingWindow {
  private hist: { t: number; f: Framing }[] = []
  private readonly sec: number
  constructor(sec: number) {
    this.sec = sec
  }

  push(t: number, f: Framing) {
    this.hist.push({ t, f })
    while (this.hist.length && t - this.hist[0].t > this.sec) this.hist.shift()
  }

  // 直近の窓で、ok だったコマの割合
  get okRatio() {
    return this.hist.length ? this.hist.filter((x) => x.f === 'ok').length / this.hist.length : 0
  }
  // 骨格を取ったコマの、毎秒の数（窓が埋まるまでは小さく出る）
  get fps() {
    return this.hist.length / this.sec
  }

  current(): Framing {
    if (!this.hist.length) return 'none'
    if (this.okRatio >= 0.5) return 'ok'
    const n = new Map<Framing, number>()
    for (const x of this.hist) if (x.f !== 'ok') n.set(x.f, (n.get(x.f) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
}
