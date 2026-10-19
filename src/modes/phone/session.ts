import { CueEngine, type CoachEvent, type CueRecord } from '../../core/engine'
import type { Category } from '../../core/types'
import { PhoneAnalyzer, type PhoneItem, type PhoneSample } from './analyzer'
import { fatigueOf, type FatigueResult } from './fatigue'
import { formTestOf, type FormTestResult } from './formtest'
import { PhoneLogRecorder, type PhoneLog } from './log'
import type { MountIssue } from './mount'
import type { PhoneMeasure } from './signal'
import { PracticeRun, type PracticePlan, type PracticeResult } from './practice'
import { SpeedTrack, type GpsFix } from './speed'
import { PHRASES, SAY } from '../../core/phrases'
import { Drill, type DrillOptions } from './drill'

// スマホ版の1回の走り：センサーの値を見る役と声かけのしくみに渡し、調整用の記録を取り、走り終わったら結果をまとめる
// 画面（screens/PhoneLive.tsx）から切り離して、模擬データでテストできるようにしている
//   const run = new PhoneRun({ perfMs: performance.now(), epochMs: Date.now() }, { userAgent, intervalMs: null }, 'outdoor')
//   センサーの値が来るたびに：run.feed(m)   （m.t は performance.now() の秒）
//   外（outdoor）では、位置が届くたびに：run.gps(f)   （f.t も performance.now() の秒）
//   タイマーで（値が途切れたことに気づくため）：run.tick(今)
//   戻り値の speak を声で読み上げ、tone が on ならメトロノームを run.tempo() のテンポで bars 小節鳴らし（練習では止めるまで）、off なら止める。
//   練習・テストのときは4つ目に種類（PhoneKind）を渡し、画面を開いたら run.intro() を言う
//   崩しの撮影（drill）では、タイマーで run.guide(今) も呼び、戻り値を同じように扱う。run.drill.at(今).done になったら終える。
//     途中でやめたら run.stopDrill(今)
//   state が ended なら終える
//   終えるとき：run.finish() → 結果（短すぎれば null）と記録

// 声にする項目。ブレーキ・上下動だけの声は、トレッドミルでカメラ版と比べて確かめるまで出さない（docs/phone-spec.md）。
// ほかの項目は、大きく崩れても声をかけない（しくみの muteOthers）。測って記録し、結果の画面に出すだけ。
// 付け方の確認の声（mount・loose・place）は、見る役の「一度だけかける声」なので、これとは別にかかる
export const PHONE_VOICED: PhoneItem[] = ['cadence']

// どこで走るか。outdoor：外。GPS の速さが基準から外れた秒・GPS が取れない秒は判定しない（docs/phone-spec.md 機能4）。
// treadmill：トレッドミル（実機テスト）。GPS は使わず、速さは一定とみなす
export type PhoneWhere = 'outdoor' | 'treadmill'

// 走りの種類。ふつうの走り（なし）・ピッチを上げる練習（practice.ts）・フォームのテスト（formtest.ts）
//   練習とテストでは、ピッチが落ちたときの声とメトロノームは使わない（練習はメトロノームが混ざらないように、テストは声をかけないため）。
//   ほめる言葉と声なしの見守りの言葉も言わない。付け方の確認の声と、始め・終わりの言葉は言う
// 崩しの撮影（drill.ts。トレッドミルだけ）：ふつうの走りと同じようにピッチの声・メトロノーム・付け方の確認の声を出し、
//   誘導の声を優先する（誘導の声の近くでは、ほかの声とメトロノームを待たせる）。しくみの始め・一時停止・再開・ほめる言葉・見守りの言葉は言わない
export type PhoneKind = { kind: 'practice'; plan: PracticePlan } | { kind: 'test' } | { kind: 'drill'; drill: DrillOptions }

