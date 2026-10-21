// 着地の位置（足が体より前に着く＝オーバーストライド）を、走りながらの骨格（毎秒13〜15コマ）から測る。数字は params.ts の LANDING
// （研究データの仮想実験は sim/result-landing.md、人の動画と自分の記録は form-videos/notes/判定テスト.md の 7）。
//   LandingMeter：1コマずつ。着地の瞬間のコマは決めない。左右の名前によらず、その瞬間に前にあるほうの足首の、腰からの前後の位置の山を
//     1歩ずつ取る（一番前に出た瞬間。歩数の数え方と同じ。Zeni ら 2008 の着地の見方）。となりのコマで放物線をあててコマの間まで細かく求め、
//     山のコマの値を1歩ずつ取る
//       reach：足首 − 腰（左右の股関節の真ん中）の前後の距離 ÷ 脚の長さ（一番前に出た量）
//       heel・toe：同じコマの、かかと・つま先 − 腰（かかとの前が、着地の瞬間のかかとの前に一番よく合った。アプリが見るのはこれ）
//       shank：同じコマのすねの角度（膝→足首の線と鉛直。足首が膝より前で正、度）
//       knee：膝の曲がり（度、まっすぐで0）
//       kneeGap：その脚の膝 − もう一方の膝（前後、÷ 脚の長さ）。3R の「着地で両膝が重なるか」に近いもの
//       legAng：腰→足首の線と鉛直の角度（度）
//       back：その前に、後ろにあるほうの足首が一番後ろへ行った位置（÷ 脚の長さ）。振れ幅 = reach − back
//     あわせて、接地している（画面で低いほうの）足首が後ろへ動く速さから、速さの目安（脚の長さ／秒）を出す。
//     トレッドミルでは、ベルトの速さ ÷ 脚の長さに比例する（仮想実験で相関 0.94）
//   LandingWatch：歩数で走っていた秒の山だけを残し、窓（LANDING.window 秒）でまとめる
//   SpeedGuard：速さの見張り。速さの目安（とピッチ）が今日の基準から外れた秒を見つけ、続いたら「速さが変わった」とする。着地と姿勢が同じものを使う
//   LandingDrift：今日の基準（整えたあとの形）からの増え。速さの見張りが外れとみた秒は比べず、速さが変わったら基準を作り直す
//   左右の名前ごとに山を取る見方（mode 'label'）は、仮想実験で比べるためだけのもの（アプリは 'lead'）
import type { Frame } from '../../core/types'
import { L } from './landmarks'
import { facing, legLength, mid } from './geometry'
import { FORM, LANDING } from './params'

export type Side = 'L' | 'R'
export interface Peak {
  t: number
  side: Side
  vis: number // その脚の足首・膝・かかとの確からしさの平均
  reach: number
  reachRaw: number // 放物線をあてる前（一番前のコマの値）
  heel: number
  toe: number
  shank: number
  knee: number
  kneeGap: number
  legAng: number
  back: number
  gap: number // 一番前のコマの前後のコマの間（秒）。間引きや抜けで広いと、山を取り逃がしやすい
}

export interface Track {
  t: number
  hx: number // 腰の前後の位置（画面の x × 走る向き ÷ 脚の長さ）
  hy: number // 腰の上下（下が正、÷ 脚の長さ）
  sv: number // 低いほうの足首が、前のコマから後ろへ動いた速さ（脚の長さ／秒）。前のコマと同じ足が低いときだけ。ほかは NaN
}

const DEG = 180 / Math.PI
export const PROMINENCE = 0.1 // 歩数の数え方（RUNNING.stepProminence）と同じ
const GAP_RESET = 0.5 // これより間があいたら数え直す（MotionDetector と同じ）
export const MIN_STEP = 0.2 // 'lead' で、山どうしがこれより近ければ、高いほうだけを残す（秒。毎分 300 歩より速い歩はない）
const SV_MIN = 0.3 // 速さの目安に使う、後ろへ動く速さの下限（脚の長さ／秒。止まっている足・宙に浮いた足を除く）

