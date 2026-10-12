import type { Frame, RunLog } from '../../core/types'
import { facing, legLength } from '../camera/geometry'
import { L } from '../camera/landmarks'
import { PHONE_MOUNTS, type PhoneLog } from './log'
import { MountCheck, type MountFeatures, type MountIssue } from './mount'

// スマホ版とカメラ版を同時に記録した2つのファイルを、時刻を合わせて並べ、声にする前の関門（docs/phone-spec.md
// 「精度の確かめ方」）の材料を出す。実機テスト①（docs/phone-test1.md）の記録を、scripts/compare-runs.mjs から使う
//
// 時刻の合わせ方：
//   1. どちらの記録も「ふつうの時刻」に直す（スマホは wallMs、カメラは clock の対応から。clock のない古い記録は
//      startedAt と最初のコマから大まかに）。2台の時計は少しずれているので、これはおおよその位置
//   2. 「動きの強さ」（スマホは加速度の大きさの、カメラは腰の高さの、0.5秒ごとのばらつき）を 0.1 秒刻みで作り、
//      カメラ側をずらしながら、2つがいちばん似る（相関が高い）ずれを探す。立つ↔走る の切り替えと、走る前のジャンプが
//      手がかりになる。前半と後半で別々に探し、ずれが動いていないか（時計の進みの違い）も確かめる
//   ピッチの並びでも試したが、ピッチが変わるのは区間の切り替えだけで、カメラは間引いて取るので、山がはっきりしなかった。
//   合わせたあとのピッチの差（区間の表）で、合わせ方が正しいかを確かめる
//
// カメラ版は、安定して走っている間は 10 秒に 3 秒だけ骨格を取る（省電力）。カメラの値は、骨格を続けて取れたひとかたまり
// （最長 4 秒）ごとに出し、同じ時間のスマホの値（直近 4 秒）と組にして比べる

// 実機テスト①の区間（docs/phone-test1.md と同じ順）。立って休む間で区切られた走りを、この順に当てはめる
export interface Step {
  key: string
  name: string
  min: number // 走る長さ（分）
  waist: boolean // 腰にしっかり付けている（ピッチを比べる区間）
  expect: MountIssue | null // 付け方の確認がこうなるべき（null：鳴らない）
}
export const TEST1: Step[] = [
  { key: 'normal1', name: 'ふつう', min: 6, waist: true, expect: null },
  { key: 'slow', name: 'ピッチを落とす', min: 3, waist: true, expect: null },
  { key: 'normal2', name: 'ふつう（戻す）', min: 2, waist: true, expect: null },
  { key: 'bouncy', name: 'わざと弾む', min: 3, waist: true, expect: null },
  { key: 'normal3', name: 'ふつう（戻す）', min: 2, waist: true, expect: null },
  { key: 'loose', name: 'ゆるい', min: 2, waist: false, expect: 'loose' },
  { key: 'arm', name: '腕', min: 2, waist: false, expect: 'notWaist' },
  { key: 'pocket', name: 'ポケット', min: 2, waist: false, expect: 'notWaist' },
  { key: 'normal4', name: '腰に戻してふつう', min: 2, waist: true, expect: null },
]
// 研究で分かっている向き（ピッチを落とすと上下動とブレーキが増える：Heiderscheit 2011）。比べる相手は最初の「ふつう」
const RESEARCH: Record<string, { bounce?: 1 | -1; braking?: 1 | -1 }> = { slow: { bounce: 1, braking: 1 }, bouncy: { bounce: 1 } }

const BIN = 0.1 // 動きの強さの刻み（秒）
const CADENCE_OK = 2 // ピッチの関門（±歩/分）

// ---- 読み込み ----

interface PhoneSec {
  T: number // ふつうの時刻（秒、スマホの時計）
  cadence: number | null
  bounceCm: number | null
  brakingMs: number | null
  mount: MountIssue | null // 走りの中で実際に出た付け方の問題（見つけた秒から後に付く）
  x: MountFeatures | null
}
interface PhoneData {
  raw: { T: number; mag: number }[]
  secs: PhoneSec[]
}

interface CamFrame {
  T: number // ふつうの時刻（秒、カメラの時計）
  hip: number // 腰の高さ ÷ 脚の長さ（下が正）。脚の長さは記録全体の中央値（コマごとの脚の長さは脚の振りで変わるので、
  //   それで割ると、腰の位置の大きな値が揺れて見える）
  ank: [number, number] // 左右の足首の、腰からの前への出（÷ 脚の長さ）
  cadence: number | null // カメラ版が出したピッチ（記録の値）
}
interface CamData {
  frames: CamFrame[]
  clock: boolean // 時計の対応があったか
}

const col = (cols: readonly string[], name: string) => {
  const i = cols.indexOf(name)
  if (i < 0) throw new Error(`記録に ${name} の列がない`)
  return i
}

// 書き出したファイルは { log, session } の形。log だけでもよい
const unwrap = <T>(x: unknown): T => ((x as { log?: T }).log ?? x) as T

