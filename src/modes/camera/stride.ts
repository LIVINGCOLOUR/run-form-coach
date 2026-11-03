// 走り姿のアニメーション用の1周（2歩）を、走りながらの骨格から作る
//
// 決まった秒数を切り出すと、1周の途中で終わって、繰り返すたびに脚が飛ぶ（1.2秒は約1.65周）。
// 奥の脚と奥の腕は体に隠れて点がぶれ、左右の取り違えも起きる（自分の記録で、奥の膝の確からしさ 0.5 前後、奥の手首 0.1 前後）。
// そこで、直近 STRIDE.window 秒から次のように1周を作る：
//   1. 手前の足首が腰より一番前に出た瞬間を、1周の区切りにする（1周の長さは、手前の足首の動きの自己相関で決める）
//   2. 区切りから区切りまでを1周として、何周ぶんも時間と位相をそろえて重ね、点ごとの中央値を取る
//   3. 重ねた形と比べて、膝・足（足首・かかと・つま先）の左右の名前が入れ替わっていたコマは入れ替える
//   4. 描くのは、重ねた形ではなく実際の1周：脚の振れ・膝の曲がり・かかとの上がりが区間の周の中央値にいちばん近く、点が跳ばない周。
//      重ねた形は、周ごとに山の時刻が少しずつ違うので、膝の曲がりやかかとの上がりが小さくなり、歩いているように見えたため
//   5. 奥の脚と奥の腕は、手前の脚と腕を半周ずらして作る（左右の動きはほぼ同じで、奥は点が当てにならないため）
//   6. 1周の始まりと終わりの差は、1周にわたって少しずつ戻して、くり返しても切れ目が出ないようにする
// 1周のコマ数は、毎秒30コマで再生して実際の速さになる数（1周の秒数 × 30）
import type { Frame, Pt, Stride } from '../../core/types'
import { L } from './landmarks'
import { legLength, mid } from './geometry'
import { STRIDE } from './params'

export interface TimedFrame {
  frame: Frame
  t: number
}

const FPS = 30 // 再生の速さ（Mannequin と同じ）
type Side = Record<'sh' | 'el' | 'wr' | 'hip' | 'knee' | 'ankle' | 'heel' | 'foot', number>
const SIDE: Record<'left' | 'right', Side> = {
  left: { sh: L.leftShoulder, el: L.leftElbow, wr: L.leftWrist, hip: L.leftHip, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, foot: L.leftFoot },
  right: { sh: L.rightShoulder, el: L.rightElbow, wr: L.rightWrist, hip: L.rightHip, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, foot: L.rightFoot },
}
// 左右の取り違えを直すときの組（膝だけ取り違えることもあるので、膝と足は別々に見る）
const SWAP_GROUPS: (keyof Side)[][] = [['knee'], ['ankle', 'heel', 'foot']]

const med = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

// 手前（よく見えている側）が左か
function nearLeft(seq: TimedFrame[]): boolean {
  let l = 0
  let r = 0
  for (const { frame: f } of seq) {
    for (const k of ['sh', 'hip', 'knee', 'ankle', 'el'] as const) {
      l += f[SIDE.left[k]].v
      r += f[SIDE.right[k]].v
    }
  }
  return l >= r
}

// 時刻 t の値を、前後のコマからまっすぐつないで取る（前後のコマの間があきすぎていれば null）
function interpAt<T>(ts: number[], t: number, get: (i: number, j: number, u: number) => T): T | null {
  if (t < ts[0] || t > ts[ts.length - 1]) return null
  let lo = 0
  let hi = ts.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (ts[m] <= t) lo = m
    else hi = m
  }
  if (ts[hi] - ts[lo] > STRIDE.maxGap) return null
  const u = ts[hi] > ts[lo] ? (t - ts[lo]) / (ts[hi] - ts[lo]) : 0
  return get(lo, hi, u)
}

