import { HUNCH } from './params'
import type { Vec3 } from './parse'

// 胸のセンサーで猫背を見分ける（tools/coach.py と同じ考え方。数字は params.ts の HUNCH）
// 時刻 t はすべて同じ時計の秒（カメラ版では performance.now() の秒）。BLE も画面も持たないので、テストで値を流して確かめられる
//   sample：胸の加速度が届くたびに渡す。ならした向きを重力の向きにする
//   stand：まっすぐ立って止まっていた間（カメラの直立の基準を取った3秒）の終わりに呼ぶ。その間の向きを「立った姿勢」として覚える
//   update：HUNCH.tick 秒ごとに、走っているか（カメラ版は、カメラが歩数で決めた「走っている」）を渡す。知らせるときは cue が true

export type HunchStep = { tilt: number | null; cue: boolean; learned?: number }

const norm = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null
}
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export class HunchDetector {
  private lp: Vec3 | null = null
  private recent: { t: number; a: Vec3 }[] = [] // 立った姿勢を覚えるための、直近の生の加速度
  private keep: number
  base: Vec3 | null = null // 立った姿勢の重力の向き
  runLean: number | null = null // 走る前傾（立った姿勢からの度）
  private runSec = 0 // 走った時間（秒）
  private tilts: number[] = []
  private lastT: number | null = null
  private overSince: number | null = null
  private lastCue = -Infinity
  private readonly p: typeof HUNCH

  // keepSec：立った姿勢を覚えるのに、さかのぼる長さの上限（秒）
  constructor(keepSec = 5, p: typeof HUNCH = HUNCH) {
    this.keep = keepSec
    this.p = p
  }

  sample(t: number, a: Vec3) {
    const k = this.p.ema
    this.lp = this.lp === null ? [...a] : [this.lp[0] * (1 - k) + a[0] * k, this.lp[1] * (1 - k) + a[1] * k, this.lp[2] * (1 - k) + a[2] * k]
    this.recent.push({ t, a })
    while (this.recent.length && t - this.recent[0].t > this.keep) this.recent.shift()
  }

  // 立って止まっていた [t - sec, t] の加速度の平均の向きを覚える。足りなければ覚えずに false
  stand(t: number, sec: number): boolean {
    const xs = this.recent.filter((x) => x.t >= t - sec && x.t <= t)
    if (xs.length < this.p.standMin) return false
    const sum: Vec3 = [0, 0, 0]
    for (const x of xs) for (let i = 0; i < 3; i++) sum[i] += x.a[i]
    const b = norm(sum)
    if (!b) return false
    this.base = b
    // 立ち直したら、走る前傾も覚え直す
    this.runLean = null
    this.runSec = 0
    this.tilts = []
    return true
  }

  // 立った姿勢からの、いまの胸の傾き（度）。覚える前や、値が来ていないときは null
  tilt(): number | null {
    if (!this.base || !this.lp) return null
    const u = norm(this.lp)
    if (!u) return null
    const dot = u[0] * this.base[0] + u[1] * this.base[1] + u[2] * this.base[2]
    return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
  }

  update(t: number, running: boolean): HunchStep {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(1, t - this.lastT))
    this.lastT = t
    const tilt = this.tilt()
    const out: HunchStep = { tilt, cue: false }
    if (!running || tilt === null) {
      this.overSince = null
      return out
    }
    this.runSec += dt
    const p = this.p
    if (this.runLean === null) {
      if (this.runSec >= p.skip && this.runSec < p.skip + p.learn) this.tilts.push(tilt)
      if (this.runSec >= p.skip + p.learn) {
        if (this.tilts.length >= p.learnMin) {
          this.runLean = median(this.tilts)
          out.learned = this.runLean
        } else this.runSec = p.skip // 取れた傾きが足りない（胸の値が途切れていた）：もう一度ためる
        this.tilts = []
      }
      return out
    }
    if (tilt > this.runLean + p.margin) {
      this.overSince ??= t
      if (t - this.overSince >= p.hold && t - this.lastCue >= p.cooldown) {
        this.lastCue = t
        out.cue = true
      }
    } else this.overSince = null
    return out
  }
}