export function readPhone(file: unknown): PhoneData {
  const log = unwrap<PhoneLog>(file)
  if (log.mode !== 'phone') throw new Error('スマホ版の記録ではない（mode が phone でない）')
  const c = log.columns
  const [iw, ix, iy, iz] = [col(c, 'wallMs'), col(c, 'ax'), col(c, 'ay'), col(c, 'az')]
  const raw = log.rows.map((r) => ({ T: r[iw]! / 1000, mag: Math.hypot(r[ix]!, r[iy]!, r[iz]!) }))
  const s = log.secondColumns
  const k = (n: string) => col(s, n)
  const [w, cad, bo, br, mo, hz, gr, sw, hf, ux, uy, uz] = ['wallMs', 'cadence', 'bounceCm', 'brakingMs', 'mount', 'stepHz', 'gravity', 'gyroSwing', 'gyroHf', 'upX', 'upY', 'upZ'].map(k)
  const secs = log.seconds.map((r): PhoneSec => ({
    T: r[w]! / 1000,
    cadence: r[cad],
    bounceCm: r[bo],
    brakingMs: r[br],
    mount: PHONE_MOUNTS[r[mo] ?? 0] ?? null,
    x: r[hz] === null || r[gr] === null || r[ux] === null
      ? null
      : { stepHz: r[hz]!, gravity: r[gr]!, up: [r[ux]!, r[uy]!, r[uz]!], gyroSwing: r[sw] ?? undefined, gyroHf: r[hf] ?? undefined },
  }))
  return { raw, secs }
}

export function readCamera(file: unknown): CamData {
  const log = unwrap<RunLog>(file)
  if (!Array.isArray(log.points) || !log.columns) throw new Error('カメラ版の記録ではない（points・columns がない）')
  const off = log.columns.length - 1 // 骨格の点が始まる列（最後の列名が '...points(x,y,v)'）
  const [it, iv, ic] = [col(log.columns, 't'), col(log.columns, 'visible'), col(log.columns, 'cadence')]
  const t0 = log.rows.length ? log.rows[0][it] : 0
  const toT = log.clock ? (t: number) => (log.clock!.epochMs + t * 1000 - log.clock!.perfMs) / 1000 : (t: number) => log.startedAt / 1000 + (t - t0)
  const frames: CamFrame[] = []
  const legs: number[] = []
  for (const r of log.rows) {
    if (r.length < off + log.points.length * 3 || r[iv] !== 1) continue
    const f: Frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
    log.points.forEach((p, j) => (f[p] = { x: r[off + j * 3], y: r[off + j * 3 + 1], v: r[off + j * 3 + 2] }))
    const need = [L.leftHip, L.rightHip, L.leftKnee, L.rightKnee, L.leftAnkle, L.rightAnkle]
    if (need.some((p) => f[p].v < 0.5)) continue
    const leg = legLength(f)
    if (leg <= 0) continue
    const dir = facing(f)
    const px = (f[L.leftHip].x + f[L.rightHip].x) / 2
    legs.push(leg)
    frames.push({
      T: toT(r[it]),
      hip: (f[L.leftHip].y + f[L.rightHip].y) / 2,
      ank: [((f[L.leftAnkle].x - px) * dir) / leg, ((f[L.rightAnkle].x - px) * dir) / leg],
      cadence: r[ic] >= 0 ? r[ic] : null,
    })
  }
  const legMid = median(legs)
  for (const fr of frames) fr.hip /= legMid
  return { frames, clock: !!log.clock }
}

// ---- 小さな計算 ----

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs: number[]) => {
  const m = mean(xs)
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : NaN
}
const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))

// 0.1 秒刻みの「動きの強さ」。値は ±half 秒の中のばらつきの対数（大きさの違う2つの量を比べられるように）
function activity(pts: { T: number; v: number }[], half: number, minN: number, eps: number): Map<number, number> {
  const out = new Map<number, number>()
  let a = 0
  let b = 0
  let s = 0
  let s2 = 0
  const bins = new Set(pts.map((p) => Math.round(p.T / BIN)))
  for (const bin of [...bins].sort((x, y) => x - y)) {
    const c = bin * BIN
    for (; b < pts.length && pts[b].T <= c + half; b++) {
      s += pts[b].v
      s2 += pts[b].v ** 2
    }
    for (; a < b && pts[a].T < c - half; a++) {
      s -= pts[a].v
      s2 -= pts[a].v ** 2
    }
    const n = b - a
    if (n < minN) continue
    const v = Math.max(0, s2 / n - (s / n) ** 2)
    out.set(bin, Math.log(Math.sqrt(v) + eps))
  }
  return out
}

// カメラの bin を lag（bin の数）だけずらしたときの、2つの並びの相関
function corrAt(ph: Map<number, number>, cam: Map<number, number>, lag: number, camBins: number[]): { r: number; n: number } {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const cb of camBins) {
    const x = ph.get(cb - lag)
    if (x === undefined) continue
    const y = cam.get(cb)!
    n++
    sx += x
    sy += y
    sxx += x * x
    syy += y * y
    sxy += x * y
  }
  if (n < 50) return { r: -1, n }
  const cov = sxy / n - (sx / n) * (sy / n)
  const vx = sxx / n - (sx / n) ** 2
  const vy = syy / n - (sy / n) ** 2
  return { r: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : -1, n }
}