// 等間隔（毎秒30コマ）にならした信号。コマの間があきすぎたところは NaN
// 1コマだけ跳んだ値（左右の取り違え）を、前後のコマとの3つの中央値で消す
const med3 = (xs: number[]) => xs.map((x, i) => (i === 0 || i === xs.length - 1 ? x : med([xs[i - 1], x, xs[i + 1]])))

function grid(ts: number[], vals: number[]): { t0: number; ys: number[] } {
  const t0 = ts[0]
  const n = Math.floor((ts[ts.length - 1] - t0) * FPS) + 1
  const ys = Array.from({ length: n }, (_, i) => interpAt(ts, t0 + i / FPS, (a, b, u) => vals[a] + (vals[b] - vals[a]) * u) ?? NaN)
  return { t0, ys }
}

// 1周の長さ（秒）：手前の足首の前後の動きの自己相関がいちばん高いずれ。はっきりしなければ null
// hint：ほかで測った1周の長さ（秒）。あれば、その前後 STRIDE.hintTol の割合の中だけで探す
export function cyclePeriod(ys: number[], hint?: number): number | null {
  const ok = ys.filter(Number.isFinite)
  if (ok.length < 10) return null
  const m = ok.reduce((a, b) => a + b, 0) / ok.length
  const lo = Math.max(1, Math.round((hint ? hint * (1 - STRIDE.hintTol) : STRIDE.periodMin) * FPS))
  const hi = Math.min(Math.round((hint ? hint * (1 + STRIDE.hintTol) : STRIDE.periodMax) * FPS), ys.length - 4)
  const r: number[] = []
  for (let lag = 0; lag <= hi + 1; lag++) {
    let num = 0
    let da = 0
    let db = 0
    let c = 0
    for (let i = 0; i + lag < ys.length; i++) {
      const a = ys[i] - m
      const b = ys[i + lag] - m
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      num += a * b
      da += a * a
      db += b * b
      c++
    }
    r.push(c >= 6 && da > 0 && db > 0 ? num / Math.sqrt(da * db) : -1)
  }
  if (hi < lo) return null
  let best = lo
  for (let lag = lo; lag <= hi; lag++) if (r[lag] > r[best]) best = lag
  if (r[best] < STRIDE.minCorr) return null
  // 2周ぶんのずれを選ばないよう、それより短くて同じくらい高い山があれば、そちらを取る
  for (let lag = lo; lag < best; lag++) {
    if (r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= 0.9 * r[best]) {
      best = lag
      break
    }
  }
  // 探した範囲の端で、まだ上り坂（本当の山は範囲の外）なら、はっきりしないとみる
  if (r[best] < r[best - 1] || r[best] < r[best + 1]) return null
  const a = r[best - 1]
  const b = r[best]
  const c = r[best + 1] ?? b
  const d = a - 2 * b + c
  const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0
  return (best + off) / FPS
}

// 区切り：手前の足首が一番前に出た山（1周に1つ）。山の間が半周より近い山は、低いほうを捨てる
function peaks(t0: number, ys: number[], period: number): { t: number; v: number }[] {
  const w = Math.max(1, Math.round(period * FPS * 0.3))
  const cand: number[] = []
  for (let i = 1; i < ys.length - 1; i++) {
    if (!Number.isFinite(ys[i])) continue
    let top = true
    for (let k = Math.max(0, i - w); k <= Math.min(ys.length - 1, i + w); k++) if (k !== i && ys[k] > ys[i]) top = false
    if (top) cand.push(i)
  }
  cand.sort((a, b) => ys[b] - ys[a])
  const kept: number[] = []
  for (const i of cand) if (kept.every((k) => Math.abs(k - i) >= period * FPS * 0.6)) kept.push(i)
  return kept
    .sort((a, b) => a - b)
    .map((i) => {
      const a = ys[i - 1]
      const b = ys[i]
      const c = ys[i + 1]
      const d = a - 2 * b + c
      const off = Number.isFinite(d) && d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0
      return { t: t0 + (i + off) / FPS, v: b }
    })
}

