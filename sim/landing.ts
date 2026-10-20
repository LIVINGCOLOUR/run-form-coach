// 着地が体より前か（オーバーストライド）を、走りながらの骨格（毎秒13〜15コマ）から測る試し。アプリには入れていない（仮想実験・動画・記録で確かめる道具。
// 結果は sim/result-landing.md と form-videos/notes/判定テスト.md の 7）
//   着地の瞬間のコマは決めない。左右の名前によらず、その瞬間に前にあるほうの足首の、腰からの前後の位置の山を1歩ずつ取る
//   （一番前に出た瞬間。歩数の数え方と同じ。Zeni ら 2008 の着地の見方）。となりのコマで放物線をあててコマの間まで細かく求め、
//   山のコマの値を1歩ずつ取る
//     reach：足首 − 腰（左右の股関節の真ん中）の前後の距離 ÷ 脚の長さ（一番前に出た量）
//     heel・toe：同じコマの、かかと・つま先 − 腰（かかとの前が、着地の瞬間のかかとの前に一番よく合った）
//     shank：同じコマのすねの角度（膝→足首の線と鉛直。足首が膝より前で正、度）
//     knee：膝の曲がり（度、まっすぐで0）
//     kneeGap：その脚の膝 − もう一方の膝（前後、÷ 脚の長さ）。3R の「着地で両膝が重なるか」に近いもの
//     legAng：腰→足首の線と鉛直の角度（度）
//     back：その前に、後ろにあるほうの足首が一番後ろへ行った位置（÷ 脚の長さ）。振れ幅 = reach − back
//   1歩ずつの値は、窓の中の中央値でまとめる。手前の脚は、窓の中で点の確からしさが高いほうの名前
//   あわせて、接地している（画面で低いほうの）足首が後ろへ動く速さから、速さの目安（脚の長さ／秒）を出す
import type { Frame } from '../src/core/types'
import { L } from '../src/modes/camera/landmarks'
import { facing, legLength, mid } from '../src/modes/camera/geometry'

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

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

// mode：
//   'lead'（ふつう）：左右の名前によらず、その瞬間に前にあるほうの足首の位置の山を1歩ずつ取る。骨格の推定が左右の脚の名前を
//     取り違えても、山の位置は変わらない（人の動画では、脚が交差するたびに名前が入れ替わることがあった）。どちらの脚の山かは、
//     そのとき前にあった脚の名前と、点の確からしさで見る
//   'label'：左右の名前ごとに山を取る（取り違えがあると、山がずれたり増えたりする）
export const MIN_STEP = 0.2 // 'lead' で、山どうしがこれより近ければ、高いほうだけを残す（秒。毎分 300 歩より速い歩はない）

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

  constructor(mode: 'lead' | 'label' = 'lead') {
    this.mode = mode
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

// 窓の速さの目安（脚の長さ／秒）：接地している足首が後ろへ動く速さの中央値。走っていれば 2〜5 ほど
export function speedOf(track: Track[], t0: number, t1: number): number {
  return median(track.filter((x) => x.t >= t0 && x.t < t1 && x.sv > 0.3).map((x) => x.sv))
}

// 窓 [t0, t1) の山をまとめる。手前の脚は、窓の中の山の確からしさ（足首・膝・かかと）の平均が高いほうの名前
export function summarize(peaks: Peak[], t0: number, t1: number, near?: Side): WindowSummary | null {
  const ps = peaks.filter((p) => p.t >= t0 && p.t < t1 && Number.isFinite(p.reach))
  if (!ps.length) return null
  const visOf = (s: Side) => {
    const xs = ps.filter((p) => p.side === s).map((p) => p.vis)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : -1
  }
  const nr: Side = near ?? (visOf('L') >= visOf('R') ? 'L' : 'R')
  const np = ps.filter((p) => p.side === nr)
  const vm = median(ps.map((p) => p.vis))
  const hp = ps.filter((p) => p.vis >= vm)
  const medOf = (xs: Peak[]) => Object.fromEntries(FEATURES.map((k) => [k, median(xs.map((p) => value(p, k)))])) as Record<Feature, number>
  const iv = np.slice(1).map((p, i) => p.t - np[i].t).filter((d) => d >= 0.45 && d <= 1.4)
  const st = ps.slice(1).map((p, i) => p.t - ps[i].t).filter((d) => d >= 0.2 && d <= 0.7)
  return { n: np.length, nAll: ps.length, near: nr, med: medOf(np), medAll: medOf(ps), medHi: medOf(hp), strideSec: median(iv), stepSec: median(st) }
}

// 腰の前後・上下の揺れの、1歩の周期の成分の大きさ（÷ 脚の長さ、山から谷の半分）。
// 1周ぶん（前後に半周ずつ）のならしで、ゆっくりした動きを除いてから、1歩の周期（1周の半分）の正弦をあてる
export function hipSway(track: Track[], t0: number, t1: number, strideSec: number) {
  const tr = track.filter((x) => x.t >= t0 && x.t < t1)
  if (tr.length < 20 || !(strideSec > 0)) return { fa: NaN, vert: NaN }
  const w = strideSec / 2
  const detr = (k: 'hx' | 'hy') =>
    tr.map((x) => {
      const nb = tr.filter((y) => Math.abs(y.t - x.t) <= w)
      return x[k] - nb.reduce((a, y) => a + y[k], 0) / nb.length
    })
  const om = (2 * Math.PI) / (strideSec / 2)
  const fit = (ys: number[]) => {
    // 最小二乗で a cos + b sin
    let cc = 0
    let ss = 0
    let cs = 0
    let yc = 0
    let ys2 = 0
    tr.forEach((x, i) => {
      const c = Math.cos(om * x.t)
      const s = Math.sin(om * x.t)
      cc += c * c
      ss += s * s
      cs += c * s
      yc += ys[i] * c
      ys2 += ys[i] * s
    })
    const det = cc * ss - cs * cs
    const a = (yc * ss - ys2 * cs) / det
    const b = (ys2 * cc - yc * cs) / det
    return Math.hypot(a, b)
  }
  return { fa: fit(detr('hx')), vert: fit(detr('hy')) }
}