// いちばん似るずれ（秒）を、粗く → 細かく探す。center・range は秒
function bestLag(ph: Map<number, number>, cam: Map<number, number>, camBins: number[], center: number, range: number, coarse: number) {
  const c0 = Math.round(center / BIN)
  const step = Math.max(1, Math.round(coarse / BIN))
  const R = Math.round(range / BIN)
  const coarseList: { lag: number; r: number }[] = []
  for (let l = c0 - R; l <= c0 + R; l += step) coarseList.push({ lag: l, r: corrAt(ph, cam, l, camBins).r })
  coarseList.sort((a, b) => b.r - a.r)
  const top = coarseList[0]
  let best = { lag: top.lag, r: top.r }
  const around = new Map<number, number>()
  for (let l = top.lag - step; l <= top.lag + step; l++) {
    const r = corrAt(ph, cam, l, camBins).r
    around.set(l, r)
    if (r > best.r) best = { lag: l, r }
  }
  // 刻みより細かく：となりの値で放物線をあてる
  const rm = around.get(best.lag - 1)
  const rp = around.get(best.lag + 1)
  let frac = 0
  if (rm !== undefined && rp !== undefined) {
    const d = rm - 2 * best.r + rp
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (rm - rp)) / d))
  }
  // 次に高い山（いちばんの山から 3 秒以上離れたもの）。いちばんとの差が小さければ、合わせ方があやしい
  const second = coarseList.find((x) => Math.abs(x.lag - top.lag) * BIN >= 3)
  return { offset: (best.lag + frac) * BIN, r: best.r, second: second?.r ?? null, n: corrAt(ph, cam, best.lag, camBins).n }
}

export interface Alignment {
  offset: number // カメラの時刻 = スマホの時刻 + offset（秒）
  how: 'activity' | 'manual' | 'clock'
  r: number | null // 相関の山の高さ
  second: number | null // 次に高い山
  pairs: number
  clockOffset: boolean // カメラの記録に時計の対応があったか（なければ、もとの位置は大まか）
  halves: [number | null, number | null] // 前半・後半で別々に探したずれ（秒）
  warnings: string[]
}

export function align(ph: PhoneData, cam: CamData, manual?: number): Alignment {
  const warnings: string[] = []
  const pa = activity(ph.raw.map((p) => ({ T: p.T, v: p.mag })), 0.25, 8, 0.05)
  const ca = activity(cam.frames.map((f) => ({ T: f.T, v: f.hip })), 0.25, 4, 0.002)
  const camBins = [...ca.keys()]
  const range = cam.clock ? 60 : 300
  let a: { offset: number; r: number; second: number | null; n: number }
  let how: Alignment['how'] = 'activity'
  if (manual !== undefined) {
    a = { offset: manual, r: corrAt(pa, ca, Math.round(manual / BIN), camBins).r, second: null, n: 0 }
    how = 'manual'
  } else {
    a = bestLag(pa, ca, camBins, 0, range, 0.5)
    if (a.r < 0.3) {
      warnings.push(`動きの強さが似るずれが見つからない（相関 ${a.r.toFixed(2)}）。ふつうの時刻のまま並べた。--offset で直せる`)
      a = { offset: 0, r: a.r, second: a.second, n: a.n }
      how = 'clock'
    } else if (a.second !== null && a.r - a.second < 0.05) {
      warnings.push(`似る山が2つある（${a.r.toFixed(2)} と ${a.second.toFixed(2)}）。合わせ方があやしい。最初のジャンプがどちらにも入っているか確かめる`)
    }
  }
  // 前半・後半で別々に
  const mid = median(camBins)
  const halves = [camBins.filter((b) => b < mid), camBins.filter((b) => b >= mid)].map((bins) => {
    const h = bestLag(pa, ca, bins, a.offset, 3, BIN)
    return h.r >= 0.3 ? h.offset : null
  }) as [number | null, number | null]
  if (halves[0] !== null && halves[1] !== null && Math.abs(halves[0] - halves[1]) > 0.5) {
    warnings.push(`前半と後半でずれが ${(halves[1] - halves[0]).toFixed(1)} 秒ちがう。時計の進みがちがうか、どちらかの記録が途中で止まった`)
  }
  return { offset: a.offset, how, r: a.r, second: a.second, pairs: a.n, clockOffset: cam.clock, halves, warnings }
}

// ---- 区間 ----

export interface Segment {
  i: number
  step: Step | null // 当てはめた区間（数が合わなければ null）
  name: string
  start: number // スマホの時刻（秒）
  end: number
}

// スマホの加速度の強さで、走っている区間を見つける（立って休む間で区切る）。短すぎる動き（ジャンプなど）は除く
export function findSegments(ph: PhoneData, steps: Step[] = TEST1, labels?: string[]): { segments: Segment[]; warnings: string[] } {
  const warnings: string[] = []
  const act = activity(ph.raw.map((p) => ({ T: p.T, v: p.mag })), 1, 20, 0.05)
  const keys = [...act.keys()].sort((a, b) => a - b).filter((_, j) => j % 5 === 0) // 0.5 秒刻み
  const vals = keys.map((k) => act.get(k)!)
  const th = otsu(vals)
  const runs: { start: number; end: number }[] = []
  let cur: { start: number; end: number } | null = null
  keys.forEach((k, j) => {
    const T = k * BIN
    if (vals[j] >= th) {
      if (cur && T - cur.end <= 3) cur.end = T
      else {
        if (cur) runs.push(cur)
        cur = { start: T, end: T }
      }
    }
  })
  if (cur) runs.push(cur)
  const kept = runs.filter((r) => r.end - r.start >= 20)
  let named: { step: Step | null; name: string }[]
  if (labels) {
    named = kept.map((_, i) => {
      const l = labels[i]
      const st = steps.find((s) => s.key === l) ?? null
      return { step: st, name: st?.name ?? l ?? `区間${i + 1}` }
    })
    if (labels.length !== kept.length) warnings.push(`走った区間が ${kept.length} 個、渡した名前が ${labels.length} 個。順に当てはめた`)
  } else if (kept.length === steps.length) {
    named = steps.map((s) => ({ step: s, name: s.name }))
  } else {
    warnings.push(`走った区間が ${kept.length} 個見つかった（手順書は ${steps.length} 個）。区間の名前を当てはめられないので、番号で出す。--labels で順に名前を渡せる`)
    named = kept.map((_, i) => ({ step: null, name: `区間${i + 1}` }))
  }
  return { segments: kept.map((r, i) => ({ i, ...named[i], start: r.start, end: r.end })), warnings }
}

