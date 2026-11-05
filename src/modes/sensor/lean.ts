import { LIMIT } from '../../core/params'
import type { LeanParams } from './params'
import type { Vec3 } from './parse'

// 1個のセンサーの前への傾きで崩れを見分ける（胸＝猫背、頭＝頭が前に出る。数字は params.ts の HUNCH・HEAD）
// 時刻 t はすべて同じ時計の秒（カメラ版では performance.now() の秒）。BLE も画面も持たないので、テストで値を流して確かめられる
//   sample：加速度が届くたびに渡す。ならした向きを重力の向きにする
//   stand：立って止まっていた間（3秒）の終わりに呼ぶ。その間の向きを「立った姿勢」として覚える（2つの立ち方で見るときは setPoses。下）
//   update：tick 秒ごとに、走っているか（カメラ版は、カメラが歩数で決めた「走っている」）を渡す。知らせるときは cue が true
// 傾きは「前への傾き」（符号つき）：走る前傾を覚えた30秒で、立った姿勢から傾いた向きを「前」とし、その向きに沿った角度を見る。
// 横に傾いた（首をかしげた、体をひねった）だけでは増えない。走る前傾が fwdMin 度より小さいときは、傾いた向きがほとんど揺れで決まって
// 本当の前と大きくずれる（2026-11-05：頭 2.9°・胸 6.1° で前の向きが横向きになり、頭が前に出ても数えなかった）ので、向きによらない角度を使う
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
//   ・（カメラ版）線を越えて camSlipSec 秒たっても、カメラの上体の前傾が camRise 度、頭の位置（肩→耳の前傾）が camHeadRise 度も、
//     線の下にいた直近 camRef 秒より増えていない：カメラは崩れていないと見ているので、センサーがずれたとみなす（カメラの値がない間は数えず、上の slipSec を待つ）
// 2つの立ち方（setPoses。params.ts の POSE の説明）：stand の代わりに、a「いつもの楽な立ち方」と b「胸を開いた立ち方」の向きを渡す。
//   b を立った姿勢、b から a へ傾く向きを「前（猫背の向き）」、a と b の角度を猫背の大きさにする（走り出しの前傾から前の向きを決めない）。
//   走る前傾（その向きに沿った、走り出し30秒の真ん中）は、基準として poseCap 度まで（カメラ版は、カメラの上体の増え + poseCamSlack 度まで）しか差し引かない。
//   線は「基準 + max(margin, poseFrac × a と b の角度)」。ほかのしくみ（寄せる・ずれの見張り・曲げた）は stand と同じ。
//   a と b の角度が poseMin より小さければ覚えずに false（呼ぶ側が測り直すか、b を stand として今までの見方にする）
//   2つの立ち方で見るときだけの、場所ごとの決まり（0 なら今までと同じ。params.ts の HEAD の説明）：
//     線の幅の下限 poseMargin（0 なら margin）・続いたら知らせる長さ poseHold（0 なら hold）・
//     走り出して poseStart 秒から、走る前傾を覚え終わる前でも poseCap を基準にして知らせる（最初から崩れたまま走り出したのを、すぐ知らせる）・
//     知らせたあと線の下に posePraise 秒続けていたら、ほめる（praise）
// 2026-11-02 20:23 と 2026-11-03 15:08 の走りで、胸のセンサーがずれて傾きが +9〜13° 増えた（カメラの上体は変わらず）。わざとの猫背（60秒まで）は置き直さない
// 1時間の上限（core/params.ts の LIMIT.perHour。しくみ engine.ts と同じ決まり）：走った時間を1時間ずつの枠に切り、知らせが枠の中で上限に達したら、
//   その枠の残りは知らせない（測って、線を越えているかは見続ける。capped を返した tick が、その枠の最後の知らせ）。長い走りで震え続けないため

// bent：体を曲げている（またはその直後）ので見ていない。bend：この tick で曲げ始めたと見た（そのときの傾き。胸の bend を越えたときだけ）
// capped：この知らせで1時間の上限に達した（この1時間は、これが最後の知らせ）
// カメラ版で、カメラが見たいまの値（度）：trunk＝上体（腰の中心→肩の中心）の前傾、head＝頭の位置（手前の肩→耳の前傾）
export type CamValues = { trunk: number; head: number }

