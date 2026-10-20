import { ITEM_KEYS, type Category, type FormGroup, type Frame, type ItemKey, type Sample, type Session, type Stride } from '../../core/types'
import type { Measure } from './types'
import { category } from '../../core/scoring'
import { itemScore, LIMITS } from './scoring'
import { CUE } from '../../core/phrases'
import { HIP_REF } from '../../core/params'
import { FORM, REL_LIMITS, STRIDE } from './params'
import { RunningGate } from './motion'
import { clampInside, formOver, formScale, FormStage, FORM_ORDER, type FormValues } from './form'
import { CueEngine, type EngineInput, type ItemSpec, type ModeAnalyzer, type SecondContext, type SecondOut, type Values } from '../../core/engine'

// カメラモード：トレッドミルの横のスマホで骨格を取り、頭・体幹・体全体（前に倒れすぎ・起きすぎ）・腰を見る。顎は測って記録するだけ。
// 走り出したら、まず正しいフォームの線と比べて1つずつ直してもらい（form.ts の「整える」）、直った形を今日の基準にする。
// そのあとは、今日の基準からの崩れ（REL_LIMITS など）と、正しいフォームの線の両方で見る。
// 声かけのしくみ（いつ声をかけ、ほめ、黙って見守るか）は engine.ts で、どのモードでも共通。
// ここにあるのは、カメラの測定から1秒ごとの判定の値を作る「見る役」（正しいフォームの線で知らせる声も、ここで決める）と、
// 走り姿のアニメーションの記録

export type { CoachEvent, CoachState } from '../../core/engine'
export { breakdownMinute } from '../../core/engine'

// moving には、そのコマを1コマだけで見た「走っているか」（MotionDetector の判定）を渡す。
// 走り始め・止まりは、Coach が直近のコマの割合（RunningGate）で決め直してから、しくみに渡す
export interface CoachInput extends EngineInput<Measure> {
  frame?: Frame // 鉛直をそろえたピクセル座標（走り姿のアニメーション用）
}

// Coach がしくみに渡す1コマ。steps：そのコマを走っているかの割合に入れたときの、そのコマの判定（入れなかったコマは無い）
interface GatedInput extends CoachInput {
  steps?: boolean
}

// 測る項目。並び順が、今日の基準からの崩れで声をかける優先順（頭 → 上体 → 上体の起きすぎ → 体全体 → 体全体の起きすぎ → 腰）。
// 正しいフォームの線で知らせる順は form.ts の FORM_ORDER
export const CAMERA_ITEMS: ItemSpec<ItemKey>[] = ITEM_KEYS.map((key) => ({ key, limits: LIMITS[key], cue: CUE[key] }))

type Ref = { neck: number; trunk: number; body: number; headLean: number; yaw: number; chin: number }
const REF_KEYS = ['neck', 'trunk', 'body', 'headLean', 'yaw', 'chin'] as const

// 今日の基準にためる値：項目ごとに、その項目が正しいフォームの線の内側にいた秒だけ（in）と、走っていた秒のすべて（all）。
// 腰は、体全体と上体の両方が線の内側にいた秒（整えた形）
type Pool = { in: Record<FormGroup, FormValues[]>; all: FormValues[]; hipIn: number[]; hipAll: number[]; yaw: number[]; chin: number[] }
const emptyPool = (): Pool => ({ in: { body: [], trunk: [], head: [] }, all: [], hipIn: [], hipAll: [], yaw: [], chin: [] })

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const meanOf = (xs: FormValues[]): FormValues => ({ trunk: mean(xs.map((x) => x.trunk)), body: mean(xs.map((x) => x.body)), neck: mean(xs.map((x) => x.neck)), headLean: mean(xs.map((x) => x.headLean)) })

class CameraAnalyzer implements ModeAnalyzer<Measure, Sample, ItemKey> {
  items = CAMERA_ITEMS

  private hipRef: number | null = null
  // 今日の基準：首の角度・上体・体全体の傾き、頭の位置そのもの、スマホの向き、顎。整えたあとの形（正しいフォームの線の内側にいた秒）の平均
  private pool = emptyPool()
  leanRef: Ref | null = null
  // 正しいフォームへ整える（form.ts）。走り出しから走り終わりまで、線と比べ続ける
  form = new FormStage()

  // 今日の基準は、歩数で走っていると見た秒だけで作る。running は Coach が決めた「走っている」（RunningGate）。
  // runFrom は、いまの走りの始まり（しくみの秒）。基準ができる前に止まったら null にして、整え直す
  running = false
  runFrom: number | null = null
  private secOn = 0 // この1秒の、走っていると見たコマの数（割合に入れたコマだけ）
  private secOff = 0

