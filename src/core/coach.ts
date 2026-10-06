import type { Baseline, Category, CueLog, Frame, ItemKey, Measure, Sample, Session, Stride } from './types'
import { category, itemScore, overCue, LIMITS, postureScore } from './scoring'
import { CUE, RECOVER, SAY } from './phrases'

export type CoachState = 'waiting' | 'running' | 'paused' | 'ended'

export interface CoachInput {
  t: number // 実時間（秒）
  present: boolean // 人が見えているか
  moving: boolean // 脚が走る動きをしているか
  m?: Measure
  frame?: Frame // 鉛直をそろえたピクセル座標（走り姿のアニメーション用）
}

export type CoachEvent = { type: 'speak'; text: string } | { type: 'state'; state: CoachState }

const ITEMS: ItemKey[] = ['head', 'trunk', 'body', 'hip']
const START_AFTER = 2 // 走り出しを2秒続けて見たら始める
const PAUSE_AFTER = 3 // 3秒止まったら一時停止
const END_AFTER = 20 // 20秒いなくなったら終わり
const CUE_WINDOW = 10
const CUE_COOLDOWN = 30
const CUE_GAP = 12
const RECOVER_WITHIN = 15
const HIP_REF_FROM = 30 // 腰の高さの基準は、走り始めて30秒〜3分の平均
const HIP_REF_TO = 180
const QUIET_FIRST = 300
const QUIET_STEP = 150
const QUIET_MAX = 900
const STRIDE_FRAMES = 36 // 約1.2秒
const STRIDE_EVERY = 20 // 20秒ごとに走り姿の候補を取る

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

interface Pending {
  item: ItemKey
  t: number
}

export class Coach {
  state: CoachState = 'waiting'
  active = 0 // 走っていた秒数（一時停止中は進まない）
  samples: Sample[] = []
  cues: CueLog[] = []
  quiet = false

  private startedAt = Date.now()
  private lastT: number | null = null
  private movingSince: number | null = null
  private stillSince: number | null = null
  private absentSince: number | null = null
  private everRan = false

  private bucket: Measure[] = []
  private bucketStart = 0
  private hipRefs: number[] = []
  private hipRef: number | null = null

  private lastCue: Partial<Record<ItemKey, number>> = {}
  private lastAnyCue = -1e9
  private lastPraise = 0
  private pending: Pending | null = null
  private quietStart = 0
  private quietLen = QUIET_FIRST
  private quietEnd = -1e9
  quietHeldSec = 0

  private ring: { frame: Frame; dir: 1 | -1 }[] = []
  private candidates: Record<Category, Stride[]> = { good: [], mid: [], bad: [] }
  private lastStrideAt = -1e9

  private baseline: Baseline
  constructor(baseline: Baseline) {
    this.baseline = baseline
  }