export interface PhoneSession {
  id: string
  mode: 'phone'
  startedAt: number
  durationSec: number
  samples: PhoneSample[]
  cues: CueRecord<PhoneItem>[]
  share: Record<Category, number>
  breakdownMin?: number // 崩れ始め（分）。スマホ版では疲れの見分け（fatigue.onsetSec）から出す
  fatigue?: FatigueResult | null // 疲れの見分けと、上下動・ブレーキ・接地時間の変化。基準を作れなければ null。ないのは、入れる前の記録
  quietHeldSec: number
  ref: { cadence: number; bounceCm: number; brakingMs: number } | null // 走り始めの自分（基準）
  where?: PhoneWhere // ないのは、外とトレッドミルを分ける前の記録（速さで止めていない）
  refSpeed?: number | null // 基準の速さ（m/s）。外だけ
  refLater?: boolean // 基準を5〜12分の平均に置き換えた（false なら仮の基準：30秒〜3分）
  mount: MountIssue | null // 付け方の問題（見つけたら、その走りでは判定を止めた。ゆるいときはピッチだけ判定を続けた）
  mountAt?: number // 見つけた秒
  logId?: string
  kind?: 'practice' | 'test' | 'drill' // ないのはふつうの走り
  practice?: PracticeResult // ピッチを上げる練習の回の結果
  test?: FormTestResult // フォームのテストの値
}

// 練習とテストで言わない言葉（しくみがかける、ほめる言葉と声なしの見守りの言葉）
const QUIET_IN_SPECIAL = new Set<string>([PHRASES.phonePraise5, PHRASES.quietStart, PHRASES.phoneQuietDone])
// 崩しの撮影で言わない言葉（区間のあいだの休みで、一時停止・再開を毎回言わないように。始めは誘導が言う）
const QUIET_IN_DRILL = new Set<string>([...QUIET_IN_SPECIAL, SAY.start, SAY.pause, SAY.resume])

class PhoneCoach extends CueEngine<PhoneMeasure, PhoneSample, PhoneItem> {
  finish(a: PhoneAnalyzer): PhoneSession {
    // 崩れ始めは、しくみの点数（ピッチの崩れ）ではなく、疲れの見分けから出す（docs/phone-spec.md 機能5）
    const fatigue = fatigueOf(this.samples)
    return {
      ...this.summary(), id: `phone-${this.startedAt}`, mode: 'phone', samples: this.samples, ref: a.ref, refLater: a.refLater, mount: a.mount.issue, mountAt: a.mount.issueAt ?? undefined,
      where: a.speed ? 'outdoor' : 'treadmill', refSpeed: a.speed ? a.refSpeed : undefined,
      fatigue, breakdownMin: fatigue?.onsetSec != null ? Math.round(fatigue.onsetSec / 60) : undefined,
    }
  }
}

// 崩しの撮影：走る区間に入ってから、ピッチの声とメトロノームを出し始めるまでの秒（しくみの窓 CUE.window より長く）
const DRILL_SETTLE = 10

// 結果に残すのは、これだけ走ったときだけ（カメラ版と同じ）
const MIN_SAMPLES = 30

export class PhoneRun {
  readonly analyzer = new PhoneAnalyzer()
  // holdUnjudged：速さで判定を止めた秒には新しく知らせず、鳴らしているメトロノームも止める
  readonly coach: PhoneCoach
  readonly rec: PhoneLogRecorder
  readonly where: PhoneWhere
  readonly kind: PhoneKind['kind'] | null
  readonly practice: PracticeRun | null = null // ピッチを上げる練習のときだけ
  readonly drill: Drill | null = null // 崩しの撮影のときだけ
  private held: { e: CoachEvent; phase: number }[] = [] // 誘導の声の近くで待たせている、しくみの声とメトロノーム（どの段で出たか）
  private seen = 0
  private lastState: PhoneCoach['state']
  private refLogged = false
  private speedRefKey: string | null = null
  private lastGate: string | null = null

  constructor(clock: { perfMs: number; epochMs: number }, device: { userAgent: string; intervalMs: number | null; sim?: number }, where: PhoneWhere, kind?: PhoneKind) {
    this.where = where
    this.kind = kind?.kind ?? null
    // 練習とテストでは、どの項目でも知らせない（ピッチが落ちたときのメトロノームを鳴らさない）
    // 崩しの撮影では、ふつうの走りと同じくピッチで知らせる
    this.coach = new PhoneCoach(this.analyzer, { pause: true, items: kind && kind.kind !== 'drill' ? [] : PHONE_VOICED, muteOthers: true, holdUnjudged: true })
    this.lastState = this.coach.state
    if (kind?.kind === 'practice') this.practice = new PracticeRun(kind.plan)
    if (kind?.kind === 'drill') this.drill = new Drill(kind.drill, clock.perfMs / 1000)
    if (where === 'outdoor') this.analyzer.speed = new SpeedTrack()
    this.rec = new PhoneLogRecorder(clock, device, where)
    this.rec.event(clock.perfMs / 1000, `state:${this.coach.state}`)
    if (kind)
      this.rec.event(
        clock.perfMs / 1000,
        kind.kind === 'practice' ? `kind:practice:${kind.plan.n}:${kind.plan.base === null ? 'none' : kind.plan.base.toFixed(1)}` : kind.kind === 'drill' ? `kind:drill:${kind.drill.version}:${kind.drill.upper ? 'upper' : kind.drill.extra ? 'extra' : 'base'}` : 'kind:test',
      )
  }

