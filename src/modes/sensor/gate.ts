import { RUN_GATE, STILL } from './params'
import type { Vec3 } from './parse'

// カメラなしで、走っているか・止まって立っているかを、センサーの揺れで見分ける（センサーラン、腰スマホといっしょに使うとき。数字は params.ts の RUN_GATE・STILL）。
// BLE も画面も持たないので、テストで値を流して確かめられる。時刻 t は同じ時計の秒（performance.now() の秒）
//   sample：値が届くたびに、場所と加速度（g）・ジャイロ（dps）を渡す
//   update：ときどき（RUN_GATE.every 秒ごとに計算する）。走っているか（続けて越えた・下回ったで切り替える）を返す
//   still：胸と頭（つながっているもの）が、直近 STILL.sec 秒じっとしているか。胸も頭もなければ null

interface Pt {
  t: number
  a: number // 加速度の大きさ（g）
  g: number // ジャイロの大きさ（dps）
}

export interface WindowStats {
  n: number
  accStd: number
  gyroMed: number
  gyroP90: number
}

const KEEP = Math.max(RUN_GATE.win, STILL.sec) + 1

export function windowStats(xs: Pt[]): WindowStats {
  const n = xs.length
  if (!n) return { n: 0, accStd: NaN, gyroMed: NaN, gyroP90: NaN }
  let m = 0
  for (const x of xs) m += x.a / n
  let v = 0
  for (const x of xs) v += (x.a - m) ** 2 / n
  const gs = xs.map((x) => x.g).sort((a, b) => a - b)
  return { n, accStd: Math.sqrt(v), gyroMed: gs[Math.floor(n / 2)], gyroP90: gs[Math.min(n - 1, Math.floor(n * 0.9))] }
}

export class MotionGate {
  private pts = new Map<string, Pt[]>()
  private lastCalc = -Infinity
  private overSince: number | null = null
  private underSince: number | null = null
  running = false
  last: { place: string | null; std: number | null } = { place: null, std: null } // 最後に見た場所とばらつき（記録用）
  readonly p: typeof RUN_GATE
  readonly s: typeof STILL

  constructor(p: typeof RUN_GATE = RUN_GATE, s: typeof STILL = STILL) {
    this.p = p
    this.s = s
  }

  sample(place: string, t: number, a: Vec3, g: Vec3) {
    let xs = this.pts.get(place)
    if (!xs) {
      xs = []
      this.pts.set(place, xs)
    }
    xs.push({ t, a: Math.hypot(a[0], a[1], a[2]), g: Math.hypot(g[0], g[1], g[2]) })
    // 古い値を捨てる（先頭から。たまに一度に）
    if (xs.length > 64 && t - xs[0].t > KEEP) {
      let i = 0
      while (i < xs.length && t - xs[i].t > KEEP) i++
      xs.splice(0, i)
    }
  }

  private recent(place: string, t: number, sec: number): Pt[] {
    const xs = this.pts.get(place)
    if (!xs) return []
    let i = xs.length
    while (i > 0 && xs[i - 1].t > t - sec) i--
    return xs.slice(i).filter((x) => x.t <= t)
  }

  // その瞬間の見分け（続けて見る前）：走っていそうなら true、そうでなければ false、見られる場所がなければ null
  vote(t: number): boolean | null {
    for (const place of this.p.order) {
      const st = windowStats(this.recent(place, t, this.p.win))
      if (st.n < this.p.minN) continue
      this.last = { place, std: st.accStd }
      return st.accStd >= (this.p.std[place] ?? Infinity)
    }
    this.last = { place: null, std: null }
    return null
  }

  update(t: number): boolean {
    if (t - this.lastCalc < this.p.every) return this.running
    this.lastCalc = t
    const v = this.vote(t)
    if (v) {
      this.underSince = null
      this.overSince ??= t
      if (!this.running && t - this.overSince >= this.p.startSec) this.running = true
    } else {
      // 値が来ない（切れた）ときも、走っていないとみなす（知らせない側に倒す）
      this.overSince = null
      this.underSince ??= t
      if (this.running && t - this.underSince >= this.p.stopSec) this.running = false
    }
    return this.running
  }

  // 胸と頭（値が来ているもの）が、直近 STILL.sec 秒じっとしているか。どちらも来ていなければ null
  still(t: number): boolean | null {
    let any = false
    for (const place of this.s.places) {
      const xs = this.recent(place, t, this.s.sec)
      // 来ていない場所は見ない。来ているのに3秒ぶんたまっていなければ、まだ分からない（false）
      if (!xs.length || t - xs[xs.length - 1].t > 1) continue
      any = true
      if (xs.length < this.s.minN || xs[0].t > t - this.s.sec + 0.3) return false
      const st = windowStats(xs)
      if (!(st.accStd <= this.s.accStd && st.gyroMed <= this.s.gyroMed && st.gyroP90 <= this.s.gyroP90)) return false
    }
    return any ? true : null
  }
}
