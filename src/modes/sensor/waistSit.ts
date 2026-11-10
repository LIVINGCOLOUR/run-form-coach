import { PHONE } from '../phone/params'
import { estimate, resample, stepCuts, type PhoneMeasure } from '../phone/signal'
import { WAIST_SIT } from './params'

// センサーランの腰のスマホで、腰落ち（腰を落として、ひざを曲げたまま走る）を見る。記録だけで、震わせない・声にしない（開発中）。数字は params.ts の WAIST_SIT。
// 腰の高さそのものは、加速度の積分では出せない（床からの位置は消える）。代わりに、腰を落とした走りで変わる2つを見る：
//   接地の割合（duty）：有効接地時間（上下の加速度が1gを上回る時間。phone/signal.ts の contactMs、ならさない値）÷ 1歩の時間。腰を落とすと長くなる
//   1歩ごとの上下の加速度の山（peakG）：重力を含む上下の加速度の、1歩の中のいちばん大きい値（g）。腰を落とす（ひざがやわらかい）と低くなる
// 2つを、その走りの、同じ速さのふつうの走りの真ん中（基準）からの z（ふつうの走りのばらつきの何倍か）にして、
//   見分けの値 index ＝ (z(duty) − z(peakG)) ÷ (ふつうの走りでの z(duty) − z(peakG) のばらつき) を出す。
// 弾む走りは duty が減って山が上がるので、index は負になる（腰落ちと逆）

export const G0 = 9.80665

// 直近の窓（WAIST_SIT.window 秒）の腰のスマホの値から出す、1秒ごとの値
export type WaistGait = {
  cad: number // ピッチ（歩/分）
  bounceCm: number // 上下動（cm）
  contactMs: number // 有効接地時間（ms）
  duty: number // 接地の割合（有効接地時間 ÷ 1歩の時間）
  peakG: number // 1歩ごとの上下の加速度の山（重力を含む、g）の真ん中
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
export const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return NaN
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((v) => (v - m) * (v - m))))
}

// 窓の値（PhoneMeasure）から1秒ごとの値を出す。走る動きでない・値が足りなければ null
// ピッチ・上下動・有効接地時間は、スマホ版と同じ見る役（phone/signal.ts の estimate）の値。山は、同じ並べ直し（resample）と同じ1歩の切れ目（stepCuts）で数える
export function waistGait(ms: PhoneMeasure[]): WaistGait | null {
  const e = estimate(ms)
  if (!e || !(e.cadence > 0) || !(e.contactMs > 0)) return null
  const { acc } = resample(ms)
  const fs = PHONE.fs
  const g = [0, 1, 2].map((k) => mean(acc.map((a) => a[k])))
  const gn = Math.hypot(g[0], g[1], g[2])
  if (!(gn > 0)) return null
  const up = g.map((x) => x / gn)
  const vert = acc.map((a) => a[0] * up[0] + a[1] * up[1] + a[2] * up[2])
  const { cuts } = stepCuts(
    vert.map((v) => v - gn),
    fs / (e.cadence / 60),
  )
  const peaks: number[] = []
  for (let c = 0; c + 1 < cuts.length; c++) {
    let hi = -Infinity
    for (let i = cuts[c]; i < cuts[c + 1]; i++) hi = Math.max(hi, vert[i])
    peaks.push(hi)
  }
  if (peaks.length < 2) return null
  return { cad: e.cadence, bounceCm: e.bounceCm, contactMs: e.contactMs, duty: e.contactMs / 1000 / (60 / e.cadence), peakG: median(peaks) / G0 }
}

// 基準（同じ速さのふつうの走り）。sdD・sdP：duty・peakG の、基準に使った秒のばらつき（基準に対する割合）。sdC：z(duty) − z(peakG) のばらつき
// by：warm（走り出して warm 秒からの span 秒）・settle（走って settleFrom〜settleTo 秒）・speed（速さが変わったあと）。fixedSd：秒が足りず、決めたばらつきを使った
export type WaistRef = { by: 'warm' | 'settle' | 'speed'; at: number; v: number | null; duty: number; peak: number; sdD: number; sdP: number; sdC: number; n: number; fixedSd: boolean }

// 判定しなかったわけ（記録の wSkip）：0 判定した、1 走っていない、2 値が出ない、3 基準がまだない、4 基準と速さが違う、5 胸が猫背の線を越えている
export const WAIST_SKIP = ['judged', 'notRunning', 'noValue', 'noRef', 'speed', 'chest'] as const
export type WaistSkip = (typeof WAIST_SKIP)[number]