// 2つの山に分ける線（大津の方法）
function otsu(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  let best = { th: s[s.length >> 1], v: -1 }
  const total = s.reduce((a, b) => a + b, 0)
  let left = 0
  for (let i = 1; i < s.length; i++) {
    left += s[i - 1]
    const w0 = i / s.length
    const m0 = left / i
    const m1 = (total - left) / (s.length - i)
    const v = w0 * (1 - w0) * (m0 - m1) ** 2
    if (v > best.v) best = { th: (s[i - 1] + s[i]) / 2, v }
  }
  return best.th
}

// ---- カメラのひとかたまりごとの値 ----

export interface Burst {
  start: number // スマホの時刻に直した（秒）
  end: number
  seg: number | null // どの区間か
  camCadence: number | null // 足首が一番前に出た瞬間の間隔から（道具で測り直し）
  appCadence: number | null // カメラ版が出した値（記録の値の中央値）
  camBounce: number | null // 腰の上下の振れ（脚の長さの %、山から谷）
  camReach: number | null // 着地で足首が腰より前に出た量（脚の長さの %）。ブレーキの目安（オーバーストライド）
  phCadence: number | null // 同じ時間のスマホの値（直近 4 秒）
  phBounce: number | null
  phBraking: number | null
}

const SETTLE = 10 // 区間の始まりから、この秒数は比べない
const PROMINENCE = 0.1 // カメラ版の歩数の数え方（RUNNING.stepProminence）と同じ

// 片脚の、足首が一番前に出た瞬間（となりのコマで放物線をあてて、コマの間まで細かく）
function strikes(ts: number[], vs: number[]): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = []
  let seekMax = true
  let ext = { i: 0, v: vs[0] }
  for (let i = 1; i < vs.length; i++) {
    const v = vs[i]
    if (seekMax) {
      if (v > ext.v) ext = { i, v }
      else if (v < ext.v - PROMINENCE) {
        // かたまりの最初のコマが山だと、本当の山は取る前にあった。数えない
        if (ext.i > 0) {
          const j = ext.i
          const d = vs[j - 1] - 2 * vs[j] + vs[j + 1]
          const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (vs[j - 1] - vs[j + 1])) / d)) : 0
          const dt = (ts[j + 1] - ts[j - 1]) / 2
          out.push({ t: ts[j] + off * dt, v: vs[j] - 0.25 * (vs[j - 1] - vs[j + 1]) * off })
        }
        seekMax = false
        ext = { i, v }
      }
    } else if (v < ext.v) ext = { i, v }
    else if (v > ext.v + PROMINENCE) {
      seekMax = true
      ext = { i, v }
    }
  }
  return out
}

function burstValues(fs: CamFrame[]) {
  const ts = fs.map((f) => f.T)
  let span = 0
  let count = 0
  const reach: number[] = []
  for (const k of [0, 1] as const) {
    const st = strikes(ts, fs.map((f) => f.ank[k]))
    reach.push(...st.map((s) => s.v))
    // 片脚の接地の間隔（1周、毎分 86〜266 歩）。左右の取り違えでできた、ありえない間隔があれば、その脚は使わない
    const iv = st.slice(1).map((s, j) => s.t - st[j].t)
    if (iv.length && iv.every((p) => p >= 0.45 && p <= 1.4)) {
      span += st[st.length - 1].t - st[0].t
      count += iv.length
    }
  }
  // 腰の上下：まっすぐな傾きを除いた、ばらつき × 2√2（波なら山から谷）
  const n = fs.length
  const tm = mean(ts)
  const ym = mean(fs.map((f) => f.hip))
  const slope = fs.reduce((a, f) => a + (f.T - tm) * (f.hip - ym), 0) / (fs.reduce((a, f) => a + (f.T - tm) ** 2, 0) || 1)
  const res = fs.map((f) => f.hip - ym - slope * (f.T - tm))
  const bounce = n >= 10 ? 2 * Math.SQRT2 * Math.sqrt(res.reduce((a, b) => a + b * b, 0) / n) * 100 : null
  const app = nums(fs.map((f) => f.cadence))
  return {
    camCadence: count >= 2 ? 120 / (span / count) : null,
    appCadence: app.length ? median(app) : null,
    camBounce: bounce,
    camReach: reach.length >= 2 ? mean(reach) * 100 : null,
  }
}

export function cameraBursts(cam: CamData, ph: PhoneData, offset: number, segs: Segment[]): Burst[] {
  const groups: CamFrame[][] = []
  let g: CamFrame[] = []
  for (const f of cam.frames) {
    if (g.length && (f.T - g[g.length - 1].T > 0.5 || f.T - g[0].T > 4)) {
      groups.push(g)
      g = []
    }
    g.push(f)
  }
  if (g.length) groups.push(g)
  const secs = ph.secs
  const out: Burst[] = []
  for (const fs of groups) {
    if (fs[fs.length - 1].T - fs[0].T < 1.5) continue
    const start = fs[0].T - offset
    const end = fs[fs.length - 1].T - offset
    const c = (start + end) / 2
    // 区間の切り替えの直後（走り方を変えるのに数歩かかる）と、スマホの窓が区間の外にはみ出すかたまりは使わない
    const seg = segs.find((s) => start >= s.start + SETTLE && c + 2 <= s.end)
    if (!seg) continue
    // スマホの値は直近 4 秒から出しているので、窓の真ん中がかたまりの真ん中に来る秒（c + 2 秒）を使う
    let best: PhoneSec | null = null
    for (const s of secs) if (Math.abs(s.T - (c + 2)) <= 1 && (!best || Math.abs(s.T - (c + 2)) < Math.abs(best.T - (c + 2)))) best = s
    out.push({ start, end, seg: seg.i, ...burstValues(fs), phCadence: best?.cadence ?? null, phBounce: best?.bounceCm ?? null, phBraking: best?.brakingMs ?? null })
  }
  return out
}

