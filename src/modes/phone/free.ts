import { CUE, LIMIT } from '../../core/params'
import { PHRASES } from '../../core/phrases'
import { WAIST_SIT } from '../sensor/params'
import { FREE, PHONE, PHONE_LIMITS, SPEED } from './params'
import type { Vec3 } from './signal'

// 答えつきの記録（/lab/）のあとの、指示なしの走り（自由走）の「試しの声」。テスト用のページだけで使い、ふつうのアプリ（/）の声は変えない。
// 走っている最中の姿勢の指摘に使うのは、腰のスマホの値だけ（本人の決め 2026-11-17。センサーは答え合わせの材料として記録に積むだけ）。
//
// 線は、この走りの答えつきの区間で、本人ごとに作る（数字は params.ts の FREE）：
//   1. 区間ごとに、判定できた1秒の値をためる（learn）。最初のふつうは始めの FREE.baseSkip 秒、ほかの区間は始めの FREE.settle 秒を除く
//   2. 答えつきの区間が終わったら（build）、項目ごとに「ふつう（最初のふつう・戻し・最後のふつう）の値の上の端（FREE.normalQ の分位）」と
//      「わざとの崩しの区間の値の真ん中」の間の真ん中に線を引く。崩しの真ん中が、ふつうの上の端より上になかった（分かれなかった）項目・
//      崩しの秒が FREE.minCrit より少なかった項目は、線を作らず声にしない
//   3. 自由走の間（judge）、線を FREE.hold 秒続けて越えた項目を1つだけ言う
// 項目（並びが言う順。ピッチを先にするのは、ピッチを変えると上下動・ブレーキもまとめて変わるため。analyzer.ts の PHONE_ITEMS と同じ考え）：
//   cadence ピッチの下がり（%）：線は研究の 5%（PHONE_LIMITS.cadence。Heiderscheit 2011）。答えつきの区間の崩しは要らないが、
//     ふつうの区間の上の端がもう 5% を越えていたら（ふつうでも声が出る）、声にしない
//   sit 腰落ち：センサーランの腰の iPhone と同じ見分けの値（sensor/waistSit.ts の index。接地の割合が増えて上下の加速度の山が下がると正）。
//     崩しは「腰を落とす（中）」「腰を深く落とす」。猫背でも同じ向きに半分ほど動く（2026-11-09）ので、猫背を腰落ちと言うことがある（events で確かめる）
//   over 足を前に出しすぎ：着地のブレーキ（m/s）の、基準からの増え。崩しは「足を前に出しすぎる」
//   bounce 弾みすぎ：上下動の、基準からの増え（%）。崩しは「弾む」
// 判定しない秒：走っていない・付け方の問題（腰以外・ずれた）・スマホの上向きが基準から傾いた・外で速さが基準から SPEED.band より外れた・GPS が取れない
//   （呼ぶ側と、ここで速さを見る）。判定しない秒のあとは FREE.after 秒待つ（速さが戻った直後などは、窓に前の歩が残るため）。
//   止まったあと（走り出し）は FREE.afterStop 秒待つ（走り始めの1分は、腰落ちの見分けの値がふつうでも線を越えた。2026-11-09）
// 坂は見ない（ウェブでは気圧計がなく、GPS の高さでは見分けられない。params.ts の SPEED の説明）。上り坂で速さが落ちれば、速さで止まる
// 声の間は、いまのしくみに合わせる：どの項目でも前の声から CUE.gap 秒、同じ項目は CUE.cooldown 秒、同じ項目は1時間に LIMIT.perHour 回まで

