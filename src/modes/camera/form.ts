import type { LeadSay } from '../../core/engine'
import { CUE as CUE_P } from '../../core/params'
import { CUE, FORM_SAY } from '../../core/phrases'
import type { FormGroup, FormResult, ItemKey } from '../../core/types'
import { FORM, LIMITS } from './params'

// 正しいフォームへ整える（カメラ版）。走り出したら、まず正しいフォームの線（params.ts の FORM）と比べ、
// 外れている項目を1つずつ、何が起きているか＋どう直すかの言葉（phrases.ts の cue…）で知らせる。
// 線の内側に入って保てたら「いいですね。その形です。」と伝えて、次の項目へ進む。全部そろったら「姿勢が整いました」
// （最初からそろっていれば「姿勢は整っています」）。そこまでは、しくみ（engine.ts）は自分では声をかけない（hold）。
// 同じ項目で知らせるのは、ふつうの間（CUE.cooldown）で FORM.tries 回まで。それでも入らなければ、その走りでは
// しつこく言わず、FORM.later 秒に1回だけにする（結果の画面には出す）。整えたあとも、線は走り終わるまで見続ける
// 今日の基準（基準からの崩れを見るもの）は、この線の内側にいた秒だけで作る（coach.ts の CameraAnalyzer）

// 直す順：体全体 → 上体 → 頭。体全体（足首から）の傾きを変えると、上体の傾きも同じだけ変わり（体ごと回るため）、
// 上体を変えると体全体はその半分ほど変わる（研究データ Van Hooren 2024：上体 +7.5° で体全体 +4.0°）。
// 頭（首の角度＝頭の位置 − 上体の傾き）は上体に左右される。大きなところから直し、変わったあとの形で次を見る
export const FORM_ORDER: FormGroup[] = ['body', 'trunk', 'head']

export interface FormValues {
  trunk: number
  body: number
  neck: number
  headLean: number
}

// 線からどちら側に、どれだけ外れているか（over が正なら外れている。内側なら負で、近いほうの線までの距離）
export function formOver(g: FormGroup, v: FormValues): { key: ItemKey; over: number } {
  if (g === 'body') {
    const fwd = v.body - FORM.body.max
    const back = FORM.body.min - v.body
    return fwd >= back ? { key: 'body', over: fwd } : { key: 'bodyBack', over: back }
  }
  if (g === 'trunk') {
    const fwd = v.trunk - FORM.trunk.max
    const back = FORM.trunk.min - v.trunk
    return fwd >= back ? { key: 'trunk', over: fwd } : { key: 'trunkBack', over: back }
  }
  // 頭は、首の角度と頭の位置そのものの両方が線を越えたときだけ（小さいほうで見る）
  return { key: 'head', over: Math.min(v.neck - FORM.head.neck, v.headLean - FORM.head.headLean) }
}

// 外れた量を、点数の目盛り（LIMITS）に直す。線の内側 margin までは満点、線で声をかける線（cue）、線の外 span で0点
export function formScale(g: FormGroup, key: ItemKey, over: number): number {
  const lim = LIMITS[key]
  const m = FORM[g].margin
  if (over <= -m) return lim.full - (-over - m)
  if (over <= 0) return lim.full + ((over + m) / m) * (lim.cue - lim.full)
  return lim.cue + (over / FORM[g].span) * (lim.zero - lim.cue)
}

// 正しいフォームの範囲（画面に出す。頭は首の角度の上の線）
export function formRange(g: FormGroup): { min?: number; max: number } {
  if (g === 'body') return { min: FORM.body.min, max: FORM.body.max }
  if (g === 'trunk') return { min: FORM.trunk.min, max: FORM.trunk.max }
  return { max: FORM.head.neck }
}

// その秒の値の範囲に寄せる（線の内側にいた秒が足りない項目の基準）
export function clampInside(g: FormGroup, v: FormValues): FormValues {
  const c = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
  return {
    trunk: g === 'trunk' ? c(v.trunk, FORM.trunk.min, FORM.trunk.max) : v.trunk,
    body: g === 'body' ? c(v.body, FORM.body.min, FORM.body.max) : v.body,
    neck: g === 'head' ? Math.min(v.neck, FORM.head.neck) : v.neck,
    headLean: g === 'head' ? Math.min(v.headLean, FORM.head.headLean) : v.headLean,
  }
}

interface Sec {
  t: number
  v: FormValues
  yaw: number
}