interface Row {
  t: number
  f: Frame
  dir: 1 | -1
  leg: number
  a: Record<Side, number>
  lead: number // 前にあるほうの足首（左右の名前によらない）
  leadSide: Side
  trail: number
  low: Side // 画面で低いほうの足首（接地している足）
}
interface LegState {
  seekMax: boolean
  ext: { n: number; v: number } // n：通しのコマの番号
  lastMin: number
}

export const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

// mode：
//   'lead'（ふつう）：左右の名前によらず、その瞬間に前にあるほうの足首の位置の山を1歩ずつ取る。骨格の推定が左右の脚の名前を
//     取り違えても、山の位置は変わらない（人の動画では、脚が交差するたびに名前が入れ替わることがあった）。どちらの脚の山かは、
//     そのとき前にあった脚の名前と、点の確からしさで見る
//   'label'：左右の名前ごとに山を取る（取り違えがあると、山がずれたり増えたりする。仮想実験で比べるため）
// keep：山（peaks）と速さの記録（track）を、直近この秒数だけ残す（アプリは長く走るので捨てる。なければ全部残す）
export class LandingMeter {
  peaks: Peak[] = []
  track: Track[] = []
  private rows: Row[] = [] // 直近のコマ（通しの番号 n0 から）
  private n0 = 0
  private legs: Record<Side | 'lead', LegState> = { L: this.fresh(), R: this.fresh(), lead: this.fresh() }
  private trailMin = Infinity
  private legHist: number[] = []
  private dirHist: number[] = []
  private lastT = -1e9
  readonly mode: 'lead' | 'label'
  private readonly keep: number

  constructor(mode: 'lead' | 'label' = 'lead', keep = Infinity) {
    this.mode = mode
    this.keep = keep
  }

  private fresh(): LegState {
    return { seekMax: true, ext: { n: -1, v: -Infinity }, lastMin: NaN }
  }