export type FreeItem = 'cadence' | 'sit' | 'over' | 'bounce'
export const FREE_ITEMS: FreeItem[] = ['cadence', 'sit', 'over', 'bounce']
// 言葉（いまのスマホ版の言葉。腰落ちは本人が 2026-11-07 に決めた言葉）
export const FREE_SAY: Record<FreeItem, string> = {
  cadence: PHRASES.phoneCadence,
  sit: PHRASES.cueHip,
  over: PHRASES.phoneBraking,
  bounce: PHRASES.phoneBounce,
}
// 線を作るのに使う、わざとの崩しの区間（答えつきの記録の key。drill.ts の LAB_STEPS）。ピッチは崩しを使わない
const CRIT: Record<FreeItem, string[]> = { cadence: [], sit: ['sitmid', 'sitdeep'], over: ['over'], bounce: ['bouncy'] }
// ふつうとして線の下側に使う区間
const NORMAL = ['normal1', 'back', 'normal2']

// 1秒の値
export interface FreeSec {
  t: number // 秒（続いているかを見るだけ。どの時計でもよい）
  judged: boolean // 呼ぶ側で、判定してよい秒か（付け方の問題〔腰以外・ずれた〕がない）
  stopped: boolean // 走っていない秒（止まった・値が出ない）。このあとは FREE.afterStop 秒判定しない
  up: Vec3 | null // スマホの上向き（スマホの座標）。最初のふつうの向きから PHONE.upShiftDeg より傾いた秒は使わない
  cadence: number | null
  bounceCm: number | null
  brakingMs: number | null
  duty: number | null // 接地の割合（直近 WAIST_SIT.window 秒。sensor/waistSit.ts の waistGait）
  peakG: number | null // 1歩ごとの上下の加速度の山（g、同じ窓）
  speed: number | null // GPS のならした速さ（m/s）。トレッドミルでは null
}

// 比べる相手（最初のふつう）
export interface FreeBase {
  n: number
  cadence: number
  bounceCm: number
  brakingMs: number
  duty: number
  peakG: number
  speed: number | null // 外だけ
  sdD: number
  sdP: number
  sdC: number
}

// 項目ごとの線。line が null なら声にしない（why に理由）
export interface FreeLine {
  item: FreeItem
  line: number | null
  normalHi: number | null // ふつうの値の上の端
  crit: number | null // わざとの崩しの値の真ん中
  nNormal: number
  nCrit: number
  why: 'ok' | 'noBase' | 'few' | 'overlap' | 'normalOver'
}

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return null
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const quantile = (xs: number[], q: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return null
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return s[i]
}
const sdOf = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

// 項目の値（大きいほど崩れている向き）。出せなければ null
export function freeValue(item: FreeItem, s: FreeSec, b: FreeBase): number | null {
  if (item === 'cadence') return s.cadence === null || !(b.cadence > 0) ? null : ((b.cadence - s.cadence) / b.cadence) * 100
  if (item === 'bounce') return s.bounceCm === null || !(b.bounceCm > 0) ? null : (s.bounceCm / b.bounceCm - 1) * 100
  if (item === 'over') return s.brakingMs === null ? null : s.brakingMs - b.brakingMs
  if (s.duty === null || s.peakG === null || !(b.duty > 0) || !(b.peakG > 0)) return null
  return ((s.duty / b.duty - 1) / b.sdD - (s.peakG / b.peakG - 1) / b.sdP) / b.sdC
}

// 線の言葉（events に残す形）：free:line sit 2.31 hi 1.10 crit 3.52 n 410/52（線を作れなければ free:line over none few n 410/0）
export const lineText = (l: FreeLine) => {
  const f = (x: number | null) => (x === null ? '-' : x.toFixed(2))
  return `free:line ${l.item} ${l.line === null ? `none ${l.why}` : f(l.line)} hi ${f(l.normalHi)} crit ${f(l.crit)} n ${l.nNormal}/${l.nCrit}`
}

