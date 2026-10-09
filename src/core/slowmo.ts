import type { Frame } from './types'
import { L } from './landmarks'
import { facing, leanFromVertical, legLength, mid } from './geometry'

// スロー動画（iPhone の 240fps など）を1コマずつ見て、接地のタイミングを測る
// 走りながらの判定（毎秒15コマ）では測れない、接地時間・着地のすね・上下動をここで出す
//   足は2本を通しで追う。骨格の推定は左右の名前をときどき取り違えるので、名前ではなく、前のコマからの動きで
//     予想した位置に近いほうを同じ足とする
//   地面の高さは足ごとに決める。スマホが腰の高さから少し見下ろすと、奥の足は地面に着いていても画面の上で
//     手前の足より高く映る（研究データの仮想実験で約25画素）。2本を同じ線で見ると、奥の足が着地していないことになる
//   接地：その足の一番低い点（かかと・足首・つま先）が、その足の地面の線から脚の長さの2%以内にある間。
//     接地中も、かかと→足裏→つま先と一番低い点が移り、1〜2cm上下するため
//   地面の線は、スマホの傾きに合わせて斜めにも引く（トレッドミルでは、接地中の足がベルトで後ろへ運ばれる）

export interface TimedFrame {
  t: number // 動画の時刻（秒）。スロー動画では実際の時間より長い
  f: Frame
}

export interface Contact {
  start: number // 実際の時刻（秒）
  end: number
  shank: number // 着地の瞬間のすねの角度（鉛直から、進む向きが正）
  footAhead: number // 着地の瞬間、足首が腰より前にある距離（脚の長さに対する割合）
}

export interface SlowReport {
  slow: number // 何倍のスローとして読んだか
  framesPerSec: number // 実際の時間あたりのコマ数
  contacts: Contact[]
  cadence: number // 歩／分
  contactMs: number | null // 1歩の接地時間。動画から両足が浮いた瞬間が見えないときは null
  flightMs: number | null // 1歩あたりの、両足が浮いている時間
  dutyFactor: number | null // 1周のうち、片足が地面に着いている割合
  shankAtContact: number
  footAheadAtContact: number
  verticalLeg: number // 腰の上下動（脚の長さに対する割合）
  trunk: number // 上体の前傾（度）
}

// 点のぶれは、実際の時間で約20msぶんのコマの中央値でならしてから見る。ぶれの大きさは動画ごとに測る
const TOL_MAX = 0.035
const SMOOTH_SEC = 0.02
// 着地・離地：足の一番低い点が、その足の地面の線から脚の長さのこの割合以内なら着いているとする
// （研究データの仮想実験で、3%だと接地時間が約45ms長く、2%で約0〜30msになった。sim/placement.sim.ts）
const OFF_TOL = 0.02
const SLOW_CANDIDATES = [1, 2, 4, 8, 10, 16]
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const pct = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}


const LEFT_FOOT = [L.leftAnkle, L.leftHeel, L.leftFoot]
const RIGHT_FOOT = [L.rightAnkle, L.rightHeel, L.rightFoot]
const lowOf = (f: Frame, pts: number[]) => Math.max(...pts.map((i) => f[i].y))
type Side = 'L' | 'R'
interface FootPt {
  side: Side
  x: number
  low: number
}
const footAt = (f: Frame, side: Side): FootPt => {
  const pts = side === 'L' ? LEFT_FOOT : RIGHT_FOOT
  return { side, x: mean(pts.map((i) => f[i].x)), low: lowOf(f, pts) }
}