// 区切りの組から、1周として使える区間（長さが1周の長さに近いものだけ）
function cyclesOf(anchors: number[], period: number): [number, number][] {
  const out: [number, number][] = []
  for (let k = 0; k + 1 < anchors.length; k++) {
    const d = anchors[k + 1] - anchors[k]
    if (Math.abs(d - period) <= STRIDE.periodTol * period) out.push([anchors[k], anchors[k + 1]])
  }
  return out
}

type Rel = { x: number; y: number; v: number }[] // 腰の基準からの位置

// 何周ぶんも重ねて、位相ごとに点の中央値を取る。どこかの位相で重ねられる周がなければ null
// 時刻 t の形を、前後2コマずつからなめらかな曲線（Catmull-Rom）で取る。まっすぐつなぐと、毎秒13コマでは
// 膝の曲がりやかかとの上がりの山が削れるため。前後のコマの間があきすぎていれば null
function sampleAt(ts: number[], rel: Rel[], t: number): Rel | null {
  if (t < ts[0] || t > ts[ts.length - 1]) return null
  let lo = 0
  let hi = ts.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (ts[m] <= t) lo = m
    else hi = m
  }
  if (ts[hi] - ts[lo] > STRIDE.maxGap) return null
  const u = ts[hi] > ts[lo] ? (t - ts[lo]) / (ts[hi] - ts[lo]) : 0
  const p0 = lo > 0 && ts[lo] - ts[lo - 1] <= STRIDE.maxGap ? lo - 1 : lo
  const p3 = hi < ts.length - 1 && ts[hi + 1] - ts[hi] <= STRIDE.maxGap ? hi + 1 : hi
  const cr = (a: number, b: number, c: number, d: number) => b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
  return rel[lo].map((p, q) => ({
    x: cr(rel[p0][q].x, p.x, rel[hi][q].x, rel[p3][q].x),
    y: cr(rel[p0][q].y, p.y, rel[hi][q].y, rel[p3][q].y),
    v: Math.min(p.v, rel[hi][q].v),
  }))
}

// 何周ぶんも重ねて、位相ごとに点の中央値を取る。shifts：周ごとの位相のずれ（align で合わせたもの）。
// どこかの位相で重ねられる周がなければ null
function fold(ts: number[], rel: Rel[], cycles: [number, number][], n: number, shifts?: number[]): Rel[] | null {
  const out: Rel[] = []
  for (let j = 0; j < n; j++) {
    const got: Rel[] = []
    cycles.forEach(([a, b], c) => {
      const r = sampleAt(ts, rel, a + (j / n + (shifts?.[c] ?? 0)) * (b - a))
      if (r) got.push(r)
    })
    if (!got.length) return null
    out.push(got[0].map((_, q) => ({ x: med(got.map((g) => g[q].x)), y: med(got.map((g) => g[q].y)), v: med(got.map((g) => g[q].v)) })))
  }
  return out
}

// 周ごとに、重ねた形にいちばん合う位相のずれを探す（区切りの山は点のぶれで前後するので、そのままでは周ごとに少しずつずれ、
// 重ねると脚の振れが小さくなる）。比べるのは手前の脚と腕の、腰からの位置
function align(ts: number[], rel: Rel[], cycles: [number, number][], tpl: Rel[], near: Side): number[] {
  const n = tpl.length
  const qs = [near.knee, near.ankle, near.heel, near.foot, near.el, near.wr]
  return cycles.map(([a, b]) => {
    let best = 0
    let bestCost = Infinity
    for (let s = -STRIDE.alignMax; s <= STRIDE.alignMax + 1e-9; s += 0.01) {
      let cost = 0
      let c = 0
      for (let j = 0; j < n; j++) {
        const r = sampleAt(ts, rel, a + (j / n + s) * (b - a))
        if (!r) continue
        for (const q of qs) cost += (r[q].x - r[near.hip].x - (tpl[j][q].x - tpl[j][near.hip].x)) ** 2 + (r[q].y - r[near.hip].y - (tpl[j][q].y - tpl[j][near.hip].y)) ** 2
        c++
      }
      if (c >= n / 2 && cost / c < bestCost) {
        bestCost = cost / c
        best = s
      }
    }
    return best
  })
}