  update(f: Frame, t: number): Peak[] {
    if (t - this.lastT > GAP_RESET) {
      this.legs = { L: this.fresh(), R: this.fresh(), lead: this.fresh() }
      this.trailMin = Infinity
      this.n0 += this.rows.length
      this.rows = []
    }
    this.lastT = t
    const l0 = legLength(f)
    if (!(l0 > 0)) return []
    this.legHist.push(l0)
    if (this.legHist.length > 31) this.legHist.shift()
    this.dirHist.push(facing(f))
    if (this.dirHist.length > 31) this.dirHist.shift()
    const leg = median(this.legHist)
    const dir: 1 | -1 = this.dirHist.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1
    const hip = mid(f[L.leftHip], f[L.rightHip])
    const a = { L: ((f[L.leftAnkle].x - hip.x) * dir) / leg, R: ((f[L.rightAnkle].x - hip.x) * dir) / leg }
    const leadSide: Side = a.L >= a.R ? 'L' : 'R'
    const n = this.n0 + this.rows.length
    // 接地している足（低いほう）の足首が後ろへ動く速さ：トレッドミルでは、ベルトの速さ ÷ 脚の長さ（速さの目安）
    const low: Side = f[L.leftAnkle].y >= f[L.rightAnkle].y ? 'L' : 'R'
    const prev = this.rows[this.rows.length - 1]
    let sv = NaN
    if (prev && t - prev.t <= 0.15 && prev.low === low) sv = (prev.a[low] - a[low]) / (t - prev.t)
    this.track.push({ t, hx: (hip.x * dir) / leg, hy: hip.y / leg, sv })
    this.rows.push({ t, f, dir, leg, a, lead: Math.max(a.L, a.R), leadSide, trail: Math.min(a.L, a.R), low })
    // 古いコマは捨てる（山を確かめるまでに要るのは1歩ぶん。2秒残す）
    while (this.rows.length > 2 && t - this.rows[0].t > 2) {
      this.rows.shift()
      this.n0++
    }
    if (this.keep < Infinity) {
      while (this.track.length && t - this.track[0].t > this.keep) this.track.shift()
      while (this.peaks.length && t - this.peaks[0].t > this.keep) this.peaks.shift()
    }
    const out: Peak[] = []
    const keep = (p: Peak | null) => {
      if (!p) return
      if (this.mode === 'lead') {
        const last = this.peaks[this.peaks.length - 1]
        if (last && p.t - last.t < MIN_STEP) {
          if (p.reach > last.reach) {
            this.peaks[this.peaks.length - 1] = p
            out.push(p)
          }
          return
        }
      }
      out.push(p)
      this.peaks.push(p)
    }
    if (this.mode === 'lead') {
      const st = this.legs.lead
      const v = Math.max(a.L, a.R)
      this.trailMin = Math.min(this.trailMin, Math.min(a.L, a.R))
      if (st.seekMax) {
        if (v > st.ext.v) st.ext = { n, v }
        else if (v < st.ext.v - PROMINENCE) {
          keep(this.peakAt(null, st.ext.n, this.trailMin))
          this.trailMin = Infinity
          st.seekMax = false
          st.ext = { n, v }
        }
      } else if (v < st.ext.v) st.ext = { n, v }
      else if (v > st.ext.v + PROMINENCE) {
        st.seekMax = true
        st.ext = { n, v }
      }
      return out
    }
    for (const s of ['L', 'R'] as Side[]) {
      const st = this.legs[s]
      const v = a[s]
      if (st.seekMax) {
        if (v > st.ext.v) st.ext = { n, v }
        else if (v < st.ext.v - PROMINENCE) {
          keep(this.peakAt(s, st.ext.n, st.lastMin))
          st.seekMax = false
          st.ext = { n, v }
        }
      } else if (v < st.ext.v) st.ext = { n, v }
      else if (v > st.ext.v + PROMINENCE) {
        st.lastMin = st.ext.v
        st.seekMax = true
        st.ext = { n, v }
      }
    }
    return out
  }

  private row(n: number): Row | undefined {
    return this.rows[n - this.n0]
  }

  // 一番前のコマ n のまわりで放物線をあてる。前のコマがない（数え直した直後の山）ときは、本当の山を取る前に過ぎたかもしれないので使わない。
  // side が null なら、前にあるほうの足首（'lead'）
  private peakAt(side: Side | null, n: number, back: number): Peak | null {
    const r = this.row(n)
    const p = this.row(n - 1)
    const q = this.row(n + 1)
    if (!r || !p || !q) return null
    const s: Side = side ?? r.leadSide
    const val = (x: Row) => (side ? x.a[side] : x.lead)
    const [t0, t1, t2] = [p.t, r.t, q.t]
    const [y0, y1, y2] = [val(p), val(r), val(q)]
    // 3点を通る放物線 y(t) = y0 + d0 (t − t0) + A (t − t0)(t − t1) の頂点（間隔がそろっていなくてもよい形）。
    // 頂点は、となりのコマとの真ん中までに抑える
    const d0 = (y1 - y0) / (t1 - t0)
    const d1 = (y2 - y1) / (t2 - t1)
    const A = (d1 - d0) / (t2 - t0)
    let tp = t1
    let yp = y1
    if (A < 0) {
      tp = Math.min((t1 + t2) / 2, Math.max((t0 + t1) / 2, (t0 + t1) / 2 - d0 / (2 * A)))
      yp = y0 + d0 * (tp - t0) + A * (tp - t0) * (tp - t1)
    }
    const f = r.f
    const dir = r.dir
    const leg = r.leg
    const hip = mid(f[L.leftHip], f[L.rightHip])
    const K = s === 'L' ? { hip: L.leftHip, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, toe: L.leftFoot, knee2: L.rightKnee } : { hip: L.rightHip, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, toe: L.rightFoot, knee2: L.leftKnee }
    const fx = (i: number) => ((f[i].x - hip.x) * dir) / leg
    const ank = f[K.ankle]
    const kn = f[K.knee]
    const hp = f[K.hip]
    const th = [hp.x - kn.x, hp.y - kn.y]
    const sh = [ank.x - kn.x, ank.y - kn.y]
    const inner = Math.acos(Math.max(-1, Math.min(1, (th[0] * sh[0] + th[1] * sh[1]) / (Math.hypot(th[0], th[1]) * Math.hypot(sh[0], sh[1]) || 1)))) * DEG
    return {
      t: tp,
      side: s,
      vis: (ank.v + kn.v + f[K.heel].v) / 3,
      reach: yp,
      reachRaw: y1,
      heel: fx(K.heel),
      toe: fx(K.toe),
      shank: Math.atan2((ank.x - kn.x) * dir, ank.y - kn.y) * DEG,
      knee: 180 - inner,
      kneeGap: ((kn.x - f[K.knee2].x) * dir) / leg,
      legAng: Math.atan2((ank.x - hip.x) * dir, ank.y - hip.y) * DEG,
      back,
      gap: t2 - t0,
    }
  }
}