// ---- 区間ごとのまとめと関門 ----

export interface SegSummary {
  seg: Segment
  phCadence: number | null // 区間の中央値
  camCadence: number | null
  appCadence: number | null
  cadence: { n: number; meanDiff: number | null; mae: number | null; within: number | null } // 組にした値の差（スマホ − カメラ）
  phBounce: number | null
  camBounce: number | null
  phBraking: number | null
  camReach: number | null
  bounceDir: Dir | null
  brakingDir: Dir | null
  mount: { replay: MountIssue | null; at: number | null; live: MountIssue | null; liveAt: number | null; ok: boolean | null; features: FeatureStats }
}
type Change = 'up' | 'down' | 'flat'
export interface Dir {
  phone: Change
  camera: Change
  research?: Change
  same: boolean | null // 両方はっきり動いて同じ向きなら true、逆なら false、どちらかがはっきりしなければ null
}
interface FeatureStats {
  gyroHf: [number, number] | null // 中央値・90%
  gyroSwing: [number, number] | null
  gravity: [number, number] | null
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const stats = (xs: number[]): [number, number] | null => (xs.length ? [median(xs), q(xs, 0.9)] : null)

// 基準の区間からの変化が、ばらつき（平均の標準誤差の2倍）より大きいか
function change(a: number[], b: number[]): Change {
  if (a.length < 3 || b.length < 3) return 'flat'
  const d = mean(b) - mean(a)
  const se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length)
  return Math.abs(d) <= 2 * se ? 'flat' : d > 0 ? 'up' : 'down'
}
function dirOf(ref: Burst[], cur: Burst[], ph: (b: Burst) => number | null, cm: (b: Burst) => number | null, research?: 1 | -1): Dir {
  const p = change(nums(ref.map(ph)), nums(cur.map(ph)))
  const c = change(nums(ref.map(cm)), nums(cur.map(cm)))
  return { phone: p, camera: c, research: research ? (research > 0 ? 'up' : 'down') : undefined, same: p === 'flat' || c === 'flat' ? null : p === c }
}

export function summarize(ph: PhoneData, segs: Segment[], bursts: Burst[]): SegSummary[] {
  const refSeg = segs.find((s) => s.step?.key === 'normal1') ?? segs[0]
  const refB = bursts.filter((b) => b.seg === refSeg?.i)
  return segs.map((seg) => {
    const secs = ph.secs.filter((s) => s.T >= seg.start && s.T <= seg.end + 1)
    const vals = settled(ph, seg)
    const bs = bursts.filter((b) => b.seg === seg.i)
    const pairs = bs.filter((b) => b.phCadence !== null && b.camCadence !== null).map((b) => b.phCadence! - b.camCadence!)
    // 付け方の確認を、この区間だけで最初からやり直す（走りの中では1回鳴ると止まるので、区間ごとの答えを見るため）
    const mc = new MountCheck()
    let replay: MountIssue | null = null
    let at: number | null = null
    for (const s of secs) {
      const found = mc.check(s.T - seg.start, s.x)
      if (found) {
        replay = found
        at = s.T - seg.start
        break
      }
    }
    const firstLive = ph.secs.find((s) => s.mount !== null)
    const liveHere = firstLive && firstLive.T >= seg.start && firstLive.T <= seg.end + 1 ? firstLive : null
    const research = seg.step ? RESEARCH[seg.step.key] : undefined
    const isRef = seg === refSeg
    const feats = secs.map((s) => s.x).filter((x): x is MountFeatures => !!x)
    return {
      seg,
      phCadence: orNull(median(nums(vals.map((s) => s.cadence)))),
      camCadence: orNull(median(nums(bs.map((b) => b.camCadence)))),
      appCadence: orNull(median(nums(bs.map((b) => b.appCadence)))),
      cadence: {
        n: pairs.length,
        meanDiff: orNull(mean(pairs)),
        mae: orNull(mean(pairs.map(Math.abs))),
        within: pairs.length ? pairs.filter((d) => Math.abs(d) <= CADENCE_OK).length / pairs.length : null,
      },
      phBounce: orNull(median(nums(vals.map((s) => s.bounceCm)))),
      camBounce: orNull(median(nums(bs.map((b) => b.camBounce)))),
      phBraking: orNull(median(nums(vals.map((s) => s.brakingMs)))),
      camReach: orNull(median(nums(bs.map((b) => b.camReach)))),
      bounceDir: isRef || !refB.length ? null : dirOf(refB, bs, (b) => b.phBounce, (b) => b.camBounce, research?.bounce),
      brakingDir: isRef || !refB.length ? null : dirOf(refB, bs, (b) => b.phBraking, (b) => b.camReach, research?.braking),
      mount: {
        replay,
        at,
        live: liveHere?.mount ?? null,
        liveAt: liveHere ? liveHere.T - seg.start : null,
        ok: seg.step ? replay === seg.step.expect : null,
        features: {
          gyroHf: stats(nums(feats.map((x) => x.gyroHf))),
          gyroSwing: stats(nums(feats.map((x) => x.gyroSwing))),
          gravity: stats(feats.map((x) => x.gravity)),
        },
      },
    }
  })
}
// 値を比べるスマホの秒：区間の中で、直近 4 秒の窓がまるごと区間に入っている秒（走り出し・止まりぎわの値を除く）
const settled = (ph: PhoneData, seg: Segment) => ph.secs.filter((s) => s.T >= seg.start + 4 && s.T <= seg.end)
const orNull = (x: number) => (Number.isFinite(x) ? x : null)