  private ring: { frame: Frame; dir: 1 | -1; t: number }[] = []
  private candidates: Record<Category, Stride[]> = { good: [], mid: [], bad: [] }
  private lastStrideAt = -1e9

  // 走っている間の1コマ：その秒に走っていたかを数え、走り姿のアニメーション用に骨格をためる
  input(inp: GatedInput) {
    if (inp.steps === true) this.secOn++
    else if (inp.steps === false) this.secOff++
    if (!inp.frame || !inp.m) return
    // 骨格を取っていない間があいたら、つながらないので捨てる
    const last = this.ring[this.ring.length - 1]
    if (last && inp.t - last.t > 0.3) this.ring = []
    this.ring.push({ frame: inp.frame, dir: inp.m.dir, t: inp.t })
    while (this.ring.length && inp.t - this.ring[0].t > STRIDE.sec + 0.3) this.ring.shift()
  }

  // 走るのが止まった：基準ができる前なら、ためた分を捨てて、次に走り出したところから整え直す
  stopped() {
    if (this.leanRef !== null) return
    this.runFrom = null
    this.pool = emptyPool()
    this.form = this.form.restart()
  }

  // 基準にためた秒の数（採点の道具が、基準を作った間を出すのに使う）
  get refSeconds() {
    return this.pool.all.length
  }

  // 1秒分の測定をまとめて1件の記録にする
  second(b: Measure[], t: number, ctx: SecondContext<ItemKey>): SecondOut<Sample, ItemKey> | null {
    // その秒に歩数で走っていたか：割合に入れたコマの半分以上が「走っている」。入れたコマがない秒（間引きのあと、
    // 歩数を数え直している間）は、Coach の「走っている」に従う
    const on = this.secOn
    const off = this.secOff
    this.secOn = 0
    this.secOff = 0
    if (b.length < 3) return null
    const stepping = this.running && (on + off === 0 || on >= off)
    const now = Object.fromEntries(REF_KEYS.map((k) => [k, mean(b.map((m) => m[k]))])) as Ref
    const { neck, headLean, trunk, body, yaw } = now
    const v: FormValues = { trunk, body, neck, headLean }
    const hipRatio = mean(b.map((m) => m.hipRatio))
    const rt = this.runFrom === null ? null : t - this.runFrom

    // 正しいフォームの線と比べ、外れていれば1つずつ知らせる（走り出してからの秒が分かるときだけ）
    const lead = rt === null ? { hold: false } : this.form.second(t, rt, stepping, v, yaw, ctx.since)

    // 今日の基準にためる：整え終わってから（走り出して HIP_REF.from 秒より後）の、歩数で走っていた秒。項目ごとに、
    // 直近 FORM.hold 秒の平均が線の内側で、知らせて直るのを待っていない秒だけ（直したあとの形。直す前の形を混ぜない）
    let ready = false
    if (this.leanRef === null && rt !== null && stepping && rt >= HIP_REF.from && this.form.doneAt !== null) {
      const p = this.pool
      p.all.push(v)
      p.hipAll.push(hipRatio)
      p.yaw.push(yaw)
      p.chin.push(now.chin)
      const ins = this.form.holdInside(t)
      if (ins) {
        for (const g of FORM_ORDER) if (ins[g] && !this.form.waiting(g)) p.in[g].push(v)
        if (ins.body && ins.trunk) p.hipIn.push(hipRatio)
      }
    }
    // 走り出して長くたっても整え終わらない（値が足りない）ときは、打ち切る
    if (this.leanRef === null && rt !== null && rt > HIP_REF.to + FORM.later) this.form.finish(t)
    // 基準を作る：走り出して HIP_REF.to 秒たち、整え終わってから FORM.refAfter 秒たったら
    if (this.leanRef === null && rt !== null && rt >= HIP_REF.to && this.form.doneAt !== null && t - this.form.doneAt >= FORM.refAfter) {
      const p = this.pool
      if (!p.all.length) this.runFrom = t - HIP_REF.from // 走っていた秒が1つもなければ、すぐ次の秒からためる
      else {
        ready = true
        const typical = meanOf(p.all)
        // 項目ごとに、線の内側にいた秒の平均。足りなければ、走っていた秒の平均を線の内側に寄せた値（入らなかった項目は、線そのもの）。
        // 線と比べられなかった項目（頭が、ずっと斜めから撮っているように見えた）は、走っていた秒の平均（線の値は当てにならないため）
        const at = (g: FormGroup) => (!this.form.judged(g) ? typical : p.in[g].length >= FORM.refMin ? meanOf(p.in[g]) : clampInside(g, typical))
        const head = at('head')
        this.leanRef = { neck: head.neck, headLean: head.headLean, trunk: at('trunk').trunk, body: at('body').body, yaw: mean(p.yaw), chin: mean(p.chin) }
        this.hipRef = p.hipIn.length >= FORM.refMin ? mean(p.hipIn) : mean(p.hipAll)
      }
    }
    const ref = this.leanRef
    const hipDrop = this.hipRef ? Math.max(0, ((this.hipRef - hipRatio) / this.hipRef) * 100) : 0
    // 頭は、今日の基準との差。1秒ごとに0で切らず、平均してから線と比べる（揺れの正の側だけが残って、実際より大きく出るため）
    const head = ref ? headForward(neck - ref.neck, headLean - ref.headLean) : 0
    const judge = ref ? { trunk: toScale('trunk', trunk - ref.trunk), body: toScale('body', body - ref.body) } : undefined
    const back = ref ? { trunk: toScale('trunkBack', ref.trunk - trunk), body: toScale('bodyBack', ref.body - body) } : undefined
    // しくみが声をかける値：今日の基準からの崩れ（基準ができるまでは無い）。
    // 起きすぎの側は、歩数で走っていた秒だけ判定する（歩くと上体も体全体も起きるので、歩いている間に声をかけないため）
    const values: Values<ItemKey> = {}
    if (ref && judge && back) {
      values.trunk = judge.trunk
      values.body = judge.body
      if (stepping) {
        values.trunkBack = back.trunk
        values.bodyBack = back.body
      }
      values.head = head
      if (this.hipRef) values.hip = hipDrop
    }
    // 正しいフォームの線を外れた量（点数の目盛り）。歩数で走っていた秒だけ。頭は斜めから撮っているように見える秒は比べない
    const form: Values<ItemKey> = {}
    if (stepping && rt !== null && rt >= FORM.from) {
      for (const g of FORM_ORDER) {
        if (!FormStage.judgeable(g, yaw)) continue
        const o = formOver(g, v)
        form[o.key] = formScale(g, o.key, o.over)
      }
    }
    // 点数は、今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう
    const both: Values<ItemKey> = { ...values }
    for (const k of Object.keys(form) as ItemKey[]) both[k] = Math.max(both[k] ?? -Infinity, form[k]!)
    const score = ctx.score(both)
    // 顎：測って記録するだけ。上体が起きた分（頭は上体といっしょに回る）を差し引く
    const chin = ref ? now.chin - ref.chin + (trunk - ref.trunk) : undefined
    const sample: Sample = { t, head, trunk, body, hipDrop, score: score ?? 100, quiet: ctx.quiet, judge, back, headLean, neck, yaw, form, chin }
    this.maybeKeepStride(sample)
    return { sample, values, ready, score, say: lead.say, hold: lead.hold }
  }