export class FreeCoach {
  private secs = new Map<string, FreeSec[]>() // 区間の key → ためた秒
  base: FreeBase | null = null
  lines: FreeLine[] = []
  built = false
  private streak: Record<FreeItem, number> = { cadence: 0, sit: 0, over: 0, bounce: 0 }
  private lastJudgedT: number | null = null // 直前に判定した秒
  private okSince: number | null = null // 判定できる秒が続き始めた t
  private stopAt = -Infinity // 最後に走っていなかった t
  private upSum: Vec3 = [0, 0, 0] // 上向きの基準：最初のふつうの、始めの FREE.settle〜FREE.baseSkip 秒の平均（線を作る秒より前で決める）
  upRef: Vec3 | null = null
  checked = 0 // 自由走で判定した秒の数
  private lastSaid = -Infinity
  private lastItem: Record<FreeItem, number> = { cadence: -Infinity, sit: -Infinity, over: -Infinity, bounce: -Infinity }
  private hour: Record<FreeItem, { from: number; n: number }> = { cadence: { from: 0, n: 0 }, sit: { from: 0, n: 0 }, over: { from: 0, n: 0 }, bounce: { from: 0, n: 0 } }
  private readonly p: typeof FREE

  constructor(p: typeof FREE = FREE) {
    this.p = p
  }

  // 答えつきの区間の1秒をためる。key：区間の key（normal1・back・sitmid…）、since：区間に入ってからの秒
  learn(key: string, since: number, s: FreeSec) {
    if (this.built || !s.judged || s.stopped) return
    if (key === 'normal1' && since >= this.p.settle && since < this.p.baseSkip && s.up) {
      for (let i = 0; i < 3; i++) this.upSum[i] += s.up[i]
      return
    }
    if (since < (key === 'normal1' ? this.p.baseSkip : this.p.settle)) return
    if (!this.upOk(s)) return
    const xs = this.secs.get(key) ?? []
    xs.push(s)
    this.secs.set(key, xs)
  }

  // 答えつきの区間が終わったとき：基準と線を作る
  build(): FreeLine[] {
    this.built = true
    const n1 = this.secs.get('normal1') ?? []
    const both = n1.filter((x) => x.cadence !== null && x.bounceCm !== null && x.brakingMs !== null && x.duty !== null && x.peakG !== null)
    if (both.length < this.p.minBase) {
      this.lines = FREE_ITEMS.map((item) => ({ item, line: null, normalHi: null, crit: null, nNormal: 0, nCrit: 0, why: 'noBase' }))
      return this.lines
    }
    const med = (f: (x: FreeSec) => number | null) => median(both.map(f).filter((v): v is number => v !== null))!
    const speeds = both.map((x) => x.speed).filter((v): v is number => v !== null)
    const duty = med((x) => x.duty)
    const peakG = med((x) => x.peakG)
    // 見分けの値のばらつきは、labValues.ts の labBase・sensor/waistSit.ts の setRef と同じ（秒が足りなければ決めた値、決めた値の半分が下限）
    const W = WAIST_SIT
    let sdD = W.sdDuty
    let sdP = W.sdPeak
    let sdC = W.sdComb
    if (both.length >= W.sdMinN) {
      const dr = both.map((x) => x.duty! / duty - 1)
      const pr = both.map((x) => x.peakG! / peakG - 1)
      sdD = Math.max(sdOf(dr), W.sdDuty / 2)
      sdP = Math.max(sdOf(pr), W.sdPeak / 2)
      sdC = Math.max(sdOf(dr.map((d, i) => d / sdD - pr[i] / sdP)), 0.5)
    }
    const b: FreeBase = {
      n: both.length,
      cadence: med((x) => x.cadence),
      bounceCm: med((x) => x.bounceCm),
      brakingMs: med((x) => x.brakingMs),
      duty,
      peakG,
      speed: speeds.length >= both.length / 2 ? median(speeds) : null,
      sdD,
      sdP,
      sdC,
    }
    this.base = b
    // 外：基準の速さから SPEED.band より外れた秒は、線を作るのにも使わない（速さでも値が変わるため）
    const pick = (keys: string[]) => keys.flatMap((k) => this.secs.get(k) ?? []).filter((x) => this.speedOk(x))
    const normal = pick(NORMAL)
    this.lines = FREE_ITEMS.map((item): FreeLine => {
      const nv = normal.map((x) => freeValue(item, x, b)).filter((v): v is number => v !== null)
      const cv = pick(CRIT[item]).map((x) => freeValue(item, x, b)).filter((v): v is number => v !== null)
      const hi = quantile(nv, this.p.normalQ)
      const crit = median(cv)
      const base = { item, normalHi: hi, crit, nNormal: nv.length, nCrit: cv.length }
      if (nv.length < this.p.minBase || hi === null) return { ...base, line: null, why: 'few' }
      if (item === 'cadence') {
        const line = PHONE_LIMITS.cadence.cue
        return hi >= line ? { ...base, line: null, why: 'normalOver' } : { ...base, line, why: 'ok' }
      }
      if (cv.length < this.p.minCrit || crit === null) return { ...base, line: null, why: 'few' }
      if (crit <= hi) return { ...base, line: null, why: 'overlap' }
      return { ...base, line: (hi + crit) / 2, why: 'ok' }
    })
    return this.lines
  }

