import { PHRASES, type PhraseId } from '../../core/phrases'
import type { MountIssue } from './mount'

// 崩しの撮影（声で指示）。トレッドミルで、わざと崩した走りを順に走ってもらい、スマホ版の記録を取る。
// 横の iPhone で全身を録画し、あとでカメラ版（「動画で試す」・スロー分析）にかける前提なので、やり方は横から見える形で言う
// （腰のスマホでは見えない頭・目線・腕の崩しも入れる）。脚に負担の少ない上半身の崩しを先に、脚に負担のかかる崩しを後に並べ、
// 「上半身だけ」を選ぶと上半身の崩しだけ走って終える。
// 左右の差（片脚をかばう走り）は入れない。わざとかばって走るのは、けがにつながりやすいため。
// 区間の前に名前とやり方を声で言い、合図で始め、残り10秒で知らせ、終わったらベルトのふちに立って休んでもらう。
// 区間の始まりと終わりは、記録の events に protocol:<区間の key>:start / end で残す（compare.ts がこれで区間を決める）。
// 走る前・走ったあとのジャンプと、じっと立つ間も protocol:jump1・still・jump2 で残す（2台の時刻を合わせる手がかり）。
// 時刻→いまの区間・声を出す時刻は、ここだけで決める（画面と切り離してテストする）。
//   const d = new Drill({ version: 'full', extra: true, upper: false }, 始めた時刻)
//   タイマーで：d.advance(今) → 言う言葉（say）と記録に残す印（marks、予定の時刻つき）。done になったら終える
//   画面：d.at(今) → いまの段・残り秒・次の段
//   途中でやめたとき：d.stop(今) → 閉じていない区間の end と protocol:stopped

export type DrillVersion = 'full' | 'short'
export interface DrillOptions {
  version: DrillVersion
  extra: boolean // 最後に付け方の区間（ゆるい・手に持つ・ポケット）も走る
  upper?: boolean // 上半身だけ：脚に負担のかかる区間と付け方の区間を走らない（extra より先に効く）
}

// 走る区間。key は compare.ts の区間の名前（TEST1 と同じものは同じ key）。秒はふつう版と短い版
export interface DrillStep {
  key: string
  name: string
  how: string // 画面に出すやり方
  intro: PhraseId // 区間の前に言う、名前とやり方
  full: number
  short: number
  waist: boolean // 腰にしっかり付けている
  expect: MountIssue | null // 付け方の確認がこうなるべき（null：鳴らない）
  extra?: true // 付け方の区間（選んだときだけ）
  legs?: true // 脚に負担のかかる崩し（上半身だけのときは走らない）
}

export const DRILL_STEPS: DrillStep[] = [
  { key: 'normal1', name: 'ふつう', how: 'いつもの走り。走り始めの自分（基準）を作ります', intro: 'drillBelt', full: 360, short: 300, waist: true, expect: null },
  { key: 'head', name: '頭を前に', how: 'あごを突き出して、頭を肩より前に', intro: 'drillHead', full: 60, short: 30, waist: true, expect: null },
  { key: 'down', name: '下を向く', how: '頭は前に出さずに、目線を足もとに落とす', intro: 'drillDown', full: 60, short: 30, waist: true, expect: null },
  { key: 'hunch', name: '猫背', how: '背中を丸めて、肩を前に落とす', intro: 'drillHunch', full: 60, short: 30, waist: true, expect: null },
  { key: 'lean', name: '体ごと前に', how: '背中はまっすぐのまま、足首から前に倒す', intro: 'drillLean', full: 60, short: 30, waist: true, expect: null },
  { key: 'armstill', name: '腕を振らない', how: '肘を体の横で固めて、腕をほとんど振らない', intro: 'drillArmStill', full: 60, short: 30, waist: true, expect: null },
  { key: 'armcross', name: '腕を横に振る', how: '腕を前後に振らずに、体の前で左右に振る', intro: 'drillArmCross', full: 60, short: 30, waist: true, expect: null },
  { key: 'sit', name: '腰を落とす', how: 'ひざを曲げて、いすに座りかけたように腰を低く', intro: 'drillSit', full: 60, short: 30, waist: true, expect: null, legs: true },
  { key: 'slow', name: 'ピッチを落とす', how: '速さはそのまま、大またで足の回転をゆっくり。ピッチの声やメトロノームが鳴っても続ける', intro: 'drillSlow', full: 120, short: 60, waist: true, expect: null, legs: true },
  { key: 'bouncy', name: '弾む', how: '足の回転はそのまま、上に弾んで走る', intro: 'drillBouncy', full: 60, short: 30, waist: true, expect: null, legs: true },
  { key: 'heel', name: 'かかとから前に', how: '足を体の前に伸ばして、かかとから着地', intro: 'drillHeel', full: 60, short: 30, waist: true, expect: null, legs: true },
  { key: 'flat', name: 'べた足', how: '足の裏全体で、ぺたっと着地', intro: 'drillFlat', full: 60, short: 30, waist: true, expect: null, legs: true },
  { key: 'normal2', name: 'ふつう（戻す）', how: 'いつもの走りに戻す', intro: 'drillNormal', full: 120, short: 60, waist: true, expect: null },
  { key: 'loose', name: 'ゆるい', how: 'ベルトをゆるめて、スマホが揺れるくらいに。付け方の確認の声が鳴っても続ける', intro: 'drillLoose', full: 60, short: 30, waist: false, expect: 'loose', extra: true },
  { key: 'hand', name: '手に持つ', how: 'スマホを手に持って、いつもどおり腕を振って走る', intro: 'drillHand', full: 60, short: 30, waist: false, expect: 'notWaist', extra: true },
  { key: 'pocket', name: 'ポケット', how: 'スマホをパンツの前のポケットに入れて走る', intro: 'drillPocket', full: 60, short: 30, waist: false, expect: 'notWaist', extra: true },
]

