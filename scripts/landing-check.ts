// 着地が体より前か（オーバーストライド）の測り方の試しを、本物の骨格の点に通す（scripts/landing-check.mjs から rolldown で読む）。
// アプリ本体（src/）は読むだけで変えない。測り方はアプリと同じ src/modes/camera/landing.ts（sim/landing.ts から読む）
//   動画（scripts/video-judge の点）：毎秒30コマで取った点と、毎秒15コマで取った点。30コマの点は、15・13コマに間引いても見る。
//     アプリと同じく One Euro でなめらかにし、全身が見えるコマだけを使う（なめらかにしない場合も出す）
//   記録（カメラ版の記録 rfc-….json）：記録の点は、アプリがなめらかにして傾きを直したあとのもの。Mac の声の区間（drill-….json）で切る
import { OneEuro } from '../src/modes/camera/filter'
import { bodyVisible } from '../src/modes/camera/motion'
import type { Frame, RunLog } from '../src/core/types'
import { LandingMeter, summarize, hipSway, speedOf, expectedHeel, FEATURES, value, type Feature, type Peak, type Side } from '../sim/landing'
import { findJump } from './treadmill/replay'

export interface LandmarkClip {
  id: string
  fps: number
  width: number
  height: number
  frames: { t: number; p: [number, number, number][] | null }[]
}
type TF = { t: number; f: Frame }

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const mean = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN
}
const sd = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  const m = mean(s)
  return s.length > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)) : NaN
}
const q = (xs: number[], p: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN
}

// 動画の点 → 全身が見えるコマ（fps を渡すと、その間隔に一番近いコマだけを残して間引く）
export function clipFrames(c: LandmarkClip, opts: { fps?: number; smooth?: boolean } = {}): TF[] {
  let fr = c.frames
  if (opts.fps && opts.fps < c.fps) {
    const out: typeof fr = []
    const t0 = fr[0].t
    let k = 0
    for (let i = 0; i < fr.length; i++) {
      const want = t0 + k / opts.fps
      if (fr[i].t + 0.5 / c.fps >= want) {
        out.push(fr[i])
        k++
        while (t0 + k / opts.fps <= fr[i].t) k++
      }
    }
    fr = out
  }
  const filters = Array.from({ length: 66 }, () => new OneEuro())
  const res: TF[] = []
  let prev: [number, number, number][] | null = null
  for (const x of fr) {
    if (!x.p) continue
    // 止まったコマ（動画の一時停止・説明の静止画）：点が前のコマとほとんど同じなら使わない
    const still = prev && x.p.every((q, i) => Math.abs(q[0] - prev![i][0]) < 0.0015 && Math.abs(q[1] - prev![i][1]) < 0.0015)
    prev = x.p
    if (still) continue
    const f: Frame = x.p.map(([px, py, v], i) =>
      opts.smooth === false ? { x: px * c.width, y: py * c.height, v } : { x: filters[i * 2].filter(px * c.width, x.t), y: filters[i * 2 + 1].filter(py * c.height, x.t), v },
    )
    if (bodyVisible(f, 0.5, c.height)) res.push({ t: x.t, f })
  }
  return res
}

export function meterOf(frames: TF[], mode: 'lead' | 'label' = 'lead') {
  const m = new LandingMeter(mode)
  for (const { t, f } of frames) m.update(f, t)
  return m
}

export interface Stat {
  n: number
  nAll: number
  near: Side
  med: Record<Feature, number>
  medAll: Record<Feature, number>
  medHi: Record<Feature, number>
  medFar: Record<Feature, number>
  sdNear: Record<Feature, number> // 1歩ずつのばらつき（手前の脚）
  strideSec: number
  cadence: number
  fa: number
  vert: number
  speedL: number // 速さの目安（脚の長さ／秒）
  peaks: Peak[]
}

