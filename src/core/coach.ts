import type { Baseline, Category, CueLog, Frame, ItemKey, Measure, Sample, Session, Stride } from './types'
import { category, itemScore, overCue, LIMITS, postureScore } from './scoring'
import { CUE, RECOVER, SAY } from './phrases'
import { ABSENCE, BREAKDOWN, CUE as CUE_P, HIP_REF, POWER, PRAISE, QUIET, REL_LIMITS, RUNNING, SCORE, STRIDE } from './params'

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
// 数字はすべて params.ts（フォームの見方のページにも、そのまま表示している）
const START_AFTER = RUNNING.startAfter
const PAUSE_AFTER = RUNNING.pauseAfter
const LOST_SAY = ABSENCE.lostSay
const LOST_END = ABSENCE.lostEnd
const STOP_END = ABSENCE.stopEnd
const CUE_WINDOW = CUE_P.window
const CUE_COOLDOWN = CUE_P.cooldown
const CUE_GAP = CUE_P.gap
const RECOVER_WITHIN = CUE_P.recoverWithin
const RECOVER_SEC = CUE_P.recoverHold
const HIP_REF_FROM = HIP_REF.from
const HIP_REF_TO = HIP_REF.to
const QUIET_FIRST = QUIET.first
const QUIET_STEP = QUIET.step
const QUIET_MAX = QUIET.max
const STRIDE_FRAMES = STRIDE.frames
const STRIDE_SEC = STRIDE.sec
const STRIDE_EVERY = STRIDE.every
const LOOK_SEC = POWER.lookSec
const LOOK_EVERY = POWER.lookEvery
const LOOK_EVERY_QUIET = POWER.lookEveryQuiet

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
  private lostSaid = false
  private everRan = false

  private bucket: Measure[] = []
  private bucketStart = 0
  private hipRefs: number[] = []
  private hipRef: number | null = null
  // 走り始めの自分の上体・体全体の傾き（HIP_REF の区間の平均）
  private leanRefs: { trunk: number[]; body: number[] } = { trunk: [], body: [] }
  leanRef: { trunk: number; body: number } | null = null

  private lastCue: Partial<Record<ItemKey, number>> = {}
  private lastAnyCue = -1e9
  private lastPraise = 0
  private pending: Pending | null = null
  private quietStart = 0
  private quietLen = QUIET_FIRST
  private quietEnd = -1e9
  quietHeldSec = 0

  private ring: { frame: Frame; dir: 1 | -1; t: number }[] = []
  private candidates: Record<Category, Stride[]> = { good: [], mid: [], bad: [] }
  private lastStrideAt = -1e9

  private baseline: Baseline
  private pauseOn: boolean
  // pause: 止まったら一時停止するか（検証中は切っておく）
  constructor(baseline: Baseline, opts: { pause?: boolean } = {}) {
    this.baseline = baseline
    this.pauseOn = opts.pause ?? true
  }

  update(inp: CoachInput): CoachEvent[] {
    const ev: CoachEvent[] = []
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, inp.t - this.lastT))
    this.lastT = inp.t

    // 画面から出たとき。走っている途中なら戻るよう促し、止まってから出たなら終わりにする
    if (!inp.present) {
      this.absentSince ??= inp.t
      this.movingSince = null
      const gone = inp.t - this.absentSince
      if (!this.everRan || this.state === 'ended') return ev
      if (this.state === 'running') {
        if (gone >= LOST_SAY && !this.lostSaid) {
          this.lostSaid = true
          ev.push({ type: 'speak', text: SAY.lost })
        }
        if (gone >= LOST_END) this.end(ev, SAY.giveUp)
      } else if (gone >= STOP_END) {
        this.end(ev, SAY.end)
      }
      return ev
    }
    this.absentSince = null
    this.lostSaid = false
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
    } else if (this.pauseOn && this.state === 'running' && this.stillSince !== null && inp.t - this.stillSince >= PAUSE_AFTER) {
      this.state = 'paused'
      this.bucket = []
      ev.push({ type: 'state', state: 'paused' }, { type: 'speak', text: SAY.pause })
    }
    if (this.state !== 'running') return ev

    // 走っている間だけ時間を進める
    this.active += dt
    if (inp.frame && inp.m) {
      // 骨格を取っていない間があいたら、つながらないので捨てる
      const last = this.ring[this.ring.length - 1]
      if (last && inp.t - last.t > 0.3) this.ring = []
      this.ring.push({ frame: inp.frame, dir: inp.m.dir, t: inp.t })
      while (this.ring.length && inp.t - this.ring[0].t > STRIDE_SEC + 0.3) this.ring.shift()
    }
    if (inp.m) this.bucket.push(inp.m)
    if (this.active - this.bucketStart >= 1) {
      this.bucketStart = Math.floor(this.active)
      const s = this.closeSecond()
      if (s) ev.push(...this.decide(s))
    }
    return ev
  }

  private end(ev: CoachEvent[], text: string) {
    this.state = 'ended'
    ev.push({ type: 'state', state: 'ended' }, { type: 'speak', text })
  }

  // 今この瞬間の骨格を取るべきか。崩れかけ・声をかけた直後・走り出す前後・人がいないときは毎コマ取る
  wantsDetail(): boolean {
    if (this.state !== 'running' || this.absentSince !== null || this.pending) return true
    const t = this.active
    if (t < POWER.warmup) return true
    // 声をかける線を越えたら、点数がまだ高くても細かく見る（間引いたままだと記録が足りず、声がかからない）
    if (this.samples.slice(-POWER.recentBad).some((s) => s.t > t - POWER.recentBad && (s.score < SCORE.good || ITEMS.some((k) => overCue(k, this.value(s, k)))))) return true
    const every = this.quiet ? LOOK_EVERY_QUIET : LOOK_EVERY
    return t % every < LOOK_SEC
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
    if (t >= HIP_REF_FROM && t <= HIP_REF_TO) {
      this.hipRefs.push(hipRatio)
      this.leanRefs.trunk.push(trunk)
      this.leanRefs.body.push(body)
    }
    if (this.hipRef === null && t > HIP_REF_TO && this.hipRefs.length) this.hipRef = mean(this.hipRefs)
    if (this.leanRef === null && t > HIP_REF_TO && this.leanRefs.trunk.length) this.leanRef = { trunk: mean(this.leanRefs.trunk), body: mean(this.leanRefs.body) }
    const hipDrop = this.hipRef ? Math.max(0, ((this.hipRef - hipRatio) / this.hipRef) * 100) : 0
    const head = Math.max(0, neck - this.baseline.neck)
    const judge = this.leanRef ? { trunk: toScale('trunk', trunk - this.leanRef.trunk), body: toScale('body', body - this.leanRef.body) } : undefined
    const v = { head, trunk: judge?.trunk ?? trunk, body: judge?.body ?? body, hip: hipDrop }
    const sample: Sample = { t, head, trunk, body, hipDrop, score: postureScore(v), quiet: this.quiet, judge }
    this.samples.push(sample)
    this.maybeKeepStride(sample)
    return sample
  }

  // 直近 sec 秒の記録。骨格を間引いて取っているので、件数ではなく時間で区切る
  private within(sec: number): Sample[] {
    const now = this.samples.length ? this.samples[this.samples.length - 1].t : 0
    const out: Sample[] = []
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].t > now - sec; i--) out.push(this.samples[i])
    return out.reverse()
  }

  private value(s: Sample, k: ItemKey) {
    return judged(s, k)
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
      // 間引いた分は、前の記録からの時間をこの記録の分として数える
      const prev = this.samples[this.samples.length - 2]
      if (s.score >= SCORE.good) this.quietHeldSec += prev ? Math.min(LOOK_EVERY_QUIET, t - prev.t) : 1
      const lastFew = this.within(QUIET.failWindow)
      if (lastFew.length >= QUIET.failMinSamples && mean(lastFew.map((x) => x.score)) < SCORE.mid) {
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
      // 直ったかの線は、満点の範囲と声をかける線の真ん中（満点まで戻らなくても、はっきり戻ればほめる）
      const p = this.pending
      const back = this.within(RECOVER_SEC).filter((x) => x.t > p.t)
      const line = (LIMITS[p.item].full + LIMITS[p.item].cue) / 2
      if (back.length >= 2 && t - p.t >= RECOVER_SEC && back.every((x) => this.value(x, p.item) <= line)) {
        this.say(ev, t, 'recover', RECOVER[this.cues.length % RECOVER.length])
        this.pending = null
        return ev
      }
    } else if (this.pending) {
      this.pending = null
    }

    // 崩れていたら声をかける（優先順：頭 → 体幹 → 体全体 → 腰）
    const win = this.within(CUE_WINDOW)
    if (win.length >= CUE_WINDOW * CUE_P.coverage && t - this.lastAnyCue >= CUE_GAP) {
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
    const lastLong = this.within(PRAISE.window)
    if (
      t >= PRAISE.window &&
      lastLong.length >= PRAISE.minSamples &&
      t - this.lastPraise >= PRAISE.window &&
      mean(lastLong.map((x) => x.score)) >= SCORE.good &&
      t - this.lastAnyCue >= PRAISE.afterCue
    ) {
      this.say(ev, t, 'praise', SAY.praise5)
      this.lastPraise = t
      return ev
    }

    // 安定していたら、声なしで確認する時間に入る
    const lastMid = this.within(QUIET.enterWindow)
    if (
      t >= QUIET.enterWindow &&
      lastMid.length >= QUIET.enterMinSamples &&
      mean(lastMid.map((x) => x.score)) >= SCORE.good &&
      t - this.lastAnyCue >= QUIET.enterWindow &&
      t - this.quietEnd >= QUIET.afterQuiet
    ) {
      this.quiet = true
      this.quietStart = t
      this.say(ev, t, 'praise', SAY.quietStart)
    }
    return ev
  }

  private maybeKeepStride(s: Sample) {
    const r = this.ring
    if (r.length < 8 || r[r.length - 1].t - r[0].t < STRIDE_SEC || s.t - this.lastStrideAt < STRIDE_EVERY) return
    this.lastStrideAt = s.t
    const cat = category(s.score)
    const list = this.candidates[cat]
    const stride: Stride = {
      frames: resample(r, STRIDE_FRAMES, STRIDE_SEC),
      dir: this.ring[this.ring.length - 1].dir,
      score: s.score,
      avg: { head: s.head, trunk: s.trunk, body: s.body, hipDrop: s.hipDrop },
    }
    if (list.length < 60) list.push(stride)
    else list[Math.floor(Math.random() * list.length)] = stride
  }

  finish(speedKmh?: number): Session {
    // 間引いた分は、次の記録までの時間をその記録の重みにする（崩れて細かく見た時間に偏らないように）
    const share = { good: 0, mid: 0, bad: 0 }
    const ss = this.samples
    const w = ss.map((s, i) => (i + 1 < ss.length ? Math.min(LOOK_EVERY_QUIET, ss[i + 1].t - s.t) : 1))
    const total = w.reduce((a, b) => a + b, 0) || 1
    ss.forEach((s, i) => (share[category(s.score)] += w[i] / total))
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
  const last = samples.length ? samples[samples.length - 1].t : 0
  if (last < BREAKDOWN.minRun) return undefined
  const early = samples.filter((s) => s.t >= 60 && s.t <= Math.max(600, last * 0.25))
  const base = mean(early.map((s) => s.score))
  let from = 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i].score
    while (samples[from].t <= samples[i].t - BREAKDOWN.window) sum -= samples[from++].score
    const n = i - from + 1
    if (samples[i].t >= BREAKDOWN.window && n >= 30 && sum / n < base - BREAKDOWN.drop) return Math.round((samples[i].t - BREAKDOWN.window / 2) / 60)
  }
  return undefined
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