export interface Gates {
  cadence: { ok: boolean | null; note: string }
  direction: { ok: boolean | null; note: string }
  mount: { ok: boolean | null; note: string }
}

export function gates(sum: SegSummary[]): Gates {
  const waist = sum.filter((s) => s.seg.step?.waist && s.cadence.meanDiff !== null)
  const bad = waist.filter((s) => Math.abs(s.cadence.meanDiff!) > CADENCE_OK)
  const allPairs = waist.reduce((a, s) => a + s.cadence.n, 0)
  const within = allPairs ? waist.reduce((a, s) => a + (s.cadence.within ?? 0) * s.cadence.n, 0) / allPairs : null
  const cadence = {
    ok: waist.length ? bad.length === 0 : null,
    note: waist.length
      ? `腰の区間 ${waist.length} 個のうち、差の平均が ±${CADENCE_OK} 歩/分を超えたのは ${bad.length} 個${bad.length ? `（${bad.map((s) => s.seg.name).join('、')}）` : ''}。かたまりごとでは ${pct(within)} が ±${CADENCE_OK} 以内`
      : '比べられる腰の区間がない',
  }
  const dirs = sum.flatMap((s) => [s.bounceDir, s.brakingDir].filter((d): d is Dir => !!d && (s.seg.step?.key === 'slow' || s.seg.step?.key === 'bouncy')))
  const decided = dirs.filter((d) => d.same !== null)
  const direction = {
    ok: decided.length ? decided.every((d) => d.same) : null,
    note: dirs.length
      ? `ピッチを落とす・弾む区間の上下動・ブレーキ ${dirs.length} 個のうち、両方はっきり動いたのが ${decided.length} 個、そのうち同じ向き ${decided.filter((d) => d.same).length} 個`
      : '「ピッチを落とす」「わざと弾む」の区間が見分けられていない',
  }
  const named = sum.filter((s) => s.mount.ok !== null)
  const wrong = named.filter((s) => !s.mount.ok)
  const mount = {
    ok: named.length ? wrong.length === 0 : null,
    note: named.length
      ? `区間ごとにやり直した付け方の確認が、手順書の答えと合わなかった区間 ${wrong.length} 個${wrong.length ? `（${wrong.map((s) => `${s.seg.name}：${issueName(s.mount.replay)}`).join('、')}）` : ''}`
      : '区間の名前がないので確かめられない',
  }
  return { cadence, direction, mount }
}

// ---- 全体 ----

export interface Comparison {
  alignment: Alignment
  segments: Segment[]
  bursts: Burst[]
  summary: SegSummary[]
  gates: Gates
  warnings: string[]
  t0: number // 図と表の 0 秒（最初の区間の始まり、スマホの時刻）
  phone: PhoneData
}

export function compare(phoneFile: unknown, cameraFile: unknown, opts: { offset?: number; labels?: string[]; steps?: Step[] } = {}): Comparison {
  const ph = readPhone(phoneFile)
  const cam = readCamera(cameraFile)
  if (!ph.raw.length) throw new Error('スマホの記録に生の値がない')
  if (!cam.frames.length) throw new Error('カメラの記録に、骨格の取れたコマがない')
  const alignment = align(ph, cam, opts.offset)
  const { segments, warnings } = findSegments(ph, opts.steps ?? TEST1, opts.labels)
  const bursts = cameraBursts(cam, ph, alignment.offset, segments)
  const summary = summarize(ph, segments, bursts)
  return {
    alignment,
    segments,
    bursts,
    summary,
    gates: gates(summary),
    warnings: [...alignment.warnings, ...warnings],
    t0: segments[0]?.start ?? ph.raw[0].T,
    phone: ph,
  }
}

// ---- 人が読む形 ----

const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d))
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const ARROW: Record<Change, string> = { up: '↑', down: '↓', flat: '→' }
const issueName = (x: MountIssue | null) => (x === null ? '鳴らない' : x === 'notWaist' ? '腰以外' : x === 'loose' ? 'ゆるい' : 'ずれた')
const okMark = (x: boolean | null) => (x === null ? '–' : x ? '合う' : '合わない')
const dirText = (d: Dir | null) => (d ? `${ARROW[d.phone]} / ${ARROW[d.camera]}${d.research ? `（研究 ${ARROW[d.research]}）` : ''} ${d.same === null ? 'はっきりしない' : d.same ? '同じ' : '逆'}` : '基準')

