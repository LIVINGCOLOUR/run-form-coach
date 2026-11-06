import type { Frame } from '../../core/types'
import { ABSENCE } from '../../core/params'
import { HEAD_POINTS, L } from './landmarks'
import { bodyVisible } from './motion'
import { FRAME_SAY } from './params'

// 体がカメラの画面にどう収まっているか（置き方の画面と、走り出すのを待つ間に、何が足りないかを短く出すため）
//   ok：全身が入っている / none：体が映っていない / head：頭が切れている / feet：足が切れている /
//   both：頭と足の両方が切れている / hidden：端は切れていないが、体の一部（膝など）が見えていない・小さすぎる
// 見るのは、傾きを直す前の骨格の点（画面に映ったままの位置）
export type Framing = 'ok' | 'none' | 'head' | 'feet' | 'both' | 'hidden'

// 頭・足が「切れている」とみる、画面の上・下のふち（画面の高さに対する割合）。置き方の案内（Live.tsx の guide）と同じ
export const EDGE = { top: 0.04, bottom: 0.98 }

const MIN_V = 0.5

export function framing(frame: Frame | null, h: number): Framing {
  if (!frame) return 'none'
  const seen = (i: number) => frame[i].v >= MIN_V
  // 肩も腰も見えていなければ、人として映っていない
  if (!(seen(L.leftShoulder) || seen(L.rightShoulder)) && !(seen(L.leftHip) || seen(L.rightHip))) return 'none'
  // 頭：頭の点がどれも見えていない、または鼻が画面の上のふちより上
  const head = !HEAD_POINTS.some(seen) || frame[L.nose].y < h * EDGE.top
  // 足：両方の足首が見えていない、または見えている側の足首（かかと）が画面の下のふちより下
  const ankles = [L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel].filter(seen)
  const feet = !(seen(L.leftAnkle) || seen(L.rightAnkle)) || Math.max(...ankles.map((i) => frame[i].y)) > h * EDGE.bottom
  if (head && feet) return 'both'
  if (head) return 'head'
  if (feet) return 'feet'
  return bodyVisible(frame, MIN_V, h) ? 'ok' : 'hidden'
}

// 画面に出す短い言葉（声の言葉は Live.tsx の FRAME_PHRASE・SETUP_PHRASE）
export const FRAMING_TEXT: Record<Framing, string> = {
  ok: '全身が入っています',
  none: '体が映っていません',
  head: '頭が切れています',
  feet: '足が切れています',
  both: '頭と足が切れています',
  hidden: '体の一部が見えていません',
}

// 1コマずつの判定はゆれるので、直近の窓でならす。窓のコマの半分以上が ok なら ok、
// そうでなければ ok 以外でいちばん多かったもの。窓にコマがなければ none
export class FramingWindow {
  private hist: { t: number; f: Framing }[] = []
  private readonly sec: number
  constructor(sec: number) {
    this.sec = sec
  }

  push(t: number, f: Framing) {
    this.hist.push({ t, f })
    while (this.hist.length && t - this.hist[0].t > this.sec) this.hist.shift()
  }

  // 直近の窓で、ok だったコマの割合
  get okRatio() {
    return this.hist.length ? this.hist.filter((x) => x.f === 'ok').length / this.hist.length : 0
  }
  // 骨格を取ったコマの、毎秒の数（窓が埋まるまでは小さく出る）
  get fps() {
    return this.hist.length / this.sec
  }