// 2本の足を、動画の最初から最後まで追う
export function footTracks(frames: TimedFrame[]): [FootPt[], FootPt[]] {
  const A: FootPt[] = [footAt(frames[0].f, 'L')]
  const B: FootPt[] = [footAt(frames[0].f, 'R')]
  let va = { x: 0, y: 0 }
  let vb = { x: 0, y: 0 }
  const d = (p: FootPt, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.low - q.y)
  for (let i = 1; i < frames.length; i++) {
    const a = A[i - 1]
    const b = B[i - 1]
    const pa = { x: a.x + va.x, y: a.low + va.y }
    const pb = { x: b.x + vb.x, y: b.low + vb.y }
    const l = footAt(frames[i].f, 'L')
    const r = footAt(frames[i].f, 'R')
    const keep = d(l, pa) + d(r, pb) <= d(r, pa) + d(l, pb)
    const na = keep ? l : r
    const nb = keep ? r : l
    va = { x: na.x - a.x, y: na.low - a.low }
    vb = { x: nb.x - b.x, y: nb.low - b.low }
    A.push(na)
    B.push(nb)
  }
  return [A, B]
}

// その足の地面の線：一番低いあたりを通る水平線から始め、線の近くにある点（＝接地中の点）だけで引き直す
function groundOf(track: FootPt[], leg: number) {
  let slope = 0
  let a = pct(track.map((p) => p.low), 0.9)
  const line = (x: number) => a + slope * x
  for (const k of [0.06, 0.04, 0.03]) {
    const sel = track.filter((p) => Math.abs(line(p.x) - p.low) <= k * leg)
    if (sel.length < 5) break
    const mx = mean(sel.map((p) => p.x))
    const my = mean(sel.map((p) => p.low))
    const sxx = sel.reduce((s, p) => s + (p.x - mx) ** 2, 0)
    const sp = Math.max(...sel.map((p) => p.x)) - Math.min(...sel.map((p) => p.x))
    // 点の左右の広がりが脚の長さの2割に満たないときは、傾きを決められないので水平のまま
    slope = sxx && sp > 0.2 * leg ? sel.reduce((s, p) => s + (p.x - mx) * (p.low - my), 0) / sxx : 0
    a = my - slope * mx
  }
  return line
}

// その足の、地面からの高さ（画素、上が正）。実際の時間で約20msぶんの中央値でならす
function heightOf(track: FootPt[], leg: number, smooth: number) {
  const line = groundOf(track, leg)
  const raw = track.map((p) => line(p.x) - p.low)
  const h = Math.floor(smooth / 2)
  return raw.map((_, i) => median(raw.slice(Math.max(0, i - h), i + h + 1)))
}

// 信号が繰り返す周期（コマ数）。自己相関が、最初に0を下回ったあと一番強く戻ってくるずれ。
// 一番高い山の8割以上ある最初の山を取る（倍の周期も同じくらい高く出るので）
export function signalPeriod(y: number[]): number | null {
  const m = mean(y)
  const d = y.map((v) => v - m)
  const n = d.length
  const energy = d.reduce((a, v) => a + v * v, 0)
  if (!energy) return null
  const ac = (lag: number) => {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag]
    return s / energy / ((n - lag) / n)
  }
  const maxLag = Math.floor(n / 2)
  const r = Array.from({ length: maxLag + 1 }, (_, lag) => (lag < 3 ? 1 : ac(lag)))
  const firstNeg = r.findIndex((v) => v < 0)
  if (firstNeg < 0) return null
  let best = -1
  for (let lag = firstNeg; lag <= maxLag; lag++) if (best < 0 || r[lag] > r[best]) best = lag
  if (best < 0 || r[best] <= 0.2) return null
  for (let lag = firstNeg + 1; lag < maxLag; lag++) {
    if (r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= 0.8 * r[best]) return lag
  }
  return best
}

