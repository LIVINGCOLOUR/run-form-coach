import type { Category, Frame, ItemKey, Measure, Sample, Session, Stride } from './types'
import { category, itemScore, LIMITS } from './scoring'
import { CUE } from './phrases'
import { HEAD_ABS, HIP_REF, REL_LIMITS, STRIDE } from './params'
import { CueEngine, type EngineInput, type ItemSpec, type ModeAnalyzer, type SecondContext, type SecondOut, type Values } from './engine'

// カメラモード：トレッドミルの横のスマホで骨格を取り、頭・体幹・体全体・腰を見る。
// 声かけのしくみ（いつ声をかけ、ほめ、黙って見守るか）は engine.ts で、どのモードでも共通。
// ここにあるのは、カメラの測定から1秒ごとの判定の値を作る「見る役」と、走り姿のアニメーションの記録だけ

export type { CoachEvent, CoachState } from './engine'
export { breakdownMinute } from './engine'

export interface CoachInput extends EngineInput<Measure> {
  frame?: Frame // 鉛直をそろえたピクセル座標（走り姿のアニメーション用）
}

// 測る項目。並び順が、声をかける優先順（頭 → 体幹 → 体全体 → 腰）
const ITEMS: ItemKey[] = ['head', 'trunk', 'body', 'hip']
export const CAMERA_ITEMS: ItemSpec<ItemKey>[] = ITEMS.map((key) => ({ key, limits: LIMITS[key], cue: CUE[key] }))

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

class CameraAnalyzer implements ModeAnalyzer<Measure, Sample, ItemKey> {
  items = CAMERA_ITEMS

  private hipRefs: number[] = []
  private hipRef: number | null = null
  // 走り始めの自分の首の角度・上体・体全体の傾き、頭の位置そのもの、スマホの向き（HIP_REF の区間の平均）
  private leanRefs: { neck: number[]; trunk: number[]; body: number[]; headLean: number[]; yaw: number[] } = { neck: [], trunk: [], body: [], headLean: [], yaw: [] }
  leanRef: { neck: number; trunk: number; body: number; headLean: number; yaw: number } | null = null

  private ring: { frame: Frame; dir: 1 | -1; t: number }[] = []
  private candidates: Record<Category, Stride[]> = { good: [], mid: [], bad: [] }
  private lastStrideAt = -1e9

  // 走っている間の1コマ：走り姿のアニメーション用に骨格をためる
  input(inp: CoachInput) {
    if (!inp.frame || !inp.m) return
    // 骨格を取っていない間があいたら、つながらないので捨てる
    const last = this.ring[this.ring.length - 1]
    if (last && inp.t - last.t > 0.3) this.ring = []
    this.ring.push({ frame: inp.frame, dir: inp.m.dir, t: inp.t })
    while (this.ring.length && inp.t - this.ring[0].t > STRIDE.sec + 0.3) this.ring.shift()
  }

  // 1秒分の測定をまとめて1件の記録にする
  second(b: Measure[], t: number, ctx: SecondContext<ItemKey>): SecondOut<Sample, ItemKey> | null {
    if (b.length < 3) return null
    const neck = mean(b.map((m) => m.neck))
    const headLean = mean(b.map((m) => m.headLean))
    const yaw = mean(b.map((m) => m.yaw))
    const trunk = mean(b.map((m) => m.trunk))
    const body = mean(b.map((m) => m.body))
    const hipRatio = mean(b.map((m) => m.hipRatio))
    if (t >= HIP_REF.from && t <= HIP_REF.to) {
      this.hipRefs.push(hipRatio)
      this.leanRefs.neck.push(neck)
      this.leanRefs.trunk.push(trunk)
      this.leanRefs.body.push(body)
      this.leanRefs.headLean.push(headLean)
      this.leanRefs.yaw.push(yaw)
    }
    if (this.hipRef === null && t > HIP_REF.to && this.hipRefs.length) this.hipRef = mean(this.hipRefs)
    let ready = false
    let once: SecondOut<Sample, ItemKey>['once']
    if (this.leanRef === null && t > HIP_REF.to && this.leanRefs.trunk.length) {
      const r = this.leanRefs
      ready = true
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

  update(inp: CoachInput) {
    return super.update(inp)
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