export function report(c: Comparison): string {
  const a = c.alignment
  const L: string[] = []
  L.push('# スマホ版とカメラ版の比べ（実機テスト①）', '')
  L.push('## 関門の目安', '')
  L.push('| 関門 | 結果 | 中身 |', '|---|---|---|')
  L.push(`| ピッチがカメラ版と合う（±${CADENCE_OK}歩/分） | ${okMark(c.gates.cadence.ok)} | ${c.gates.cadence.note} |`)
  L.push(`| ブレーキ・上下動がカメラ版と同じ向きに動く | ${okMark(c.gates.direction.ok)} | ${c.gates.direction.note} |`)
  L.push(`| 付け方の確認が、鳴るべきときだけ鳴る | ${okMark(c.gates.mount.ok)} | ${c.gates.mount.note} |`)
  L.push('', '結果は道具が出した目安。声を出してよいかは、表の中身を見て決める。', '')
  L.push('## 時刻の合わせ方', '')
  L.push(`- カメラの時刻 = スマホの時刻 + **${a.offset.toFixed(2)} 秒**（${a.how === 'manual' ? '手で指定' : a.how === 'clock' ? 'ふつうの時刻のまま' : '動きの強さの相関'}）`)
  L.push(`- 相関の山 ${f(a.r, 2)}、次の山 ${f(a.second, 2)}、組にした刻み ${a.pairs}`)
  L.push(`- 前半だけで探すと ${f(a.halves[0], 2)} 秒、後半だけで ${f(a.halves[1], 2)} 秒（ちがいが大きければ、時計の進みがちがう）`)
  if (!a.clockOffset) L.push('- カメラの記録に時計の対応がない（古い記録か動画）。もとの位置は大まかなので、広く探した')
  if (c.warnings.length) L.push('', '**気をつけること**', '', ...c.warnings.map((w) => `- ${w}`))
  L.push('', '## 区間', '')
  L.push('| # | 区間 | 始まり | 長さ | ピッチ スマホ | ピッチ カメラ | カメラ版の値 | 組 | 差の平均 | 差の絶対値 | ±2以内 |', '|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of c.summary) {
    L.push(`| ${s.seg.i + 1} | ${s.seg.name} | ${mmss(s.seg.start - c.t0)} | ${mmss(s.seg.end - s.seg.start)} | ${f(s.phCadence)} | ${f(s.camCadence)} | ${f(s.appCadence, 0)} | ${s.cadence.n} | ${f(s.cadence.meanDiff)} | ${f(s.cadence.mae)} | ${pct(s.cadence.within)} |`)
  }
  L.push('', 'ピッチ：歩/分、区間の中央値。「カメラ」は足首が一番前に出た瞬間の間隔から道具で測り直した値、「カメラ版の値」はカメラ版が記録した値。差はスマホ − カメラ（かたまりごとの組）', '')
  L.push('## 上下動・ブレーキ（最初の「ふつう」からの向き）', '')
  L.push('| 区間 | 上下動 スマホ cm | 上下動 カメラ %脚 | 向き スマホ/カメラ | ブレーキ スマホ m/s | 着地の足の前への出 カメラ %脚 | 向き スマホ/カメラ |', '|---|---|---|---|---|---|---|')
  for (const s of c.summary) {
    L.push(`| ${s.seg.name} | ${f(s.phBounce)} | ${f(s.camBounce)} | ${dirText(s.bounceDir)} | ${f(s.phBraking, 2)} | ${f(s.camReach)} | ${dirText(s.brakingDir)} |`)
  }
  L.push('', 'カメラにはブレーキそのものがないので、着地で足首が腰より前に出た量（オーバーストライド）を目安にした。向きは、かたまりごとの値の平均の差が標準誤差の2倍を超えたときだけ ↑↓', '')
  L.push('## 付け方の確認', '')
  L.push('| 区間 | 答え | 区間ごとにやり直す | 走りの中で実際に | 細かい回転 rad/s（中央・90%） | 水平軸の回転 rad/s | 平均の加速度 m/s² | 合う |', '|---|---|---|---|---|---|---|---|')
  for (const s of c.summary) {
    const m = s.mount
    const st = (x: [number, number] | null, d: number) => (x ? `${x[0].toFixed(d)}・${x[1].toFixed(d)}` : '–')
    L.push(`| ${s.seg.name} | ${s.seg.step ? issueName(s.seg.step.expect) : '–'} | ${issueName(m.replay)}${m.at !== null ? `（${Math.round(m.at)}秒）` : ''} | ${m.live ? `${issueName(m.live)}（${Math.round(m.liveAt!)}秒）` : ''} | ${st(m.features.gyroHf, 2)} | ${st(m.features.gyroSwing, 2)} | ${st(m.features.gravity, 1)} | ${okMark(m.ok)} |`)
  }
  L.push('', '走りの中では1回鳴ると止まるので、区間ごとに最初からやり直した結果で比べる。線は params.ts の MOUNT（細かい回転 ≥ 0.5 でゆるい、水平軸の回転 ≥ 1.5 で腰以外）')
  return L.join('\n') + '\n'
}

export function burstsCsv(c: Comparison): string {
  const head = 'start_s,end_s,segment,phone_cadence,camera_cadence,camera_app_cadence,phone_bounce_cm,camera_bounce_pct_leg,phone_braking_ms,camera_reach_pct_leg'
  const rows = c.bursts.map((b) => [f(b.start - c.t0, 2), f(b.end - c.t0, 2), c.segments[b.seg!]?.name ?? '', f(b.phCadence), f(b.camCadence), f(b.appCadence, 0), f(b.phBounce, 2), f(b.camBounce, 2), f(b.phBraking, 3), f(b.camReach, 2)].map((x) => (x === '–' ? '' : x)).join(','))
  return [head, ...rows].join('\n') + '\n'
}

