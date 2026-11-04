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
// ずれの見張り：次のどちらかで、崩れではなくセンサーの付け位置がずれたとみなし、基準を直近 slipRef 秒の傾きの真ん中の値へ置き直す（slip を返す）
//   ・線を越えていた時間（線の下にいる間は slipDecay 倍の速さで減らす）が slipSec 秒に達した：急にずれて、線を越えたままになった
//   ・基準が、走る前傾（前にずれとみなしたときは、そのときの基準）から slipDrift 度より前へ動いた：少しずつずれて、寄せた基準が動いた。
//     後ろへ動いたのは見ない（鳴りにくくなるだけで、外れた知らせにはならない。基準は寄せて追う）
// 体を曲げた（物を拾う）：傾きが基準 + bend 以上（または、ほかの場所で曲げたと分かった：update の bentElsewhere）なら、走る姿勢ではない。
//   その間と bendAfter 秒あとまでは、知らせず、基準も寄せず、ずれの見張りにも数えない。越え始めてから数えた分もなかったことにする。
//   大きく傾いて知らせるとき（基準 + confirmAbove 以上）は confirmSec 秒待ち、その間に曲げたと分かれば知らせない
// 2026-11-02 20:23 と 2026-11-03 15:08 の走りで、胸のセンサーがずれて傾きが +9〜13° 増えた（カメラの上体は変わらず）。わざとの猫背（60秒まで）は置き直さない

// bent：体を曲げている（またはその直後）ので見ていない。bend：この tick で曲げ始めたと見た（そのときの傾き。胸の bend を越えたときだけ）
export type LeanStep = { tilt: number | null; cue: boolean; learned?: number; ref?: number | null; slip?: { from: number; to: number }; bent?: boolean; bend?: number }

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
  private overAcc = 0 // 線を越えていた時間（秒。線の下にいる間は減らす）
  private tilts: { t: number; v: number }[] = [] // 直近 slipRef 秒の傾き（置き直す先を決める）
  private anchor: number | null = null // ずれを測るもと（走る前傾。ずれとみなしたら、そのときの基準）
  private overAccAtStart = 0 // 線を越え始めたときの overAcc（曲げたと分かったら、ここへ戻す）
  private waitSince: number | null = null // 大きく傾いて知らせるのを待ち始めた t
  private bendUntil = -Infinity // この t までは曲げている（その直後）とみなす
  private bending = false // 前の tick で、曲げている間だった
  slips = 0 // ずれとみなして基準を置き直した回数
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
    this.overAcc = 0
    this.tilts = []
    this.anchor = null
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

  // t の時点で、曲げている（その直後）とみているか
  bent(t: number): boolean {
    return t < this.bendUntil
  }

  // bentElsewhere：ほかの場所（胸）で、体を曲げたと分かっている
  update(t: number, running: boolean, bentElsewhere = false): LeanStep {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(1, t - this.lastT))
    this.lastT = t
    const u = t - this.lastSample > this.p.stale ? null : this.dir()
    const tilt = u && this.base ? this.angle(u, this.fwd) : null
    const out: LeanStep = { tilt, cue: false, ref: this.ref }
    if (!running || tilt === null || !u) {
      this.overSince = null
      this.waitSince = null
      this.bending = false
      return out
    }
    this.runSec += dt
    const p = this.p
    // 体を曲げた：知らせず、基準・ずれの見張り・走る前傾の覚え込みにも使わない
    const big = p.bend > 0 && tilt >= (this.ref ?? this.runLean ?? 0) + p.bend
    if (big || bentElsewhere) {
      if (big && !this.bending) out.bend = tilt
      this.bendUntil = t + p.bendAfter
    }
    if (t < this.bendUntil) {
      if (this.overSince !== null) this.overAcc = this.overAccAtStart
      this.overSince = null
      this.waitSince = null
      this.bending = true
      out.bent = true
      return out
    }
    this.bending = false
    if (this.runLean === null) {
      if (this.runSec >= p.skip && this.runSec < p.skip + p.learn) this.learnUs.push(u)
      if (this.runSec >= p.skip + p.learn) {
        if (this.learnUs.length >= p.learnMin) {
          this.runLean = this.learnNow()
          this.ref = this.runLean
          this.anchor = this.runLean
          out.learned = this.runLean
          out.ref = this.ref
          out.tilt = this.tilt()
        } else this.runSec = p.skip // 取れた傾きが足りない（値が途切れていた）：もう一度ためる
        this.learnUs = []
      }
      return out
    }
    const ref = this.ref ?? this.runLean
    this.tilts.push({ t, v: tilt })
    while (t - this.tilts[0].t > p.slipRef) this.tilts.shift()
    if (tilt > ref + p.margin) {
      if (this.overSince === null) {
        this.overSince = t
        this.overAccAtStart = this.overAcc
      }
      this.overAcc += dt
      if (t - this.overSince >= p.hold && t - this.lastCue >= p.cooldown) {
        // 越えて最初の知らせで大きく傾いているときは、曲げる途中かもしれないので少し待つ（越えたままの知らせ直しは待たない）
        const wait = p.confirmAbove > 0 && p.confirmSec > 0 && this.lastCue < this.overSince && tilt >= ref + p.confirmAbove
        if (wait) this.waitSince ??= t
        if (!wait || t - this.waitSince! >= p.confirmSec) {
          this.lastCue = t
          this.waitSince = null
          out.cue = true
        }
      }
    } else {
      this.overSince = null
      this.waitSince = null
      this.overAcc = Math.max(0, this.overAcc - dt * p.slipDecay)
      // 線の下にいる間だけ、基準を今の傾きへゆっくり寄せる（follow が 0 なら寄せない）
      if (p.follow > 0) this.ref = ref + (tilt - ref) * Math.min(1, dt / p.follow)
    }
    // 崩れではなく、センサーがずれた：基準を今の傾きへ置き直し、ずれのせいで知らせ続けないようにする（slipSec・slipDrift が 0 なら見張らない）
    const long = p.slipSec > 0 && this.overAcc >= p.slipSec
    const drift = p.slipDrift > 0 && this.ref !== null && this.ref - (this.anchor ?? this.runLean) >= p.slipDrift
    if (long || drift) {
      const from = this.anchor ?? this.runLean
      this.ref = median(this.tilts.map((x) => x.v))
      this.anchor = this.ref
      this.overAcc = 0
      this.overSince = null
      this.waitSince = null
      this.slips++
      out.cue = false
      out.slip = { from, to: this.ref }
    }
    out.ref = this.ref
    return out
  }
}