// learned：走る前傾を覚えた（度）。offset：2つの立ち方で見るとき、そのうち基準として差し引いた分（度）
// plausible：2つの立ち方で見ているとき、線を越えている向きが猫背としてありうる（ずれの見張りに数えない）
// praise：知らせたあと、線の下に posePraise 秒続けていた（直った。2つの立ち方で見ているときだけ）
export type LeanStep = { tilt: number | null; cue: boolean; capped?: boolean; praise?: boolean; plausible?: boolean; learned?: number; offset?: number; ref?: number | null; slip?: { from: number; to: number }; bent?: boolean; bend?: number }

// 2つの立ち方で決めた物差し。deg：a と b の角度（猫背の大きさ）、margin：使う線の幅（度）、camB：カメラ版で b のときのカメラの上体の前傾（度）
export type PoseScale = { deg: number; margin: number; camB: number | null }
// 走る前傾のうち、基準として差し引いた分。by：sensor（走る前傾そのまま）・cap（poseCap で抑えた）・camera（カメラの上体の増えで抑えた）。cam：カメラの上体の増え（度）
export type PoseOffset = { deg: number; by: 'sensor' | 'cap' | 'camera'; cam: number | null }

const DEG = 180 / Math.PI
const norm = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// 2つの向きの間の角度（度）
export const angleDeg = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * DEG
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
  private camUnder: { t: number; v: CamValues }[] = [] // 線の下にいた間のカメラの値（直近 camRef 秒）
  private camOver: CamValues[] = [] // 線を越えてからのカメラの値
  slips = 0 // ずれとみなして基準を置き直した回数
  pose: PoseScale | null = null // 2つの立ち方で見ているとき（setPoses）。stand で覚えたときは null
  offset: PoseOffset | null = null // 2つの立ち方で見ているとき、走る前傾のうち基準として差し引いた分
  private camLearn: number[] = [] // 2つの立ち方で見るカメラ版：走る前傾を覚える間の、カメラの上体の前傾
  private sides: { t: number; v: number }[] = [] // 直近 slipRef 秒の横の傾き（2つの立ち方で見るとき）
  private streak = 0 // 続けて知らせた回数（2つの立ち方で見るときの、知らせ直す間隔をのばすため）
  private hourCues = { hour: -1, n: 0 } // いまの1時間の枠（走った時間 ÷ 3600）で知らせた回数（LIMIT.perHour の上限）
  private underSince: number | null = null // 線の下に入った t
  private owed = false // 知らせたあと、まだほめていない（2つの立ち方で見るとき、posePraise）
  readonly p: LeanParams
  private readonly perHour: number

  // keepSec：立った姿勢を覚えるのに、さかのぼる長さの上限（秒）。perHour：1時間の知らせの上限（テストで外すためだけに渡す）
  constructor(p: LeanParams, keepSec = 5, perHour = LIMIT.perHour) {
    this.keep = keepSec
    this.p = p
    this.perHour = perHour
  }

  sample(t: number, a: Vec3) {
    const k = this.p.ema
    this.lastSample = t
    this.lp = this.lp === null ? [...a] : [this.lp[0] * (1 - k) + a[0] * k, this.lp[1] * (1 - k) + a[1] * k, this.lp[2] * (1 - k) + a[2] * k]
    this.recent.push({ t, a })
    while (this.recent.length && t - this.recent[0].t > this.keep) this.recent.shift()
  }

  // 止まっていた [t - sec, t] の加速度の平均の向き（覚えない）。足りなければ null
  dirOver(t: number, sec: number): Vec3 | null {
    const xs = this.recent.filter((x) => x.t >= t - sec && x.t <= t)
    if (xs.length < this.p.standMin) return null
    const sum: Vec3 = [0, 0, 0]
    for (const x of xs) for (let i = 0; i < 3; i++) sum[i] += x.a[i]
    return norm(sum)
  }

  // 立って止まっていた [t - sec, t] の加速度の平均の向きを覚える。足りなければ覚えずに false
  stand(t: number, sec: number): boolean {
    const b = this.dirOver(t, sec)
    if (!b) return false
    this.standDir(b)
    return true
  }

  // 2つの立ち方：a（いつもの楽な立ち方）と b（胸を開いた立ち方）の重力の向き。camB：カメラ版で、b のときのカメラの上体の前傾（度）。
  // 角度が poseMin より小さい（姿勢を変えられていない）か、向きが決まらなければ、何も覚えずに false
  setPoses(a: Vec3, b: Vec3, camB: number | null = null): boolean {
    const deg = angleDeg(a, b)
    if (!(deg >= this.p.poseMin)) return false
    const c = dot(a, b)
    const fwd = norm([a[0] - c * b[0], a[1] - c * b[1], a[2] - c * b[2]])
    if (!fwd) return false
    this.standDir(b)
    this.fwd = fwd
    this.pose = { deg, margin: Math.max(this.p.poseMargin > 0 ? this.p.poseMargin : this.p.margin, this.p.poseFrac * deg), camB: camB !== null && Number.isFinite(camB) ? camB : null }
    return true
  }

  // b→a の向きと直角な（横の）傾き（度）。2つの立ち方で見ていなければ null
  side(u: Vec3): number | null {
    if (!this.pose || !this.base || !this.fwd) return null
    const b = this.base
    const f = this.fwd
    const c = Math.max(-1, Math.min(1, dot(u, b)))
    const s: Vec3 = [b[1] * f[2] - b[2] * f[1], b[2] * f[0] - b[0] * f[2], b[0] * f[1] - b[1] * f[0]]
    const d: Vec3 = [u[0] - c * b[0], u[1] - c * b[1], u[2] - c * b[2]]
    return Math.atan2(dot(d, s), c) * DEG
  }

  // 線を越えている向きが、猫背としてありうるか（2つの立ち方で見ているときだけ）：
  //   猫背の割合（差し引いた走る前傾を除く）が poseIdxMin〜poseSlipIdx で、横の傾きが max(poseSlipSide, poseSlipSideFrac × 差) 以下。
  //   1歩ごとの揺れで割合が一瞬はみ出すので、直近 slipRef 秒の傾きと横の傾きの真ん中の値で見る
  private plausible(): boolean {
    const pose = this.pose!
    const p = this.p
    const idx = (median(this.tilts.map((x) => x.v)) - (this.offset?.deg ?? 0)) / pose.deg
    const side = Math.abs(median(this.sides.map((x) => x.v)))
    return idx >= p.poseIdxMin && idx <= p.poseSlipIdx && side <= Math.max(p.poseSlipSide, p.poseSlipSideFrac * pose.deg)
  }

  // 線の幅（度）：2つの立ち方で見ているときは max(poseMargin（0 なら margin）, poseFrac × 角度)、そうでなければ margin
  margin(): number {
    return this.pose?.margin ?? this.p.margin
  }

  // 猫背の割合（b ＝ 0、a ＝ 1）。2つの立ち方で見ていないか、傾きがなければ null
  index(tilt: number | null = this.tilt()): number | null {
    return this.pose && tilt !== null ? tilt / this.pose.deg : null
  }

  // 立った姿勢の向き b を覚える（stand と setPoses から）。前の向きと走る前傾も覚え直す
  standDir(b: Vec3) {
    this.base = b
    this.pose = null
    this.offset = null
    this.camLearn = []
    this.streak = 0
    this.underSince = null
    this.owed = false
    this.sides = []
    // 立ち直したら、前の向きと走る前傾も覚え直す
    this.fwd = null
    this.runLean = null
    this.ref = null
    this.runSec = 0
    this.learnUs = []
    this.overAcc = 0
    this.tilts = []
    this.anchor = null
    this.camUnder = []
    this.camOver = []
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
    // 2つの立ち方で見ているときは、前の向きは決まっている（b から a へ）
    if (!this.pose) {
      const size = Math.asin(Math.min(1, Math.hypot(m[0], m[1], m[2]) / n)) * DEG
      this.fwd = size >= this.p.fwdMin ? norm(m) : null
    }
    return median(this.learnUs.map((u) => this.angle(u, this.fwd)))
  }

  // 2つの立ち方で見るとき、走る前傾のうち基準として差し引く分：poseCap 度まで。カメラ版でカメラの上体の値が camMin 件あれば、
  // カメラの上体の増え（b の立ち姿勢から）+ poseCamSlack 度までにも抑える（カメラの上体は猫背をほとんど映さず、おもに体ごとの前傾を映すため）
  private poseOffset(runLean: number): PoseOffset {
    const p = this.p
    let lim = p.poseCap
    let by: PoseOffset['by'] = 'cap'
    let cam: number | null = null
    if (this.pose?.camB !== null && this.pose?.camB !== undefined && this.camLearn.length >= p.camMin) {
      cam = median(this.camLearn) - this.pose.camB
      const c = Math.max(0, cam + p.poseCamSlack)
      if (c < lim) {
        lim = c
        by = 'camera'
      }
    }
    return runLean <= lim ? { deg: runLean, by: 'sensor', cam } : { deg: lim, by, cam }
  }

  // t の時点で、曲げている（その直後）とみているか
  bent(t: number): boolean {
    return t < this.bendUntil
  }

  // bentElsewhere：ほかの場所（胸）で、体を曲げたと分かっている。cam：カメラ版で、いまのカメラの値。なければ null
  update(t: number, running: boolean, bentElsewhere = false, cam: CamValues | null = null): LeanStep {
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
      if (this.runSec >= p.skip && this.runSec < p.skip + p.learn) {
        this.learnUs.push(u)
        if (this.pose?.camB !== null && this.pose?.camB !== undefined && cam && Number.isFinite(cam.trunk)) this.camLearn.push(cam.trunk)
      }
      if (this.runSec >= p.skip + p.learn) {
        if (this.learnUs.length >= p.learnMin) {
          this.runLean = this.learnNow()
          // 2つの立ち方で見るときは、走る前傾を上限までしか差し引かない（猫背のまま走り出しても、猫背を基準にしない）
          this.offset = this.pose ? this.poseOffset(this.runLean) : null
          const start = this.offset ? this.offset.deg : this.runLean
          this.ref = start
          this.anchor = start
          out.learned = this.runLean
          if (this.offset) out.offset = this.offset.deg
          out.ref = this.ref
          out.tilt = this.tilt()
        } else this.runSec = p.skip // 取れた傾きが足りない（値が途切れていた）：もう一度ためる
        this.learnUs = []
        this.camLearn = []
        return out
      }
      // 2つの立ち方で見ていて poseStart 秒走ったら、覚え終わる前から知らせる（基準は差し引く上限の poseCap。覚えた基準はそれより大きくならない）
      if (!(this.pose && p.poseStart > 0 && this.runSec >= p.poseStart)) return out
    }
    // learning：走る前傾を覚えている間（poseStart から）。基準を寄せず、ずれも見張らない
    const learning = this.runLean === null
    const ref = learning ? p.poseCap : (this.ref ?? this.runLean!)
    this.tilts.push({ t, v: tilt })
    while (t - this.tilts[0].t > p.slipRef) this.tilts.shift()
    if (this.pose) {
      this.sides.push({ t, v: this.side(u) ?? 0 })
      while (t - this.sides[0].t > p.slipRef) this.sides.shift()
    }
    const camOk = p.camSlipSec > 0 && cam !== null && Number.isFinite(cam.trunk) && Number.isFinite(cam.head)
    if (tilt > ref + this.margin()) {
      this.underSince = null
      if (this.overSince === null) {
        this.overSince = t
        this.overAccAtStart = this.overAcc
        this.camOver = []
      }
      if (camOk) this.camOver.push(cam!)
      // 2つの立ち方で見ているとき：向きが猫背としてありうる（b→a の向きに沿い、割合が poseIdxMin〜poseSlipIdx、横の傾きが小さい）間は、
      // ずれの見張り（slipSec）に数えない。猫背のまま走っても、ずれとみなして黙らない
      const plausible = this.pose !== null && this.plausible()
      if (this.pose) out.plausible = plausible
      if (!plausible) this.overAcc += dt
      // 知らせ直す間隔：2つの立ち方で見ているときは、続けて poseBackoffAfter 回知らせたら poseBackoffEvery 秒ごとにする
      const every = this.pose && this.streak >= p.poseBackoffAfter ? p.poseBackoffEvery : p.cooldown
      const hold = this.pose && p.poseHold > 0 ? p.poseHold : p.hold
      // 1時間の枠が変わったら数え直す。上限に達した枠では知らせない
      const hour = Math.floor(this.runSec / 3600)
      if (this.hourCues.hour !== hour) this.hourCues = { hour, n: 0 }
      if (this.hourCues.n < this.perHour && t - this.overSince >= hold && t - this.lastCue >= every) {
        // 越えて最初の知らせで大きく傾いているときは、曲げる途中かもしれないので少し待つ（越えたままの知らせ直しは待たない）
        const wait = p.confirmAbove > 0 && p.confirmSec > 0 && this.lastCue < this.overSince && tilt >= ref + p.confirmAbove
        if (wait) this.waitSince ??= t
        if (!wait || t - this.waitSince! >= p.confirmSec) {
          this.lastCue = t
          this.streak++
          this.waitSince = null
          out.cue = true
          if (++this.hourCues.n >= this.perHour) out.capped = true
          if (this.pose && p.posePraise > 0) this.owed = true
        }
      }
    } else {
      this.overSince = null
      this.waitSince = null
      this.overAcc = Math.max(0, this.overAcc - dt * p.slipDecay)
      // 線の下に poseBackoffReset 秒いたら、続けて知らせた回数を数え直す（一瞬下に入っただけでは戻さない）
      this.underSince ??= t
      if (t - this.underSince >= p.poseBackoffReset) this.streak = 0
      // 知らせたあと、線の下に posePraise 秒続けていたら、ほめる（1回の崩れに1回）
      if (this.owed && t - this.underSince >= p.posePraise) {
        this.owed = false
        out.praise = true
      }
      // 線の下にいる間だけ、基準を今の傾きへゆっくり寄せる（follow が 0 なら寄せない）
      // 2つの立ち方で見ているときは、向きが猫背としてありうる間は前へ寄せない（ゆっくり猫背になったのを基準に吸わない）。後ろへはいつも寄せる
      if (p.follow > 0 && !learning) {
        const next = ref + (tilt - ref) * Math.min(1, dt / p.follow)
        if (!(this.pose && next > ref && this.plausible())) this.ref = next
      }
      if (camOk) {
        this.camUnder.push({ t, v: cam! })
        while (t - this.camUnder[0].t > p.camRef) this.camUnder.shift()
      }
    }
    // 崩れではなく、センサーがずれた：基準を今の傾きへ置き直し、ずれのせいで知らせ続けないようにする（slipSec・slipDrift が 0 なら見張らない）
    const long = p.slipSec > 0 && this.overAcc >= p.slipSec
    // 2つの立ち方で見ているときは、向きが猫背としてありうる間は、ずれとみなさない
    const drift = p.slipDrift > 0 && this.ref !== null && this.ref - (this.anchor ?? this.runLean!) >= p.slipDrift && !(this.pose && this.plausible())
    // カメラ版：越えて camSlipSec 秒たち、カメラの値が camMin 件ずつあって、線の下にいた間より camRise 度も増えていなければ、ずれ
    const camSlip =
      p.camSlipSec > 0 &&
      this.overSince !== null &&
      t - this.overSince >= p.camSlipSec &&
      this.camOver.length >= p.camMin &&
      this.camUnder.length >= p.camMin &&
      median(this.camOver.map((x) => x.trunk)) - median(this.camUnder.map((x) => x.v.trunk)) < p.camRise &&
      median(this.camOver.map((x) => x.head)) - median(this.camUnder.map((x) => x.v.head)) < p.camHeadRise
    if (!learning && (long || drift || camSlip)) {
      const from = this.anchor ?? this.runLean!
      this.ref = median(this.tilts.map((x) => x.v))
      this.anchor = this.ref
      this.overAcc = 0
      this.overSince = null
      this.waitSince = null
      this.camOver = []
      this.streak = 0
      this.owed = false
      this.slips++
      out.cue = false
      out.slip = { from, to: this.ref }
    }
    out.ref = learning ? ref : this.ref
    return out
  }
}
