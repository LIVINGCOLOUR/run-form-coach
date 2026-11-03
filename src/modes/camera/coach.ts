import { ITEM_KEYS, type Category, type FormGroup, type Frame, type ItemKey, type Sample, type Session, type Stride } from '../../core/types'
import type { Measure } from './types'
import { category } from '../../core/scoring'
import { itemScore, LIMITS } from './scoring'
import { CUE } from '../../core/phrases'
import { HIP_REF } from '../../core/params'
import { applyStrictness, FORM, HUNCH, LANDING, REL_LIMITS, STRIDE } from './params'
import type { Level } from '../../core/level'
import { CUE as CUE_P } from '../../core/params'
import { RunningGate } from './motion'
import { clampInside, formOver, formScale, FormStage, FORM_ORDER, voiced, type FormValues } from './form'
import { LandingDrift, LandingWatch, median, refOf, SpeedGuard, type Peak } from './landing'
import { GaitWatch } from './gait'
import { strideCycle } from './stride'
import { CueEngine, type EngineInput, type ItemSpec, type ModeAnalyzer, type SecondContext, type SecondOut, type Values } from '../../core/engine'

// カメラモード：トレッドミルの横のスマホで骨格を取り、頭・体幹・体全体（前に倒れすぎ・起きすぎ）・腰・着地の位置を見る。顎は測って記録するだけ。
// 走り出したら、まず正しいフォームの線と比べて1つずつ直してもらい（form.ts の「整える」）、直った形を今日の基準にする。
// そのあとは、今日の基準からの崩れ（REL_LIMITS など）と、正しいフォームの線の両方で見る。
// 速さを変えると姿勢も変わる（体全体・上体は時速 +1km で約 +0.8°。docs/research/posture-vs-speed.md）ので、着地と同じ速さの見張り
// （landing.ts の SpeedGuard）が外れとみた秒は、姿勢も基準や線と比べず、速さが変わったとみたら姿勢の基準も新しい速さで作り直す。
// 声かけのしくみ（いつ声をかけ、ほめ、黙って見守るか）は engine.ts で、どのモードでも共通。
// ここにあるのは、カメラの測定から1秒ごとの判定の値を作る「見る役」（正しいフォームの線で知らせる声も、ここで決める）と、
// 走り姿のアニメーションの記録

export type { CoachEvent, CoachState } from '../../core/engine'
export { breakdownMinute } from '../../core/engine'

// moving には、そのコマを1コマだけで見た「走っているか」（MotionDetector の判定）を渡す。
// 走り始め・止まりは、Coach が直近のコマの割合（RunningGate）で決め直してから、しくみに渡す
export interface CoachInput extends EngineInput<Measure> {
  frame?: Frame // 鉛直をそろえたピクセル座標（走り姿のアニメーション用）
}

// Coach がしくみに渡す1コマ。steps：そのコマを走っているかの割合に入れたときの、そのコマの判定（入れなかったコマは無い）
interface GatedInput extends CoachInput {
  steps?: boolean
}

// 測る項目。並び順が、今日の基準からの崩れで声をかける優先順（頭 → 上体 → 上体の起きすぎ → 体全体 → 体全体の起きすぎ → 腰 → 着地）。
// 正しいフォームの線で知らせる順は form.ts の FORM_ORDER
export const CAMERA_ITEMS: ItemSpec<ItemKey>[] = ITEM_KEYS.map((key) => ({ key, limits: LIMITS[key], cue: CUE[key] }))

type Ref = { neck: number; trunk: number; body: number; headLean: number; yaw: number; chin: number }
const REF_KEYS = ['neck', 'trunk', 'body', 'headLean', 'yaw', 'chin'] as const