// ---- 窓のまとめ ----

export type Feature = 'reach' | 'reachRaw' | 'heel' | 'toe' | 'shank' | 'knee' | 'kneeGap' | 'legAng' | 'front'
export const FEATURES: Feature[] = ['reach', 'reachRaw', 'heel', 'toe', 'shank', 'knee', 'kneeGap', 'legAng', 'front']
export const value = (p: Peak, k: Feature) => (k === 'front' ? p.reach / (p.reach - p.back) : p[k])

export interface WindowSummary {
  n: number // 手前の脚の山の数
  nAll: number
  near: Side
  med: Record<Feature, number> // 手前の脚（名前で分けたもの）の中央値
  medAll: Record<Feature, number> // 両脚の中央値
  medHi: Record<Feature, number> // 点の確からしさが窓の中央値以上の山（名前によらない手前の脚の見方）の中央値
  strideSec: number // 手前の脚の山の間隔の中央値（1周）
  stepSec: number // 両脚の山の間隔の中央値（1歩）
}

// 手前の脚：山の確からしさ（足首・膝・かかと）の平均が高いほうの名前
export function nearSideOf(ps: Peak[]): Side {
  const visOf = (s: Side) => {
    const xs = ps.filter((p) => p.side === s).map((p) => p.vis)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : -1
  }
  return visOf('L') >= visOf('R') ? 'L' : 'R'
}

// 窓の速さの目安（脚の長さ／秒）：接地している足首が後ろへ動く速さの中央値。走っていれば 1〜5 ほど
export function speedOf(track: Track[], t0: number, t1: number): number {
  return median(track.filter((x) => x.t >= t0 && x.t < t1 && x.sv > SV_MIN).map((x) => x.sv))
}

// 窓 [t0, t1) の山をまとめる（仮想実験・確かめの道具で使う、すべての値の中央値）。手前の脚は、渡さなければ確からしさで決める
export function summarize(peaks: Peak[], t0: number, t1: number, near?: Side): WindowSummary | null {
  const ps = peaks.filter((p) => p.t >= t0 && p.t < t1 && Number.isFinite(p.reach))
  if (!ps.length) return null
  const nr: Side = near ?? nearSideOf(ps)
  const np = ps.filter((p) => p.side === nr)
  const vm = median(ps.map((p) => p.vis))
  const hp = ps.filter((p) => p.vis >= vm)
  const medOf = (xs: Peak[]) => Object.fromEntries(FEATURES.map((k) => [k, median(xs.map((p) => value(p, k)))])) as Record<Feature, number>
  const iv = np.slice(1).map((p, i) => p.t - np[i].t).filter((d) => d >= 0.45 && d <= 1.4)
  const st = ps.slice(1).map((p, i) => p.t - ps[i].t).filter((d) => d >= 0.2 && d <= 0.7)
  return { n: np.length, nAll: ps.length, near: nr, med: medOf(np), medAll: medOf(ps), medHi: medOf(hp), strideSec: median(iv), stepSec: median(st) }
}