// 1周の形の、位相 ph（0〜1、くり返す）の点 q
function tplAt(tpl: Rel[], ph: number, q: number): { x: number; y: number } {
  const n = tpl.length
  const s = (((ph % 1) + 1) % 1) * n
  const i = Math.floor(s) % n
  const k = (i + 1) % n
  const u = s - Math.floor(s)
  return { x: tpl[i][q].x + (tpl[k][q].x - tpl[i][q].x) * u, y: tpl[i][q].y + (tpl[k][q].y - tpl[i][q].y) * u }
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

// 各コマの位相（区切りの間を0〜1）。1周に入らないコマは null
function phaseOf(t: number, cycles: [number, number][]): number | null {
  for (const [a, b] of cycles) if (t >= a && t <= b) return (t - a) / (b - a)
  return null
}

// 重ねた形と比べて、膝・足の左右の名前が入れ替わっているコマは入れ替える。奥の脚は手前の脚の半周ずれとみる
function fixSwaps(ts: number[], rel: Rel[], cycles: [number, number][], tpl: Rel[], near: Side, far: Side): number {
  let swapped = 0
  rel.forEach((r, i) => {
    const ph = phaseOf(ts[i], cycles)
    if (ph === null) return
    for (const g of SWAP_GROUPS) {
      let keep = 0
      let swap = 0
      for (const k of g) {
        const n = tplAt(tpl, ph, near[k])
        const f = tplAt(tpl, ph + 0.5, near[k])
        keep += d2(r[near[k]], n) + d2(r[far[k]], f)
        swap += d2(r[far[k]], n) + d2(r[near[k]], f)
      }
      if (swap < keep) {
        swapped++
        for (const k of g) {
          const a = r[near[k]]
          r[near[k]] = r[far[k]]
          r[far[k]] = a
        }
      }
    }
  })
  return swapped
}

// 奥の脚・奥の腕を、手前の半周ずれで作る（付け根は奥の腰・奥の肩のまま）
function mirrorFar(tpl: Rel[], near: Side, far: Side): Rel[] {
  const n = tpl.length
  return tpl.map((r, j) => {
    const o = r.slice()
    const ph = j / n + 0.5
    const set = (root: 'hip' | 'sh', ks: (keyof Side)[]) => {
      const nr = tplAt(tpl, ph, near[root])
      for (const k of ks) {
        const p = tplAt(tpl, ph, near[k])
        o[far[k]] = { x: r[far[root]].x + p.x - nr.x, y: r[far[root]].y + p.y - nr.y, v: Math.min(r[far[k]].v, r[near[k]].v * 0.6) }
      }
    }
    set('hip', ['knee', 'ankle', 'heel', 'foot'])
    set('sh', ['el', 'wr'])
    return o
  })
}

// くり返しの切れ目が出ないよう、1周をつなげて [1 2 1] でなめらかにする
function smoothLoop(tpl: Rel[], times: number): Rel[] {
  let cur = tpl
  for (let t = 0; t < times; t++) {
    const n = cur.length
    cur = cur.map((r, j) => r.map((p, q) => {
      const a = cur[(j - 1 + n) % n][q]
      const b = cur[(j + 1) % n][q]
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, v: p.v }
    }))
  }
  return cur
}