  // スマホの上向きが、最初のふつうの向きから PHONE.upShiftDeg 以内か（ベルトの中でスマホが動くと、上下動などの値が変わる。analyzer.ts と同じ）。
  // 基準の向きがまだなければ、ここで決める
  private upOk(s: FreeSec): boolean {
    if (!this.upRef) {
      const n = Math.hypot(...this.upSum)
      if (!(n > 0)) return false
      this.upRef = [this.upSum[0] / n, this.upSum[1] / n, this.upSum[2] / n]
    }
    const u = s.up
    if (!u) return false
    const r = this.upRef
    const c = (u[0] * r[0] + u[1] * r[1] + u[2] * r[2]) / (Math.hypot(u[0], u[1], u[2]) || 1)
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI <= PHONE.upShiftDeg
  }

  // 外で、基準の速さから外れていないか（トレッドミル・基準の速さがないときは見ない）
  private speedOk(s: FreeSec): boolean {
    const v0 = this.base?.speed ?? null
    if (v0 === null) return true
    return s.speed !== null && Math.abs(s.speed / v0 - 1) <= SPEED.band
  }

  // 自由走の1秒。言う項目があれば返す（呼ぶ側が言い、events に残す）
  judge(s: FreeSec): { item: FreeItem; value: number; line: number; text: string } | null {
    const b = this.base
    if (s.stopped) this.stopAt = s.t
    const ok = !!b && s.judged && !s.stopped && this.upOk(s) && this.speedOk(s)
    // 判定できない秒があいだにあったら（走り出し・止まった・速さが外れた）、そこから FREE.after 秒は判定しない
    const cont = this.lastJudgedT !== null && s.t - this.lastJudgedT <= 1.5
    this.lastJudgedT = ok ? s.t : null
    if (!ok || !cont) {
      for (const k of FREE_ITEMS) this.streak[k] = 0
      this.okSince = ok ? s.t : null
      if (!ok) return null
    }
    if (this.okSince === null || s.t - this.okSince < this.p.after || s.t - this.stopAt < this.p.afterStop) return null
    this.checked++
    let say: { item: FreeItem; value: number; line: number; text: string } | null = null
    for (const l of this.lines) {
      if (l.line === null) continue
      const v = freeValue(l.item, s, b!)
      if (v !== null && v > l.line) this.streak[l.item]++
      else this.streak[l.item] = 0
      if (say || this.streak[l.item] < this.p.hold) continue
      if (s.t - this.lastSaid < CUE.gap || s.t - this.lastItem[l.item] < CUE.cooldown) continue
      const h = this.hour[l.item]
      if (s.t - h.from >= 3600) {
        h.from = s.t
        h.n = 0
      }
      if (h.n >= LIMIT.perHour) continue
      say = { item: l.item, value: v!, line: l.line, text: FREE_SAY[l.item] }
    }
    if (say) {
      this.lastSaid = s.t
      this.lastItem[say.item] = s.t
      this.hour[say.item].n++
      this.streak[say.item] = 0
    }
    return say
  }
}

// 言った声の events の形：free:cue sit 3.12 line 2.31
export const cueText = (c: { item: FreeItem; value: number; line: number }) => `free:cue ${c.item} ${c.value.toFixed(2)} line ${c.line.toFixed(2)}`