// 速さの目安から見込む、かかとの前（LANDING.fit）。速さで補正した着地の前 = かかとの前 − これ
export const expectedHeel = (speed: number) => LANDING.fit.a + LANDING.fit.b * speed

// アプリが見る、窓の着地の値
export interface LandingWindow {
  n: number // 手前の脚の山の数
  near: Side
  heel: number // 手前の脚のかかとの前の中央値（脚の長さに対する割合）
  speed: number // 速さの目安の中央値（脚の長さ／秒）
  res: number // 速さで補正したかかとの前（heel − expectedHeel(speed)）。正しいフォームの線（FORM.landing.max）と比べる値
  cadence: number // ピッチ（歩／分）：手前の脚の山の間隔（1周）の中央値から。出せなければ NaN
}

// 手前の脚の山の間隔（1周 0.45〜1.4 秒のものだけ）の中央値から、ピッチ（歩／分）
const cadenceOf = (ps: Peak[]) => 120 / median(ps.slice(1).map((p, i) => p.t - ps[i].t).filter((d) => d >= 0.45 && d <= 1.4))

// 山と速さの目安（接地している足首が後ろへ動く速さ）から、窓の値を出す。手前の脚の山が LANDING.minSteps に足りないか、
// 速さの目安がないときは null。near：手前の脚（渡さなければ、確からしさで決める）
export function landingOf(peaks: Peak[], sv: number[], near?: Side): LandingWindow | null {
  const ps = peaks.filter((p) => Number.isFinite(p.heel))
  if (!ps.length) return null
  const nr = near ?? nearSideOf(ps)
  const heels = ps.filter((p) => p.side === nr).map((p) => p.heel)
  const speed = median(sv.filter((v) => v > SV_MIN))
  if (heels.length < LANDING.minSteps || !Number.isFinite(speed)) return null
  const heel = median(heels)
  return { n: heels.length, near: nr, heel, speed, res: heel - expectedHeel(speed), cadence: cadenceOf(ps.filter((p) => p.side === nr).sort((a, b) => a.t - b.t)) }
}

// ---- 走っていた秒だけを残す ----

// 1秒ぶんの、歩数で走っていた秒の山と速さの目安（走っていなかった秒は空）
export interface StepSec {
  peaks: Peak[]
  sv: number[]
}
const EMPTY: StepSec = { peaks: [], sv: [] }

// 1コマずつ山を取り、1秒ごとに、その秒に歩数で走っていたときの山だけを残す（歩きの着地は走りよりはっきり前に出るため。
// 自分の記録で +0.19〜+0.25）。山は一番前に出た少しあと（足首が脚の長さの1割戻ってから）に見つかるので、1秒おくらせて振り分ける
export class LandingWatch {
  readonly meter = new LandingMeter('lead', 6)
  private peaks: Peak[] = [] // 走っていた秒の山（直近 KEEP 秒）
  private sv: { t: number; v: number }[] = []
  private secs: { to: number; frames: number }[] = [] // 秒ごとの、骨格を取ったコマの数（間引いているかを見る）
  private frames = 0
  private spanEnd: number | null = null
  private prev: { from: number; to: number; stepping: boolean } | null = null
  private doneTo = -Infinity // 振り分けを終えた時刻
  now = -Infinity // いちばん新しいコマの時刻（実時間の秒）

  // 骨格を取ったコマ（なめらかにして傾きを直したもの）
  frame(f: Frame, t: number) {
    this.meter.update(f, t)
    this.frames++
    this.now = Math.max(this.now, t)
  }

  // 時間だけ進んだコマ（骨格を取らなかったコマ）
  tick(t: number) {
    this.now = Math.max(this.now, t)
  }