// 1周の形の数字：手前の足首の前後幅・膝の最大の曲がり（度）・かかとの上がり（腰からの高さの幅）。脚の長さに対する割合
export function formOf(fs: Frame[], near: Side, dir: 1 | -1, leg: number) {
  const hip = (f: Frame) => mid(f[L.leftHip], f[L.rightHip])
  const ax = fs.map((f) => ((f[near.ankle].x - hip(f).x) * dir) / leg)
  const knee = fs.map((f) => {
    const u = { x: f[near.hip].x - f[near.knee].x, y: f[near.hip].y - f[near.knee].y }
    const w = { x: f[near.ankle].x - f[near.knee].x, y: f[near.ankle].y - f[near.knee].y }
    const c = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y) || 1)
    return 180 - (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
  })
  const heel = fs.map((f) => (f[near.heel].y - hip(f).y) / leg)
  return { ankle: Math.max(...ax) - Math.min(...ax), knee: Math.max(...knee), heel: Math.max(...heel) - Math.min(...heel) }
}

// 区間の中から、いちばん典型的な実際の1周を選び、毎秒30コマ（n コマ）にならす。始まりと終わりの差は1周にわたって少しずつ戻す
function pickCycle(ts: number[], rel: Rel[], cycles: [number, number][], n: number, near: Side, dir: 1 | -1, leg: number): Rel[] | null {
  const cand: { fs: Rel[]; end: Rel; form: ReturnType<typeof formOf>; jerk: number; seam: number }[] = []
  const pts = [near.knee, near.ankle, near.heel, near.foot]
  for (const [a, b] of cycles) {
    const fs: Rel[] = []
    for (let j = 0; j <= n; j++) {
      const r = sampleAt(ts, rel, a + (j / n) * (b - a))
      if (!r) break
      fs.push(r)
    }
    if (fs.length <= n) continue
    const end = fs.pop()!
    let jerk = 0
    for (let j = 0; j < n; j++) {
      const p = fs[(j - 1 + n) % n]
      const c = fs[j]
      const q = j === n - 1 ? end : fs[j + 1]
      for (const k of pts) jerk = Math.max(jerk, Math.hypot(p[k].x - 2 * c[k].x + q[k].x, p[k].y - 2 * c[k].y + q[k].y) / leg)
    }
    const seam = Math.max(...pts.map((k) => d2(fs[0][k], end[k]))) / leg
    cand.push({ fs, end, form: formOf(fs, near, dir, leg), jerk, seam })
  }
  if (!cand.length) return null
  const m = { ankle: med(cand.map((c) => c.form.ankle)), knee: med(cand.map((c) => c.form.knee)), heel: med(cand.map((c) => c.form.heel)) }
  const cost = (c: (typeof cand)[number]) =>
    Math.abs(c.form.ankle / m.ankle - 1) + Math.abs(c.form.knee / m.knee - 1) + Math.abs(c.form.heel / m.heel - 1) + STRIDE.pickJerk * c.jerk + STRIDE.pickSeam * c.seam
  const best = cand.reduce((x, y) => (cost(y) < cost(x) ? y : x))
  return best.fs.map((r, j) => r.map((p, q) => ({ x: p.x - ((best.end[q].x - best.fs[0][q].x) * j) / n, y: p.y - ((best.end[q].y - best.fs[0][q].y) * j) / n, v: p.v })))
}

export interface CycleResult {
  frames: Frame[] // 1周（毎秒30コマで再生して実際の速さ）。区切りは手前の足首が一番前に出た瞬間
  sec: number // 1周の秒数
  cycles: number // 重ねた周の数
  swapped: number // 左右の名前を入れ替えたコマの組の数
  farDiff: number // 重ねた奥の足首と、手前の足首を半周ずらしたものの差（1周の平均、脚の長さに対する割合）。確かめる用
}

