import type { LeadSay } from '../../core/engine'
import { CUE as CUE_P } from '../../core/params'
import { CUE, FORM_SAY } from '../../core/phrases'
import type { FormGroup, FormResult, ItemKey } from '../../core/types'
import { CAM_YAW, FORM, HEAD_OPEN, LIMITS } from './params'
import { landingOf, median, type Peak, type StepSec } from './landing'

// 正しいフォームへ整える（カメラ版）。走り出したら、まず正しいフォームの線（params.ts の FORM）と比べ、
// 外れている項目を1つずつ、何が起きているか＋どう直すかの言葉（phrases.ts の cue…）で知らせる。
// 線の内側に入って保てたら「いいですね。その形です。」と伝えて、次の項目へ進む。全部そろったら「姿勢が整いました」
// （最初からそろっていれば「姿勢は整っています」）。そこまでは、しくみ（engine.ts）は自分では声をかけない（hold）。
// 同じ項目で知らせるのは、ふつうの間（CUE.cooldown）で FORM.tries 回まで。それでも入らなければ、その走りでは
// しつこく言わず、FORM.later 秒に1回だけにする（結果の画面には出す）。整えたあとも、線は走り終わるまで見続ける
// 今日の基準（基準からの崩れを見るもの）は、この線の内側にいた秒だけで作る（coach.ts の CameraAnalyzer）
// 着地（landing）は、声にするかを FORM.landing.say で決める（いまは声にする）。声にしない設定では、知らせず、整え終わりも待たせないが、
// 線を越えている間は「整いました／整っています」と言わない（足が体より前に着く走りに「整っています」と言わないため）

// 直す順：体全体 → 着地 → 上体 → 頭。体全体（足首から）の傾きを変えると、上体の傾きも同じだけ変わり（体ごと回るため）、
// 上体を変えると体全体はその半分ほど変わる（Van Hooren 2024 の公開データからこちらで計算：「少し前に倒して」で上体 +7.5°、体全体 +4.0°）。
// 体が後ろに残ると着地も前に出る（3R の動画で、体全体が起きた例は着地も前。自分の記録で体ごと前に倒すと、かかとの前は −0.096）ので、
// 着地は体全体のあと。頭（首の角度＝頭の位置 − 上体の傾き）は上体に左右される。大きなところから直し、変わったあとの形で次を見る
export const FORM_ORDER: FormGroup[] = ['body', 'landing', 'trunk', 'head']

// 1秒ごとの値（傾きは度）。landing は窓の値（速さで補正したかかとの前。窓の山から出すもので、1秒ごとの値にはない）
export interface FormValues {
  trunk: number
  body: number
  neck: number
  headLean: number
  landing?: number
  yaw?: number // 前側・後ろ側の値（geometry の yawSign）。頭の線そのもの（headOver の ②）で、スマホの向きを見積もるのに使う
}

// 前側・後ろ側の値から見積もったスマホの向き（度。前側が正。params.ts の CAM_YAW）
export const yawDeg = (yawSign: number) => yawSign / CAM_YAW.perDeg

// スマホが前側にずれた分を差し引いた首・頭の位置（後ろ側は直さない）
export function yawFixed(v: { neck: number; headLean: number; yaw?: number }): { neck: number; headLean: number } {
  const d = Math.max(0, yawDeg(v.yaw ?? 0))
  return { neck: v.neck - CAM_YAW.neck * d, headLean: v.headLean - CAM_YAW.headLean * d }
}

// 頭が線からどれだけ外れているか（params.ts の FORM の頭の説明）。どちらかの見方で、首の角度と頭の位置の両方が線を越えたら正。
//   ① 胸を開いた立ち方（FORM.head.open）からの差 + HEAD_OPEN。同じ置き方で測った差なので、スマホの向きでずれにくい
//   ② 線そのもの：スマホの向きの分を直した値。見積もった向きが FORM.head.yawMax 以下のときだけ
// どちらでも比べられないときは -Infinity
export function headOver(v: FormValues): number {
  const h = FORM.head
  const o = h.open
  const rel = o ? Math.min(v.neck - o.neck + HEAD_OPEN.neck - h.neck, v.headLean - o.headLean + HEAD_OPEN.headLean - h.headLean) : -Infinity
  if (yawDeg(v.yaw ?? 0) > h.yawMax) return rel
  const f = yawFixed(v)
  return Math.max(rel, Math.min(f.neck - h.neck, f.headLean - h.headLean))
}