  // 1秒の終わり。stepping：この秒に歩数で走っていたか。戻り値は、1つ前の秒の山と速さの目安（その秒に走っていなければ空）
  second(stepping: boolean): StepSec {
    const now = this.now
    const from = this.spanEnd ?? now - 1
    this.secs.push({ to: now, frames: this.frames })
    this.frames = 0
    while (this.secs.length && now - this.secs[0].to > LANDING.thinWindow + 2) this.secs.shift()
    const prev = this.prev
    this.prev = { from, to: now, stepping }
    this.spanEnd = now
    if (!prev) return EMPTY
    this.doneTo = prev.to
    if (!prev.stepping) return EMPTY
    const out: StepSec = {
      peaks: this.meter.peaks.filter((p) => p.t > prev.from && p.t <= prev.to),
      sv: this.meter.track.filter((x) => x.t > prev.from && x.t <= prev.to && x.sv > SV_MIN).map((x) => x.sv),
    }
    this.peaks.push(...out.peaks)
    this.sv.push(...out.sv.map((v) => ({ t: prev.to, v })))
    const keep = LANDING.thinWindow + 2
    while (this.peaks.length && now - this.peaks[0].t > keep) this.peaks.shift()
    while (this.sv.length && now - this.sv[0].t > keep) this.sv.shift()
    return out
  }

  // 細かく見ているか：直近 LANDING.window 秒のうち、骨格を3コマ以上取った秒が FORM.coverage 以上
  dense(): boolean {
    const xs = this.secs.filter((s) => s.to > this.now - LANDING.window)
    return xs.filter((s) => s.frames >= 3).length >= Math.ceil(LANDING.window * FORM.coverage)
  }

  // 窓の値：振り分けを終えたところまでの、直近 sec 秒の走っていた秒の山。sec を渡さなければ、細かく見ているなら LANDING.window、
  // 間引いて見ているなら LANDING.thinWindow
  window(sec = this.dense() ? LANDING.window : LANDING.thinWindow, near?: Side): LandingWindow | null {
    const from = this.doneTo - sec
    return landingOf(
      this.peaks.filter((p) => p.t > from && p.t <= this.doneTo),
      this.sv.filter((x) => x.t > from).map((x) => x.v),
      near,
    )
  }
}

// ---- 今日の基準からの増え ----

export interface LandingRef {
  heel: number
  speed: number
  near: Side
  n: number
  cadence: number // ピッチ（歩／分。出せなければ NaN）
}

// 山をまとめて基準にする（手前の脚の山が LANDING.refSteps に足りないか、速さの目安がなければ null）
export function refOf(peaks: Peak[], sv: number[]): LandingRef | null {
  if (!peaks.length) return null
  const near = nearSideOf(peaks)
  const heels = peaks.filter((p) => p.side === near).map((p) => p.heel).filter(Number.isFinite)
  const speed = median(sv)
  if (heels.length < LANDING.refSteps || !Number.isFinite(speed)) return null
  return { heel: median(heels), speed, near, n: heels.length, cadence: cadenceOf(peaks.filter((p) => p.side === near).sort((a, b) => a.t - b.t)) }
}

// 速さの見張り：比べる速さ（今日の基準の速さの目安とピッチ）から、いまの窓の値が外れていないかを1秒ごとに見る。
// 着地（LandingDrift）と姿勢（coach.ts の CameraAnalyzer）が同じ見張りを使い、「速さが変わった」を同じに決める。
// 速さの目安が LANDING.speedGuard を越えて変わった秒（一度越えたら LANDING.speedBack の内側に戻るまで）と、ピッチが LANDING.cadenceUp を越えて
// 上がった秒は外れ（比べない）。それが LANDING.speedHold 秒続いたら、速さが変わったとみて、そのときの速さを新しい比べる速さにする
export type SpeedCheck = 'same' | 'away' | 'changed'
export class SpeedGuard {
  base: { speed: number; cadence: number } | null = null // 比べる速さ（ピッチがなければ NaN で、ピッチは見ない）
  off = 0 // 外れて、比べずにいる秒（続けて外れた秒の数）
  changes = 0 // 速さが変わったとみた回数

