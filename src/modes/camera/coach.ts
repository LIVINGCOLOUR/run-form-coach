import type { Category, Frame, ItemKey, Sample, Session, Stride } from '../../core/types'
import type { Measure } from './types'
import { category } from '../../core/scoring'
import { itemScore, LIMITS } from './scoring'
import { CUE } from '../../core/phrases'
import { HIP_REF } from '../../core/params'
import { HEAD_ABS, REL_LIMITS, STRIDE } from './params'
import { RunningGate } from './motion'
import { CueEngine, type EngineInput, type ItemSpec, type ModeAnalyzer, type SecondContext, type SecondOut, type Values } from '../../core/engine'

// カメラモード：トレッドミルの横のスマホで骨格を取り、頭・体幹・体全体・腰を見る。
// 声かけのしくみ（いつ声をかけ、ほめ、黙って見守るか）は engine.ts で、どのモードでも共通。
// ここにあるのは、カメラの測定から1秒ごとの判定の値を作る「見る役」と、走り姿のアニメーションの記録だけ

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

// 測る項目。並び順が、声をかける優先順（頭 → 体幹 → 体全体 → 腰）
const ITEMS: ItemKey[] = ['head', 'trunk', 'body', 'hip']
export const CAMERA_ITEMS: ItemSpec<ItemKey>[] = ITEMS.map((key) => ({ key, limits: LIMITS[key], cue: CUE[key] }))

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

class CameraAnalyzer implements ModeAnalyzer<Measure, Sample, ItemKey> {
  items = CAMERA_ITEMS

  private hipRefs: number[] = []
  private hipRef: number | null = null
  // 走り始めの自分の首の角度・上体・体全体の傾き、頭の位置そのもの、スマホの向き（HIP_REF の区間の、歩数で走っていた秒の平均）
  private leanRefs: { neck: number[]; trunk: number[]; body: number[]; headLean: number[]; yaw: number[] } = { neck: [], trunk: [], body: [], headLean: [], yaw: [] }
  leanRef: { neck: number; trunk: number; body: number; headLean: number; yaw: number } | null = null

  // 走り始めの基準は、歩数で走っていると見た秒だけで作る。running は Coach が決めた「走っている」（RunningGate）。
  // runFrom は、いまの走りの始まり（しくみの秒）。基準ができる前に止まったら null にして、作り直す
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

  // 走るのが止まった：基準ができる前なら、ためた分を捨てて、次に走り出したところから作り直す
  stopped() {
    if (this.leanRef !== null) return
    this.runFrom = null
    this.hipRefs = []
    this.leanRefs = { neck: [], trunk: [], body: [], headLean: [], yaw: [] }
  }

