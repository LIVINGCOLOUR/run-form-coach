import { ABSENCE, BREAKDOWN, CUE as CUE_P, POWER, PRAISE, QUIET, RUNNING, SCORE, TONE } from './params'
import { RECOVER, SAY } from './phrases'
import { category } from './scoring'

// 声かけのしくみ（どのモードでも共通）。いつ声をかけ、いつほめ、いつ黙って見守るかを決める。
// 何を測るか（1秒ごとの判定の値）は、モードごとの「見る役」（ModeAnalyzer）が作る。
//   カメラ：src/modes/camera/coach.ts の CameraAnalyzer（頭・体幹・体全体・腰）
//   スマホ・センサー：それぞれの入り口が、自分の項目と見る役を用意して、このしくみに渡す
// 数字はすべて同じフォルダの params.ts（フォームの見方のページにも、そのまま表示している）

export type CoachState = 'waiting' | 'running' | 'paused' | 'ended'

// tone：音で知らせる項目（ItemSpec.tone）の音を鳴らす（on）・止める（off）。bars は鳴らす長さの上限（小節）。
//   テンポなど音の中身は入り口が決める（スマホ：走り始めの自分のピッチのメトロノーム）。音を使わない入り口は無視してよい
export type CoachEvent =
  | { type: 'speak'; text: string }
  | { type: 'state'; state: CoachState }
  | { type: 'tone'; on: true; item: string; bars: number }
  | { type: 'tone'; on: false; item: string }

export interface EngineInput<M> {
  t: number // 実時間（秒）
  present: boolean // 人が見えているか（センサーなら、つながっているか）
  moving: boolean // 走る動きをしているか
  m?: M // 1コマ分の測定
}

// 1つの項目の線。value が full 以下なら満点、zero 以上で0点、その間は比例。cue を越えたら声をかける
export interface Limits {
  full: number
  zero: number
  cue: number
}

export interface ItemSpec<K extends string> {
  key: K
  limits: Limits
  cue: string // 崩れたときにかける言葉
  // 言葉は初めだけ（TONE.words 回まで）で、あとは音で知らせる。戻ったら音を止め、ほめる言葉も言わない。
  // くり返すほど次の知らせまでの間をあける（TONE.fadeFrom〜）。なければ毎回言葉（カメラ版）
  tone?: boolean
}

export interface CueRecord<K extends string> {
  t: number
  item: K | 'praise' | 'recover'
  text: string
  tone?: boolean // 言葉ではなく音で知らせた（text は TONE_TEXT）
}

// 音だけで知らせたときの、記録の文
export const TONE_TEXT = '（メトロノーム）'

// 1秒の判定の値。その秒に判定しない項目は入れない（0 を入れると「崩れていない」と数えてしまう）
export type Values<K extends string> = Partial<Record<K, number>>

// しくみが話す言葉のうち、入り口ごとに替えられるもの（見えなくなったときの言葉など）
export type EngineSay = Record<keyof typeof SAY, string>

// 見る役が1秒ごとに返すもの
export interface SecondOut<S, K extends string> {
  sample: S // そのモードの1秒の記録（画面や結果に使う）
  values: Values<K> // 判定に使う値（線と比べる）。判定しない項目は入れない。1つもなければ、その秒は判定しない
  ready?: boolean // 走り始めの自分の基準ができた（声なしの見守りは、ここから QUIET.enterWindow 経つまで入らない）
  once?: { item: K; back: number } // 一度だけかける声。直ったかは values[item] が back 以下に戻ったかで見る
}

export interface SecondContext<K extends string> {
  quiet: boolean // 声なしで見守っている時間か
  active: K[] // 声をかける項目
  score: (values: Values<K>) => number | null // 1秒の点数（判定した項目のうち、いちばん崩れている項目の点数）。判定した項目がなければ null
}

export interface ModeAnalyzer<M, S, K extends string> {
  items: ItemSpec<K>[] // 測る項目。並び順が、声をかける優先順
  // この入り口で替える言葉（スマホなら、見えなくなったときの言葉をセンサーが途切れたときの言葉に）。ないものは SAY のまま
  say?: Partial<EngineSay>
  // 走っている間、1コマごとに呼ぶ（走り姿の記録など。要らなければ無くてよい）
  input?(inp: EngineInput<M>): void
  // 1秒分の測定（bucket）をまとめる。足りなければ null
  second(bucket: M[], t: number, ctx: SecondContext<K>): SecondOut<S, K> | null
}