// 走る前・あとの段の長さ（秒）
export const DRILL_TIME = {
  setup: 60, // 腰に付けて、横の iPhone の録画を始めて、ベルトに立つ（言葉に15秒ほど）
  jump: 12, // ベルトを止めたまま、その場で3回ジャンプ（言葉に4秒ほど）
  still: 14, // じっと立つ（10秒 ＋ 言葉3秒ほど）
  belt: 20, // ベルトを動かして、いつもの速さにする
  rest: 15, // 区間のあいだ、カメラに映るままベルトのふちに立って休む。「休みます」と次の区間のやり方を言い終える長さ
  restMount: 30, // 付け方を変える区間の前の休み（付け替える時間）
  endJump: 20, // ベルトを止めて、その場で3回ジャンプ
  soon: 10, // 区間の終わりの、この秒数前に知らせる
}

export type DrillPhaseKind = 'setup' | 'jump' | 'still' | 'belt' | 'run' | 'rest' | 'endJump' | 'done'
export interface DrillPhase {
  kind: DrillPhaseKind
  name: string
  how: string
  start: number // 始めてからの秒
  sec: number
  mark?: string // 記録に残す区間の key（protocol:<mark>:start / end）
  step?: DrillStep // 走る区間のとき
}
export interface DrillCue {
  at: number // 始めてからの秒
  say?: string
  mark?: string // protocol:… の印
}

// 印の key のうち、走る区間でないもの（compare.ts は区間に入れない）
export const DRILL_PREP_MARKS = ['jump1', 'still', 'jump2']

export function drillSteps(o: DrillOptions): DrillStep[] {
  if (o.upper) return DRILL_STEPS.filter((s) => !s.legs && !s.extra)
  return DRILL_STEPS.filter((s) => o.extra || !s.extra)
}