  // 画面を開いたときに言う言葉（練習の1回目・テスト）
  intro(): string | null {
    if (this.kind === 'test') return PHRASES.testStart
    return this.practice?.intro() ?? null
  }

  // 位置を1つ受け取る（外のときだけ使う）
  gps(f: GpsFix) {
    const track = this.analyzer.speed
    if (!track) return
    this.rec.gps(f, track.fix(f))
  }

  // ならした速さ（m/s）。トレッドミル・GPS が取れないときは null
  speedNow(t: number): number | null {
    return this.analyzer.speed?.at(t) ?? null
  }

  feed(m: PhoneMeasure): CoachEvent[] {
    this.analyzer.feed(m)
    const ev = this.coach.update({ t: m.t, present: true, moving: this.analyzer.moving, m })
    this.rec.raw(m, this.coach.state)
    return this.after(m.t, ev)
  }

  // 値が途切れているときだけ、しくみの時間を進める（途切れたと気づかせる）
  tick(t: number): CoachEvent[] {
    if (this.analyzer.connected(t)) return []
    const ev = this.coach.update({ t, present: false, moving: false })
    return this.after(t, ev)
  }

  // メトロノームのテンポ（歩/分）。ふつうの走りでは走り始めの自分のピッチ（基準ができる前は null）。
  // 練習では練習のテンポ（鳴らしていなければ null）
  tempo(): number | null {
    if (this.practice) return this.practice.tempo()
    return this.analyzer.ref?.cadence ?? null
  }

  // 崩しの撮影：タイマーで呼ぶ。誘導の言葉と、待たせていたしくみの声・メトロノームを返し、区間の印を記録に残す
  guide(t: number): CoachEvent[] {
    if (!this.drill) return []
    const g = this.drill.advance(t)
    for (const m of g.marks) this.rec.event(m.t, m.text)
    const ev: CoachEvent[] = g.say.map((text) => ({ type: 'speak', text }))
    for (const e of ev) if (e.type === 'speak') this.rec.event(t, e.text)
    if (this.held.length && !this.drill.busy(t)) {
      // 段が変わったら、ピッチの声とメトロノームは捨てる（前の区間のことなので）。付け方の確認の声などは出す
      const cur = this.drill.at(t).index
      const out = this.held.filter((h) => h.phase === cur || (h.e.type === 'speak' && h.e.text !== PHRASES.phoneCadence)).map((h) => h.e)
      this.held = []
      for (const e of out) {
        if (e.type === 'speak') this.rec.event(t, e.text)
        if (e.type === 'tone') this.rec.event(t, e.on ? `tone:on:${e.item}:${Math.round(this.tempo() ?? 0)}` : `tone:off:${e.item}`)
      }
      ev.push(...out)
    }
    return ev
  }

  // 崩しの撮影を途中でやめた：閉じていない区間の印を閉じる
  stopDrill(t: number) {
    for (const m of this.drill?.stop() ?? []) this.rec.event(t, m)
  }

  // 言葉を記録に残す（しくみの外で話した言葉も）
  said(t: number, text: string) {
    this.rec.event(t, text)
  }