// 今日の基準にためる値：項目ごとに、その項目が正しいフォームの線の内側にいた秒だけ（in）と、走っていた秒のすべて（all）。
// 腰は、体全体と上体の両方が線の内側にいた秒（整えた形）。着地は、その秒に振り分けた山と速さの目安（着地の線の内側にいた秒だけと、すべて）
type Steps = { peaks: Peak[]; sv: number[]; secs: number }
type Pool = { in: Record<FormGroup, FormValues[]>; all: FormValues[]; hipIn: number[]; hipAll: number[]; yaw: number[]; chin: number[]; landIn: Steps; landAll: Steps }
const emptySteps = (): Steps => ({ peaks: [], sv: [], secs: 0 })
const emptyPool = (): Pool => ({ in: { body: [], landing: [], trunk: [], head: [] }, all: [], hipIn: [], hipAll: [], yaw: [], chin: [], landIn: emptySteps(), landAll: emptySteps() })
const addSteps = (p: Steps, s: { peaks: Peak[]; sv: number[] }) => {
  p.peaks.push(...s.peaks)
  p.sv.push(...s.sv)
  p.secs++
}

// 着地の仮の基準：基準を渡さずに始めると、速さの変わらない LANDING.earlyCollect 秒の山をためて作る（landing.ts の LandingDrift）
const earlyDrift = () => {
  const d = new LandingDrift(LANDING.earlyCollect)
  d.set(null)
  return d
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const meanOf = (xs: FormValues[]): FormValues => ({ trunk: mean(xs.map((x) => x.trunk)), body: mean(xs.map((x) => x.body)), neck: mean(xs.map((x) => x.neck)), headLean: mean(xs.map((x) => x.headLean)) })

// 今日の基準にためる1秒（走り出しに作るときと、速さが変わって作り直すときに使う）
function addSecond(p: Pool, form: FormStage, t: number, v: FormValues, hipRatio: number, yaw: number, chin: number, steps: { peaks: Peak[]; sv: number[] }) {
  p.all.push(v)
  p.hipAll.push(hipRatio)
  p.yaw.push(yaw)
  p.chin.push(chin)
  addSteps(p.landAll, steps)
  const ins = form.holdInside(t)
  if (ins) {
    for (const g of FORM_ORDER) if (ins[g] && !form.waiting(g)) p.in[g].push(v)
    if (ins.body && ins.trunk) p.hipIn.push(hipRatio)
    if (ins.landing && !form.waiting('landing')) addSteps(p.landIn, steps)
  }
}

// ためた秒から、姿勢の基準（首・頭の位置・上体・体全体）と腰の高さの基準を作る。
// 項目ごとに、線の内側にいた秒の平均。足りなければ、走っていた秒の平均を線の内側に寄せた値（入らなかった項目は、線そのもの）。
// 線と比べられなかった項目（頭が、ずっと斜めから撮っているように見えた）は、走っていた秒の平均（線の値は当てにならないため）
function postureRefOf(p: Pool, form: FormStage) {
  const typical = meanOf(p.all)
  const at = (g: FormGroup) => (!form.judged(g) ? typical : p.in[g].length >= FORM.refMin ? meanOf(p.in[g]) : clampInside(g, typical))
  const head = at('head')
  return { lean: { neck: head.neck, headLean: head.headLean, trunk: at('trunk').trunk, body: at('body').body }, hip: p.hipIn.length >= FORM.refMin ? mean(p.hipIn) : mean(p.hipAll) }
}

class CameraAnalyzer implements ModeAnalyzer<Measure, Sample, ItemKey> {
  items = CAMERA_ITEMS

  private hipRef: number | null = null
  // 今日の基準：首の角度・上体・体全体の傾き、頭の位置そのもの、スマホの向き、顎。整えたあとの形（正しいフォームの線の内側にいた秒）の平均
  private pool = emptyPool()
  leanRef: Ref | null = null
  // 正しいフォームへ整える（form.ts）。走り出しから走り終わりまで、線と比べ続ける
  form = new FormStage()
  // 着地（landing.ts）：骨格を取ったコマごとに山を取り、歩数で走っていた秒の山だけを残す。今日の基準からの増えは drift
  land = new LandingWatch()
  drift = new LandingDrift()
  // 着地の仮の基準（今日の基準ができるまで）：走り出して FORM.from 秒からの、速さの変わらない LANDING.earlyCollect 秒の山で作り、
  // 今日の基準ができるまで、それからの増えで声をかける（走り出しの数分に足が前に出ても、基準がないので気づけなかったため）
  early = earlyDrift()
  // 走りの数字（gait.ts）：着地と同じ山で1歩ずつ区切って、ピッチ・上下動・腰の高さ・腕振りを測る。声はかけない
  gait = new GaitWatch()
  // 速さが変わったとみて（drift.guard）、姿勢の基準を新しい速さでためなおしている間のため場所（なければ null）
  private repool: Pool | null = null
  private seenChanges = 0
  // 今日の基準をためている間の速さの見張り（ためはじめの速さと比べる）。速さが変わってため直したら poolMoved
  private poolGuard = new SpeedGuard()
  private poolMoved = false
  // 仮の基準（FORM.early）：今日の基準ができるまで、ためはじめの FORM.early 秒の平均で、基準からの崩れを見る。速さが変わってため直したら捨てる
  private earlyRef: Pick<Ref, 'neck' | 'headLean' | 'trunk' | 'body'> | null = null
  // 直近の秒の、基準からの崩れ（点数の目盛り）。CUE.window 秒の平均で、崩れた秒を基準にためないためと、猫背が線を越えている間に上体・頭の声を重ねないため
  private recent: { t: number; v: Values<ItemKey> }[] = []

  // 今日の基準は、歩数で走っていると見た秒だけで作る。running は Coach が決めた「走っている」（RunningGate）。
  // runFrom は、いまの走りの始まり（しくみの秒）。基準ができる前に止まったら null にして、整え直す
  running = false
  runFrom: number | null = null
  private secOn = 0 // この1秒の、走っていると見たコマの数（割合に入れたコマだけ）
  private secOff = 0

  private ring: { frame: Frame; dir: 1 | -1; t: number }[] = []
  private candidates: Record<Category, Stride[]> = { good: [], mid: [], bad: [] }
  private lastStrideAt = -1e9

  // 走っている間の1コマ：その秒に走っていたかを数え、着地の山を取り、走り姿のアニメーション用に骨格をためる
  input(inp: GatedInput) {
    if (inp.steps === true) this.secOn++
    else if (inp.steps === false) this.secOff++
    this.land.tick(inp.t)
    if (!inp.frame || !inp.m) return
    this.land.frame(inp.frame, inp.t)
    this.gait.frame(inp.frame, inp.t)
    // 骨格を取っていない間があいたら、つながらないので捨てる
    const last = this.ring[this.ring.length - 1]
    if (last && inp.t - last.t > 0.3) this.ring = []
    this.ring.push({ frame: inp.frame, dir: inp.m.dir, t: inp.t })
    while (this.ring.length && inp.t - this.ring[0].t > STRIDE.window) this.ring.shift()
  }

  // 走るのが止まった：基準ができる前なら、ためた分を捨てて、次に走り出したところから整え直す
  stopped() {
    if (this.leanRef !== null) return
    this.runFrom = null
    this.pool = emptyPool()
    this.poolGuard = new SpeedGuard()
    this.poolMoved = false
    this.earlyRef = null
    this.recent = []
    this.early = earlyDrift()
    this.form = this.form.restart()
  }

  // 基準にためた秒の数（採点の道具が、基準を作った間を出すのに使う）
  get refSeconds() {
    return this.pool.all.length
  }

  // 1秒分の測定をまとめて1件の記録にする
  second(b: Measure[], t: number, ctx: SecondContext<ItemKey>): SecondOut<Sample, ItemKey> | null {
    // その秒に歩数で走っていたか：割合に入れたコマの半分以上が「走っている」。入れたコマがない秒（間引きのあと、
    // 歩数を数え直している間）は、Coach の「走っている」に従う
    const on = this.secOn
    const off = this.secOff
    this.secOn = 0
    this.secOff = 0
    const stepping = this.running && (on + off === 0 || on >= off)
    // 着地：1つ前の秒の山を、その秒に走っていたかで振り分ける（骨格を取らなかった秒も、時間は進める）
    const steps = this.land.second(stepping && b.length >= 3)
    this.gait.second(steps.peaks)
    if (b.length < 3) return null
    const now = Object.fromEntries(REF_KEYS.map((k) => [k, mean(b.map((m) => m[k]))])) as Ref
    const { neck, headLean, trunk, body, yaw } = now
    const v: FormValues = { trunk, body, neck, headLean }
    const hipRatio = mean(b.map((m) => m.hipRatio))
    const rt = this.runFrom === null ? null : t - this.runFrom

    // 速さの見張り（landing.ts の SpeedGuard、着地と同じもの）：基準ができたあとは、先に着地を比べて、この秒に速さが外れているかを決める。
    // 速さが変わったとみたら、姿勢の基準も新しい速さでためなおす（着地と同じ LANDING.rebuild 秒。ためている間に速さがまた変わったら、ため直す）
    const hadRef = this.leanRef !== null
    let lw = hadRef ? this.land.window(undefined, this.drift.ref?.near) : null
    let landing = hadRef ? this.drift.judge(lw, steps, stepping) : undefined
    if (hadRef && this.drift.guard.changes !== this.seenChanges) {
      this.seenChanges = this.drift.guard.changes
      this.repool = emptyPool()
    }
    // 姿勢を止めるのは、外れが LANDING.postureAfter 秒続いてから（窓の揺れで短く外れるたびに止めると、本当の崩れに気づくのが遅れるため）
    const away = hadRef && this.drift.guard.off >= LANDING.postureAfter

    // 正しいフォームの線と比べ、外れていれば1つずつ知らせる（走り出してからの秒が分かるときだけ）。
    // 速さが外れている秒（速さを変えている途中）は、走っていない秒と同じに、線とも比べない
    const lead = rt === null ? { hold: false } : this.form.second(t, rt, stepping && !away, v, yaw, ctx.since, steps)

    // 今日の基準にためる：整え終わってから（走り出して HIP_REF.from 秒より後）の、歩数で走っていた秒。項目ごとに、
    // 直近 FORM.hold 秒の平均が線の内側で、知らせて直るのを待っていない秒だけ（直したあとの形。直す前の形を混ぜない）
    let ready = false
    let poolSame = false
    if (this.leanRef === null && rt !== null && stepping && rt >= HIP_REF.from && this.form.doneAt !== null) {
      // ためている間も速さを見張る（走り出しはゆっくりで、あとからベルトの速さを上げる人がいるため）。外れている秒はためず、
      // 速さが変わったとみたら、それまでにためた秒を捨てて、新しい速さでため直す
      const pw = this.land.window()
      const c = pw ? this.poolGuard.check(pw) : 'same'
      poolSame = c === 'same'
      if (c === 'changed') {
        this.pool = emptyPool()
        this.poolMoved = true
        this.earlyRef = null
        this.recent = []
      } else if (c === 'same') {
        // 仮の基準から崩れている間（直近 CUE.window 秒の平均が線を越えた）は、ためない
        if (this.earlyRef) this.noteRecent(t, relValues(v, this.earlyRef, true))
        if (!this.earlyRef || !this.recentOver(REL_KEYS)) addSecond(this.pool, this.form, t, v, hipRatio, yaw, now.chin, steps)
        if (!this.earlyRef && this.pool.all.length >= FORM.early) this.earlyRef = postureRefOf(this.pool, this.form).lean
      }
    }
    // 走り出して長くたっても整え終わらない（値が足りない）ときは、打ち切る
    if (this.leanRef === null && rt !== null && rt > HIP_REF.to + FORM.later) this.form.finish(t)
    // 基準を作る：走り出して HIP_REF.to 秒たち、整え終わってから FORM.refAfter 秒たったら。ためている間に速さが変わってため直したときは、
    // 新しい速さで LANDING.rebuild 秒たまるまで待つ（速さが変わったあとに作り直すときと同じ長さ）
    const waitPool = this.poolMoved && this.pool.all.length < LANDING.rebuild
    if (this.leanRef === null && rt !== null && rt >= HIP_REF.to && this.form.doneAt !== null && t - this.form.doneAt >= FORM.refAfter && !waitPool) {
      const p = this.pool
      if (!p.all.length) this.runFrom = t - HIP_REF.from // 走っていた秒が1つもなければ、すぐ次の秒からためる
      else {
        ready = true
        const r = postureRefOf(p, this.form)
        this.leanRef = { ...r.lean, yaw: mean(p.yaw), chin: mean(p.chin) }
        this.hipRef = r.hip
        // 着地の基準：着地の線の内側にいた秒の山。足りなければ、走っていた秒すべての山（線の内側に寄せない：着地の線は速さの当てはめが
        // 仮想のスマホのもので、まだ確かめていない。寄せると、線の外の人ほど基準からの増えの線が実際より近くなり、ふつうに走るだけで声が出る）。
        // 山が足りなければ（足が映りにくい）、このあと走りながらためて作る
        this.drift.set((p.landIn.secs >= FORM.refMin ? refOf(p.landIn.peaks, p.landIn.sv) : null) ?? refOf(p.landAll.peaks, p.landAll.sv))
      }
    }
    // 速さが変わったあとの姿勢の基準：新しい速さで、速さが外れていない、歩数で走っていた秒をためる（スマホの向きと顎の基準はそのまま）
    if (this.repool && stepping && !away) {
      addSecond(this.repool, this.form, t, v, hipRatio, yaw, now.chin, steps)
      if (this.repool.all.length >= LANDING.rebuild) {
        const r = postureRefOf(this.repool, this.form)
        this.leanRef = { ...this.leanRef!, ...r.lean }
        this.hipRef = r.hip
        this.repool = null
      }
    }
    // 姿勢を今日の基準と比べない秒：速さが外れている秒と、速さが変わって基準をためなおしている間
    const paused = hadRef && (away || this.repool !== null)
    // 今日の基準ができるまでは、仮の基準と比べる（速さが外れていない、ためている秒だけ）
    const ref = this.leanRef ?? (poolSame ? this.earlyRef : null)
    const hipDrop = this.hipRef ? Math.max(0, ((this.hipRef - hipRatio) / this.hipRef) * 100) : 0
    // 頭は、今日の基準との差。1秒ごとに0で切らず、平均してから線と比べる（揺れの正の側だけが残って、実際より大きく出るため）
    const head = ref ? headForward(neck - ref.neck, headLean - ref.headLean) : 0
    // 着地：窓（細かく見ていれば16秒、間引いて見ている間は30秒）の、基準と同じ脚の山の中央値と基準の差。歩数で走っていた秒だけ。
    // 速さの目安が基準から大きく変わった秒は比べず、基準を作り直す（landing.ts の LandingDrift）。基準ができたこの秒は、ここで比べる
    if (!hadRef) {
      lw = this.land.window(undefined, this.drift.ref?.near)
      landing = this.leanRef ? this.drift.judge(lw, steps, stepping) : undefined
    }
    // 今日の基準ができるまでは、着地の仮の基準と比べる（LANDING.early）
    if (!this.leanRef && LANDING.early && rt !== null && rt >= FORM.from) {
      const ew = this.land.window(undefined, this.early.ref?.near)
      landing = this.early.judge(ew, steps, stepping)
      if (this.early.ref) lw = ew
    }
    const shown = lw ?? this.land.window()
    const judge = ref ? { trunk: toScale('trunk', trunk - ref.trunk), body: toScale('body', body - ref.body) } : undefined
    const back = ref ? { trunk: toScale('trunkBack', ref.trunk - trunk), body: toScale('bodyBack', ref.body - body) } : undefined
    // しくみが声をかける値：今日の基準からの崩れ（基準ができるまでと、姿勢を比べない秒は無い）。
    // 起きすぎの側は、歩数で走っていた秒だけ判定する（歩くと上体も体全体も起きるので、歩いている間に声をかけないため）
    const values: Values<ItemKey> = {}
    let hunch: number | undefined
    if (ref && judge && back && !paused) {
      const rv = relValues(v, ref, stepping)
      hunch = rv.hunch
      Object.assign(values, rv)
      if (this.hipRef) values.hip = hipDrop
    }
    // 点数は、猫背が線を越えている間も、上体と頭を数える。声は、猫背が線を越えている間（直近 CUE.window 秒の平均）は猫背だけにする
    // （背中が丸まると上体も頭も前に出るので、「前かがみ」「頭が前」を重ねて言わない。胸を開けば両方戻る）
    const scored: Values<ItemKey> = { ...values }
    if (hunch !== undefined) this.noteRecent(t, values)
    if (hunch !== undefined && this.recentOver(['hunch'])) {
      delete values.trunk
      delete values.head
    }
    if (landing !== undefined) values.landing = landing
    // 正しいフォームの線を外れた量（点数の目盛り）。歩数で走っていた秒だけ（速さが外れている秒は除く）。頭は斜めから撮っているように見える秒は比べない。
    // 着地は窓の値（FormStage の、いちばん新しい窓）で、声にする項目にしたときだけ点数に入れる（声にしない線で点数を下げると、
    // 声なしの見守りやほめる声が、理由を言われないまま来なくなるため）
    const form: Values<ItemKey> = {}
    if (stepping && !away && rt !== null && rt >= FORM.from) {
      for (const g of FORM_ORDER) {
        if (g === 'landing') {
          if (voiced(g) && this.form.landing !== undefined) form.landing = formScale(g, 'landing', this.form.landing - FORM.landing.max)
          continue
        }
        if (!FormStage.judgeable(g, { yaw })) continue
        const o = formOver(g, v)
        form[o.key] = formScale(g, o.key, o.over)
      }
    }
    // 点数は、今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう
    const both: Values<ItemKey> = { ...scored }
    for (const k of Object.keys(form) as ItemKey[]) both[k] = Math.max(both[k] ?? -Infinity, form[k]!)
    const score = ctx.score(both)
    // 顎：測って記録するだけ。上体が起きた分（頭は上体といっしょに回る）を差し引く
    const chin = this.leanRef ? now.chin - this.leanRef.chin + (trunk - this.leanRef.trunk) : undefined
    const sample: Sample = { t, head, trunk, body, hipDrop, score: score ?? 100, quiet: ctx.quiet, judge, back, headLean, neck, yaw, form, chin }
    if (hunch !== undefined) sample.hunch = hunch
    if (paused) sample.paused = true
    if (shown) sample.land = { heel: shown.heel, speed: shown.speed, res: shown.res, n: shown.n, ...(landing !== undefined ? { drift: landing } : {}) }
    if (score !== null) this.maybeKeepStride(sample)
    return { sample, values, ready, score, say: lead.say, hold: lead.hold }
  }

  // 直近の秒の、基準からの崩れをためる（同じ秒はあと勝ち）。CUE.window 秒より古いものは捨てる
  private noteRecent(t: number, v: Values<ItemKey>) {
    const r = this.recent
    if (r.length && r[r.length - 1].t === t) r[r.length - 1].v = v
    else r.push({ t, v })
    while (r.length && r[0].t <= t - CUE_P.window) r.shift()
  }

  // 直近 CUE.window 秒の平均が、ks のどれかで声をかける線を越えているか（しくみの窓と同じ：値のある秒が CUE.coverage 以上）
  private recentOver(ks: ItemKey[]): boolean {
    return ks.some((k) => {
      const xs = this.recent.flatMap((x) => (x.v[k] === undefined ? [] : [x.v[k]!]))
      return xs.length >= CUE_P.window * CUE_P.coverage && mean(xs) > LIMITS[k].cue
    })
  }

  // 走り姿の候補：直近 STRIDE.window 秒から、何周も重ねたきれいな1周を作る（stride.ts）。作れなければ、次の秒にもう一度ためす
  private maybeKeepStride(s: Sample) {
    const r = this.ring
    if (r.length < 8 || r[r.length - 1].t - r[0].t < STRIDE.window - 1 || s.t - this.lastStrideAt < STRIDE.every) return
    const dir = r[r.length - 1].dir
    if (r.some((x) => x.dir !== dir)) return
    // 1周の長さの目安：同じ区間の1歩の長さ（gait.ts）の中央値の2倍
    const steps = this.gait.steps.filter((x) => x.t >= r[0].t).map((x) => x.sec)
    const c = strideCycle(r, dir, steps.length >= 4 ? 2 * median(steps) : undefined)
    if (!c) return
    this.lastStrideAt = s.t
    const list = this.candidates[category(s.score)]
    const stride: Stride = {
      frames: c.frames,
      dir,
      score: s.score,
      avg: { head: Math.max(0, s.head), trunk: s.trunk, body: s.body, hipDrop: s.hipDrop },
      sec: c.sec,
    }
    if (list.length < 60) list.push(stride)
    else list[Math.floor(Math.random() * list.length)] = stride
  }

  // 結果画面の走り姿：分類ごとに、点数がその分類の平均にいちばん近い1歩
  strides(): Session['strides'] {
    const strides: Session['strides'] = {}
    for (const cat of ['good', 'mid', 'bad'] as Category[]) {
      const list = this.candidates[cat]
      if (!list.length) continue
      const m = mean(list.map((x) => x.score))
      strides[cat] = list.reduce((a, b) => (Math.abs(b.score - m) < Math.abs(a.score - m) ? b : a))
    }
    return strides
  }
}

export class Coach extends CueEngine<Measure, Sample, ItemKey> {
  // pause: 止まったら一時停止するか（検証中は切っておく）。
  // items: 今日の基準からの崩れで声をかける項目（ランナーのレベルで決まる。ほかの項目は大きく崩れたときだけ）。なければすべて。
  //   正しいフォームの線で整える声（form.ts）は、どのレベルでもかける（フォームの土台なので。それでも一度に1つずつ）
  // 走る前に立って測る基準は、猫背の確認にだけ使い、ここには渡さない（頭は今日の基準と比べる）
  // 判定しなかった秒（values に入れなかった秒）には、その項目で新しく知らせない（holdUnjudged）：着地と姿勢は速さが変わった秒、
  // 起きすぎと着地は歩数で走っていない秒に判定を止めるので、止めた直後に、止める前の秒の値で知らせないため
  // level：ランナーのレベル。声をかける線と点数の目盛りの厳しさ（params.ts の STRICT）を、ここで入れ替える。
  //   なければ入れ替えない（いまの線のまま。読み込んだときは中級＝ふつう。採点の道具が線を書き換えて試すため）
  constructor(opts: { pause?: boolean; items?: ItemKey[]; level?: Level } = {}) {
    if (opts.level) applyStrictness(opts.level)
    super(new CameraAnalyzer(), { holdUnjudged: true, ...opts })
  }

  private get camera() {
    return this.analyzer as CameraAnalyzer
  }

  // 今日の基準（整えたあとの形。できるまでは null）
  get leanRef() {
    return this.camera.leanRef
  }

  // 整え終わったか（form.ts）
  get formDone() {
    return this.camera.form.doneAt !== null
  }

  private readonly gate = new RunningGate()

  // いま歩数で走っているとみているか（直近のコマの割合で決めたもの。センサーの猫背の見分けが、走っている間だけ見るのに使う）
  get stepping() {
    return this.gate.running
  }

  // 今日の基準ができる前に止まったか、走り出したか（整え直すため）
  update(inp: CoachInput) {
    const was = this.gate.running
    // 割合に入れるのは、見えていて骨格を取ったコマだけ（間引いて取らなかったコマは、前の判定のままなので入れない）
    const counted = inp.present && inp.m !== undefined && this.gate.push(inp.t, inp.moving)
    const running = this.gate.running
    if (was && !running) this.camera.stopped()
    if (!was && running && this.camera.runFrom === null) this.camera.runFrom = this.active
    this.camera.running = running
    const g: GatedInput = { ...inp, moving: running }
    if (counted) g.steps = inp.moving
    return super.update(g)
  }

  // 走っていない（止まった）と見ている間と、今日の基準ができるまで（整えている間も）は、間引かずに毎コマ見る。
  // 走り出し・止まりを、飛び飛びの数コマではなく続けて見て決めるため（間引いた数コマだけで決めると、
  // 見えにくい1秒で「止まった」になり、基準を何度も作り直してしまう）。
  // そのあとも、正しいフォームの線を越えている・知らせて直るのを待っている間は毎コマ見る
  wantsDetail(): boolean {
    return !this.gate.running || this.leanRef === null || this.camera.form.busy(Math.floor(this.active)) || super.wantsDetail()
  }

  // 走り始めの基準にためた秒の数
  get refSeconds() {
    return this.camera.refSeconds
  }

  finish(speedKmh?: number): Session {
    return { ...this.summary(), speedKmh, samples: this.samples, strides: this.camera.strides(), form: this.camera.form.results(), gait: this.camera.gait.result() }
  }
}

export { itemScore }

// 基準からの崩れで見る姿勢の項目（腰と着地のほか）
const REL_KEYS: ItemKey[] = ['hunch', 'head', 'trunk', 'trunkBack', 'body', 'bodyBack']

// 基準 ref からの崩れ（点数の目盛り）：上体・体全体の前と後ろ（後ろは歩数で走っていた秒だけ）、頭、猫背
function relValues(v: FormValues, ref: Pick<Ref, 'neck' | 'headLean' | 'trunk' | 'body'>, stepping: boolean): Values<ItemKey> {
  const out: Values<ItemKey> = {
    hunch: hunchOf(v.trunk - ref.trunk, v.neck - ref.neck),
    head: headForward(v.neck - ref.neck, v.headLean - ref.headLean),
    trunk: toScale('trunk', v.trunk - ref.trunk),
    body: toScale('body', v.body - ref.body),
  }
  if (stepping) {
    out.trunkBack = toScale('trunkBack', ref.trunk - v.trunk)
    out.bodyBack = toScale('bodyBack', ref.body - v.body)
  }
  return out
}

// 猫背：今日の基準からの、上体（腰→肩）の前傾の増えと、首の角度（肩→耳の前傾 − 腰→肩の前傾）の増え ＋ HUNCH.neckSlack の、小さいほう。
// 背中が丸まると、肩が前に落ちて上体の線が前に傾き、頭もその先へ出るので、両方がいっしょに増える。
// 頭だけ前に出すと上体は傾かないので小さいまま。股関節から上体ごと前に倒す（背中はまっすぐ、首の角度は変わらない）と、
// HUNCH.neckSlack で頭打ちになり、どのレベルの線にも届かない（そちらは上体の前かがみの声）。くわしくは params.ts の HUNCH
export function hunchOf(trunkDelta: number, neckDelta: number): number {
  return Math.min(trunkDelta, neckDelta + HUNCH.neckSlack)
}

// 頭が前に出た量：首の角度の増え（頭が上体より前に出た）と、頭の位置そのものの増えの、小さいほう。
// 上体が起きると首の角度だけが増える（頭は動いていない）ので、頭の位置そのものも前に出たときだけ「頭が前」にする
export function headForward(neckDelta: number, headLeanDelta: number): number {
  return Math.min(neckDelta, headLeanDelta)
}

// 判定に使う値（LIMITS の目盛り）：今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう。どちらも無い項目は -Infinity。
// 姿勢を今日の基準と比べなかった秒（paused：速さを変えている途中と、そのあと基準をためなおしている間）は、基準からの崩れを使わない
export function judged(s: Sample, k: ItemKey): number {
  const f = s.form?.[k] ?? -Infinity
  if (k === 'landing') return Math.max(f, s.land?.drift ?? -Infinity)
  if (s.paused) return f
  if (k === 'hip') return s.hipDrop
  if (k === 'hunch') return s.hunch ?? -Infinity
  if (k === 'head') return Math.max(f, s.judge ? s.head : -Infinity)
  if (k === 'trunkBack') return Math.max(f, s.back?.trunk ?? -Infinity)
  if (k === 'bodyBack') return Math.max(f, s.back?.body ?? -Infinity)
  return Math.max(f, s.judge?.[k as 'trunk' | 'body'] ?? -Infinity)
}

// 増え方を、点数の目盛り（LIMITS）に直す：増え方の満点・声をかける線・0点が、LIMITS のそれぞれに重なるように
// （起きすぎの側は、今日の基準から後ろへ傾いた量を渡す）
export function toScale(k: 'trunk' | 'trunkBack' | 'body' | 'bodyBack', delta: number): number {
  const a = REL_LIMITS[k]
  const b = LIMITS[k]
  if (delta <= a.full) return b.full - (a.full - delta)
  if (delta <= a.cue) return b.full + ((delta - a.full) * (b.cue - b.full)) / (a.cue - a.full)
  return b.cue + ((delta - a.cue) * (b.zero - b.cue)) / (a.zero - a.cue)
}