// 1秒ごとの判定の記録（しくみの中だけで使う）
// 判定しなかった秒も入れる（間引いた分の重みを、次の記録までの時間で数えるため）。score が null の秒は判定しなかった秒
interface Record_<K extends string> {
  t: number
  values: Values<K>
  score: number | null
}

const judged = <K extends string>(rs: Record_<K>[]) => rs.filter((r): r is Record_<K> & { score: number } => r.score !== null)
const valuesOf = <K extends string>(rs: Record_<K>[], k: K) =>
  rs.flatMap((r) => {
    const v = r.values[k]
    return v === undefined ? [] : [v]
  })

interface Pending<K extends string> {
  item: K
  t: number
  back: number // この値以下に戻れば「直った」
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function scoreOf(limits: Limits, value: number): number {
  const { full, zero } = limits
  if (value <= full) return 100
  if (value >= zero) return 0
  return Math.round((100 * (zero - value)) / (zero - full))
}

export class CueEngine<M, S, K extends string> {
  state: CoachState = 'waiting'
  active = 0 // 走っていた秒数（一時停止中は進まない）
  samples: S[] = []
  cues: CueRecord<K>[] = []
  quiet = false
  quietHeldSec = 0
  readonly startedAt = Date.now()

  private records: Record_<K>[] = []
  private lastT: number | null = null
  private movingSince: number | null = null
  private stillSince: number | null = null
  private absentSince: number | null = null
  private lostSaid = false
  private everRan = false

  private bucket: M[] = []
  private bucketStart = 0
  private refAt: number | null = null // 走り始めの基準ができた時刻
  private onceDue: { item: K; back: number } | null = null

  private lastCue: Partial<Record<K, number>> = {}
  private cueCount: Partial<Record<K, number>> = {} // 項目ごとの、この走りで知らせた回数
  private toneOn: K | null = null // 音を鳴らしている項目
  private lastAnyCue = -1e9
  private lastPraise = 0
  private pending: Pending<K> | null = null
  private quietStart = 0
  private quietLen = QUIET.first
  private quietEnd = -1e9

  protected readonly analyzer: ModeAnalyzer<M, S, K>
  private readonly specs: Record<K, ItemSpec<K>>
  private readonly order: K[]
  private readonly pauseOn: boolean
  protected readonly activeItems: K[]
  private readonly muteOthers: boolean
  private readonly holdUnjudged: boolean
  private readonly said: EngineSay

  // pause: 止まったら一時停止するか（検証中は切っておく）
  // items: 声をかける項目（ランナーのレベルで決まる。ほかの項目は大きく崩れたときだけ）。なければすべて
  // muteOthers: items のほかの項目は、大きく崩れても声をかけない（測って記録するだけ。精度を確かめていない項目のある入り口で使う）。
  //   一度だけかける声（見る役の once）は、これとは別にかける
  // holdUnjudged: 見る役がその項目を判定しなかった秒（values に入れなかった秒）には、その項目で新しく知らせず、
  //   鳴らしている音も止める。窓の平均だけで決めると、判定を止めた直後に、止める前の秒の値で知らせてしまうため
  //   （スマホ：速さが基準から外れた秒を判定しない）。一度だけかける声は、これとは別にかける
  constructor(analyzer: ModeAnalyzer<M, S, K>, opts: { pause?: boolean; items?: K[]; muteOthers?: boolean; holdUnjudged?: boolean } = {}) {
    this.analyzer = analyzer
    this.order = analyzer.items.map((s) => s.key)
    this.specs = Object.fromEntries(analyzer.items.map((s) => [s.key, s])) as Record<K, ItemSpec<K>>
    this.pauseOn = opts.pause ?? true
    this.activeItems = opts.items ?? this.order
    this.muteOthers = opts.muteOthers ?? false
    this.holdUnjudged = opts.holdUnjudged ?? false
    this.said = { ...SAY, ...analyzer.say }
  }

