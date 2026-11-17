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
//
// 答えつきの記録（version: 'lab'。テスト用のページ /lab/ から）：腰のスマホ1台で、外でもトレッドミルでも走れる並び（LAB_STEPS・labPlan）。
// 区間のあいだは止まらず、走ったまま「ふつう」に戻す（印は protocol:back）。並びと秒は下の LAB_STEPS・LAB_TIME

export type DrillVersion = 'full' | 'short' | 'lab'
export interface DrillOptions {
  version: DrillVersion
  extra: boolean // 最後に付け方の区間（ゆるい・手に持つ・ポケット）も走る（答えつきの記録では使わない）
  upper?: boolean // 上半身だけ：脚に負担のかかる区間と付け方の区間を走らない（extra より先に効く。答えつきの記録では使わない）
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
  { key: 'loose', name: 'ゆるい', how: 'ベルトをゆるめて、スマホが揺れるくらいに。ゆるいは声にせず、記録にだけ残す（線を決め直す材料）', intro: 'drillLoose', full: 60, short: 30, waist: false, expect: 'loose', extra: true },
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

// start：答えつきの記録で走り始める（ベルトを動かすの代わり）。back：答えつきの記録で、区間のあいだに走ったまま「ふつう」に戻す
export type DrillPhaseKind = 'setup' | 'jump' | 'still' | 'belt' | 'start' | 'run' | 'rest' | 'back' | 'endJump' | 'done'
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
  if (o.version === 'lab') return labSteps()
  if (o.upper) return DRILL_STEPS.filter((s) => !s.legs && !s.extra)
  return DRILL_STEPS.filter((s) => o.extra || !s.extra)
}

export function drillPlan(o: DrillOptions): { phases: DrillPhase[]; cues: DrillCue[]; total: number } {
  if (o.version === 'lab') return labPlan()
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
    add({ kind: 'run', name: s.name, how: s.how, sec: o.version === 'short' ? s.short : s.full, mark: s.key, step: s }, [PHRASES.drillGo])
  })
  add({ kind: 'endJump', name: 'その場でジャンプ', how: 'ベルトを止めて、その場で3回ジャンプ', sec: DRILL_TIME.endJump, mark: 'jump2' }, [PHRASES.drillEndJump])
  phases.push({ kind: 'done', name: '終わり', how: '録画を止めて大丈夫です', start: t, sec: 0 })
  cues.push({ at: t, say: PHRASES.drillDone }, { at: t, mark: 'protocol:done' })
  return { phases, cues, total: t }
}

// ---- 答えつきの記録（腰のスマホ1台。外でもトレッドミルでも） ----
// 主な目的は腰落ち（docs/research/phone-only-posture.md、sink.ts・sensor/waistSit.ts の WAIST_SIT）。2026-11-09 のわざとの腰落ちは11秒×2だけで、
// 線を決めるには足りなかったので、腰を落とす3段を2回ずつ、30秒ずつ走る。足を前に出しすぎる（オーバーストライド）は本人の希望で必ず入れる（2026-11-17）。
// 腰のスマホでは見えない猫背・胸を開くも、腰に出るか（と、横の iPhone で撮る回の材料）を見るため1回ずつ入れる。
// 区間のあいだは止まらず走ったまま「ふつう」に戻し、その戻しも区間の印に残す（protocol:back。前後のふつうと比べる材料。外では道や速さが少しずつ変わるため）。
// 深い腰落ちは脚に負担がかかるので、どの崩しも30秒だけにする。崩しははっきり大きく、戻しは走ったまま（本人の決め）
export const LAB_TIME = {
  setup: 45, // 腰に付ける・横の iPhone の録画を始める（言葉に13秒ほど）
  jump: 12, // その場で3回ジャンプ（横の iPhone の記録と時計を合わせる手がかり。言葉に3秒ほど）
  still: 14, // じっと立つ（10秒 ＋ 言葉3秒ほど）
  start: 20, // 走り始めて、いつもの楽な速さにする
  base: 240, // 最初のふつう。比べる相手（基準）を作る。走り始めの1分は外して見る
  sec: 30, // 崩しの区間
  back: 40, // 崩しのあと、走ったままふつうに戻す
  lead: 14, // 区間の始まりのこの秒数前に、名前とやり方を言う（いちばん長い言葉で約10秒）
  last: 60, // 最後のふつう
  endJump: 20, // 止まって、その場で3回ジャンプ
}