  private maybeKeepStride(s: Sample) {
    const r = this.ring
    if (r.length < 8 || r[r.length - 1].t - r[0].t < STRIDE.sec || s.t - this.lastStrideAt < STRIDE.every) return
    this.lastStrideAt = s.t
    const list = this.candidates[category(s.score)]
    const stride: Stride = {
      frames: resample(r, STRIDE.frames, STRIDE.sec),
      dir: this.ring[this.ring.length - 1].dir,
      score: s.score,
      avg: { head: Math.max(0, s.head), trunk: s.trunk, body: s.body, hipDrop: s.hipDrop },
    }
    if (list.length < 60) list.push(stride)
    else list[Math.floor(Math.random() * list.length)] = stride
  }

  // 結果画面の走り姿：分類ごとに、点数がその分類の平均にいちばん近い1歩
  strides(): Session['strides'] {
    const strides: Session['strides'] = {}
    for (const cat of ['good', 'mid', 'bad'] as Category[]) {
      const list = this.candidates[cat]
      if (!list.length) continue
      const m = mean(list.map((x) => x.score))
      strides[cat] = list.reduce((a, b) => (Math.abs(b.score - m) < Math.abs(a.score - m) ? b : a))
    }
    return strides
  }
}

export class Coach extends CueEngine<Measure, Sample, ItemKey> {
  // pause: 止まったら一時停止するか（検証中は切っておく）。
  // items: 今日の基準からの崩れで声をかける項目（ランナーのレベルで決まる。ほかの項目は大きく崩れたときだけ）。なければすべて。
  //   正しいフォームの線で整える声（form.ts）は、どのレベルでもかける（フォームの土台なので。それでも一度に1つずつ）
  // 走る前に立って測る基準は、猫背の確認にだけ使い、ここには渡さない（頭は今日の基準と比べる）
  constructor(opts: { pause?: boolean; items?: ItemKey[] } = {}) {
    super(new CameraAnalyzer(), opts)
  }