export function statOf(m: LandingMeter, t0: number, t1: number, near?: Side): Stat | null {
  const s = summarize(m.peaks, t0, t1, near)
  if (!s) return null
  const np = m.peaks.filter((p) => p.t >= t0 && p.t < t1 && p.side === s.near)
  const fp = m.peaks.filter((p) => p.t >= t0 && p.t < t1 && p.side !== s.near)
  const stride = Number.isFinite(s.strideSec) ? s.strideSec : 2 * s.stepSec
  const sw = hipSway(m.track, t0, t1, stride)
  return {
    n: s.n,
    nAll: s.nAll,
    near: s.near,
    med: s.med,
    medAll: s.medAll,
    medHi: s.medHi,
    medFar: Object.fromEntries(FEATURES.map((k) => [k, median(fp.map((p) => value(p, k)))])) as Record<Feature, number>,
    sdNear: Object.fromEntries(FEATURES.map((k) => [k, sd(np.map((p) => value(p, k)))])) as Record<Feature, number>,
    strideSec: stride,
    cadence: 60 / s.stepSec,
    fa: sw.fa,
    vert: sw.vert,
    speedL: speedOf(m.track, t0, t1),
    peaks: np,
  }
}

// ---- 動画 ----
export interface ClipConfig {
  clips: { id: string; title: string; windows: { role: 'bad' | 'good'; name: string; from: number; to: number }[] }[]
}
export const VIDEO_CONDS = [
  { key: 'c30', label: '30コマ', fps: undefined as number | undefined, smooth: true, src: 30 },
  { key: 'c30raw', label: '30コマ・なめらかにしない', fps: undefined, smooth: false, src: 30 },
  { key: 'c15', label: '15コマで取った点', fps: undefined, smooth: true, src: 15 },
  { key: 'd15', label: '30コマ→15コマに間引く', fps: 15, smooth: true, src: 30 },
  { key: 'd13', label: '30コマ→13コマに間引く', fps: 13, smooth: true, src: 30 },
]
export function videoStats(config: ClipConfig, lm30: Record<string, LandmarkClip>, lm15: Record<string, LandmarkClip>) {
  const out: { id: string; title: string; role: string; name: string; from: number; to: number; cond: string; st: Stat | null }[] = []
  for (const c of config.clips) {
    for (const cond of VIDEO_CONDS) {
      const lm = cond.src === 30 ? lm30[c.id] : lm15[c.id]
      if (!lm) continue
      const m = meterOf(clipFrames(lm, { fps: cond.fps, smooth: cond.smooth }))
      for (const w of c.windows) out.push({ id: c.id, title: c.title, role: w.role, name: w.name, from: w.from, to: w.to, cond: cond.key, st: statOf(m, w.from, w.to) })
    }
  }
  return out
}

// ---- 記録 ----
export function logFrames(file: unknown): { frames: TF[]; toMs: (t: number) => number; height: number } {
  const o = file as { log?: RunLog }
  const log = (o.log ?? file) as RunLog
  const off = log.columns.length - 1
  const iPhase = log.columns.indexOf('phase')
  const iVis = log.columns.indexOf('visible')
  const c = log.clock!
  const frames: TF[] = []
  for (const r of log.rows) {
    if (r.length < off + log.points.length * 3 || r[iPhase] !== 2 || r[iVis] !== 1) continue
    const f: Frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
    log.points.forEach((pi, k) => (f[pi] = { x: r[off + k * 3], y: r[off + k * 3 + 1], v: r[off + k * 3 + 2] }))
    frames.push({ t: r[0], f })
  }
  return { frames, toMs: (t) => c.epochMs + t * 1000 - c.perfMs, height: log.height }
}

export interface DrillSection {
  key: string
  kind: string
  name: string
  start: number
  end: number
  after?: string
}
export function logStats(drill: { sections: DrillSection[]; jumpAt?: number }, file: unknown, offsetMs = 0) {
  const { frames, toMs } = logFrames(file)
  const m = meterOf(frames)
  const fromMs = (T: number) => frames.length ? (T + offsetMs - toMs(0)) / 1000 : 0 // ふつうの時刻（Mac）→ 記録の t
  const jump = drill.jumpAt ? findJump(file, drill.jumpAt + offsetMs) : null
  // 区間ごと（はじめの 8 秒は、走り方を変えている途中なので除く）
  const SETTLE = 8
  const sections = drill.sections
    .filter((s) => ['normal', 'drill', 'gap', 'speedup', 'speed', 'moved'].includes(s.kind))
    .map((s) => {
      const t0 = fromMs(s.start) + SETTLE
      const t1 = fromMs(s.end)
      return { ...s, t0, t1, st: t1 - t0 > 5 ? statOf(m, t0, t1) : null }
    })
  // ふつうの区間の窓（16秒・6秒、1秒ずつずらす）。手前の脚は区間全体で決めたもの
  const windows = (key: string, len: number) => {
    const out: { t: number; st: ReturnType<typeof summarize> }[] = []
    for (const s of sections.filter((x) => x.key === key)) {
      const near = s.st?.near
      for (let a = s.t0; a + len <= s.t1; a += 1) out.push({ t: a, st: summarize(m.peaks, a, a + len, near) })
    }
    return out
  }
  return { m, frames, sections, windows, jump, toT: fromMs }
}