// seq：鉛直をそろえたピクセル座標のコマ（時刻の順）。dir：走る向き（画面の右が 1）。
// hint：歩数から測った1周の長さ（秒。gait.ts の1歩の長さの2倍）。あれば、1周の長さをその近くで探す
export function strideCycle(seq: TimedFrame[], dir: 1 | -1, hint?: number): CycleResult | null {
  const minCycles = STRIDE.minCycles
  if (seq.length < 8) return null
  const isLeft = nearLeft(seq)
  const near = isLeft ? SIDE.left : SIDE.right
  const far = isLeft ? SIDE.right : SIDE.left
  const ts = seq.map((s) => s.t)
  const hips = seq.map((s) => mid(s.frame[L.leftHip], s.frame[L.rightHip]))
  const legs = seq.map((s) => legLength(s.frame)).filter((x) => x > 0)
  if (!legs.length) return null
  const leg = med(legs)
  // 1周の長さ：手前の足首が腰よりどれだけ前か（脚の長さに対する割合）
  const fwd = (r: { x: number }[], i: number) => ((r[near.ankle].x - hips[i].x) * dir) / leg
  const g0 = grid(ts, med3(seq.map((s, i) => fwd(s.frame, i))))
  const period = cyclePeriod(g0.ys, hint)
  if (period === null) return null
  // 腰の基準：前後1周ぶんの腰の平均（ベルトの上での前後のずれは消し、1歩ごとの上下動は残す）
  const base = hips.map((_, i) => {
    let x = 0
    let y = 0
    let c = 0
    for (let k = 0; k < seq.length; k++) {
      if (Math.abs(ts[k] - ts[i]) > period / 2) continue
      x += hips[k].x
      y += hips[k].y
      c++
    }
    return { x: x / c, y: y / c }
  })
  const cx = base.reduce((a, b) => a + b.x, 0) / base.length
  const cy = base.reduce((a, b) => a + b.y, 0) / base.length
  const rel: Rel[] = seq.map((s, i) => s.frame.map((p) => ({ x: p.x - base[i].x + cx, y: p.y - base[i].y + cy, v: p.v })))
  const n = Math.max(STRIDE.minFrames, Math.min(STRIDE.maxFrames, Math.round(period * FPS)))
  const anchorsOf = (): [number, number][] | null => {
    const g = grid(ts, med3(rel.map((r, i) => ((r[near.ankle].x - (hips[i].x - base[i].x + cx)) * dir) / leg)))
    const cycles = cyclesOf(peaks(g.t0, g.ys, period).map((p) => p.t), period)
    return cycles.length >= minCycles ? cycles : null
  }
  let cycles = anchorsOf()
  if (!cycles) return null
  // 1回目：名前どおりに重ねる → 2回目：取り違えを直して、区切りも取り直して重ねる
  const first = fold(ts, rel, cycles, n)
  if (!first) return null
  const swapped = fixSwaps(ts, rel, cycles, first, near, far)
  cycles = anchorsOf() ?? cycles
  let second = fold(ts, rel, cycles, n)
  if (!second) return null
  // 周ごとの位相のずれを合わせて重ね直す（2回）
  for (let k = 0; k < 2; k++) {
    const next = fold(ts, rel, cycles, n, align(ts, rel, cycles, second, near))
    if (!next) break
    second = next
  }
  // 重ねた形は、周ごとに膝の曲がりやかかとの上がりの山の時刻が少しずつ違うので、山が低くなる（記録で、かかとの上がりが生の周の約8割）。
  // そこで、重ねた形は左右の取り違えを直すためだけに使い、描くのは実際の1周：脚の振れ・膝の曲がり・かかとの上がりが、
  // 区間の周の中央値にいちばん近く、途中で点が跳ばず、始まりと終わりが近い周
  const pick = pickCycle(ts, rel, cycles, n, near, dir, leg)
  if (!pick) return null
  const mirrored = mirrorFar(pick, near, far)
  const farDiff = second.reduce((a, r, j) => a + d2(r[far.ankle], mirrorFar(second!, near, far)[j][far.ankle]), 0) / n / leg
  const frames = smoothLoop(mirrored, STRIDE.smooth).map((r) => r.map((p): Pt => ({ x: p.x, y: p.y, v: p.v })))
  const sec = cycles.reduce((a, [s, e]) => a + (e - s), 0) / cycles.length
  return { frames, sec, cycles: cycles.length, swapped, farDiff }
}