  // 基準にためた秒の数（採点の道具が、基準を作った間を出すのに使う）
  get refSeconds() {
    return this.leanRefs.trunk.length
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
    const neck = mean(b.map((m) => m.neck))
    const headLean = mean(b.map((m) => m.headLean))
    const yaw = mean(b.map((m) => m.yaw))
    const trunk = mean(b.map((m) => m.trunk))
    const body = mean(b.map((m) => m.body))
    const hipRatio = mean(b.map((m) => m.hipRatio))
    // 走り始めの基準：いまの走りの始まりから HIP_REF の間の、歩数で走っていた秒の平均
    const rt = this.runFrom === null ? null : t - this.runFrom
    if (this.leanRef === null && rt !== null && stepping && rt >= HIP_REF.from && rt <= HIP_REF.to) {
      this.hipRefs.push(hipRatio)
      this.leanRefs.neck.push(neck)
      this.leanRefs.trunk.push(trunk)
      this.leanRefs.body.push(body)
      this.leanRefs.headLean.push(headLean)
      this.leanRefs.yaw.push(yaw)
    }
    let ready = false
    let once: SecondOut<Sample, ItemKey>['once']
    // 区間に歩数で走っていた秒が1つもなければ、もう走り始めの数十秒は過ぎているので、すぐ次の秒からためる
    if (this.leanRef === null && rt !== null && rt > HIP_REF.to && !this.leanRefs.trunk.length) this.runFrom = t - HIP_REF.from
    else if (this.leanRef === null && rt !== null && rt > HIP_REF.to) {
      const r = this.leanRefs
      ready = true
      this.hipRef = mean(this.hipRefs)
      this.leanRef = { neck: mean(r.neck), trunk: mean(r.trunk), body: mean(r.body), headLean: mean(r.headLean), yaw: mean(r.yaw) }
      // 最初から頭が前に出ていないかを、一度だけ決まった線と比べる（真横に近く置けているときだけ）。
      // 直ったかは、走り始めより頭が HEAD_ABS.recoverBack 戻ったかで見る
      if (ctx.active.includes('head') && Math.abs(this.leanRef.yaw) <= HEAD_ABS.yawMax && this.leanRef.headLean > HEAD_ABS.line) {
        once = { item: 'head', back: -HEAD_ABS.recoverBack }
      }
    }
    const hipDrop = this.hipRef ? Math.max(0, ((this.hipRef - hipRatio) / this.hipRef) * 100) : 0
    // 頭は、走り始めの自分との差。1秒ごとに0で切らず、平均してから線と比べる（揺れの正の側だけが残って、実際より大きく出るため）
    const head = this.leanRef ? neck - this.leanRef.neck : 0
    const judge = this.leanRef ? { trunk: toScale('trunk', trunk - this.leanRef.trunk), body: toScale('body', body - this.leanRef.body) } : undefined
    // 上体と体全体は、基準ができるまでは決まった線で判定する。頭と腰は、走り始めの自分の基準ができるまで判定しない
    const values: Values<ItemKey> = { trunk: judge?.trunk ?? trunk, body: judge?.body ?? body }
    if (this.leanRef) values.head = head
    if (this.hipRef) values.hip = hipDrop
    // 上体と体全体はいつも判定するので、点数が null になることはない
    const sample: Sample = { t, head, trunk, body, hipDrop, score: ctx.score(values) ?? 100, quiet: ctx.quiet, judge, headLean }
    this.maybeKeepStride(sample)
    return { sample, values, ready, once }
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
  // items: 声をかける項目（ランナーのレベルで決まる。ほかの項目は大きく崩れたときだけ）。なければすべて
  // 走る前に立って測る基準は、猫背の確認にだけ使い、ここには渡さない（頭は走り始めの自分と比べる）
  constructor(opts: { pause?: boolean; items?: ItemKey[] } = {}) {
    super(new CameraAnalyzer(), opts)
  }

  private get camera() {
    return this.analyzer as CameraAnalyzer
  }

  // 走り始めの自分の基準（できるまでは null）
  get leanRef() {
    return this.camera.leanRef
  }

  private readonly gate = new RunningGate()

  // 走り始めの基準ができる前に止まったか、走り出したか（基準を作り直すため）
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

  // 走っていない（止まった）と見ている間と、走り始めの基準ができるまでは、間引かずに毎コマ見る。
  // 走り出し・止まりを、飛び飛びの数コマではなく続けて見て決めるため（間引いた数コマだけで決めると、
  // 見えにくい1秒で「止まった」になり、基準を何度も作り直してしまう）
  wantsDetail(): boolean {
    return !this.gate.running || this.leanRef === null || super.wantsDetail()
  }

  // 走り始めの基準にためた秒の数
  get refSeconds() {
    return this.camera.refSeconds
  }

  finish(speedKmh?: number): Session {
    return { ...this.summary(), speedKmh, samples: this.samples, strides: this.camera.strides() }
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

// 判定に使う値。上体と体全体は、走り始めの自分の基準ができていれば、その増え方（LIMITS の目盛りに直したもの）
export function judged(s: Sample, k: ItemKey): number {
  if (k === 'hip') return s.hipDrop
  if (k === 'head') return s.head
  return s.judge?.[k] ?? s[k]
}

// 増え方を、決まった線（LIMITS）の目盛りに直す：増え方の満点・声をかける線・0点が、LIMITS のそれぞれに重なるように
export function toScale(k: 'trunk' | 'body', delta: number): number {
  const a = REL_LIMITS[k]
  const b = LIMITS[k]
  if (delta <= a.full) return b.full - (a.full - delta)
  if (delta <= a.cue) return b.full + ((delta - a.full) * (b.cue - b.full)) / (a.cue - a.full)
  return b.cue + ((delta - a.cue) * (b.zero - b.cue)) / (a.zero - a.cue)
}
