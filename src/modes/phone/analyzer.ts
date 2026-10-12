import type { EngineSay, ItemSpec, ModeAnalyzer, SecondContext, SecondOut, Values } from '../../core/engine'
import { HIP_REF, RUNNING } from '../../core/params'
import { PHRASES } from '../../core/phrases'
import { MountCheck, mountFeatures, offWaistRunning, type MountFeatures, type MountIssue } from './mount'
import { PHONE, PHONE_LIMITS, PHONE_REF, SPEED } from './params'
import type { FatigueFeatures } from './fatigue'
import { estimate, isRunning, type Estimate, type PhoneMeasure } from './signal'
import { speedGate, type SpeedGate, type SpeedTrack } from './speed'

// スマホ1台（腰のベルト）の入り口の「見る役」。engine.ts の CueEngine に渡す
//   const analyzer = new PhoneAnalyzer()
//   const coach = new CueEngine(analyzer, { pause: true })
//   センサーの値が来るたびに：analyzer.feed(m); coach.update({ t: m.t, present: true, moving: analyzer.moving, m })
//   値が来ないときも、タイマーで：coach.update({ t: 今, present: analyzer.connected(今), moving: analyzer.moving })
//     （値が途切れたまま update を呼ばないと、しくみは途切れたことに気づけない）
// 付け方の確認（mount.ts）で、ゆるい・ずれた・腰以外と分かったら、1回だけ知らせて、その走りではもう判定しない
// （外れた付け方で測った値で、フォームを誤って直させないため）。記録には印（PhoneSample.mount）が残る
// 外で走るとき（speed に GPS の速さを渡したとき）は、速さが走り始めの基準の速さから外れた秒・GPS が取れない秒も判定しない
// （speed.ts。ペースを落としただけで「崩れ」と言わないため）。止めた理由は記録（PhoneSample.gate）に残る。
// speed が null（トレッドミル）なら、速さは一定とみなして止めない

export type PhoneItem = 'cadence' | 'braking' | 'bounce' | 'mount' | 'place'

// 1秒の記録（画面や結果に使う）
export interface PhoneSample {
  t: number
  cadence: number | null // 歩／分。付け方がおかしく、測れなかった秒は null
  bounceCm: number | null
  brakingMs: number | null
  score: number | null // 判定しない秒（走り始めの基準ができる前・付け方がおかしいと分かった後）は null
  quiet: boolean
  mount: MountIssue | null // この走りで見つけた付け方の問題（見つけた秒から後に付く）
  speed?: number | null // GPS のならした速さ（m/s）。トレッドミルでは付けない
  gate?: SpeedGate | null // 速さで判定を止めた理由（speed.ts）。止めていない秒・トレッドミルでは null か、付けない
  values: Values<PhoneItem> // 線と比べた値（走り始めの自分からの崩れ）。判定しない秒は {}
  fat?: FatigueFeatures | null // 疲れの見分けの材料（fatigue.ts）。走り終わった後にまとめる。声にはしない。測れなかった秒は null
}

// 崩れたとき・付け方がおかしいときの言葉
export const PHONE_CUE: Record<PhoneItem, string> = {
  cadence: PHRASES.phoneCadence,
  braking: PHRASES.phoneBraking,
  bounce: PHRASES.phoneBounce,
  mount: PHRASES.phoneMount,
  place: PHRASES.phonePlace,
}

// しくみが話す言葉のうち、スマホで替えるもの。見えなくなったときは、センサーの値が途切れたときの言葉に。
// ほめる言葉は、腰では姿勢が見えないので「姿勢」ではなく「走り」と言う
export const PHONE_SAY: Partial<EngineSay> = {
  lost: PHRASES.phoneLost,
  giveUp: PHRASES.phoneGiveUp,
  praise5: PHRASES.phonePraise5,
  quietDone: PHRASES.phoneQuietDone,
}

// 付け方の知らせは、しくみの「一度だけかける声」（once）で出す。値は渡さないので、線と比べて声をかけることはない
const NEVER = { full: 0, zero: 1, cue: 1 }

// 並び順が、声をかける優先順。ピッチは、言葉は初めの1回だけで、あとは走り始めのテンポのメトロノームで知らせる（tone）
export const PHONE_ITEMS: ItemSpec<PhoneItem>[] = [
  { key: 'cadence', limits: PHONE_LIMITS.cadence, cue: PHONE_CUE.cadence, tone: true },
  { key: 'braking', limits: PHONE_LIMITS.braking, cue: PHONE_CUE.braking },
  { key: 'bounce', limits: PHONE_LIMITS.bounce, cue: PHONE_CUE.bounce },
  { key: 'mount', limits: NEVER, cue: PHONE_CUE.mount },
  { key: 'place', limits: NEVER, cue: PHONE_CUE.place },
]

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0
}