// 崩しの並び。腰を落とす3段は、少し → 中 → 深くの順（落とし方の幅をつかみやすいように）で2回。
// 深く落としたあとは、脚を休める区間（猫背）を1つはさむ
const LAB_ORDER = ['sitlight', 'sitmid', 'sitdeep', 'hunch', 'bouncy', 'open', 'over', 'sitlight', 'sitmid', 'sitdeep', 'bouncy', 'over'] as const
const labStep = (key: string, name: string, how: string, intro: PhraseId, legs?: true): DrillStep => ({ key, name, how, intro, full: LAB_TIME.sec, short: LAB_TIME.sec, waist: true, expect: null, ...(legs ? { legs } : {}) })
export const LAB_STEPS: DrillStep[] = [
  { key: 'normal1', name: 'ふつう', how: 'いつもの走り。比べる相手（基準）を作ります', intro: 'labStart', full: LAB_TIME.base, short: LAB_TIME.base, waist: true, expect: null },
  labStep('sitlight', '腰を少し落とす', 'ひざを少しやわらかく曲げて、腰を少しだけ低く', 'labSitLight', true),
  labStep('sitmid', '腰を落とす（中）', 'ひざをはっきり曲げて、腰を目で見て分かるくらい低く', 'labSitMid', true),
  labStep('sitdeep', '腰を深く落とす', 'ひざを深く曲げて、いすに座りかけたように腰を大きく低く', 'labSitDeep', true),
  labStep('hunch', '猫背', '背中を丸めて、肩を前に落とす', 'drillHunch'),
  labStep('bouncy', '弾む', '足の回転はそのまま、上に大きく弾んで走る', 'drillBouncy', true),
  labStep('open', '胸を開く', '胸を張って、肩を後ろに引く', 'labOpen'),
  labStep('over', '足を前に出しすぎる', '大またで、足を体よりずっと前に伸ばして、かかとから着地', 'labOver', true),
  { key: 'normal2', name: 'ふつう（最後）', how: 'いつもの走りに戻して、最後まで', intro: 'labLast', full: LAB_TIME.last, short: LAB_TIME.last, waist: true, expect: null },
]
// 区間のあいだの「ふつうに戻す」（印は protocol:back。compare.ts・採点が区間の名前に使う。走っている間の画面は大きな字で出すので、短く「ふつう」）
export const LAB_BACK = { key: 'back', name: 'ふつうに戻す', how: '走ったまま、いつもの走りに戻す' }

export function labSteps(): DrillStep[] {
  const by = (k: string) => LAB_STEPS.find((s) => s.key === k)!
  return [by('normal1'), ...LAB_ORDER.map(by), by('normal2')]
}

export function labPlan(): { phases: DrillPhase[]; cues: DrillCue[]; total: number } {
  const T = LAB_TIME
  const phases: DrillPhase[] = []
  const cues: DrillCue[] = []
  let t = 0
  const add = (p: Omit<DrillPhase, 'start'>, say: string[]) => {
    phases.push({ ...p, start: t })
    if (p.mark) cues.push({ at: t, mark: `protocol:${p.mark}:start` })
    for (const s of say) cues.push({ at: t, say: s })
    t += p.sec
    if (p.mark) cues.push({ at: t, mark: `protocol:${p.mark}:end` })
  }
  add({ kind: 'setup', name: '準備', how: 'スマホを腰のベルトにしっかり付けて立つ。横の iPhone でも撮るときは、真横から全身が映るように置いて録画を始める', sec: T.setup }, [PHRASES.labSetup])
  add({ kind: 'jump', name: 'その場でジャンプ', how: 'その場で3回ジャンプ', sec: T.jump, mark: 'jump1' }, [PHRASES.labJump])
  add({ kind: 'still', name: 'じっと立つ', how: 'そのまま10秒、じっと立つ', sec: T.still, mark: 'still' }, [PHRASES.drillStill])
  const steps = labSteps()
  steps.forEach((s, i) => {
    if (i === 0) {
      add({ kind: 'start', name: '走り始める', how: 'ゆっくり走り始めて、いつもの楽な速さに（トレッドミルはベルトを動かす）。合図から、いつもどおりに', sec: T.start }, [PHRASES[s.intro]])
      add({ kind: 'run', name: s.name, how: s.how, sec: s.full, mark: s.key, step: s }, [PHRASES.drillGo])
      return
    }
    if (s.key === 'normal2') {
      add({ kind: 'run', name: s.name, how: s.how, sec: s.full, mark: s.key, step: s }, [PHRASES[s.intro]])
      return
    }
    // 前の区間がふつう（最初の基準）でなければ、走ったままふつうに戻す区間をはさむ。名前とやり方は、区間の始まりの lead 秒前に言う
    if (steps[i - 1].key !== 'normal1') add({ kind: 'back', name: 'ふつう', how: LAB_BACK.how, sec: T.back, mark: LAB_BACK.key }, [PHRASES.labBack])
    cues.push({ at: t - T.lead, say: PHRASES[s.intro] })
    add({ kind: 'run', name: s.name, how: s.how, sec: s.full, mark: s.key, step: s }, [PHRASES.drillGo])
    cues.push({ at: t - DRILL_TIME.soon, say: PHRASES.drillSoon })
  })
  add({ kind: 'endJump', name: 'その場でジャンプ', how: '止まって、その場で3回ジャンプ', sec: T.endJump, mark: 'jump2' }, [PHRASES.labEndJump])
  phases.push({ kind: 'done', name: '終わり', how: '横の iPhone で撮っていたら、録画を止めて大丈夫です', start: t, sec: 0 })
  cues.push({ at: t, say: PHRASES.labDone }, { at: t, mark: 'protocol:done' })
  // 言葉を先に言う分（lead・残り10秒）を足したので、時刻の順に並べ直す（同じ時刻は足した順のまま：終わりの印 → 始まりの印 → 言葉）
  const order = cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.at - b.c.at || a.i - b.i)
  return { phases, cues: order.map((x) => x.c), total: t }
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

  // いまの段・残り秒・次の段（休みと、答えつきの記録の「ふつうに戻す」は飛ばして、次に走る区間）
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
    const next = this.phases.slice(i + 1).find((p) => p.kind !== 'rest' && p.kind !== 'back') ?? null
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