// 前の記録の走り姿（決まった1.2秒を36コマにならしたもの。約1.65周で、1周ではない）を、表示するときに1周に直す。
// 短くて何周も重ねられないので、1周ぶんの長さの区間のうち、始まりと終わりが近く、途中で点が跳ばない区間を選んで使う。
// 始まりと終わりの残った差は、1周にわたって少しずつ戻してつなぐ。奥の脚と腕は、新しい作り方と同じく手前の半周ずれ。
// hint：その走りの1周の長さ（秒。結果のピッチから）。なければ手前の足首の動きから決める。直せなければ、そのまま
export function legacyCycle(s: Stride, hint?: number): Frame[] {
  const src = s.frames
  const n = src.length
  if (n < 8) return src
  const dt = STRIDE.legacySec / (n - 1)
  const isLeft = nearLeft(src.map((frame) => ({ frame, t: 0 })))
  const near = isLeft ? SIDE.left : SIDE.right
  const far = isLeft ? SIDE.right : SIDE.left
  const legs = src.map(legLength).filter((x) => x > 0)
  if (!legs.length) return src
  const leg = med(legs)
  const ts = src.map((_, i) => i * dt)
  const fwd = src.map((f) => ((f[near.ankle].x - mid(f[L.leftHip], f[L.rightHip]).x) * s.dir) / leg)
  const h = hint && hint < STRIDE.legacySec - 3 * dt ? hint : undefined
  const period = cyclePeriod(grid(ts, med3(fwd)).ys, h) ?? h ?? null
  if (period === null) return src
  const P = Math.round(period / dt)
  if (P < 8 || P > n - 1) return src
  const pts = [near.knee, near.ankle, near.foot]
  const dist = (a: Frame, b: Frame) => Math.max(...pts.map((q) => d2(a[q], b[q]))) / leg
  // 途中の跳び：手前の膝・足首・つま先の、となりのコマとの差の差（加速）
  const jerk = src.map((f, i) => (i === 0 || i === n - 1 ? 0 : Math.max(...pts.map((q) => Math.hypot(src[i - 1][q].x - 2 * f[q].x + src[i + 1][q].x, src[i - 1][q].y - 2 * f[q].y + src[i + 1][q].y))) / leg))
  let best = 0
  let bestCost = Infinity
  for (let o = 0; o + P < n; o++) {
    let c = dist(src[o], src[o + P])
    for (let i = o + 1; i < o + P; i++) c += jerk[i]
    if (c < bestCost) {
      bestCost = c
      best = o
    }
  }
  // 始まりと終わりの差を、1周にわたって少しずつ戻す
  const a = src[best]
  const b = src[best + P]
  const one: Rel[] = []
  for (let k = 0; k < P; k++) {
    const u = k / P
    one.push(src[best + k].map((p, q) => ({ x: p.x - (b[q].x - a[q].x) * u, y: p.y - (b[q].y - a[q].y) * u, v: p.v })))
  }
  // 毎秒30コマで再生して実際の速さになるコマ数にならし、手前の足首が一番前に出たコマから始める
  const m = Math.max(STRIDE.minFrames, Math.min(STRIDE.maxFrames, Math.round(period * FPS)))
  let tpl: Rel[] = Array.from({ length: m }, (_, j) => one[0].map((_, q) => ({ ...tplAt(one, j / m, q), v: one[Math.floor((j / m) * P)][q].v })))
  const top = tpl.reduce((t, r, j) => ((r[near.ankle].x - tpl[t][near.ankle].x) * s.dir > 0 ? j : t), 0)
  tpl = tpl.slice(top).concat(tpl.slice(0, top))
  return smoothLoop(mirrorFar(tpl, near, far), STRIDE.smooth).map((r) => r.map((p): Pt => ({ x: p.x, y: p.y, v: p.v })))
}