export type WaistSitSec = { dutyPct: number | null; peakPct: number | null; index: number | null; sit: 0 | 1 | null; skip: WaistSkip }

// 1秒ごとの値の行（基準を作るための貯め）
type Row = { t: number; run: number; v: number | null; duty: number; peak: number }

// 1秒ごとに、見分けの値を出して、決まり（WAIST_SIT）を満たした秒が続いたら events に残す
//   waist:ref <by> duty <接地の割合> peak <山 g> v <速さ km/h か -> n <秒の数>[ fixedSd]（基準を作った・置き換えた）
//   waist:sit <duty の増え %> <山の変わり %> <index>（hold 秒続いた）・waist:sitOk（okSec 秒続けて決まりの外）
export class WaistSit {
  ref: WaistRef | null = null
  private refs: WaistRef[] = []
  runSec = 0
  private rows: Row[] = [] // 最初の基準のための秒（走った時間 warm〜settleTo）
  private pending: Row[] = [] // 速さが変わったあとの基準のための秒
  private offSince: number | null = null // 基準の速さから外れ始めた t
  private streak = 0 // 決まりを満たした、判定した秒が続いた数
  private chestRun = 0 // 胸が線を越えて判定しなかった秒が続いた数
  private okStreak = 0
  on = false
  private readonly onEvent: (t: number, text: string) => void
  private readonly p: typeof WAIST_SIT

  constructor(onEvent: (t: number, text: string) => void, p: typeof WAIST_SIT = WAIST_SIT) {
    this.onEvent = onEvent
    this.p = p
  }

  // 1秒ごと。running：走っているか。chestOver：胸の猫背の見張りが線を越えているか。v：いまの速さ（km/h。分からなければ null）
  second(t: number, g: WaistGait | null, running: boolean, chestOver: boolean, v: number | null): WaistSitSec {
    const none = (skip: WaistSkip): WaistSitSec => {
      if (skip !== 'judged') this.streak = 0
      return { dutyPct: null, peakPct: null, index: null, sit: null, skip }
    }
    if (!running) return none('notRunning')
    this.runSec += 1
    if (!g) return none('noValue')
    const row: Row = { t, run: this.runSec, v, duty: g.duty, peak: g.peakG }
    // 基準にくらべた値（基準がなくても、速さで選べないときでも、出せるものは出す）
    const ref = this.pick(v)
    const okSpeed = !!ref && (ref.v === null || v === null || Math.abs(v / ref.v - 1) <= this.p.speedTol)
    const out = ref ? this.compare(g, ref) : null
    this.learn(t, row, chestOver, okSpeed)
    if (!ref || !out) return none('noRef')
    if (!okSpeed) return { ...out, sit: null, skip: this.stopStreak('speed') }
    // 胸が猫背の線を越えている秒は判定しない。続いた秒は数え直さず、そのまま持ち越す（腰を落とすと胸も丸まりやすく、
    // 11-09 の2回目の腰落ちでは、胸が1秒おきに線を越えていた）。chestGap 秒より長く越え続けたら数え直す
    if (chestOver) {
      if (++this.chestRun > this.p.chestGap) this.streak = 0
      return { ...out, sit: null, skip: 'chest' }
    }
    this.chestRun = 0
    const sit = out.index >= this.p.line || (out.dutyPct >= this.p.dutyPct && out.peakPct <= this.p.peakPct)
    if (sit) {
      this.streak += 1
      this.okStreak = 0
      // hold 秒：1秒ごとの値は直近 window 秒の窓から出すので、続けて (hold − window + 1) 秒なら、hold 秒ぶんの走りが決まりを満たした
      if (!this.on && this.streak >= Math.max(1, this.p.hold - this.p.window + 1)) {
        this.on = true
        this.onEvent(t, `waist:sit ${out.dutyPct.toFixed(1)} ${out.peakPct.toFixed(1)} ${out.index.toFixed(2)}`)
      }
    } else {
      this.streak = 0
      this.okStreak += 1
      if (this.on && this.okStreak >= this.p.okSec) {
        this.on = false
        this.onEvent(t, 'waist:sitOk')
      }
    }
    return { ...out, sit: sit ? 1 : 0, skip: 'judged' }
  }

  private stopStreak(skip: WaistSkip): WaistSkip {
    this.streak = 0
    return skip
  }

  private compare(g: WaistGait, r: WaistRef) {
    return { dutyPct: (g.duty / r.duty - 1) * 100, peakPct: (g.peakG / r.peak - 1) * 100, index: this.index(g.duty, g.peakG, r) }
  }