export function drillPlan(o: DrillOptions): { phases: DrillPhase[]; cues: DrillCue[]; total: number } {
  const phases: DrillPhase[] = []
  const cues: DrillCue[] = []
  let t = 0
  const add = (p: Omit<DrillPhase, 'start'>, say: string[]) => {
    phases.push({ ...p, start: t })
    if (p.mark) cues.push({ at: t, mark: `protocol:${p.mark}:start` })
    for (const s of say) cues.push({ at: t, say: s })
    if (p.kind === 'run' && p.sec > DRILL_TIME.soon + 5) cues.push({ at: t + p.sec - DRILL_TIME.soon, say: PHRASES.drillSoon })
    t += p.sec
    if (p.mark) cues.push({ at: t, mark: `protocol:${p.mark}:end` })
  }
  add({ kind: 'setup', name: '準備', how: 'スマホを腰のベルトにしっかり付け、横の iPhone で録画を始めてから、ベルトの上に立つ。iPhone は真横から全身が映るように', sec: DRILL_TIME.setup }, [PHRASES.drillSetup])
  add({ kind: 'jump', name: 'その場でジャンプ', how: 'ベルトを止めたまま、その場で3回ジャンプ', sec: DRILL_TIME.jump, mark: 'jump1' }, [PHRASES.drillJump])
  add({ kind: 'still', name: 'じっと立つ', how: 'そのまま10秒、じっと立つ', sec: DRILL_TIME.still, mark: 'still' }, [PHRASES.drillStill])
  drillSteps(o).forEach((s, i) => {
    if (i === 0) add({ kind: 'belt', name: 'ベルトを動かす', how: 'ベルトを動かして、いつもの速さに。合図で走り始める', sec: DRILL_TIME.belt }, [PHRASES[s.intro]])
    else add({ kind: 'rest', name: '休み', how: s.extra ? 'ふちに立って休む。次の付け方に変える（ベルトを止めてよい）' : 'カメラに映る場所で、ベルトのふちに立って休む', sec: s.extra ? DRILL_TIME.restMount : DRILL_TIME.rest }, [PHRASES.drillRest, PHRASES[s.intro]])
    add({ kind: 'run', name: s.name, how: s.how, sec: s[o.version], mark: s.key, step: s }, [PHRASES.drillGo])
  })
  add({ kind: 'endJump', name: 'その場でジャンプ', how: 'ベルトを止めて、その場で3回ジャンプ', sec: DRILL_TIME.endJump, mark: 'jump2' }, [PHRASES.drillEndJump])
  phases.push({ kind: 'done', name: '終わり', how: '録画を止めて大丈夫です', start: t, sec: 0 })
  cues.push({ at: t, say: PHRASES.drillDone }, { at: t, mark: 'protocol:done' })
  return { phases, cues, total: t }
}

export class Drill {
  readonly options: DrillOptions
  readonly phases: DrillPhase[]
  readonly cues: DrillCue[]
  readonly total: number
  readonly t0: number
  private nextCue = 0
  private stopped = false

  constructor(o: DrillOptions, t0: number) {
    this.options = o
    const p = drillPlan(o)
    this.phases = p.phases
    this.cues = p.cues
    this.total = p.total
    this.t0 = t0
  }

  // いまの段・残り秒・次の段（休みは飛ばして、次に走る区間）
  at(t: number): { index: number; phase: DrillPhase; remaining: number; next: DrillPhase | null; done: boolean } {
    const e = t - this.t0
    let i = this.phases.length - 1
    for (let k = 0; k < this.phases.length; k++) {
      const p = this.phases[k]
      if (e < p.start + p.sec) {
        i = k
        break
      }
    }
    const phase = this.phases[i]
    const next = this.phases.slice(i + 1).find((p) => p.kind !== 'rest') ?? null
    return { index: i, phase, remaining: Math.max(0, phase.start + phase.sec - e), next, done: phase.kind === 'done' }
  }

  // 前に呼んだときから今までに来た言葉と印。印は予定の時刻（t0 と同じ時計）つき
  advance(t: number): { say: string[]; marks: { t: number; text: string }[]; done: boolean } {
    const say: string[] = []
    const marks: { t: number; text: string }[] = []
    if (this.stopped) return { say, marks, done: true }
    const e = t - this.t0
    while (this.nextCue < this.cues.length && this.cues[this.nextCue].at <= e) {
      const c = this.cues[this.nextCue++]
      if (c.say) say.push(c.say)
      if (c.mark) marks.push({ t: this.t0 + c.at, text: c.mark })
    }
    return { say, marks, done: this.nextCue >= this.cues.length }
  }

  // 誘導の声がこの近くにあるか（ないときだけ、ピッチの声や付け方の確認の声を出す）。
  // 誘導の声の前 before 秒・後 after 秒は、ほかの声を待たせる
  busy(t: number, before = 6, after = 3): boolean {
    const e = t - this.t0
    return this.cues.some((c) => c.say && c.at >= e - after && c.at <= e + before)
  }

  // 途中でやめた：始まっていて閉じていない印を閉じる（記録に残すのは呼んだ側。時刻はやめた時刻）
  stop(): string[] {
    if (this.stopped) return []
    this.stopped = true
    const open = new Set<string>()
    for (const c of this.cues.slice(0, this.nextCue)) {
      const m = c.mark?.match(/^protocol:(.+):(start|end)$/)
      if (!m) continue
      if (m[2] === 'start') open.add(m[1])
      else open.delete(m[1])
    }
    if (this.nextCue >= this.cues.length) return []
    return [...[...open].map((k) => `protocol:${k}:end`), 'protocol:stopped']
  }
}
