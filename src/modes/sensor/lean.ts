import type { LeanParams } from './params'
import type { Vec3 } from './parse'

// 1個のセンサーの前への傾きで崩れを見分ける（胸＝猫背、頭＝頭が前に出る。数字は params.ts の HUNCH・HEAD）
// 時刻 t はすべて同じ時計の秒（カメラ版では performance.now() の秒）。BLE も画面も持たないので、テストで値を流して確かめられる
//   sample：加速度が届くたびに渡す。ならした向きを重力の向きにする
//   stand：まっすぐ立って止まっていた間（カメラの直立の基準を取った3秒）の終わりに呼ぶ。その間の向きを「立った姿勢」として覚える
//   update：tick 秒ごとに、走っているか（カメラ版は、カメラが歩数で決めた「走っている」）を渡す。知らせるときは cue が true
// 傾きは「前への傾き」（符号つき）：走る前傾を覚えた30秒で、立った姿勢から傾いた向きを「前」とし、その向きに沿った角度を見る。
// 横に傾いた（首をかしげた、体をひねった）だけでは増えない。前の向きが決まらないほど小さいときは、向きによらない角度を使う
// 基準（走る前傾）は、線を越えていない間だけ、follow 秒の時定数でゆっくり今の傾きに寄せる。
// ベルトの上でセンサーが少しずつずれていく（2026-11-02 の走りで、胸の傾きが3分半で約15°ずつ増えた。カメラの上体は変わらず）のを吸い、
// 数秒で起きた崩れは線を越えるので知らせる。線を越えている間は基準を動かさないので、崩れたままなら知らせ続ける

export type LeanStep = { tilt: number | null; cue: boolean; learned?: number; ref?: number | null }

const DEG = 180 / Math.PI
const norm = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export class LeanDetector {
  private lp: Vec3 | null = null
  private recent: { t: number; a: Vec3 }[] = [] // 立った姿勢を覚えるための、直近の生の加速度
  private keep: number
  base: Vec3 | null = null // 立った姿勢の重力の向き
  fwd: Vec3 | null = null // 前の向き（立った姿勢の向きと直角）。決まらなければ null
  runLean: number | null = null // 覚えた走る前傾（度）
  ref: number | null = null // いまの基準（走る前傾から、ゆっくり寄せたもの）
  private runSec = 0 // 走った時間（秒）
  private learnUs: Vec3[] = [] // 走る前傾を覚える間の、重力の向き
  private lastT: number | null = null
  private lastSample = -Infinity // 最後に値が届いた t
  private overSince: number | null = null
  private lastCue = -Infinity
  readonly p: LeanParams

  // keepSec：立った姿勢を覚えるのに、さかのぼる長さの上限（秒）
  constructor(p: LeanParams, keepSec = 5) {
    this.keep = keepSec
    this.p = p
  }

  sample(t: number, a: Vec3) {
    const k = this.p.ema
    this.lastSample = t
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
    // 立ち直したら、前の向きと走る前傾も覚え直す
    this.fwd = null
    this.runLean = null
    this.ref = null
    this.runSec = 0
    this.learnUs = []
    return true
  }

  // 重力の向き u の、立った姿勢からの傾き（度）。前の向きがあれば、それに沿った符号つきの角度
  private angle(u: Vec3, fwd: Vec3 | null): number {
    const b = this.base!
    const c = Math.max(-1, Math.min(1, dot(u, b)))
    if (!fwd) return Math.acos(c) * DEG
    const d: Vec3 = [u[0] - c * b[0], u[1] - c * b[1], u[2] - c * b[2]]
    return Math.atan2(dot(d, fwd), c) * DEG
  }

  private dir(): Vec3 | null {
    return this.lp ? norm(this.lp) : null
  }

  // 立った姿勢からの、いまの傾き（度）。覚える前や、値が来ていないときは null
  tilt(): number | null {
    const u = this.dir()
    return this.base && u ? this.angle(u, this.fwd) : null
  }

  // 走る前傾を覚える：前の向き（傾いた向きの平均）を決め、その向きに沿った傾きの真ん中の値を走る前傾にする
  private learnNow(): number {
    const b = this.base!
    const m: Vec3 = [0, 0, 0]
    for (const u of this.learnUs) {
      const c = dot(u, b)
      for (let i = 0; i < 3; i++) m[i] += u[i] - c * b[i]
    }
    const n = this.learnUs.length
    const size = Math.asin(Math.min(1, Math.hypot(m[0], m[1], m[2]) / n)) * DEG
    this.fwd = size >= this.p.fwdMin ? norm(m) : null
    return median(this.learnUs.map((u) => this.angle(u, this.fwd)))
  }

  update(t: number, running: boolean): LeanStep {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(1, t - this.lastT))
    this.lastT = t
    const u = t - this.lastSample > this.p.stale ? null : this.dir()
    const tilt = u && this.base ? this.angle(u, this.fwd) : null
    const out: LeanStep = { tilt, cue: false, ref: this.ref }
    if (!running || tilt === null || !u) {
      this.overSince = null
      return out
    }
    this.runSec += dt
    const p = this.p
    if (this.runLean === null) {
      if (this.runSec >= p.skip && this.runSec < p.skip + p.learn) this.learnUs.push(u)
      if (this.runSec >= p.skip + p.learn) {
        if (this.learnUs.length >= p.learnMin) {
          this.runLean = this.learnNow()
          this.ref = this.runLean
          out.learned = this.runLean
          out.ref = this.ref
          out.tilt = this.tilt()
        } else this.runSec = p.skip // 取れた傾きが足りない（値が途切れていた）：もう一度ためる
        this.learnUs = []
      }
      return out
    }
    const ref = this.ref ?? this.runLean
    if (tilt > ref + p.margin) {
      this.overSince ??= t
      if (t - this.overSince >= p.hold && t - this.lastCue >= p.cooldown) {
        this.lastCue = t
        out.cue = true
      }
    } else {
      this.overSince = null
      // 線の下にいる間だけ、基準を今の傾きへゆっくり寄せる（follow が 0 なら寄せない）
      if (p.follow > 0) this.ref = ref + (tilt - ref) * Math.min(1, dt / p.follow)
    }
    out.ref = this.ref
    return out
  }
}