// 頭が線の内側に入る、走っている首・頭の位置の上限（今日の基準を線の内側に寄せるとき。両方の見方の、きびしいほう）
function headCap(yaw: number | undefined): { neck: number; headLean: number } {
  const h = FORM.head
  let neck = Infinity
  let headLean = Infinity
  if (h.open) {
    neck = h.open.neck - HEAD_OPEN.neck + h.neck
    headLean = h.open.headLean - HEAD_OPEN.headLean + h.headLean
  }
  if (yawDeg(yaw ?? 0) <= h.yawMax) {
    const d = Math.max(0, yawDeg(yaw ?? 0))
    neck = Math.min(neck, h.neck + CAM_YAW.neck * d)
    headLean = Math.min(headLean, h.headLean + CAM_YAW.headLean * d)
  }
  return { neck, headLean }
}

// 声にする項目か（着地は FORM.landing.say）
export const voiced = (g: FormGroup) => g !== 'landing' || FORM.landing.say

// 線からどちら側に、どれだけ外れているか（over が正なら外れている。内側なら負で、近いほうの線までの距離）。
// 着地の値がない（窓の山が足りない）ときは、内側のずっと奥とみなす（judgeable で、比べないようにしている）
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
  if (g === 'landing') return { key: 'landing', over: v.landing === undefined ? -Infinity : v.landing - FORM.landing.max }
  // 頭は、首の角度と頭の位置そのものの両方が線を越えたときだけ（小さいほうで見る）。胸を開いた立ち方からの差と、線そのもの（headOver）
  return { key: 'head', over: headOver(v) }
}

// 外れた量を、点数の目盛り（LIMITS）に直す。線の内側 margin までは満点、線で声をかける線（cue）、線の外 span で0点
export function formScale(g: FormGroup, key: ItemKey, over: number): number {
  const lim = LIMITS[key]
  const m = FORM[g].margin
  if (over <= -m) return lim.full - (-over - m)
  if (over <= 0) return lim.full + ((over + m) / m) * (lim.cue - lim.full)
  return lim.cue + (over / FORM[g].span) * (lim.zero - lim.cue)
}

// 正しいフォームの範囲（画面に出す。頭は首の角度の上の線、着地は前の線）
export function formRange(g: FormGroup): { min?: number; max: number } {
  if (g === 'body') return { min: FORM.body.min, max: FORM.body.max }
  if (g === 'trunk') return { min: FORM.trunk.min, max: FORM.trunk.max }
  if (g === 'landing') return { max: FORM.landing.max }
  return { max: FORM.head.neck }
}

// その秒の値の範囲に寄せる（線の内側にいた秒が足りない項目の基準）。着地の基準は coach.ts で別に作る。
// 頭は、走っている値のまま（胸を開いた立ち方からの差でも、線そのものでも）線の内側に入る値まで（headCap。v.yaw はその間の向き）
export function clampInside(g: FormGroup, v: FormValues): FormValues {
  const c = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
  const cap = g === 'head' ? headCap(v.yaw) : { neck: Infinity, headLean: Infinity }
  return {
    trunk: g === 'trunk' ? c(v.trunk, FORM.trunk.min, FORM.trunk.max) : v.trunk,
    body: g === 'body' ? c(v.body, FORM.body.min, FORM.body.max) : v.body,
    neck: Math.min(v.neck, cap.neck),
    headLean: Math.min(v.headLean, cap.headLean),
  }
}

interface Sec {
  t: number
  v: FormValues
  yaw: number
  noRoll: boolean // スマホの左右の傾き（傾きセンサー）が分からなかった秒
  steps: StepSec // その秒に振り分けた着地の山と速さの目安（landing.ts の LandingWatch）
}