interface GroupState {
  cues: number // この走りで、正しいフォームの線で知らせた回数
  lastCue: number // 前に知らせた時刻（しくみの秒）
  waiting: boolean // 知らせて、直るのを待っている（CUE.cooldown まで）
  fixed: boolean // 知らせたあと、線の内側に入った
  inSince: number | null // 窓の平均が線の内側に続いている、始まりの時刻（外れていれば null）
  okUntil: number // 直ったと伝えてから、窓が直ったあとの値に入れ替わるまで（この時刻まで）は、内側とみなす
  windows: number // 線と比べた窓の平均の数
  insideWindows: number // そのうち内側だった数
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export class FormStage {
  private secs: Sec[] = []
  private all: Sec[] = [] // 走っていた秒のすべて（結果の平均に使う）
  private st: Record<FormGroup, GroupState>
  doneAt: number | null = null // 整え終わった時刻（しくみの秒）
  cued = false // 整える間に声をかけたか
  private ackAt = -1e9 // 直ったと伝えた時刻

  constructor() {
    const s = (): GroupState => ({ cues: 0, lastCue: -1e9, waiting: false, fixed: false, inSince: null, okUntil: -1e9, windows: 0, insideWindows: 0 })
    this.st = { body: s(), trunk: s(), head: s() }
  }

  // 直近 sec 秒（しくみの秒で数える）の平均。値のある秒が need より少なければ null（ふつうは窓の FORM.coverage）
  private avg(t: number, sec: number, after = -1e9, need = Math.ceil(sec * FORM.coverage)): (FormValues & { yaw: number }) | null {
    const xs = this.secs.filter((x) => x.t > t - sec && x.t <= t && x.t > after)
    if (!xs.length || xs.length < need) return null
    return {
      trunk: mean(xs.map((x) => x.v.trunk)),
      body: mean(xs.map((x) => x.v.body)),
      neck: mean(xs.map((x) => x.v.neck)),
      headLean: mean(xs.map((x) => x.v.headLean)),
      yaw: mean(xs.map((x) => x.yaw)),
    }
  }

  // 線と比べられるか（頭は、斜めから撮っているように見えるときは比べない：params.ts の FORM.head.yawMax）
  static judgeable(g: FormGroup, yaw: number): boolean {
    return g !== 'head' || yaw <= FORM.head.yawMax
  }

  // 直近 FORM.hold 秒の平均が、線の内側か（今日の基準にためる秒を選ぶ。頭も斜めかどうかは見ない）
  holdInside(t: number): Record<FormGroup, boolean> | null {
    const h = this.avg(t, FORM.hold)
    if (!h) return null
    return { body: formOver('body', h).over <= 0, trunk: formOver('trunk', h).over <= 0, head: formOver('head', h).over <= 0 }
  }

  // 知らせて、直るのを待っている項目
  waiting(g: FormGroup) {
    return this.st[g].waiting
  }

  // 線と比べたことがある項目（頭は、ずっと斜めから撮っているように見えたら比べていない）
  judged(g: FormGroup) {
    return this.st[g].windows > 0
  }

  // 細かく見たほうがよいか：直るのを待っている項目か、線を越えていて、もうすぐ知らせる項目がある。
  // 間引いて見ている間は窓の秒がそろわないので、見えた秒だけの平均で見る（そろうまで待つと、ずっと間引いたままになる）。
  // 知らせるのを FORM.later 秒に1回にした項目（直らなかった項目）は、次に知らせるころまで間引いてよい
  busy(t: number): boolean {
    if (FORM_ORDER.some((g) => this.st[g].waiting)) return true
    const w = this.avg(t, FORM.window, -1e9, 1)
    if (!w) return false
    return FORM_ORDER.some((g) => {
      const s = this.st[g]
      return FormStage.judgeable(g, w.yaw) && formOver(g, w).over > 0 && (s.cues < FORM.tries || t - s.lastCue >= FORM.later - FORM.window)
    })
  }

  // 1秒ごと。t：しくみの秒、rt：走り出してからの秒、stepping：歩数で走っていた秒（それ以外は線と比べない）。
  // since：その項目（なければどれか）の前の崩れの声からの秒数（しくみの声も数える）。
  // 戻り値の hold は、整えている間（しくみに自分で声を決めさせない）
  second(t: number, rt: number, stepping: boolean, v: FormValues, yaw: number, since: (k?: ItemKey) => number): { say?: LeadSay<ItemKey>; hold: boolean } {
    if (stepping && rt >= FORM.from) {
      const s = { t, v, yaw }
      this.secs.push(s)
      this.all.push(s)
      while (this.secs.length && this.secs[0].t <= t - Math.max(FORM.window, CUE_P.cooldown) - FORM.hold) this.secs.shift()
    }
    const doing = this.doneAt === null
    const win = this.avg(t, FORM.window)
    let say: LeadSay<ItemKey> | undefined

    // 直ったか：知らせたあとの FORM.hold 秒の平均が、線の内側に margin 以上入った。
    // 窓（FORM.window）には直す前の秒も残っているので、窓が入れ替わるまでは内側とみなす
    for (const g of FORM_ORDER) {
      const s = this.st[g]
      if (!s.waiting) continue
      const h = this.avg(t, FORM.hold, s.lastCue)
      if (!say && h && FormStage.judgeable(g, h.yaw) && formOver(g, h).over <= -FORM[g].margin) {
        s.waiting = false
        s.fixed = true
        s.okUntil = t + FORM.window
        this.ackAt = t
        say = { kind: 'ack', text: FORM_SAY.ok }
      } else if (t - s.lastCue >= CUE_P.cooldown) s.waiting = false
    }

    // 窓の平均で線と比べる
    const out: Partial<Record<FormGroup, { key: ItemKey; over: number }>> = {}
    if (win) {
      for (const g of FORM_ORDER) {
        if (!FormStage.judgeable(g, win.yaw)) continue
        const s = this.st[g]
        const o = formOver(g, win)
        out[g] = t < s.okUntil ? { key: o.key, over: Math.min(o.over, -FORM[g].margin) } : o
        s.windows++
        if (o.over <= 0) s.insideWindows++
        if (out[g]!.over > 0) s.inSince = null
        else s.inSince ??= t
      }
    }

    // 外れている項目に知らせる。整えている間は1つずつ（優先の項目が直るのを待つ間、ほかの項目は言わない）。
    // 直ったと伝えた直後は、少しあけてから次へ
    if (!say && t - this.ackAt >= FORM.next) {
      for (const g of FORM_ORDER) {
        const o = out[g]
        if (!o || o.over <= 0) continue
        const s = this.st[g]
        if (s.waiting) {
          if (doing) break
          continue
        }
        // ふつうの間で知らせるのは FORM.tries 回まで。そのあとは FORM.later 秒に1回（整えている間は、次の項目へ進む）
        const gap = s.cues < FORM.tries ? CUE_P.cooldown : FORM.later
        if (doing && s.cues >= FORM.tries) continue
        if (since() >= CUE_P.gap && since(o.key) >= gap) {
          s.cues++
          s.lastCue = t
          s.waiting = true
          if (doing) this.cued = true
          say = { kind: 'cue', item: o.key, text: CUE[o.key] }
          break
        }
        if (doing) break
      }
    }

    // 整え終わり：どの項目も、線の内側か、FORM.tries 回知らせても入らなかったか、比べられない（頭が斜め）。
    // 内側は、窓の平均が FORM.settle 秒続けて内側か、直ったと伝えたあと（1つの窓の当たり外れで「整った」と言わないため）。
    // 全部が線の内側なら「整いました」（声をかけずに済んだら「整っています」）。入らなかった項目があるときは、整ったとは言わない（結果の画面に出す）
    if (doing && win && !say) {
      const inside = (g: FormGroup) => {
        const s = this.st[g]
        if (s.waiting) return false
        if (!out[g]) return g === 'head'
        return t < s.okUntil || (s.inSince !== null && t - s.inSince >= FORM.settle)
      }
      const settled = (g: FormGroup) => inside(g) || (!this.st[g].waiting && this.st[g].cues >= FORM.tries)
      if (FORM_ORDER.every(settled)) {
        this.doneAt = t
        if (FORM_ORDER.every(inside)) say = { kind: 'note', text: this.cued ? FORM_SAY.set : FORM_SAY.good }
      }
    }
    return { say, hold: doing }
  }

  // 走りが止まって、整え直すとき：窓の値と整え終わりは捨てるが、項目ごとに知らせた回数と時刻は残す
  // （走っているかの判定が行き来する人に、整え直すたびに同じ声を FORM.tries 回ずつくり返さないため）
  restart(): FormStage {
    const next = new FormStage()
    for (const g of FORM_ORDER) {
      const s = this.st[g]
      Object.assign(next.st[g], { cues: s.cues, lastCue: s.lastCue, fixed: s.fixed })
    }
    return next
  }

  // 整えるのを打ち切る（走りが長く続いても値が足りないとき）。声はかけない
  finish(t: number) {
    if (this.doneAt === null) this.doneAt = t
  }

  // 結果：項目ごとの、走っていた秒の平均と、線と比べた結果
  results(): FormResult[] {
    if (!this.all.length) return []
    const v: FormValues = {
      trunk: mean(this.all.map((x) => x.v.trunk)),
      body: mean(this.all.map((x) => x.v.body)),
      neck: mean(this.all.map((x) => x.v.neck)),
      headLean: mean(this.all.map((x) => x.v.headLean)),
    }
    return FORM_ORDER.map((g) => {
      const s = this.st[g]
      const o = formOver(g, v)
      const value = g === 'body' ? v.body : g === 'trunk' ? v.trunk : v.neck
      const r: FormResult = { group: g, key: o.key, value, over: o.over, inside: s.windows ? s.insideWindows / s.windows : 1, cues: s.cues, fixed: s.fixed, judged: s.windows > 0 }
      if (g === 'head') r.value2 = v.headLean
      return r
    })
  }
}