  update(inp: CoachInput): CoachEvent[] {
    const ev: CoachEvent[] = []
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, inp.t - this.lastT))
    this.lastT = inp.t

    // 状態の切り替え
    if (!inp.present) {
      this.absentSince ??= inp.t
      this.movingSince = null
      if (this.everRan && this.state !== 'ended' && inp.t - this.absentSince >= END_AFTER) {
        this.state = 'ended'
        ev.push({ type: 'state', state: 'ended' }, { type: 'speak', text: SAY.end })
      }
      return ev
    }
    this.absentSince = null
    if (inp.moving) {
      this.movingSince ??= inp.t
      this.stillSince = null
    } else {
      this.stillSince ??= inp.t
      this.movingSince = null
    }

    if ((this.state === 'waiting' || this.state === 'paused') && this.movingSince !== null && inp.t - this.movingSince >= START_AFTER) {
      ev.push({ type: 'speak', text: this.state === 'waiting' ? SAY.start : SAY.resume })
      this.state = 'running'
      this.everRan = true
      ev.push({ type: 'state', state: 'running' })
    } else if (this.state === 'running' && this.stillSince !== null && inp.t - this.stillSince >= PAUSE_AFTER) {
      this.state = 'paused'
      this.bucket = []
      ev.push({ type: 'state', state: 'paused' }, { type: 'speak', text: SAY.pause })
    }
    if (this.state !== 'running') return ev

    // 走っている間だけ時間を進める
    this.active += dt
    if (inp.frame && inp.m) {
      this.ring.push({ frame: inp.frame, dir: inp.m.dir })
      if (this.ring.length > STRIDE_FRAMES) this.ring.shift()
    }
    if (inp.m) this.bucket.push(inp.m)
    if (this.active - this.bucketStart >= 1) {
      this.bucketStart = Math.floor(this.active)
      const s = this.closeSecond()
      if (s) ev.push(...this.decide(s))
    }
    return ev
  }

  // 1秒分の測定をまとめて1件の記録にする
  private closeSecond(): Sample | null {
    const b = this.bucket
    this.bucket = []
    if (b.length < 3) return null
    const t = Math.floor(this.active)
    const neck = mean(b.map((m) => m.neck))
    const trunk = mean(b.map((m) => m.trunk))
    const body = mean(b.map((m) => m.body))
    const hipRatio = mean(b.map((m) => m.hipRatio))
    if (t >= HIP_REF_FROM && t <= HIP_REF_TO) this.hipRefs.push(hipRatio)
    if (this.hipRef === null && t > HIP_REF_TO && this.hipRefs.length) this.hipRef = mean(this.hipRefs)
    const hipDrop = this.hipRef ? Math.max(0, ((this.hipRef - hipRatio) / this.hipRef) * 100) : 0
    const head = Math.max(0, neck - this.baseline.neck)
    const v = { head, trunk, body, hip: hipDrop }
    const sample: Sample = { t, head, trunk, body, hipDrop, score: postureScore(v), quiet: this.quiet }
    this.samples.push(sample)
    this.maybeKeepStride(sample)
    return sample
  }

  private recent(n: number): Sample[] {
    return this.samples.slice(-n)
  }

  private value(s: Sample, k: ItemKey) {
    return k === 'hip' ? s.hipDrop : s[k]
  }

  private say(ev: CoachEvent[], t: number, item: CueLog['item'], text: string) {
    ev.push({ type: 'speak', text })
    this.cues.push({ t, item, text })
  }

  private decide(s: Sample): CoachEvent[] {
    const ev: CoachEvent[] = []
    const t = s.t

    // 声なしで確認する時間
    if (this.quiet) {
      if (s.score >= 80) this.quietHeldSec += 1
      const last30 = this.recent(30)
      if (last30.length >= 30 && mean(last30.map((x) => x.score)) < 50) {
        this.quiet = false
        this.quietEnd = t
        this.quietLen = QUIET_FIRST
      } else if (t - this.quietStart >= this.quietLen) {
        this.quiet = false
        this.quietEnd = t
        this.quietLen = Math.min(QUIET_MAX, this.quietLen + QUIET_STEP)
        this.say(ev, t, 'praise', SAY.quietDone)
      }
      return ev
    }

    // 直ったらほめる
    if (this.pending && t - this.pending.t <= RECOVER_WITHIN) {
      const last5 = this.recent(5)
      if (mean(last5.map((x) => this.value(x, this.pending!.item))) <= LIMITS[this.pending.item].full) {
        this.say(ev, t, 'recover', RECOVER[this.cues.length % RECOVER.length])
        this.pending = null
        return ev
      }
    } else if (this.pending) {
      this.pending = null
    }

    // 崩れていたら声をかける（優先順：頭 → 体幹 → 体全体 → 腰）
    const win = this.recent(CUE_WINDOW)
    if (win.length >= CUE_WINDOW && t - this.lastAnyCue >= CUE_GAP) {
      for (const k of ITEMS) {
        const avg = mean(win.map((x) => this.value(x, k)))
        if (overCue(k, avg) && t - (this.lastCue[k] ?? -1e9) >= CUE_COOLDOWN) {
          this.say(ev, t, k, CUE[k])
          this.lastCue[k] = t
          this.lastAnyCue = t
          this.pending = { item: k, t }
          return ev
        }
      }
    }

    // 5分きれいに走れていたらほめる
    const last300 = this.recent(300)
    if (last300.length >= 300 && t - this.lastPraise >= 300 && mean(last300.map((x) => x.score)) >= 80 && t - this.lastAnyCue >= 60) {
      this.say(ev, t, 'praise', SAY.praise5)
      this.lastPraise = t
      return ev
    }

    // 安定していたら、声なしで確認する時間に入る
    const last180 = this.recent(180)
    if (
      last180.length >= 180 &&
      mean(last180.map((x) => x.score)) >= 80 &&
      t - this.lastAnyCue >= 180 &&
      t - this.quietEnd >= 120
    ) {
      this.quiet = true
      this.quietStart = t
      this.say(ev, t, 'praise', SAY.quietStart)
    }
    return ev
  }

  private maybeKeepStride(s: Sample) {
    if (this.ring.length < STRIDE_FRAMES || s.t - this.lastStrideAt < STRIDE_EVERY) return
    this.lastStrideAt = s.t
    const cat = category(s.score)
    const list = this.candidates[cat]
    const stride: Stride = {
      frames: this.ring.map((r) => r.frame),
      dir: this.ring[this.ring.length - 1].dir,
      score: s.score,
      avg: { head: s.head, trunk: s.trunk, body: s.body, hipDrop: s.hipDrop },
    }
    if (list.length < 60) list.push(stride)
    else list[Math.floor(Math.random() * list.length)] = stride
  }

  finish(speedKmh?: number): Session {
    const n = this.samples.length || 1
    const share = { good: 0, mid: 0, bad: 0 }
    for (const s of this.samples) share[category(s.score)] += 1 / n
    const strides: Session['strides'] = {}
    for (const cat of ['good', 'mid', 'bad'] as Category[]) {
      const list = this.candidates[cat]
      if (!list.length) continue
      const m = mean(list.map((x) => x.score))
      strides[cat] = list.reduce((a, b) => (Math.abs(b.score - m) < Math.abs(a.score - m) ? b : a))
    }
    return {
      id: String(this.startedAt),
      startedAt: this.startedAt,
      durationSec: Math.round(this.active),
      speedKmh,
      samples: this.samples,
      cues: this.cues,
      strides,
      share,
      breakdownMin: breakdownMinute(this.samples),
      quietHeldSec: this.quietHeldSec,
    }
  }
}

// 崩れ始め：5分平均の姿勢スコアが、序盤の平均より15点以上下がった最初の時刻（分）
export function breakdownMinute(samples: Sample[]): number | undefined {
  if (samples.length < 600) return undefined
  const early = samples.filter((s) => s.t >= 60 && s.t <= Math.max(600, samples.length * 0.25))
  const base = mean(early.map((s) => s.score))
  for (let i = 300; i < samples.length; i++) {
    const w = samples.slice(i - 300, i)
    if (mean(w.map((s) => s.score)) < base - 15) return Math.round(samples[i - 150].t / 60)
  }
  return undefined
}

export { itemScore }