  // 1秒の点数 = 判定した項目のうち、いちばん崩れている項目の点数。判定した項目がなければ null
  score(values: Values<K>): number | null {
    const ks = this.order.filter((k) => values[k] !== undefined)
    return ks.length ? Math.min(...ks.map((k) => scoreOf(this.specs[k].limits, values[k]!))) : null
  }

  private over(k: K, value: number) {
    return value > this.specs[k].limits.cue
  }

  update(inp: EngineInput<M>): CoachEvent[] {
    const ev: CoachEvent[] = []
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, inp.t - this.lastT))
    this.lastT = inp.t

    // 見えなくなったとき。走っている途中なら戻るよう促し、止まってから外れたなら終わりにする
    if (!inp.present) {
      this.absentSince ??= inp.t
      this.movingSince = null
      const gone = inp.t - this.absentSince
      if (!this.everRan || this.state === 'ended') return ev
      if (this.state === 'running') {
        if (gone >= ABSENCE.lostSay && !this.lostSaid) {
          this.lostSaid = true
          this.stopTone(ev)
          ev.push({ type: 'speak', text: this.said.lost })
        }
        if (gone >= ABSENCE.lostEnd) this.end(ev, this.said.giveUp)
      } else if (gone >= ABSENCE.stopEnd) {
        this.end(ev, this.said.end)
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

    if ((this.state === 'waiting' || this.state === 'paused') && this.movingSince !== null && inp.t - this.movingSince >= RUNNING.startAfter) {
      ev.push({ type: 'speak', text: this.state === 'waiting' ? this.said.start : this.said.resume })
      this.state = 'running'
      this.everRan = true
      ev.push({ type: 'state', state: 'running' })
    } else if (this.pauseOn && this.state === 'running' && this.stillSince !== null && inp.t - this.stillSince >= RUNNING.pauseAfter) {
      this.state = 'paused'
      this.bucket = []
      this.stopTone(ev)
      ev.push({ type: 'state', state: 'paused' }, { type: 'speak', text: this.said.pause })
    }
    if (this.state !== 'running') return ev

    // 走っている間だけ時間を進める
    this.active += dt
    this.analyzer.input?.(inp)
    if (inp.m) this.bucket.push(inp.m)
    if (this.active - this.bucketStart >= 1) {
      this.bucketStart = Math.floor(this.active)
      const r = this.closeSecond()
      if (r) ev.push(...this.decide(r))
    }
    return ev
  }

  private end(ev: CoachEvent[], text: string) {
    this.stopTone(ev)
    this.state = 'ended'
    ev.push({ type: 'state', state: 'ended' }, { type: 'speak', text })
  }

  // 今この瞬間を細かく測るべきか。崩れかけ・声をかけた直後・走り出す前後・見えていないときは毎コマ測る
  wantsDetail(): boolean {
    if (this.state !== 'running' || this.absentSince !== null || this.pending) return true
    const t = this.active
    if (t < POWER.warmup) return true
    // 声をかける線を越えたら、点数がまだ高くても細かく見る（間引いたままだと記録が足りず、声がかからない）
    const shaky = (r: Record_<K>) => (r.score !== null && r.score < SCORE.good) || this.order.some((k) => {
      const v = r.values[k]
      return v !== undefined && this.over(k, v)
    })
    if (this.records.slice(-POWER.recentBad).some((r) => r.t > t - POWER.recentBad && shaky(r))) return true
    const every = this.quiet ? POWER.lookEveryQuiet : POWER.lookEvery
    return t % every < POWER.lookSec
  }

  // 1秒分の測定をまとめて1件の記録にする
  private closeSecond(): Record_<K> | null {
    const b = this.bucket
    this.bucket = []
    const t = Math.floor(this.active)
    const out = this.analyzer.second(b, t, { quiet: this.quiet, active: this.activeItems, score: (v) => this.score(v) })
    if (!out) return null
    if (out.ready && this.refAt === null) this.refAt = t
    if (out.once) this.onceDue = out.once
    const r = { t, values: out.values, score: this.score(out.values) }
    this.records.push(r)
    this.samples.push(out.sample)
    return r
  }

  // 直近 sec 秒の記録。間引いて測っているので、件数ではなく時間で区切る
  private within(sec: number): Record_<K>[] {
    const rs = this.records
    const now = rs.length ? rs[rs.length - 1].t : 0
    const out: Record_<K>[] = []
    for (let i = rs.length - 1; i >= 0 && rs[i].t > now - sec; i--) out.push(rs[i])
    return out.reverse()
  }

  private say(ev: CoachEvent[], t: number, item: CueRecord<K>['item'], text: string) {
    ev.push({ type: 'speak', text })
    this.cues.push({ t, item, text })
  }

  private cue(ev: CoachEvent[], t: number, k: K, back: number) {
    const n = (this.cueCount[k] ?? 0) + 1
    this.cueCount[k] = n
    if (!this.specs[k].tone) this.say(ev, t, k, this.specs[k].cue)
    else {
      // 初めは言葉で言い、続けて音を鳴らす（音は入り口が、言葉を言い終えてから鳴らす）。あとは音だけ
      if (n <= TONE.words) this.say(ev, t, k, this.specs[k].cue)
      else this.cues.push({ t, item: k, text: TONE_TEXT, tone: true })
      this.stopTone(ev)
      ev.push({ type: 'tone', on: true, item: k, bars: TONE.bars })
      this.toneOn = k
    }
    this.lastCue[k] = t
    this.lastAnyCue = t
    this.pending = { item: k, t, back }
  }

  private stopTone(ev: CoachEvent[]) {
    if (this.toneOn === null) return
    ev.push({ type: 'tone', on: false, item: this.toneOn })
    this.toneOn = null
  }

  // 同じ項目の次の知らせまでの間。音で知らせる項目は、くり返すほどのばす（だんだん減らす）
  private cooldown(k: K): number {
    const next = (this.cueCount[k] ?? 0) + 1
    if (!this.specs[k].tone || next <= TONE.fadeFrom) return CUE_P.cooldown
    return Math.min(TONE.fadeMax, CUE_P.cooldown + (next - TONE.fadeFrom) * TONE.fadeStep)
  }

  private decide(r: Record_<K>): CoachEvent[] {
    const ev: CoachEvent[] = []
    const t = r.t
    // 判定しなかった項目の音は止める（holdUnjudged）
    if (this.holdUnjudged && this.toneOn !== null && r.values[this.toneOn] === undefined) this.stopTone(ev)

    // 声なしで見守る時間
    if (this.quiet) {
      // 間引いた分は、前の記録からの時間をこの記録の分として数える
      const prev = this.records[this.records.length - 2]
      // 判定しなかった秒は、保てた時間に数えない
      if (r.score !== null && r.score >= SCORE.good) this.quietHeldSec += prev ? Math.min(POWER.lookEveryQuiet, t - prev.t) : 1
      const lastFew = judged(this.within(QUIET.failWindow))
      if (lastFew.length >= QUIET.failMinSamples && mean(lastFew.map((x) => x.score)) < SCORE.mid) {
        this.quiet = false
        this.quietEnd = t
        this.quietLen = QUIET.first
      } else if (t - this.quietStart >= this.quietLen) {
        this.quiet = false
        this.quietEnd = t
        this.quietLen = Math.min(QUIET.max, this.quietLen + QUIET.step)
        // 「保てていました」と言えるのは、その間に判定した秒があったときだけ
        const seen = judged(this.within(this.quietLen)).filter((x) => x.t > this.quietStart)
        if (seen.length >= QUIET.failMinSamples) this.say(ev, t, 'praise', this.said.quietDone)
      }
      return ev
    }

    // 直ったらほめる
    if (this.pending && t - this.pending.t <= CUE_P.recoverWithin) {
      const p = this.pending
      // 判定しなかった秒は飛ばして、判定した秒だけで見る
      const back = valuesOf(this.within(CUE_P.recoverHold).filter((x) => x.t > p.t), p.item)
      if (back.length >= 2 && t - p.t >= CUE_P.recoverHold && back.every((v) => v <= p.back)) {
        // 音で知らせた項目は、音を止めるだけ（止まることが「戻った」の知らせ。言葉をくり返さない）
        if (this.specs[p.item].tone) this.stopTone(ev)
        else this.say(ev, t, 'recover', RECOVER[this.cues.length % RECOVER.length])
        this.pending = null
        return ev
      }
    } else if (this.pending) {
      this.pending = null
      this.stopTone(ev)
    }

    // 一度だけかける声（カメラ：最初から頭が前に出ている）
    if (this.onceDue && t - this.lastAnyCue >= CUE_P.gap) {
      const o = this.onceDue
      this.onceDue = null
      this.cue(ev, t, o.item, o.back)
      return ev
    }

    // 崩れていたら声をかける（優先順は見る役の items の並び）。項目ごとに、その項目を判定した秒だけで平均する
    const win = this.within(CUE_P.window)
    if (t - this.lastAnyCue >= CUE_P.gap) {
      for (const k of this.order) {
        if (this.holdUnjudged && r.values[k] === undefined) continue
        const vs = valuesOf(win, k)
        if (vs.length < CUE_P.window * CUE_P.coverage) continue
        const avg = mean(vs)
        const lim = this.specs[k].limits
        // 注意していない項目は、大きく崩れたとき（その項目の点数が「ふつう」の線を切ったとき）だけ。muteOthers なら声をかけない
        const over = this.activeItems.includes(k) ? this.over(k, avg) : !this.muteOthers && scoreOf(lim, avg) < SCORE.mid
        if (over && t - (this.lastCue[k] ?? -1e9) >= this.cooldown(k)) {
          // 直ったかの線は、満点の範囲と声をかける線の真ん中（満点まで戻らなくても、はっきり戻ればほめる）
          this.cue(ev, t, k, (lim.full + lim.cue) / 2)
          return ev
        }
      }
    }

    // 5分きれいに走れていたらほめる
    const lastLong = judged(this.within(PRAISE.window))
    if (
      t >= PRAISE.window &&
      lastLong.length >= PRAISE.minSamples &&
      t - this.lastPraise >= PRAISE.window &&
      mean(lastLong.map((x) => x.score)) >= SCORE.good &&
      t - this.lastAnyCue >= PRAISE.afterCue
    ) {
      this.say(ev, t, 'praise', this.said.praise5)
      this.lastPraise = t
      return ev
    }

    // 安定していたら、声なしで見守る時間に入る。走り始めの自分との比べで安定していたかを見たいので、
    // 基準ができてから QUIET.enterWindow 経つまでは入らない
    const lastMid = judged(this.within(QUIET.enterWindow))
    if (
      this.refAt !== null &&
      t - this.refAt >= QUIET.enterWindow &&
      lastMid.length >= QUIET.enterMinSamples &&
      mean(lastMid.map((x) => x.score)) >= SCORE.good &&
      t - this.lastAnyCue >= QUIET.enterWindow &&
      t - this.quietEnd >= QUIET.afterQuiet
    ) {
      this.quiet = true
      this.quietStart = t
      this.say(ev, t, 'praise', this.said.quietStart)
    }
    return ev
  }

  // 結果のうち、どのモードでも共通の部分
  protected summary() {
    // 間引いた分は、次の記録までの時間をその記録の重みにする（崩れて細かく見た時間に偏らないように）。
    // 判定しなかった秒は、良い・ふつう・悪いのどれにも入れず、割合の分母からも外す（満点として数えると「良い」が水増しされる）
    const share = { good: 0, mid: 0, bad: 0 }
    const rs = this.records
    const w = rs.map((r, i) => (i + 1 < rs.length ? Math.min(POWER.lookEveryQuiet, rs[i + 1].t - r.t) : 1))
    const total = rs.reduce((a, r, i) => a + (r.score === null ? 0 : w[i]), 0) || 1
    rs.forEach((r, i) => r.score !== null && (share[category(r.score)] += w[i] / total))
    return {
      id: String(this.startedAt),
      startedAt: this.startedAt,
      durationSec: Math.round(this.active),
      cues: this.cues,
      share,
      breakdownMin: breakdownMinute(judged(rs)),
      quietHeldSec: this.quietHeldSec,
    }
  }
}

// 崩れ始め：5分平均の点数が、序盤の平均より15点以上下がった最初の時刻（分）
export function breakdownMinute(samples: { t: number; score: number }[]): number | undefined {
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