type Win = FormValues & { yaw: number; noRoll: boolean }

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
const NO_STEPS: StepSec = { peaks: [], sv: [] }
const LANDING_BLOCK = 30 // 結果の着地の値：走っていた秒をこの長さに区切って、区切りごとの中央値を平均する（速さを途中で変えても区切りごとに補正する）

export class FormStage {
  private secs: Sec[] = []
  private all: Sec[] = [] // 走っていた秒のすべて（結果の平均に使う）
  private st: Record<FormGroup, GroupState>
  doneAt: number | null = null // 整え終わった時刻（しくみの秒）
  cued = false // 整える間に声をかけたか
  private ackAt = -1e9 // 直ったと伝えた時刻
  landing: number | undefined // いちばん新しい窓の着地の値（速さで補正したかかとの前。点数に入れるとき使う）

  constructor() {
    const s = (): GroupState => ({ cues: 0, lastCue: -1e9, waiting: false, fixed: false, inSince: null, okUntil: -1e9, windows: 0, insideWindows: 0 })
    this.st = { body: s(), landing: s(), trunk: s(), head: s() }
  }

  // 直近 sec 秒（しくみの秒で数える）の平均。値のある秒が need より少なければ null（ふつうは窓の FORM.coverage）。
  // 着地は、その秒たちの山から出した窓の値（手前の脚の山が足りなければ無い）
  private avg(t: number, sec: number, after = -1e9, need = Math.ceil(sec * FORM.coverage)): Win | null {
    const xs = this.secs.filter((x) => x.t > t - sec && x.t <= t && x.t > after)
    if (!xs.length || xs.length < need) return null
    const lw = landingOf(xs.flatMap((x) => x.steps.peaks), xs.flatMap((x) => x.steps.sv))
    return {
      trunk: mean(xs.map((x) => x.v.trunk)),
      body: mean(xs.map((x) => x.v.body)),
      neck: mean(xs.map((x) => x.v.neck)),
      headLean: mean(xs.map((x) => x.v.headLean)),
      yaw: mean(xs.map((x) => x.yaw)),
      noRoll: xs.some((x) => x.noRoll),
      ...(lw ? { landing: lw.res } : {}),
    }
  }

  // 線と比べられるか。頭は、胸を開いた立ち方を測っているか、斜めから撮っているように見えないとき（params.ts の FORM.head.yawMax）。
  // 体全体・上体・着地は、スマホの左右の傾き（傾きセンサー）が分かっているときだけ（分からないと、傾きがそのまま角度と前後に入るため。記録だけ残す）。
  // 着地は、窓に手前の脚の山が LANDING.minSteps 以上あるときだけ
  static judgeable(g: FormGroup, w: { yaw: number; landing?: number; noRoll?: boolean }): boolean {
    if (g === 'head') return FORM.head.open !== null || yawDeg(w.yaw) <= FORM.head.yawMax
    if (w.noRoll) return false
    if (g === 'landing') return w.landing !== undefined
    return true
  }

