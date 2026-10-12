import type { EngineSay, ItemSpec, ModeAnalyzer, SecondContext, SecondOut, Values } from '../../core/engine'
import { HIP_REF, REL_LIMITS, RUNNING } from '../../core/params'
import { PHRASES } from '../../core/phrases'
import { PHONE, PHONE_LIMITS } from './params'
import { estimate, isRunning, type Estimate, type PhoneMeasure, type Placement, type Vec3 } from './signal'

// スマホ1台の入り口の「見る役」。engine.ts の CueEngine に渡す
//   const analyzer = new PhoneAnalyzer('waist')
//   const coach = new CueEngine(analyzer, { pause: true })
//   センサーの値が来るたびに：analyzer.feed(m); coach.update({ t: m.t, present: true, moving: analyzer.moving, m })
//   値が来ないときも、タイマーで：coach.update({ t: 今, present: analyzer.connected(今), moving: analyzer.moving })
//     （値が途切れたまま update を呼ばないと、しくみは途切れたことに気づけない）
// 前傾を見るとき（ベスト・胸）は、走り出す前に立って止まった数秒の値から uprightFrom で基準を取り、渡す

export type PhoneItem = 'lean' | 'cadence' | 'braking' | 'bounce'

// 1秒の記録（画面や結果に使う）
export interface PhoneSample {
  t: number
  cadence: number // 歩／分
  bounceCm: number
  brakingMs: number
  lean?: number // 度（ベスト・胸のときだけ）
  score: number | null // 判定しない秒（走り始めの基準ができる前）は null
  quiet: boolean
}

// 崩れたときの言葉。前かがみはカメラ版の体幹と同じ言葉
export const PHONE_CUE: Record<PhoneItem, string> = {
  lean: PHRASES.cueTrunk,
  cadence: PHRASES.phoneCadence,
  braking: PHRASES.phoneBraking,
  bounce: PHRASES.phoneBounce,
}

// しくみが話す言葉のうち、スマホで替えるもの。見えなくなったときは、センサーの値が途切れたときの言葉に。
// ほめる言葉は、腰では姿勢が見えないので「姿勢」ではなく「走り」と言う
export const PHONE_SAY: Partial<EngineSay> = {
  lost: PHRASES.phoneLost,
  giveUp: PHRASES.phoneGiveUp,
  praise5: PHRASES.phonePraise5,
  quietDone: PHRASES.phoneQuietDone,
}

// 並び順が、声をかける優先順。前傾はベスト・胸のときだけ
export function phoneItems(placement: Placement): ItemSpec<PhoneItem>[] {
  const all: ItemSpec<PhoneItem>[] = [
    { key: 'lean', limits: REL_LIMITS.trunk, cue: PHONE_CUE.lean },
    { key: 'cadence', limits: PHONE_LIMITS.cadence, cue: PHONE_CUE.cadence },
    { key: 'braking', limits: PHONE_LIMITS.braking, cue: PHONE_CUE.braking },
    { key: 'bounce', limits: PHONE_LIMITS.bounce, cue: PHONE_CUE.bounce },
  ]
  return placement === 'waist' ? all.filter((s) => s.key !== 'lean') : all
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export class PhoneAnalyzer implements ModeAnalyzer<PhoneMeasure, PhoneSample, PhoneItem> {
  items: ItemSpec<PhoneItem>[]
  say = PHONE_SAY
  readonly placement: Placement
  upright?: Vec3
  last: Estimate | null = null // 直近の測定
  moving = false // 走る動きをしているか（engine の moving に渡す）

  private buf: PhoneMeasure[] = [] // 直近 PHONE.window 秒の値
  private lastEstAt = -1e9
  private lastFedAt: number | null = null // 最後に値が来た時刻
  private refs: { cadence: number[]; bounceCm: number[]; brakingMs: number[]; lean: number[] } = { cadence: [], bounceCm: [], brakingMs: [], lean: [] }
  ref: { cadence: number; bounceCm: number; brakingMs: number; lean?: number } | null = null

  // upright：立って止まったときの平均の加速度。ベスト・胸で前傾を見るときに要る（なければ前傾は見ない）
  constructor(placement: Placement, upright?: Vec3) {
    this.placement = placement
    this.upright = upright
    this.items = phoneItems(placement).filter((s) => s.key !== 'lean' || upright)
  }

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
      this.last = estimate(this.buf, this.placement, this.upright)
      this.moving = isRunning(this.last, RUNNING.runSpm)
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
    const e = estimate(this.buf, this.placement, this.upright)
    if (!e || !isRunning(e, RUNNING.runSpm)) return null
    const lean = this.items.some((s) => s.key === 'lean') ? e.lean : undefined

    // 走り始め（HIP_REF の区間）の自分を基準にする
    if (t >= HIP_REF.from && t <= HIP_REF.to) {
      this.refs.cadence.push(e.cadence)
      this.refs.bounceCm.push(e.bounceCm)
      this.refs.brakingMs.push(e.brakingMs)
      if (lean !== undefined) this.refs.lean.push(lean)
    }
    let ready = false
    if (this.ref === null && t > HIP_REF.to && this.refs.cadence.length) {
      const r = this.refs
      this.ref = { cadence: mean(r.cadence), bounceCm: mean(r.bounceCm), brakingMs: mean(r.brakingMs), lean: r.lean.length ? mean(r.lean) : undefined }
      ready = true
    }
    // 基準ができるまでは判定しない（values に入れない。0 を入れると「良い」を水増しする）。
    // 1秒ごとに0で切らず、平均してから線と比べられるよう差のまま渡す
    const ref = this.ref
    const values: Values<PhoneItem> = {}
    if (ref) {
      values.cadence = ((ref.cadence - e.cadence) / ref.cadence) * 100
      values.bounce = e.bounceCm - ref.bounceCm
      values.braking = e.brakingMs - ref.brakingMs
      if (ref.lean !== undefined && lean !== undefined) values.lean = lean - ref.lean
    }
    const sample: PhoneSample = { t, cadence: e.cadence, bounceCm: e.bounceCm, brakingMs: e.brakingMs, lean, score: ctx.score(values), quiet: ctx.quiet }
    return { sample, values, ready }
  }
}