  private index(duty: number, peak: number, r: WaistRef) {
    return ((duty / r.duty - 1) / r.sdD - (peak / r.peak - 1) / r.sdP) / r.sdC
  }

  // いまの速さに合う基準：速さが分からなければ、いまの基準。分かれば、速さの近い基準（なければ、いまの基準を返して、呼ぶ側が速さで止める）
  private pick(v: number | null): WaistRef | null {
    if (v === null || !this.ref) return this.ref
    const near = this.refs.filter((r) => r.v !== null && Math.abs(v / r.v - 1) <= this.p.speedTol).sort((a, b) => Math.abs(v - a.v!) - Math.abs(v - b.v!))
    if (near.length) this.ref = near[0]
    return this.ref
  }

  // 基準を作る・置き換える
  private learn(t: number, row: Row, chestOver: boolean, okSpeed: boolean) {
    const p = this.p
    // 1. 最初の基準：走って warm 秒から span 秒（仮）。2. 走って settleFrom〜settleTo 秒の、決まりの下（index < settleBelow）にいた秒で置き換える
    if (!chestOver && row.run > p.warm && row.run <= p.settleTo) this.rows.push(row)
    if (!this.ref && row.run >= p.warm + p.span) {
      // 胸で止めた秒が多くて足りなければ、足りるまで後ろへ延ばす
      const xs = this.rows.filter((r) => r.run > p.warm)
      if (xs.length >= p.minN) this.setRef(t, 'warm', xs)
    }
    if (row.run === p.settleTo && this.ref?.by === 'warm') {
      const first = this.ref
      const xs = this.rows.filter((r) => r.run > p.settleFrom && (first.v === null || r.v === null || Math.abs(r.v / first.v - 1) <= p.speedTol) && this.index(r.duty, r.peak, first) < p.settleBelow)
      if (xs.length >= p.minN) this.setRef(t, 'settle', xs, first)
      this.rows = []
    }
    // 3. 速さが変わった：どの基準とも speedTol より違う速さが speedWarm 秒続いたら、そこから speedSpan 秒の真ん中を、その速さの基準にする
    if (!this.ref || okSpeed || row.v === null) {
      this.offSince = null
      this.pending = []
      return
    }
    this.offSince ??= t
    if (t - this.offSince < p.speedWarm || chestOver) return
    this.pending.push(row)
    const vMid = median(this.pending.map((r) => r.v!))
    const xs = this.pending.filter((r) => Math.abs(r.v! / vMid - 1) <= p.speedTol)
    if (t - this.offSince >= p.speedWarm + p.speedSpan && xs.length >= p.minN) {
      this.setRef(t, 'speed', xs)
      this.offSince = null
      this.pending = []
    }
  }

  private setRef(t: number, by: WaistRef['by'], xs: Row[], replace?: WaistRef) {
    const p = this.p
    const duty = median(xs.map((r) => r.duty))
    const peak = median(xs.map((r) => r.peak))
    const vs = xs.map((r) => r.v).filter((v): v is number => v !== null)
    const v = vs.length >= xs.length / 2 ? median(vs) : null
    // ばらつきは、秒が sdMinN 以上あるときだけ、その走りから出す（重なった窓の秒なので、少ないと当てにならない）。足りなければ決めた値
    const enough = by !== 'warm' && xs.length >= p.sdMinN
    const dr = xs.map((r) => r.duty / duty - 1)
    const pr = xs.map((r) => r.peak / peak - 1)
    let sdD = enough ? sd(dr) : p.sdDuty
    let sdP = enough ? sd(pr) : p.sdPeak
    // ばらつきが小さすぎると、わずかな違いで大きな値になる（同じ値が続いた記録など）。決めた値の半分を下限にする
    sdD = Math.max(sdD, p.sdDuty / 2)
    sdP = Math.max(sdP, p.sdPeak / 2)
    const sdC = enough ? Math.max(sd(dr.map((d, i) => d / sdD - pr[i] / sdP)), 0.5) : p.sdComb
    const ref: WaistRef = { by, at: t, v, duty, peak, sdD, sdP, sdC, n: xs.length, fixedSd: !enough }
    if (replace) this.refs = this.refs.filter((r) => r !== replace)
    this.refs.push(ref)
    this.ref = ref
    this.onEvent(t, `waist:ref ${by} duty ${duty.toFixed(3)} peak ${peak.toFixed(2)} v ${v === null ? '-' : v.toFixed(1)} n ${xs.length}${enough ? '' : ' fixedSd'}`)
  }
}
