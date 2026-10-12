import type { ItemSpec, ModeAnalyzer, SecondContext, SecondOut } from '../../core/engine'
import { HIP_REF, REL_LIMITS, RUNNING } from '../../core/params'
import { PHONE, PHONE_LIMITS } from './params'
import { estimate, isRunning, type Estimate, type PhoneMeasure, type Placement, type Vec3 } from './signal'

// スマホ1台の入り口の「見る役」。engine.ts の CueEngine に渡す
//   const analyzer = new PhoneAnalyzer('waist')
//   const coach = new CueEngine(analyzer, { pause: true })
//   センサーの値が来るたびに：analyzer.feed(m); coach.update({ t: m.t, present: true, moving: analyzer.moving, m })
// 前傾を見るとき（ベスト・胸）は、走り出す前に立って止まった数秒の値から uprightFrom で基準を取り、渡す

export type PhoneItem = 'lean' | 'cadence' | 'braking' | 'bounce'

// 1秒の記録（画面や結果に使う）
export interface PhoneSample {
  t: number
  cadence: number // 歩／分
  bounceCm: number
  brakingMs: number
  lean?: number // 度（ベスト・胸のときだけ）
  score: number
  quiet: boolean
}

// 声かけの言葉（仮）。音声を作るときに phrases.ts の PHRASES に移す（今は phrases.ts を変えていない）
export const PHONE_CUE: Record<PhoneItem, string> = {
  lean: '前かがみになっています。胸のライトで、前を照らしてください。',
  cadence: 'ピッチが落ちています。歩幅を少し狭くして、足の回転を上げてください。',
  braking: '着地でブレーキがかかっています。足を体の真下に下ろしてください。',
  bounce: '弾みすぎています。前に進むように、低く走ってください。',
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
  readonly placement: Placement
  upright?: Vec3
  last: Estimate | null = null // 直近の測定
  moving = false // 走る動きをしているか（engine の moving に渡す）

  private buf: PhoneMeasure[] = [] // 直近 PHONE.window 秒の値
  private lastEstAt = -1e9
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
    // 基準ができるまでは判定しない（0 = 崩れていない）。1秒ごとに0で切らず、平均してから線と比べられるよう差のまま渡す
    const ref = this.ref
    const values: Record<PhoneItem, number> = {
      cadence: ref ? ((ref.cadence - e.cadence) / ref.cadence) * 100 : 0,
      bounce: ref ? e.bounceCm - ref.bounceCm : 0,
      braking: ref ? e.brakingMs - ref.brakingMs : 0,
      lean: ref && ref.lean !== undefined && lean !== undefined ? lean - ref.lean : 0,
    }
    const sample: PhoneSample = { t, cadence: e.cadence, bounceCm: e.bounceCm, brakingMs: e.brakingMs, lean, score: ctx.score(values), quiet: ctx.quiet }
    return { sample, values, ready }
  }
}