  current(): Framing {
    if (!this.hist.length) return 'none'
    if (this.okRatio >= 0.5) return 'ok'
    const n = new Map<Framing, number>()
    for (const x of this.hist) if (x.f !== 'ok') n.set(x.f, (n.get(x.f) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
}

// 人の体の形らしいか（「全身が入りました」と言う前の確かめ。数字の根拠は params.ts の FRAME_SAY）。
//   脚の高さ（腰の中心 → 低いほうの足首）÷ 体幹（肩の中心 → 腰の中心）が人の範囲にあるか
export function humanShape(frame: Frame): boolean {
  const mid = (a: number, b: number) => ({ x: (frame[a].x + frame[b].x) / 2, y: (frame[a].y + frame[b].y) / 2 })
  const s = mid(L.leftShoulder, L.rightShoulder)
  const hip = mid(L.leftHip, L.rightHip)
  const trunk = Math.hypot(s.x - hip.x, s.y - hip.y)
  if (!(trunk > 0)) return false
  const r = (Math.max(frame[L.leftAnkle].y, frame[L.rightAnkle].y) - hip.y) / trunk
  return r >= FRAME_SAY.legTrunk.min && r <= FRAME_SAY.legTrunk.max
}

// 頭から足までの高さ（画面の点のまま）
const spanOf = (frame: Frame) => Math.max(frame[L.leftAnkle].y, frame[L.rightAnkle].y) - frame[L.nose].y

// いまどの場面か。声の言葉と、どれだけ続いたら言うか・言い直すかが変わる
//   setup：置く間 / pose：2つの立ち方 / wait：走り出すのを待つ間 / run：走っている間
export type FramePhase = 'setup' | 'pose' | 'wait' | 'run'

// 映り方が変わったら声で言うための見張り（数字は params.ts の FRAME_SAY）。
// 骨格を取ったコマごとに push し、言うことがあれば due() が返す。言ったら said() で知らせる（ほかのしくみが言ったときも）。
//   stable：確かめた映り方。ok は「全身が入った」を確かめたとき（okNow）、ok 以外は、ok 以外のコマが hold 秒続いたとき
//   ok 以外のどれか（足・頭・両方・一部・映っていない）は、その間でいちばん多かったもの
export class FramingVoice {
  phase: FramePhase = 'setup'
  stable: Framing = 'none' // 確かめるまでは none（known が false の間は、言わない）
  known = false
  okNow = false // いまのコマまで、全身が入って人らしいのが okHold 秒続いている
  lastSaid: { f: Framing; t: number } | null = null
  private lastSayAt = -1e9
  private lastT = -1e9
  private okRun: { t: number; span: number }[] = [] // 続けて全身だったコマ
  private offRun: { t: number; f: Framing }[] = [] // 続けて ok 以外だったコマ

  private hold() {
    return this.phase === 'run' ? ABSENCE.lostSay : FRAME_SAY.hold
  }
  private repeat() {
    return this.phase === 'run' ? FRAME_SAY.repeatRun : FRAME_SAY.repeat
  }

  // f：そのコマの映り方（framing()）。frame：画面に映ったままの点（なければ null）
  push(t: number, f: Framing, frame: Frame | null) {
    if (t - this.lastT > FRAME_SAY.maxGap) {
      this.okRun = []
      this.offRun = []
    }
    this.lastT = t
    // 全身が入っていても、人の体の形から外れていれば「一部が見えていない」とみる
    const g: Framing = f === 'ok' && frame && !humanShape(frame) ? 'hidden' : f
    if (g === 'ok' && frame) {
      this.offRun = []
      this.okRun.push({ t, span: spanOf(frame) })
      while (this.okRun.length > 1 && t - this.okRun[1].t >= FRAME_SAY.okHold) this.okRun.shift()
      const spans = this.okRun.map((x) => x.span)
      this.okNow =
        t - this.okRun[0].t >= FRAME_SAY.okHold * 0.95 && this.okRun.length >= FRAME_SAY.okFrames && Math.max(...spans) <= Math.min(...spans) * FRAME_SAY.spanJump
      if (this.okNow) {
        this.stable = 'ok'
        this.known = true
      }
    } else {
      this.okRun = []
      this.okNow = false
      this.offRun.push({ t, f: g })
      if (this.offRun.length >= 2 && t - this.offRun[0].t >= this.hold()) {
        // 直近 hold 秒でいちばん多かったもの
        const n = new Map<Framing, number>()
        for (const x of this.offRun) if (t - x.t <= this.hold()) n.set(x.f, (n.get(x.f) ?? 0) + 1)
        this.stable = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
        this.known = true
      }
    }
  }

  // 同じ映り方を、直近 within 秒に言ったか
  saidRecently(f: Framing, t: number, within = this.repeat()) {
    return !!this.lastSaid && this.lastSaid.f === f && t - this.lastSaid.t < within
  }

  // いま言うこと（なければ null）。
  //   全身（ok）は、その前に切れていると言ったときだけ（「また全身が入った」）。
  //   ok 以外は、言った映り方から変わったとき、または同じでも repeat 秒たったとき。どれも、前の映り方の声から gap 秒あける
  due(t: number): Framing | null {
    if (!this.known || t - this.lastSayAt < FRAME_SAY.gap) return null
    if (this.stable === 'ok') return this.lastSaid && this.lastSaid.f !== 'ok' ? 'ok' : null
    if (this.saidRecently(this.stable, t)) return null
    return this.stable
  }

  said(f: Framing, t: number) {
    this.lastSaid = { f, t }
    this.lastSayAt = t
  }
}