// 今日の基準からの増え（崩れの線）を、ふつうの区間で試す。基準は最初のふつうの区間（はじめの refSkip 秒を除く）の、手前の脚の中央値。
// 窓（len 秒、1秒ずつずらす）の中央値が 基準 + 線 を越えた割合と、越えた回数（声の間 CUE.cooldown＝30秒をあけて数える）を出す。
// thin を付けると、アプリのふだんの間引き（安定して走っている間は10秒のうち3秒だけ骨格を取る）をまねて、その3秒のコマだけを使う
export function driftCheck(L: ReturnType<typeof logStats>, o: { feature: Feature; lines: number[]; len: number; thin?: boolean; refKey?: string; refSkip?: number; testKeys?: string[] }) {
  const refSec = L.sections.find((x) => x.key === (o.refKey ?? 'normal1'))!
  const near = refSec.st?.near ?? 'L'
  let peaks = L.m.peaks
  if (o.thin) {
    const fr = L.frames.filter((x) => ((x.t % 10) + 10) % 10 < 3)
    peaks = meterOf(fr).peaks
  }
  const vals = (a: number, b: number) => peaks.filter((p) => p.t >= a && p.t < b && p.side === near).map((p) => value(p, o.feature))
  const ref = median(vals(refSec.t0 + (o.refSkip ?? 30), refSec.t1))
  const tests = L.sections.filter((x) => (o.testKeys ?? ['normal2']).includes(x.key))
  const ws: { t: number; d: number; n: number }[] = []
  for (const s of tests) {
    for (let a = s.t0; a + o.len <= s.t1; a += 1) {
      const v = vals(a, a + o.len)
      if (v.length >= Math.max(3, Math.floor(o.len / 3))) ws.push({ t: a + o.len, d: median(v) - ref, n: v.length })
    }
  }
  const minutes = tests.reduce((acc, s) => acc + (s.t1 - s.t0) / 60, 0)
  const lines = o.lines.map((line) => {
    let count = 0
    let last = -1e9
    for (const w of ws) if (w.d > line && w.t - last >= 30) (count++, (last = w.t))
    return { line, share: ws.filter((w) => w.d > line).length / Math.max(1, ws.length), per10: minutes ? (count / minutes) * 10 : NaN }
  })
  const drills = L.sections.filter((x) => x.kind === 'drill' || x.kind === 'gap').map((x) => {
    const v = vals(x.t0, x.t1)
    return { key: x.key, name: x.name, after: x.after, n: v.length, d: v.length >= 3 ? median(v) - ref : NaN }
  })
  const ds = ws.map((w) => w.d)
  return { ref, near, n: ws.length, minutes, q05: q(ds, 0.05), q50: q(ds, 0.5), q95: q(ds, 0.95), max: q(ds, 1), sd: sd(ds), lines, drills }
}

// 速さを考えた「着地の前」：かかとの前 −（仮想実験のふつうの走り185本の当てはめ。アプリと同じ LANDING.fit）。sim/result-landing.md の ④
export function absCheck(L: ReturnType<typeof logStats>, keys: string[], len = 16) {
  const out: { t: number; heel: number; speedL: number; res: number; shank: number }[] = []
  for (const s of L.sections.filter((x) => keys.includes(x.key))) {
    const near = s.st?.near
    for (let a = s.t0; a + len <= s.t1; a += 1) {
      const w = summarize(L.m.peaks, a, a + len, near)
      const sp = speedOf(L.m.track, a, a + len)
      if (!w || w.n < 5 || !Number.isFinite(sp)) continue
      out.push({ t: a, heel: w.med.heel, speedL: sp, res: w.med.heel - expectedHeel(sp), shank: w.med.shank })
    }
  }
  return out
}

export { q, sd, mean, median }
