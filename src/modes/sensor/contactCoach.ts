import { CueEngine, type ModeAnalyzer, type SecondOut } from '../../core/engine'
import { PHRASES } from '../../core/phrases'
import { ContactJudge, StepDetector, type ContactValues, type Step } from './contact'
import { ANKLES, CONTACT, CONTACT_BUZZ, STEP, type ContactParams } from './params'
import type { Vec3 } from './parse'

// 足首の2つのセンサーで、接地時間が長い・接地時間の左右差・足が体より前に着く（オーバーストライド）を見て、知らせる（SensorSession から使う）。
// いつ知らせるか・直ったらほめるか・だんだん減らすか・1時間の上限は、ほかの入り口と同じ声かけのしくみ（core/engine.ts の CueEngine）に任せる。
// このファイルは、その秒の値（ContactValues）を項目の値にする「見る役」と、しくみが決めた知らせを、振動（と声）に替える役だけ。
//   接地が長い（sit）：両足首を震わせる（体全体のこと。胸・頭の振動と場所で分ける）。声は「接地が長くなっています」と起きていることだけを言う
//     （腰が落ちたときだけでなく、大また・かかとからの着地でも長くなるので、「腰が落ちています」とは言わない。腰にはセンサーがない）
//   オーバーストライド：両足首を震わせる（どちらの足でも起きる。声はカメラの着地と同じ「足が体より前に着いています…」）
//   左右差：接地の長いほうの足首を震わせる
//   直った：同じ場所を短く2回（ほめる。声を出せるときは「いい感じです」「左右がそろいました」）
// 着地の衝撃の左右差は記録だけで、知らせない（付け方で値が大きく変わる。実機の4本では、どの走りでも右が 1〜3割重かった）

export type ContactKey = 'sit' | 'longL' | 'longR' | 'stride'

export interface ContactSample {
  t: number
  v: ContactValues | null
}

// 項目の値：sit は「その速さの市民ランナーの平均から、標準偏差いくつぶん上か」、longL・longR は、その足が長い左右差（%）、
// stride は、同じ速さの走り出しからピッチが何 % 落ちたか（overHold 秒ずっと落ちていたときの、いちばん小さい値。続いていなければ、線より下の今の値だけ）
export function contactValues(m: ContactValues | null): Partial<Record<ContactKey, number>> {
  if (!m) return {}
  const out: Partial<Record<ContactKey, number>> = { sit: m.z }
  if (Number.isFinite(m.ctSi) && !m.mountDiff) {
    out.longL = Math.max(0, -m.ctSi)
    out.longR = Math.max(0, m.ctSi)
  }
  if (Number.isFinite(m.cadDropHeld)) out.stride = Math.max(0, m.cadDropHeld)
  else if (Number.isFinite(m.cadDrop) && m.cadDrop <= CONTACT.overDrop) out.stride = Math.max(0, m.cadDrop)
  // 速さ（接地の割合と左右差はピッチも）が変わっている間は、線より下の値だけ渡す（知らせはしないが、知らせたあとに戻ったか＝ほめるかは見る）
  const limit: Record<ContactKey, number> = { sit: CONTACT.z, longL: CONTACT.si, longR: CONTACT.si, stride: CONTACT.overDrop }
  for (const k of Object.keys(out) as ContactKey[]) {
    const ok = k === 'stride' ? m.steadyV : m.steady
    if (!ok && !(out[k]! <= limit[k])) delete out[k]
  }
  return out
}

export class ContactAnalyzer implements ModeAnalyzer<ContactValues | null, ContactSample, ContactKey> {
  items
  constructor(c: ContactParams = CONTACT) {
    // 満点は「平均 + 1標準偏差まで」（市民ランナーの約8割）、0点は線の 1.5 標準偏差上。直ったかの線は、そのあいだの真ん中（engine.ts）
    this.items = [
      { key: 'sit' as const, limits: { full: 1, cue: c.z, zero: c.z + 1.5 }, cue: PHRASES.cueContactLong },
      { key: 'longL' as const, limits: { full: c.si / 3, cue: c.si, zero: c.si * 2 }, cue: PHRASES.cueLongL },
      { key: 'longR' as const, limits: { full: c.si / 3, cue: c.si, zero: c.si * 2 }, cue: PHRASES.cueLongR },
      { key: 'stride' as const, limits: { full: c.overDrop / 3, cue: c.overDrop, zero: c.overDrop * 2 }, cue: PHRASES.cueLanding },
    ]
  }
  second(bucket: (ContactValues | null)[], t: number): SecondOut<ContactSample, ContactKey> {
    const m = bucket.length ? bucket[bucket.length - 1] : null
    const values = contactValues(m)
    return { sample: { t, v: m }, values, ready: Object.keys(values).length > 0 }
  }
}