type Ref = { cadence: number; bounceCm: number; brakingMs: number }
// 基準の区間の1秒
interface RefSec {
  cadence: number
  bounceCm: number
  brakingMs: number
  speed: number | null
}

// 基準の区間の秒から、基準を作る。need 秒より少なければ null
// 外（gps）では、速さの中央値から SPEED.band の中にある秒だけを使い、速さの基準もそこから出す
// （区間の中で信号待ちの手前の減速などがあっても、その秒をピッチの基準に入れないため）。
// そういう秒が、測れた秒の PHONE_REF.coverage の割合に足りなければ、ピッチなどはすべての秒から作り、
// 速さの基準は null（速さが分からないので、その基準のあいだは判定しない）
function refFrom(xs: RefSec[], gps: boolean, need: number): { ref: Ref; speed: number | null } | null {
  const avg = (ys: RefSec[]): Ref => ({ cadence: mean(ys.map((y) => y.cadence)), bounceCm: mean(ys.map((y) => y.bounceCm)), brakingMs: mean(ys.map((y) => y.brakingMs)) })
  if (xs.length < need || !xs.length) return null
  if (!gps) return { ref: avg(xs), speed: null }
  const withSpeed = xs.filter((x): x is RefSec & { speed: number } => x.speed !== null)
  const med = median(withSpeed.map((x) => x.speed))
  const keep = med > 0 ? withSpeed.filter((x) => Math.abs(x.speed - med) / med <= SPEED.band) : []
  if (!keep.length || keep.length < xs.length * PHONE_REF.coverage) return { ref: avg(xs), speed: null }
  return { ref: avg(keep), speed: mean(keep.map((x) => x.speed)) }
}

export class PhoneAnalyzer implements ModeAnalyzer<PhoneMeasure, PhoneSample, PhoneItem> {
  items = PHONE_ITEMS
  say = PHONE_SAY
  last: Estimate | null = null // 直近の測定
  moving = false // 走る動きをしているか（engine の moving に渡す）
  readonly mount = new MountCheck() // 付け方の確認。mount.issue が、この走りの記録の印

  private buf: PhoneMeasure[] = [] // 直近 PHONE.window 秒の値
  private lastEstAt = -1e9
  private lastFedAt: number | null = null // 最後に値が来た時刻
  private refs: RefSec[] = []
  ref: Ref | null = null
  refLater = false // 5〜12分の平均（PHONE_REF）に置き換えた。false のうちは仮の基準（30秒〜3分）
  refLaterAt: number | null = null // 置き換えた秒
  // 5〜12分の値。置き換えるか決めたら null（測れた秒が足りなければ、その走りは仮の基準のまま）
  private laters: RefSec[] | null = []
  // GPS の速さ（外で走るとき）。null ならトレッドミル：速さは一定とみなし、速さで判定を止めない
  speed: SpeedTrack | null = null
  refSpeed: number | null = null // 走り始めの基準の速さ（m/s）。基準と同じ区間で取る
  gate: SpeedGate | null = null // 直近の秒に、速さで判定を止めた理由
  private gateUntil = -1e9 // 速さが範囲に戻っても、この秒までは止める（SPEED.hold）
  private lastGate: SpeedGate | null = null
  // 直近の1秒で使った、測った値と付け方の手がかり（記録の書き出しで使う）。走っていない秒は est が null
  lastSecond: { est: Estimate | null; mount: MountFeatures | null } | null = null

  // センサーの値を1つ受け取る。走っているかの判定は、走る前（engine が走っていないとき）にも要るので、ここで続ける
  feed(m: PhoneMeasure) {
    this.lastFedAt = m.t
    const prev = this.buf[this.buf.length - 1]
    if (prev && (m.t - prev.t > PHONE.gapReset || m.t <= prev.t)) this.buf = []
    this.buf.push(m)
    while (this.buf.length && m.t - this.buf[0].t > PHONE.window) this.buf.shift()
    // 毎コマ計算すると重いので、0.25秒ごと
    if (m.t - this.lastEstAt >= 0.25 || m.t < this.lastEstAt) {
      this.lastEstAt = m.t
      this.last = estimate(this.buf)
      // 手に持つなど腰以外に付けていると estimate が値を出さないことがある。そのときも走り出しに気づいて、付け方を知らせる
      this.moving = isRunning(this.last, RUNNING.runSpm) || offWaistRunning(mountFeatures(this.buf), RUNNING.runSpm)
    }
  }