// その足の接地の区間（コマの番号）
function spansOf(height: number[], leg: number, strideFrames: number) {
  // 点のぶれ：地面の近くにいるコマどうしの差から見積もる
  const near0 = height.map((y) => y <= TOL_MAX * leg)
  const diffs = height.slice(1).flatMap((y, i) => (near0[i] && near0[i + 1] ? [Math.abs(y - height[i])] : []))
  const sigma = diffs.length ? (1.4826 * median(diffs)) / Math.SQRT2 : 0
  const tol = Math.max(OFF_TOL * leg, 2.5 * sigma)
  const on = height.map((y) => y <= tol)
  const spans: { i0: number; i1: number }[] = []
  let s = -1
  on.forEach((v, i) => {
    if (v && s < 0) s = i
    if (!v && s >= 0) {
      spans.push({ i0: s, i1: i - 1 })
      s = -1
    }
  })
  // 1周の5%より短いすき間はつなぐ。1周の8%より短い、または7割より長い区間は接地ではない
  const merged: typeof spans = []
  for (const sp of spans) {
    const prev = merged[merged.length - 1]
    if (prev && sp.i0 - prev.i1 < strideFrames * 0.05) prev.i1 = sp.i1
    else merged.push({ ...sp })
  }
  // 動画の最初と最後で切れている接地は、長さが分からないので使わない
  return merged.filter((sp) => sp.i0 > 0 && sp.i1 < height.length - 1 && sp.i1 - sp.i0 >= strideFrames * 0.08 && sp.i1 - sp.i0 <= strideFrames * 0.7)
}

// 実際のピッチが毎分130〜230歩に入るスローの倍率を選ぶ（スロー動画は時間が引き延ばされている）
export function guessSlow(strideVideoSec: number): number {
  const ok = SLOW_CANDIDATES.filter((k) => {
    const spm = 120 / (strideVideoSec / k)
    return spm >= 130 && spm <= 230
  })
  if (!ok.length) return 1
  return ok.reduce((a, b) => (Math.abs(120 / (strideVideoSec / a) - 175) <= Math.abs(120 / (strideVideoSec / b) - 175) ? a : b))
}