// しくみが決めた知らせ（場所・回数・長さ。声を出せるときの言葉）
export interface ContactCue {
  kind: 'cue' | 'praise'
  item: ContactKey
  places: string[]
  count: number
  ms: number
  text: string
  value?: number
}

export class ContactCoach {
  readonly det = { L: new StepDetector(STEP), R: new StepDetector(STEP) }
  readonly judge = new ContactJudge(CONTACT)
  readonly engine = new CueEngine(new ContactAnalyzer(CONTACT), { pause: true, holdUnjudged: true })
  private seen = 0 // しくみの cues のうち、もう知らせ終えた件数
  private lastItem: ContactKey | null = null
  private runSince: number | null = null
  private stopSince: number | null = null
  private lastStep = { L: -Infinity, R: -Infinity } // 足ごとの、最後に1歩が決まった時刻（t の時計）
  last: ContactValues | null = null
  steps: { side: 'L' | 'R'; t: number; s: Step }[] = [] // 新しく決まった1歩（記録用。呼ぶ側が取り出す）

  // 足首の値。side：左右、t：同じ時計の秒（カメラ版は performance.now() の秒）、sensorT：センサーの時計の秒（1歩の長さはこちらで測る）
  sample(side: 'L' | 'R', t: number, sensorT: number, g: Vec3, a: Vec3) {
    const d = this.det[side]
    d.sample(sensorT, g, a)
    for (const s of d.steps()) this.addStep(side, t, s)
  }

  // 決まった1歩を入れる（テストでは1歩を直接入れる）。1歩はセンサーの時計で決まるので、判定に入れる時刻だけ、今の t に読み替える
  addStep(side: 'L' | 'R', t: number, s: Step) {
    this.judge.add(side, s)
    this.lastStep[side] = t
    this.steps.push({ side, t, s })
  }

  // tick ごと。running：走っているか（カメラ版はカメラの「走っている」）。返すのは、いま知らせること（なければ空）
  tick(t: number, running: boolean): ContactCue[] {
    this.det.L.running = running
    this.det.R.running = running
    // 「走っている」は1コマずつで決まるので、短く途切れることがある。stopReset 秒より長く止まったときだけ、ためた1歩を捨てて走り出しからやり直す
    if (running) {
      this.runSince ??= t
      this.stopSince = null
    } else {
      this.stopSince ??= t
      if (t - this.stopSince >= CONTACT.stopReset) {
        this.runSince = null
        this.judge.clear()
      }
    }
    const fresh = { L: t - this.lastStep.L < CONTACT.stale, R: t - this.lastStep.R < CONTACT.stale }
    // 走り出してすぐ（warmup 秒）は、ためるだけで判定しない（歩きから走りへ、速さを上げている間）
    const warm = this.runSince !== null && t - this.runSince >= CONTACT.warmup
    this.last = warm ? this.judge.values(t, fresh) : null
    const moving = this.runSince !== null && (fresh.L || fresh.R)
    this.engine.update({ t, present: true, moving, m: this.last })
    const out: ContactCue[] = []
    for (; this.seen < this.engine.cues.length; this.seen++) {
      const c = this.engine.cues[this.seen]
      if (c.item === 'sit' || c.item === 'longL' || c.item === 'longR' || c.item === 'stride') {
        this.lastItem = c.item
        out.push({ kind: 'cue', item: c.item, places: placesOf(c.item), count: CONTACT_BUZZ.cueCount, ms: CONTACT_BUZZ.cueMs, text: c.text, value: valueOf(this.last, c.item) })
      } else if (c.item === 'recover' && this.lastItem) {
        const item = this.lastItem
        out.push({ kind: 'praise', item, places: placesOf(item), count: CONTACT_BUZZ.praiseCount, ms: CONTACT_BUZZ.praiseMs, text: item === 'longL' || item === 'longR' ? PHRASES.recoverEven : c.text })
      }
      // praise（5分きれい・声なしの見守り）は、カメラのしくみが自分で言うので、ここでは知らせない
    }
    return out
  }
}

const placesOf = (item: ContactKey) => (item === 'longL' ? [ANKLES.L] : item === 'longR' ? [ANKLES.R] : [ANKLES.L, ANKLES.R])
const valueOf = (m: ContactValues | null, item: ContactKey) => (m ? (item === 'sit' ? m.z : item === 'stride' ? m.cadDropHeld : Math.abs(m.ctSi)) : undefined)