  set(speed: number | null, cadence = NaN) {
    this.base = speed === null ? null : { speed, cadence }
    this.off = 0
  }

  // 1秒ごと（窓の値があり、歩数で走っていた秒だけ）。比べる速さがまだなければ、この窓の速さにする
  check(w: LandingWindow): SpeedCheck {
    if (!this.base) {
      this.set(w.speed)
      return 'same'
    }
    // ピッチが上がったのに足が前に出たなら、速さを上げた（トレッドミルの同じ速さで大またにすると、ピッチは下がる）
    const faster = w.cadence > this.base.cadence * (1 + LANDING.cadenceUp)
    const r = Math.abs(w.speed / this.base.speed - 1)
    if (!faster && !(this.off > 0 ? r > LANDING.speedBack : r > LANDING.speedGuard)) {
      this.off = 0
      return 'same'
    }
    if (++this.off < LANDING.speedHold) return 'away'
    this.changes++
    this.set(w.speed)
    return 'changed'
  }
}

// 今日の基準と比べる。基準は、整えたあとの形をためたもの（coach.ts の CameraAnalyzer が set で渡す）。
// 速さの見張り（SpeedGuard）が外れとみた秒は比べない。速さが変わったとみたら、基準を捨て、新しい速さで LANDING.rebuild 秒ためて作り直す
// （ためている間に速さがまた変わったら、ため直す）。基準がうまく作れなかったときも、同じようにためて作る
export class LandingDrift {
  ref: LandingRef | null = null
  rebuilds = 0 // 速さが変わって作り直した回数
  readonly guard = new SpeedGuard()
  private pool: { peaks: Peak[]; sv: number[]; secs: number } | null = null

  // 基準を渡す（作れなければ、ためて作る。比べる速さは、ためはじめの窓の速さ）
  set(ref: LandingRef | null) {
    this.ref = ref
    this.guard.set(ref ? ref.speed : null, ref ? ref.cadence : NaN)
    this.pool = ref ? null : { peaks: [], sv: [], secs: 0 }
  }

  get building() {
    return this.pool !== null
  }

  // 1秒ごと。w：いまの窓の値（基準の手前の脚で出したもの）、sec：この秒に振り分けた山と速さの目安、stepping：歩数で走っていた秒か。
  // 戻り値は、基準からのかかとの前の増え（比べなかった秒は undefined）
  judge(w: LandingWindow | null, sec: StepSec, stepping: boolean): number | undefined {
    if (!stepping) return undefined
    const c = w ? this.guard.check(w) : 'same'
    if (this.ref) {
      if (!w || c === 'away') return undefined
      if (c === 'changed') {
        this.rebuilds++
        this.ref = null
        this.pool = { peaks: [], sv: [], secs: 0 }
        return undefined
      }
      return w.heel - this.ref.heel
    }
    if (!this.pool || c === 'away') return undefined
    // ためている間に速さが変わったら（速さを段階的に上げているときなど）、新しい速さでため直す
    if (c === 'changed') {
      this.pool = { peaks: [], sv: [], secs: 0 }
      return undefined
    }
    const p = this.pool
    p.peaks.push(...sec.peaks)
    p.sv.push(...sec.sv)
    p.secs++
    if (p.secs >= LANDING.rebuild) {
      const ref = refOf(p.peaks, p.sv)
      if (ref) this.set(ref)
      // 山がなかなかたまらない（足が映りにくい）ときは、古い分を捨ててため直す（ずっと前の形を基準にしないため）
      else if (p.secs >= 3 * LANDING.rebuild) this.pool = { peaks: [], sv: [], secs: 0 }
    }
    return undefined
  }
}