  // センサーの値が届いているか（engine の present に渡す）。PHONE.gapReset 秒より間があいたら途切れたとみなす
  connected(t: number): boolean {
    return this.lastFedAt !== null && t - this.lastFedAt <= PHONE.gapReset
  }

  // 1秒分の測定をまとめて1件の記録にする。値そのものは feed でためた直近 PHONE.window 秒から出す
  second(bucket: PhoneMeasure[], t: number, ctx: SecondContext<PhoneItem>): SecondOut<PhoneSample, PhoneItem> | null {
    if (bucket.length < 3) return null
    // feed を通さずに engine にだけ値を渡したときのために、bucket からも足す
    for (const m of bucket) if (!this.buf.length || m.t > this.buf[this.buf.length - 1].t) this.feed(m)
    const est = estimate(this.buf)
    const e = isRunning(est, RUNNING.runSpm) ? est : null
    const x: MountFeatures | null = mountFeatures(this.buf, e ? e.cadence / 60 : undefined)
    this.lastSecond = { est: e, mount: x }
    if (!e && !offWaistRunning(x, RUNNING.runSpm)) return null

    const gps = this.speed !== null
    const v = this.speed ? this.speed.at(this.lastFedAt ?? 0) : null
    const found = this.mount.check(t, x)
    const once: SecondOut<PhoneSample, PhoneItem>['once'] = found ? { item: found === 'notWaist' ? 'place' : 'mount', back: 0 } : undefined

    // 付け方がおかしいと分かった後（または測れない秒）は判定しない。基準も作らない
    const values: Values<PhoneItem> = {}
    let ready = false
    this.gate = null
    if (e && !this.mount.issue) {
      // 走り始め（HIP_REF の区間）の自分を基準にする
      const sec: RefSec = { cadence: e.cadence, bounceCm: e.bounceCm, brakingMs: e.brakingMs, speed: v }
      if (t >= HIP_REF.from && t <= HIP_REF.to) this.refs.push(sec)
      if (this.ref === null && t > HIP_REF.to && this.refs.length) {
        const r = refFrom(this.refs, gps, 1)!
        this.ref = r.ref
        this.refSpeed = r.speed
        ready = true
      }
      // 5〜12分の平均ができたら、基準を置き換える（仮の基準から声をかける線より下がった秒は入れない）
      const early = this.ref
      const l = this.laters
      if (early && l && t >= PHONE_REF.laterFrom && t <= PHONE_REF.laterTo && ((early.cadence - e.cadence) / early.cadence) * 100 <= PHONE_LIMITS.cadence.cue) {
        l.push(sec)
      }
      if (early && l && t > PHONE_REF.laterTo) {
        const r = refFrom(l, gps, (PHONE_REF.laterTo - PHONE_REF.laterFrom) * PHONE_REF.coverage)
        // 外では、速さの基準も作れたときだけ置き換える（作れなければ、仮の基準と仮の速さのまま）
        if (r && (!gps || r.speed !== null)) {
          this.ref = r.ref
          this.refSpeed = r.speed
          this.refLater = true
          this.refLaterAt = t
        }
        this.laters = null
      }
      // 基準ができるまでは判定しない（values に入れない。0 を入れると「良い」を水増しする）。
      // 1秒ごとに0で切らず、平均してから線と比べられるよう差のまま渡す
      const ref = this.ref
      // 外では、速さが基準から外れた秒・GPS が取れない秒は判定しない（values に入れない）
      let gate: SpeedGate | null = null
      if (ref && gps) {
        const g = speedGate(v, this.refSpeed)
        if (g) {
          gate = g
          this.lastGate = g
          this.gateUntil = t + SPEED.hold
        } else if (t <= this.gateUntil) gate = this.lastGate
      }
      this.gate = gate
      if (ref && !gate) {
        values.cadence = ((ref.cadence - e.cadence) / ref.cadence) * 100
        values.bounce = e.bounceCm - ref.bounceCm
        values.braking = e.brakingMs - ref.brakingMs
      }
    }
    const sample: PhoneSample = {
      t,
      cadence: e ? e.cadence : null,
      bounceCm: e ? e.bounceCm : null,
      brakingMs: e ? e.brakingMs : null,
      score: ctx.score(values),
      quiet: ctx.quiet,
      mount: this.mount.issue,
      values,
      fat: e ? { regularity: e.regularity, apRegularity: e.apRegularity, ratioV: e.ratioV, ratioAP: e.ratioAP, ratioML: e.ratioML, contactMs: e.contactMs } : null,
    }
    if (gps) {
      sample.speed = v
      sample.gate = this.gate
    }
    return { sample, values, ready, once }
  }
}