  // 直近 FORM.hold 秒の平均が、線の内側か（今日の基準にためる秒を選ぶ。頭も斜めかどうかは見ない。着地は、比べられたときだけ内側）
  holdInside(t: number): Record<FormGroup, boolean> | null {
    const h = this.avg(t, FORM.hold)
    if (!h) return null
    return { body: formOver('body', h).over <= 0, landing: h.landing !== undefined && formOver('landing', h).over <= 0, trunk: formOver('trunk', h).over <= 0, head: formOver('head', h).over <= 0 }
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
  // 知らせるのを FORM.later 秒に1回にした項目（直らなかった項目）は、次に知らせるころまで間引いてよい。声にしない項目（着地）は見ない
  busy(t: number): boolean {
    if (FORM_ORDER.some((g) => this.st[g].waiting)) return true
    const w = this.avg(t, FORM.window, -1e9, 1)
    if (!w) return false
    return FORM_ORDER.some((g) => {
      const s = this.st[g]
      return voiced(g) && FormStage.judgeable(g, w) && formOver(g, w).over > 0 && (s.cues < FORM.tries || t - s.lastCue >= FORM.later - FORM.window)
    })
  }

  // 1秒ごと。t：しくみの秒、rt：走り出してからの秒、stepping：歩数で走っていた秒（それ以外は線と比べない）。
  // since：その項目（なければどれか）の前の崩れの声からの秒数（しくみの声も数える）。steps：その秒に振り分けた着地の山。
  // 戻り値の hold は、整えている間（しくみに自分で声を決めさせない）。noRoll：その秒にスマホの左右の傾きが分からなかった。
  // defer：整え終わったあと、知らせる直前に呼ぶ。true なら、この秒はその項目で知らせない（coach.ts：猫背が線に近づいている間の頭）。
  //   整えている間は呼ばない（走り出しの頭の声はそのまま）
  second(t: number, rt: number, stepping: boolean, v: FormValues, yaw: number, since: (k?: ItemKey) => number, steps: StepSec = NO_STEPS, noRoll = false, defer?: (k: ItemKey) => boolean): { say?: LeadSay<ItemKey>; hold: boolean } {
    if (stepping && rt >= FORM.from) {
      const s = { t, v, yaw, noRoll, steps }
      this.secs.push(s)
      this.all.push(s)
      while (this.secs.length && this.secs[0].t <= t - Math.max(FORM.window, CUE_P.cooldown) - FORM.hold) this.secs.shift()
    }
    const doing = this.doneAt === null
    const win = this.avg(t, FORM.window)
    this.landing = win?.landing
    let say: LeadSay<ItemKey> | undefined

    // 直ったか：知らせたあとの FORM.hold 秒の平均が、線の内側に margin 以上入った。
    // 窓（FORM.window）には直す前の秒も残っているので、窓が入れ替わるまでは内側とみなす
    for (const g of FORM_ORDER) {
      const s = this.st[g]
      if (!s.waiting) continue
      const h = this.avg(t, FORM.hold, s.lastCue)
      if (!say && h && FormStage.judgeable(g, h) && formOver(g, h).over <= -FORM[g].margin) {
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
        if (!FormStage.judgeable(g, win)) continue
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
    // 直ったと伝えた直後は、少しあけてから次へ。声にしない項目（着地）は知らせない
    if (!say && t - this.ackAt >= FORM.next) {
      for (const g of FORM_ORDER) {
        const o = out[g]
        if (!o || o.over <= 0 || !voiced(g)) continue
        const s = this.st[g]
        if (s.waiting) {
          if (doing) break
          continue
        }
        // ふつうの間で知らせるのは FORM.tries 回まで。そのあとは FORM.later 秒に1回（整えている間は、次の項目へ進む）
        const gap = s.cues < FORM.tries ? CUE_P.cooldown : FORM.later
        if (doing && s.cues >= FORM.tries) continue
        // 窓の平均が線を越えていても、1秒ごとの値が線の外に CUE.sustain 秒続いていなければ、まだ知らせない（一瞬の崩れは言わない。sustainedOver）
        if (!this.sustainedOver(g, t)) {
          if (doing) break
          continue
        }
        if (since() >= CUE_P.gap && since(o.key) >= gap && (doing || !defer?.(o.key))) {
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

    // 整え終わり：どの項目も、線の内側か、FORM.tries 回知らせても入らなかったか、比べられない（頭が斜め、着地の山が足りない、傾きが分からない）か、声にしない項目。
    // 内側は、窓の平均が FORM.settle 秒続けて内側か、直ったと伝えたあと（1つの窓の当たり外れで「整った」と言わないため）。
    // 全部が線の内側なら「整いました」（声をかけずに済んだら「整っています」）。入らなかった項目があるときは、整ったとは言わない（結果の画面に出す）。
    // 声にしない着地も、線を越えているなら整ったとは言わない（整え終わりは待たせない）
    if (doing && win && !say) {
      const inside = (g: FormGroup) => {
        const s = this.st[g]
        if (s.waiting) return false
        if (!out[g]) return true
        return t < s.okUntil || (s.inSince !== null && t - s.inSince >= FORM.settle)
      }
      const settled = (g: FormGroup) => !voiced(g) || inside(g) || (!this.st[g].waiting && this.st[g].cues >= FORM.tries)
      if (FORM_ORDER.every(settled)) {
        this.doneAt = t
        // 傾きが分からず体全体・上体・着地を比べていないときは、整ったとは言わない
        if (FORM_ORDER.every(inside) && !win.noRoll) say = { kind: 'note', text: this.cued ? FORM_SAY.set : FORM_SAY.good }
      }
    }
    return { say, hold: doing }
  }

  // 1秒ごとの値が、直近 CUE.sustain 秒（t まで、1秒も欠けずに）どれも線の外か。16秒の窓の平均は、1〜2秒の大きな跳ね
  // （一瞬うつむいた）でも線を越えることがあるので、知らせる前にこれも見る（core/params.ts の CUE.sustain）。
  // 比べられない秒（頭が斜め、傾きが分からない）は線の外に数えない。着地は1歩ごとの山の窓の中央値で、1秒ごとの値がないので見ない
  sustainedOver(g: FormGroup, t: number): boolean {
    if (g === 'landing') return true
    for (let i = 0; i < CUE_P.sustain; i++) {
      const x = this.secs.find((y) => y.t === t - i)
      if (!x || !FormStage.judgeable(g, { yaw: x.yaw, noRoll: x.noRoll }) || formOver(g, x.v).over <= 0) return false
    }
    return true
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

  // 結果：項目ごとの、走っていた秒の平均と、線と比べた結果。頭には、走っていた秒の前側・後ろ側の値の平均も付ける
  // （頭が大きく出ているかもしれないことを、結果の画面に書くため）。
  // 着地は、走っていた秒を LANDING_BLOCK 秒ずつに区切った窓の値（速さで補正したかかとの前）の平均。区切りに山が足りなければ、比べていない
  results(): FormResult[] {
    if (!this.all.length) return []
    const v: FormValues = {
      trunk: mean(this.all.map((x) => x.v.trunk)),
      body: mean(this.all.map((x) => x.v.body)),
      neck: mean(this.all.map((x) => x.v.neck)),
      headLean: mean(this.all.map((x) => x.v.headLean)),
      yaw: mean(this.all.map((x) => x.yaw)),
    }
    const land = this.landingResult()
    const out: FormResult[] = []
    for (const g of FORM_ORDER) {
      const s = this.st[g]
      if (g === 'landing') {
        if (!land) continue
        const over = land.res - FORM.landing.max
        out.push({ group: g, key: 'landing', value: land.res, over, inside: s.windows ? s.insideWindows / s.windows : over <= 0 ? 1 : 0, cues: s.cues, fixed: s.fixed, judged: true, heel: land.heel, speed: land.speed })
        continue
      }
      const o = formOver(g, v)
      const value = g === 'body' ? v.body : g === 'trunk' ? v.trunk : v.neck
      const r: FormResult = { group: g, key: o.key, value, over: o.over, inside: s.windows ? s.insideWindows / s.windows : 1, cues: s.cues, fixed: s.fixed, judged: s.windows > 0 }
      if (g === 'head') {
        r.value2 = v.headLean
        r.yaw = mean(this.all.map((x) => x.yaw))
      }
      out.push(r)
    }
    return out
  }

  private landingResult(): { res: number; heel: number; speed: number } | null {
    const res: number[] = []
    const peaks: Peak[] = []
    const sv: number[] = []
    let block: Sec[] = []
    const flush = () => {
      const w = landingOf(block.flatMap((x) => x.steps.peaks), block.flatMap((x) => x.steps.sv))
      if (w) res.push(w.res)
      block = []
    }
    for (const x of this.all) {
      if (block.length && x.t - block[0].t >= LANDING_BLOCK) flush()
      block.push(x)
      peaks.push(...x.steps.peaks)
      sv.push(...x.steps.sv)
    }
    flush()
    if (!res.length) return null
    const all = landingOf(peaks, sv)
    return { res: mean(res), heel: all?.heel ?? NaN, speed: all?.speed ?? median(sv) }
  }
}
