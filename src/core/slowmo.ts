import type { Frame } from './types'
import { L } from './landmarks'
import { facing, leanFromVertical, legLength, mid } from './geometry'

// スロー動画（iPhone の 240fps など）を1コマずつ見て、接地のタイミングを測る
// 走りながらの判定（毎秒15コマ）では測れない、接地時間・着地のすね・上下動をここで出す
//   接地：どちらかの足（かかと・足首・つま先の一番低い点）が、地面の高さの近くにある間。1回の接地＝1歩
//   地面の高さ：動画の中で、足が一番低くなる高さ（上位5%の値）
//   真横から撮ると、骨格の推定が左右の脚の名前をコマごとに入れ替えることがあるので、左右は区別しない。
//   着地した脚は、そのコマで一番低い足の側とする

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

// 足が地面の高さから、脚の長さの1%（約1cm）か、点のぶれの2.5倍の、大きいほう以内なら接地。
// 広くしすぎると、着く直前・離れた直後まで接地に数えてしまう（見本の走りで、2%だと接地時間が約35ms長く出た）。
// 実際の動画は点がぶれるので、ぶれの大きさを動画ごとに測って幅を決める（上限は3.5%）
// 点のぶれは、実際の時間で約20msぶんのコマの中央値でならしてから見る
const TOL_MIN = 0.01
const TOL_MAX = 0.035
const SMOOTH_SEC = 0.02
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


// 接地している区間を、動画の時刻で返す
const LEFT_FOOT = [L.leftAnkle, L.leftHeel, L.leftFoot]
const RIGHT_FOOT = [L.rightAnkle, L.rightHeel, L.rightFoot]
const lowOf = (f: Frame, pts: number[]) => Math.max(...pts.map((i) => f[i].y))
// そのコマで一番低い足の点（x, y）
function lowestFoot(f: Frame) {
  let best = f[LEFT_FOOT[0]]
  for (const i of [...LEFT_FOOT, ...RIGHT_FOOT]) if (f[i].y > best.y) best = f[i]
  return best
}

// 地面の線：スマホが少し傾いていたり、上から見下ろしていたりすると、地面は画面の上で斜めになる（トレッドミルでは、
// 接地中の足がベルトで後ろへ運ばれるにつれて、画面の上で上下に動いていく）。
//   1. 足の一番低い点を左右10区間に分け、区間ごとの一番低いあたり（上位10%）を出す
//   2. その区間どうしを結ぶ傾きの中央値で、最初の線を引く（両端の区間は浮いた足しかないことがあるので、中央値で外す）
//   3. その線の近くにある足の点（＝接地中の足）だけで直線を引き直す。近さの幅を脚の長さの5% → 3% と狭めて2回
function groundLine(frames: TimedFrame[]) {
  const pts = frames.map(({ f }) => lowestFoot(f))
  const leg = median(frames.map(({ f }) => legLength(f)))
  const xs = pts.map((p) => p.x)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const bins: { x: number; y: number }[] = []
  for (let b = 0; b < 10; b++) {
    const lo = x0 + ((x1 - x0) * b) / 10
    const hi = x0 + ((x1 - x0) * (b + 1)) / 10
    const ys = pts.filter((p) => p.x >= lo && (b === 9 ? p.x <= hi : p.x < hi)).map((p) => p.y)
    if (ys.length >= 3) bins.push({ x: (lo + hi) / 2, y: pct(ys, 0.9) })
  }
  const slopes: number[] = []
  for (let i = 0; i < bins.length; i++) for (let j = i + 1; j < bins.length; j++) slopes.push((bins[j].y - bins[i].y) / (bins[j].x - bins[i].x))
  let slope = slopes.length ? median(slopes) : 0
  // 線の高さ：線から見て一番低いあたり（上位5%）を通す
  let a = pct(pts.map((p) => p.y - slope * p.x), 0.95)
  const line = (x: number) => a + slope * x
  for (const k of [0.05, 0.03]) {
    const sel = pts.filter((p) => Math.abs(line(p.x) - p.y) <= k * leg)
    if (sel.length < 5) break
    const mx = mean(sel.map((p) => p.x))
    const my = mean(sel.map((p) => p.y))
    const sxx = sel.reduce((s, p) => s + (p.x - mx) ** 2, 0)
    const sp = Math.max(...sel.map((p) => p.x)) - Math.min(...sel.map((p) => p.x))
    if (sxx && sp > 0.2 * leg) slope = sel.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
    a = my - slope * mx
  }
  return line
}