  private get camera() {
    return this.analyzer as CameraAnalyzer
  }

  // 今日の基準（整えたあとの形。できるまでは null）
  get leanRef() {
    return this.camera.leanRef
  }

  // 整え終わったか（form.ts）
  get formDone() {
    return this.camera.form.doneAt !== null
  }

  private readonly gate = new RunningGate()

  // 今日の基準ができる前に止まったか、走り出したか（整え直すため）
  update(inp: CoachInput) {
    const was = this.gate.running
    // 割合に入れるのは、見えていて骨格を取ったコマだけ（間引いて取らなかったコマは、前の判定のままなので入れない）
    const counted = inp.present && inp.m !== undefined && this.gate.push(inp.t, inp.moving)
    const running = this.gate.running
    if (was && !running) this.camera.stopped()
    if (!was && running && this.camera.runFrom === null) this.camera.runFrom = this.active
    this.camera.running = running
    const g: GatedInput = { ...inp, moving: running }
    if (counted) g.steps = inp.moving
    return super.update(g)
  }

  // 走っていない（止まった）と見ている間と、今日の基準ができるまで（整えている間も）は、間引かずに毎コマ見る。
  // 走り出し・止まりを、飛び飛びの数コマではなく続けて見て決めるため（間引いた数コマだけで決めると、
  // 見えにくい1秒で「止まった」になり、基準を何度も作り直してしまう）。
  // そのあとも、正しいフォームの線を越えている・知らせて直るのを待っている間は毎コマ見る
  wantsDetail(): boolean {
    return !this.gate.running || this.leanRef === null || this.camera.form.busy(Math.floor(this.active)) || super.wantsDetail()
  }

  // 走り始めの基準にためた秒の数
  get refSeconds() {
    return this.camera.refSeconds
  }

  finish(speedKmh?: number): Session {
    return { ...this.summary(), speedKmh, samples: this.samples, strides: this.camera.strides(), form: this.camera.form.results() }
  }
}

// 実際に取れたコマ（毎秒15コマ前後）を、直近 sec 秒を n コマに等間隔でならす
function resample(ring: { frame: Frame; t: number }[], n: number, sec: number): Frame[] {
  const end = ring[ring.length - 1].t
  const out: Frame[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = end - sec + (sec * k) / (n - 1)
    while (j + 1 < ring.length - 1 && ring[j + 1].t <= t) j++
    const a = ring[j]
    const b = ring[Math.min(j + 1, ring.length - 1)]
    const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0
    out.push(a.frame.map((p, i) => ({ x: p.x + (b.frame[i].x - p.x) * u, y: p.y + (b.frame[i].y - p.y) * u, v: Math.min(p.v, b.frame[i].v) })))
  }
  return out
}

export { itemScore }

// 頭が前に出た量：首の角度の増え（頭が上体より前に出た）と、頭の位置そのものの増えの、小さいほう。
// 上体が起きると首の角度だけが増える（頭は動いていない）ので、頭の位置そのものも前に出たときだけ「頭が前」にする
export function headForward(neckDelta: number, headLeanDelta: number): number {
  return Math.min(neckDelta, headLeanDelta)
}

// 判定に使う値（LIMITS の目盛り）：今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう。どちらも無い項目は -Infinity
export function judged(s: Sample, k: ItemKey): number {
  const f = s.form?.[k] ?? -Infinity
  if (k === 'hip') return s.hipDrop
  if (k === 'head') return Math.max(f, s.judge ? s.head : -Infinity)
  if (k === 'trunkBack') return Math.max(f, s.back?.trunk ?? -Infinity)
  if (k === 'bodyBack') return Math.max(f, s.back?.body ?? -Infinity)
  return Math.max(f, s.judge?.[k] ?? -Infinity)
}

// 増え方を、点数の目盛り（LIMITS）に直す：増え方の満点・声をかける線・0点が、LIMITS のそれぞれに重なるように
// （起きすぎの側は、今日の基準から後ろへ傾いた量を渡す）
export function toScale(k: 'trunk' | 'trunkBack' | 'body' | 'bodyBack', delta: number): number {
  const a = REL_LIMITS[k]
  const b = LIMITS[k]
  if (delta <= a.full) return b.full - (a.full - delta)
  if (delta <= a.cue) return b.full + ((delta - a.full) * (b.cue - b.full)) / (a.cue - a.full)
  return b.cue + ((delta - a.cue) * (b.zero - b.cue)) / (a.zero - a.cue)
}