  private after(t: number, ev0: CoachEvent[]): CoachEvent[] {
    // 練習とテストでは、ほめる言葉と声なしの見守りの言葉を言わない
    const mute = this.kind === 'drill' ? QUIET_IN_DRILL : this.kind ? QUIET_IN_SPECIAL : null
    let ev = mute ? ev0.filter((e) => !(e.type === 'speak' && mute.has(e.text))) : ev0
    // 崩しの撮影：誘導の声の近くでは、しくみの声とメトロノームを鳴らし始めずに待たせる（guide で出す）。
    // 待たせている間にメトロノームを止める知らせが来たら、待たせていた分も捨てる
    if (this.drill) {
      const now: CoachEvent[] = []
      for (const e of ev) {
        if (e.type === 'tone' && !e.on && this.held.some((h) => h.e.type === 'tone' && h.e.on && h.e.item === e.item)) {
          this.held = this.held.filter((h) => !(h.e.type === 'tone' && h.e.item === e.item))
          continue
        }
        // ピッチの声とメトロノームは、走る区間に入って DRILL_SETTLE 秒たってから（しくみの窓は休みをまたぐので、
        // 前の区間のピッチで次の区間の始めに鳴らさないように）。それより前に来たものは捨てる
        const at = this.drill.at(t)
        const pitch = (e.type === 'tone' && e.on) || (e.type === 'speak' && e.text === PHRASES.phoneCadence)
        if (pitch && (at.phase.kind !== 'run' || t - this.drill.t0 - at.phase.start < DRILL_SETTLE)) continue
        if ((e.type === 'speak' || (e.type === 'tone' && e.on)) && (this.held.length || this.drill.busy(t))) this.held.push({ e, phase: at.index })
        else now.push(e)
      }
      ev = now
    }
    // 練習：走りが止まったら（一時停止・途切れ・終わり）、メトロノームを止める
    if (this.practice && this.coach.state !== 'running' && this.practice.halt()) ev.push({ type: 'tone', on: false, item: 'practice' })
    const a = this.analyzer
    if (a.refLater && !this.refLogged && a.ref) {
      this.refLogged = true
      this.rec.event(t, `ref:later:${a.ref.cadence.toFixed(1)}`)
    }
    // 基準の速さ（外だけ）。基準を置き換えたら、もう一度残す
    const speedKey = a.speed && a.ref ? `${a.refLater}:${a.refSpeed}` : null
    if (speedKey !== null && speedKey !== this.speedRefKey) {
      this.speedRefKey = speedKey
      this.rec.event(t, `ref:speed:${a.refSpeed === null ? 'none' : a.refSpeed.toFixed(2)}`)
    }
    if (this.coach.state !== this.lastState) {
      this.lastState = this.coach.state
      this.rec.event(t, `state:${this.coach.state}`)
    }
    const ss = this.coach.samples
    while (this.seen < ss.length) {
      const ls = this.analyzer.lastSecond
      const s = ss[this.seen++]
      this.rec.second(t, s, ls?.est ?? null, ls?.mount ?? null)
      // 練習：1秒ごとに、鳴らす・止める・テンポを変えるを決める
      if (this.practice) {
        const p = this.practice.second(s.t, s.cadence, this.analyzer.ref?.cadence ?? null, this.coach.state === 'running')
        if (p.say) ev.push({ type: 'speak', text: p.say })
        if (p.tone === 'on') ev.push({ type: 'tone', on: true, item: 'practice', bars: Infinity })
        if (p.tone === 'off') ev.push({ type: 'tone', on: false, item: 'practice' })
      }
      // 速さで判定を止めた・戻した（外だけ）
      const g = s.gate ?? null
      if (g !== this.lastGate) {
        this.rec.event(t, g ? `gate:on:${g}` : 'gate:off')
        this.lastGate = g
      }
    }
    for (const e of ev) {
      if (e.type === 'speak') this.rec.event(t, e.text)
      if (e.type === 'tone') this.rec.event(t, e.on ? `tone:on:${e.item}:${Math.round(this.tempo() ?? 0)}` : `tone:off:${e.item}`)
    }
    return ev
  }

  get log(): PhoneLog {
    return this.rec.log
  }

  finish(): { session: PhoneSession | null; log: PhoneLog } {
    const log = this.rec.log
    if (this.coach.samples.length < MIN_SAMPLES) return { session: null, log }
    const session = this.coach.finish(this.analyzer)
    if (this.kind) session.kind = this.kind
    if (this.practice) session.practice = this.practice.result()
    if (this.kind === 'test') session.test = formTestOf(session.samples, session.mount, this.where)
    log.fatigue = session.fatigue ?? null
    session.logId = log.id
    log.sessionId = session.id
    return { session, log }
  }
}