export function secondsCsv(c: Comparison): string {
  const head = 't_s,segment,cadence,bounce_cm,braking_ms,mount,stepHz,gravity,gyroSwing,gyroHf'
  const rows = c.phone.secs.map((s) => {
    const seg = c.segments.find((g) => s.T >= g.start && s.T <= g.end + 1)
    return [f(s.T - c.t0, 1), seg?.name ?? '', f(s.cadence), f(s.bounceCm, 2), f(s.brakingMs, 3), s.mount ?? '', f(s.x?.stepHz, 3), f(s.x?.gravity, 2), f(s.x?.gyroSwing, 3), f(s.x?.gyroHf, 3)].map((x) => (x === '–' ? '' : x)).join(',')
  })
  return [head, ...rows].join('\n') + '\n'
}

// 図：ピッチ・上下動・ブレーキを、時間をそろえて上下に並べる。上下動とブレーキは単位がちがうので、
// どちらも最初の「ふつう」の中央値を 100 とした値にする（1つの軸に2つの目盛りを置かない）
export function chartSvg(c: Comparison): string {
  const W = 1000
  const PH = 200
  const M = { l: 56, r: 16, t: 28, b: 24 }
  const end = Math.max(...c.segments.map((s) => s.end), c.t0 + 60) - c.t0
  const x = (t: number) => M.l + ((t - c.t0) / end) * (W - M.l - M.r)
  const BLUE = '#2a78d6'
  const ORANGE = '#eb6834'
  const ref = c.summary.find((s) => s.seg.step?.key === 'normal1') ?? c.summary[0]
  const secs = c.segments.flatMap((g) => settled(c.phone, g))
  const panels: { title: string; ph: [number, number][]; cam: [number, number][] }[] = [
    {
      title: 'ピッチ（歩/分）',
      ph: secs.filter((s) => s.cadence !== null).map((s) => [s.T, s.cadence!]),
      cam: c.bursts.filter((b) => b.camCadence !== null).map((b) => [(b.start + b.end) / 2, b.camCadence!]),
    },
    {
      title: '上下動（最初の「ふつう」= 100）',
      ph: secs.filter((s) => s.bounceCm !== null && ref?.phBounce).map((s) => [s.T, (s.bounceCm! / ref.phBounce!) * 100]),
      cam: c.bursts.filter((b) => b.camBounce !== null && ref?.camBounce).map((b) => [(b.start + b.end) / 2, (b.camBounce! / ref.camBounce!) * 100]),
    },
    {
      title: 'ブレーキ（スマホ）・着地の足の前への出（カメラ）（最初の「ふつう」= 100）',
      ph: secs.filter((s) => s.brakingMs !== null && ref?.phBraking).map((s) => [s.T, (s.brakingMs! / ref.phBraking!) * 100]),
      cam: c.bursts.filter((b) => b.camReach !== null && ref?.camReach).map((b) => [(b.start + b.end) / 2, (b.camReach! / ref.camReach!) * 100]),
    },
  ]
  const H = M.t + panels.length * (PH + M.t + M.b) + 20
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`)
  out.push(`<rect width="${W}" height="${H}" fill="#fcfcfb"/>`)
  out.push(`<g transform="translate(${M.l},16)"><line x1="0" y1="0" x2="18" y2="0" stroke="${BLUE}" stroke-width="2"/><text x="24" y="4" fill="#0b0b0b">スマホ（1秒ごと）</text><circle cx="150" cy="0" r="4" fill="${ORANGE}" stroke="#fcfcfb" stroke-width="2"/><text x="160" y="4" fill="#0b0b0b">カメラ（かたまりごと）</text></g>`)
  panels.forEach((p, k) => {
    const top = M.t + k * (PH + M.t + M.b) + M.t
    const vals = [...p.ph.map((v) => v[1]), ...p.cam.map((v) => v[1])]
    if (!vals.length) return
    let lo = q(vals, 0.01)
    let hi = q(vals, 0.99)
    if (hi - lo < 1e-6) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
    const y = (v: number) => top + PH - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * PH
    out.push(`<text x="${M.l}" y="${top - 8}" fill="#0b0b0b" font-weight="600">${p.title}</text>`)
    for (const s of c.segments) {
      out.push(`<rect x="${x(s.start)}" y="${top}" width="${Math.max(1, x(s.end) - x(s.start))}" height="${PH}" fill="#f0efec"/>`)
      if (k === 0) out.push(`<text x="${x(s.start) + 3}" y="${top + 12}" fill="#52514e" font-size="10">${s.name}</text>`)
    }
    for (let j = 0; j <= 4; j++) {
      const v = lo + ((hi - lo) * j) / 4
      out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e1dc" stroke-width="1"/><text x="${M.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="#52514e">${v.toFixed(0)}</text>`)
    }
    // スマホは線。1秒より大きくあいたところでは切る
    let d = ''
    let prev = -1e9
    for (const [t, v] of p.ph) {
      d += `${t - prev > 3 ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`
      prev = t
    }
    out.push(`<path d="${d}" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linejoin="round"/>`)
    for (const [t, v] of p.cam) out.push(`<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${ORANGE}" stroke="#fcfcfb" stroke-width="2"/>`)
    for (let m = 0; m <= end / 60; m += end > 1200 ? 5 : 1) {
      out.push(`<text x="${x(c.t0 + m * 60)}" y="${top + PH + 16}" text-anchor="middle" fill="#52514e">${m}分</text>`)
    }
  })
  out.push('</svg>')
  return out.join('\n') + '\n'
}