export function analyzeRun(frames: TimedFrame[], slow?: number): SlowReport | null {
  if (frames.length < 20) return null
  const leg = median(frames.map(({ f }) => legLength(f)))
  const dir = facing(frames[Math.floor(frames.length / 2)].f)
  const dt = median(frames.slice(1).map((x, i) => x.t - frames[i].t))
  const tracks = footTracks(frames)
  // 1回目：ならさずに足の高さのリズムから1周の長さを出し、スローの倍率を決める
  const strideFrames = tracks.map((tr) => signalPeriod(heightOf(tr, leg, 1))).find((p) => p !== null)
  if (!strideFrames) return null
  const k = slow ?? guessSlow(strideFrames * dt)
  const real = (t: number) => t / k
  // 2回目：実際の時間で約20msぶんならして、足ごとに接地を見る
  const n = Math.max(1, Math.round((SMOOTH_SEC * k) / dt))
  const smooth = n % 2 ? n : n + 1
  // 着地するのは、もう一方の足より前にある足。後ろの足が点のぶれで地面すれすれに見えただけの「接地」は除く
  // （腰と比べないのは、斜めから撮ると左右の腰の奥行きの違いで、腰の位置が画面の上で前後にずれるため）。
  // 同じ足の接地は1周に1回なので、近すぎるものは、より前で着いたほうを残す
  // 真横に近いときは腰より前、斜めから撮ったときはもう一方の足より前、のどちらかを満たせば着地とする
  const ahead = (sp: { i0: number }, tr: FootPt[], other: FootPt[]) => ((tr[sp.i0].x - other[sp.i0].x) * dir) / leg
  const aheadHip = (sp: { i0: number }, tr: FootPt[]) => ((tr[sp.i0].x - mid(frames[sp.i0].f[L.leftHip], frames[sp.i0].f[L.rightHip]).x) * dir) / leg
  const perTrack = tracks.map((tr, t) => {
    const other = tracks[1 - t]
    const spans: { i0: number; i1: number }[] = []
    for (const sp of spansOf(heightOf(tr, leg, smooth), leg, strideFrames).filter((x) => ahead(x, tr, other) > 0.1 || aheadHip(x, tr) > 0.05)) {
      const prev = spans[spans.length - 1]
      if (prev && sp.i0 - prev.i0 < strideFrames * 0.6) {
        if (ahead(sp, tr, other) > ahead(prev, tr, other)) spans[spans.length - 1] = sp
      } else spans.push(sp)
    }
    return { tr, spans }
  })
  const all = perTrack
    .flatMap(({ tr, spans }) => spans.map((sp) => ({ ...sp, side: tr[sp.i0].side })))
    .sort((a, b) => a.i0 - b.i0)
  if (all.length < 2) return null
  // 1周の長さ：足ごとに、次の着地までの間隔の中央値
  // 着地を見落とすと間隔が2周ぶんになるので、足のリズムから出した1周の長さの何倍かで割って戻す
  const strides = perTrack.flatMap(({ spans }) =>
    spans.slice(1).flatMap((sp, j) => {
      const gap = frames[sp.i0].t - frames[spans[j].i0].t
      const m = Math.round(gap / (strideFrames * dt))
      return m >= 1 ? [gap / m] : []
    }),
  )
  const stride = real(strides.length ? median(strides) : strideFrames * dt)
  const step = stride / 2
  const durations = all.map((sp) => real(frames[sp.i1].t - frames[sp.i0].t) + real(dt))
  const contactSec = durations.length >= 2 && median(durations) < step ? median(durations) : null
  // 角度は、はっきり見えている脚（手前の脚）の着地だけで出す。奥の脚は隠れて点が不確か
  const vis = (sp: { i0: number; side: Side }) => {
    const f = frames[sp.i0].f
    return sp.side === 'L' ? f[L.leftKnee].v + f[L.leftAnkle].v : f[L.rightKnee].v + f[L.rightAnkle].v
  }
  const contacts: Contact[] = all.map((sp) => {
    const f = frames[sp.i0].f
    const hip = mid(f[L.leftHip], f[L.rightHip])
    const knee = sp.side === 'L' ? L.leftKnee : L.rightKnee
    const ankle = sp.side === 'L' ? L.leftAnkle : L.rightAnkle
    return {
      start: real(frames[sp.i0].t),
      end: real(frames[sp.i1].t) + real(dt),
      shank: -leanFromVertical(f[ankle], f[knee], dir), // 足首が膝より前に出て着くほど正
      footAhead: ((f[ankle].x - hip.x) * dir) / leg,
    }
  })
  const bestVis = Math.max(...all.map(vis))
  const clear = contacts.filter((_, j) => vis(all[j]) >= bestVis - 0.3)
  // 上下動：1歩ずつ（着地から次の着地まで）、腰の一番高い位置と低い位置の差
  // 腰の点もぶれるので、実際の時間で約60msぶんの中央値でならしてから測る
  const rawHip = frames.map(({ f }) => mid(f[L.leftHip], f[L.rightHip]).y)
  const hw = Math.max(1, Math.round((0.03 * k) / dt))
  const hipY = rawHip.map((_, i) => median(rawHip.slice(Math.max(0, i - hw), i + hw + 1)))
  // 着地から1歩ぶん（片足の着地を見落としても、1歩ぶんの区間で測れる）
  const stepFrames = Math.max(2, Math.round((step * k) / dt))
  const swings = all
    .map((sp) => hipY.slice(sp.i0, sp.i0 + stepFrames))
    .filter((ys) => ys.length === stepFrames)
    .map((ys) => (Math.max(...ys) - Math.min(...ys)) / leg)
  // 左右の名前が入れ替わっても変わらないよう、上体は両側の真ん中で見る
  const trunk = mean(frames.map(({ f }) => leanFromVertical(mid(f[L.leftHip], f[L.rightHip]), mid(f[L.leftShoulder], f[L.rightShoulder]), dir)))
  return {
    slow: k,
    framesPerSec: 1 / real(dt),
    contacts,
    cadence: 60 / step,
    contactMs: contactSec === null ? null : contactSec * 1000,
    flightMs: contactSec === null ? null : Math.max(0, (step - contactSec) * 1000),
    dutyFactor: contactSec === null ? null : contactSec / stride,
    shankAtContact: median(clear.map((c) => c.shank)),
    footAheadAtContact: median(clear.map((c) => c.footAhead)),
    verticalLeg: median(swings),
    trunk,
  }
}