// 地面からの足の高さ（画素、上が正）
export function footLows(frames: TimedFrame[]) {
  const ground = groundLine(frames)
  return frames.map(({ f }) => {
    const p = lowestFoot(f)
    return ground(p.x) - p.y
  })
}

// 足の高さが上下するリズムの周期（コマ数）＝1歩の長さ。自己相関が一番強く戻ってくるずれ
// 接地を数える前に周期を出しておくと、スロー動画で1回の接地が細かく割れても、倍率を取り違えない
export function footPeriod(frames: TimedFrame[]): number | null {
  const y = footLows(frames)
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
  // 最初に0を下回ったあとの山のうち、一番高い山の8割以上ある最初の山（2歩ぶんのずれも同じくらい高く出るので）
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

export function contactSpans(frames: TimedFrame[], smooth: number, stepFrames: number) {
  const raw = footLows(frames)
  const h = Math.floor(smooth / 2)
  const height = raw.map((_, i) => median(raw.slice(Math.max(0, i - h), i + h + 1)))
  const leg = median(frames.map(({ f }) => legLength(f)))
  // 地面の線は「一番低いあたり」を通るので、接地中の高さは0より少し下に集まる。その高さを基準にする
  const base = pct(height, 0.05)
  // 地面の近くにいるコマどうしの、コマごとの差から点のぶれを見積もる
  const near = height.map((y) => y <= base + TOL_MAX * leg)
  const diffs = height.slice(1).flatMap((y, i) => (near[i] && near[i + 1] ? [Math.abs(y - height[i])] : []))
  const sigma = diffs.length ? (1.4826 * median(diffs)) / Math.SQRT2 : 0
  const tol = Math.min(TOL_MAX * leg, Math.max(TOL_MIN * leg, 2.5 * sigma))
  const on = height.map((y) => y <= base + tol)
  const spans: { i0: number; i1: number }[] = []
  let s = -1
  on.forEach((v, i) => {
    if (v && s < 0) s = i
    if (!v && s >= 0) {
      spans.push({ i0: s, i1: i - 1 })
      s = -1
    }
  })
  // 足が地面すれすれで揺れると、1回の接地が細かく割れる。1歩の10%より短いすき間はつなぎ
  // （両足が浮く時間は1歩の20%以上ある）、1歩の15%より短いかけらは捨てる（接地は1歩の60〜80%ある）
  const merged: typeof spans = []
  for (const sp of spans) {
    const prev = merged[merged.length - 1]
    if (prev && sp.i0 - prev.i1 < stepFrames * 0.1) prev.i1 = sp.i1
    else merged.push({ ...sp })
  }
  // 動画の最初と最後で切れている接地は、長さが分からないので使わない
  return { spans: merged.filter((sp) => sp.i0 > 0 && sp.i1 < frames.length - 1 && sp.i1 - sp.i0 >= stepFrames * 0.15), height, base, tol }
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

// 着地の瞬間：一番低い足が、腰から見て急に前へ移るコマ（反対の足が着いて、一番低い足が入れ替わる）。
// 左右の名前に頼らないので、推定が左右を取り違えても数えられる
function landings(frames: TimedFrame[], period: number, dir: 1 | -1, leg: number): number[] {
  const u = frames.map(({ f }) => {
    const p = lowestFoot(f)
    return ((p.x - mid(f[L.leftHip], f[L.rightHip]).x) * dir) / leg
  })
  const w = Math.max(1, Math.round(period * 0.12))
  const ev: number[] = []
  for (let i = w; i < u.length; i++) {
    if (u[i] - u[i - w] < 0.3) continue
    // 窓の中で一番大きく前へ跳んだコマ
    let best = i
    for (let j = i - w + 1; j <= i; j++) if (u[j] - u[j - 1] > u[best] - u[best - 1]) best = j
    if (!ev.length || best - ev[ev.length - 1] > period * 0.5) ev.push(best)
  }
  return ev
}

export function analyzeRun(frames: TimedFrame[], slow?: number): SlowReport | null {
  if (frames.length < 20) return null
  // 足の高さのリズムから1歩の長さ（コマ数）を出し、スローの倍率を決める
  const period = footPeriod(frames)
  if (!period) return null
  const dt = median(frames.slice(1).map((x, i) => x.t - frames[i].t))
  const k = slow ?? guessSlow(2 * period * dt)
  const real = (t: number) => t / k
  const leg = median(frames.map(({ f }) => legLength(f)))
  const dir = facing(frames[Math.floor(frames.length / 2)].f)
  // 足の高さ（実際の時間で約20msぶんならす）と、高さで見た接地の区間
  const n = Math.max(1, Math.round((SMOOTH_SEC * k) / dt))
  const { spans, height, base, tol } = contactSpans(frames, n % 2 ? n : n + 1, period)
  // 着地：一番低い足が前へ移ったコマから、足が地面の高さに届くコマまで進める（1歩の2割まで）
  const lands = landings(frames, period, dir, leg).map((i) => {
    let j = i
    while (j < frames.length - 1 && j - i < period * 0.2 && height[j] > base + tol) j++
    return j
  })
  if (lands.length < 2) return null
  const stepVideo = median(lands.slice(1).map((i, j) => frames[i].t - frames[lands[j]].t))
  const step = real(stepVideo)
  // 高さで両足が浮いている時間が見えているときだけ、接地時間を出す（点のぶれで足が地面から離れて見えないと、
  // 接地がずっと続いて見えてしまう）
  const onShare = height.filter((y) => y <= base + tol).length / height.length
  const durations = lands.flatMap((i) => {
    const sp = spans.find((x) => Math.abs(x.i0 - i) <= period * 0.2)
    return sp ? [real(frames[sp.i1].t - frames[sp.i0].t) + real(dt)] : []
  })
  const contactSec = onShare < 0.85 && durations.length >= 2 ? median(durations) : null
  const contacts: Contact[] = lands.map((i) => {
    const f = frames[i].f
    const hip = mid(f[L.leftHip], f[L.rightHip])
    // 着地した脚：そのコマで低いほうの足
    const leftDown = lowOf(f, LEFT_FOOT) >= lowOf(f, RIGHT_FOOT)
    const knee = leftDown ? L.leftKnee : L.rightKnee
    const ankle = leftDown ? L.leftAnkle : L.rightAnkle
    return {
      start: real(frames[i].t),
      end: contactSec === null ? real(frames[i].t) : real(frames[i].t) + contactSec,
      shank: -leanFromVertical(f[ankle], f[knee], dir), // 足首が膝より前に出て着くほど正
      footAhead: ((f[ankle].x - hip.x) * dir) / leg,
    }
  })
  // 上下動：1歩ずつ、腰の一番高い位置と低い位置の差
  // 腰の点もぶれるので、実際の時間で約60msぶんの中央値でならしてから測る
  const rawHip = frames.map(({ f }) => mid(f[L.leftHip], f[L.rightHip]).y)
  const hw = Math.max(1, Math.round((0.03 * k) / dt))
  const hipY = rawHip.map((_, i) => median(rawHip.slice(Math.max(0, i - hw), i + hw + 1)))
  const swings: number[] = []
  for (let j = 0; j + 1 < lands.length; j++) {
    const ys = hipY.slice(lands[j], lands[j + 1])
    if (ys.length) swings.push((Math.max(...ys) - Math.min(...ys)) / leg)
  }
  // 左右の名前が入れ替わっても変わらないよう、上体は両側の真ん中で見る
  const trunk = mean(frames.map(({ f }) => leanFromVertical(mid(f[L.leftHip], f[L.rightHip]), mid(f[L.leftShoulder], f[L.rightShoulder]), dir)))
  return {
    slow: k,
    framesPerSec: 1 / real(dt),
    contacts,
    cadence: 60 / step,
    contactMs: contactSec === null ? null : contactSec * 1000,
    flightMs: contactSec === null ? null : Math.max(0, (step - contactSec) * 1000),
    dutyFactor: contactSec === null ? null : contactSec / (2 * step),
    shankAtContact: median(contacts.map((c) => c.shank)),
    footAheadAtContact: median(contacts.map((c) => c.footAhead)),
    verticalLeg: median(swings),
    trunk,
  }
}
