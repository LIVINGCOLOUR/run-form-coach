// カメラ版とセンサーを同時に使った走りの記録を、時刻を合わせて比べる計算（scripts/compare-sensor-camera.mjs から使う。テストは sensor-camera.test.ts）
// ファイルも画面も持たない。ブロックを戻す関数（src/modes/sensor/log.ts の decodeBlock）は、呼ぶ側から渡す
//   カメラの骨格を答えにして、センサーだけの判定（頭・胸の傾き、ピッチ、着地の衝撃、腕振り）の線を、カメラに合うように決めるための材料を出す

export const NO = -999 // カメラの記録で、測れなかった値

const DEG = 180 / Math.PI
export const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x !== NO
export const mean = (xs) => {
  const s = xs.filter(finite)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN
}
export const quantile = (xs, p) => {
  const s = xs.filter(finite).sort((a, b) => a - b)
  if (!s.length) return NaN
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo)
}
export const median = (xs) => quantile(xs, 0.5)

// ピアソンの相関（両方そろった組だけ）
export function corr(xs, ys) {
  const p = []
  for (let i = 0; i < xs.length; i++) if (finite(xs[i]) && finite(ys[i])) p.push([xs[i], ys[i]])
  if (p.length < 3) return { r: NaN, n: p.length }
  const mx = mean(p.map((v) => v[0]))
  const my = mean(p.map((v) => v[1]))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of p) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  return { r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, n: p.length }
}

// ---- センサー ----

// センサーごとに、ブロックをサンプルの並びにする。時刻 tt はカメラと同じ時計の秒。
// ブロックの t は「先頭の件が届いた時刻」で、Bluetooth の遅れが毎回ちがう。センサーの時刻（ms）は正確なので、
// 「届いた時刻 − センサーの時刻」の、前後 span 秒のブロックの中でいちばん小さい値（いちばん遅れの少なかった件）を差にする
// （センサーが起動し直して時刻が戻ったときも、前後で別の差になる）
export function decodeNodes(sensors, decode, span = 15) {
  const per = sensors.nodes.map(() => [])
  for (const [t, node, b64] of sensors.blocks) {
    const xs = decode(b64)
    if (xs.length && per[node]) per[node].push({ t, xs })
  }
  return sensors.nodes.map((n, i) => {
    const bs = per[i].sort((a, b) => a.t - b.t)
    const off = bs.map((b) => b.t - b.xs[0].t / 1000)
    const samples = []
    const lags = []
    let j0 = 0
    for (let k = 0; k < bs.length; k++) {
      while (bs[k].t - bs[j0].t > span) j0++
      let o = Infinity
      for (let j = j0; j < bs.length && bs[j].t - bs[k].t <= span; j++) {
        // センサーの時刻が戻った（起動し直した）ブロックとは混ぜない
        if (Math.abs(off[j] - off[k]) < 1) o = Math.min(o, off[j])
      }
      lags.push(off[k] - o)
      for (const s of bs[k].xs) samples.push({ tt: s.t / 1000 + o, seq: s.seq, a: s.a, g: s.g })
    }
    samples.sort((a, b) => a.tt - b.tt)
    // 遅れ：届いた時刻 − 合わせた時刻（ブロックの先頭の件）。中央値を、時刻の合わせ方の確かめに出す
    const lag = median(lags)
    return { place: n.place, name: n.name, lost: n.lost, battery: n.battery, samples, lag }
  })
}

// 取れていた時間：最初と最後の時刻と、gap 秒より長い切れ目
export function coverage(samples, gap = 2) {
  if (!samples.length) return { first: null, last: null, n: 0, gaps: [] }
  const gaps = []
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].tt - samples[i - 1].tt
    if (d > gap) gaps.push([samples[i - 1].tt, samples[i].tt])
  }
  return { first: samples[0].tt, last: samples[samples.length - 1].tt, n: samples.length, gaps }
}

// [t0, t1) の値がある割合（1秒ごと）
export function coveredShare(samples, t0, t1) {
  const secs = new Set()
  for (const s of samples) if (s.tt >= t0 && s.tt < t1) secs.add(Math.floor(s.tt))
  return secs.size / (Math.floor(t1) - Math.floor(t0) + 1)
}

const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// [t0, t1] の加速度の平均の向き（立って止まっていた間なら重力の向き）
export function gravityDir(samples, t0, t1) {
  const sum = [0, 0, 0]
  let n = 0
  for (const s of samples) {
    if (s.tt < t0 || s.tt > t1) continue
    for (let i = 0; i < 3; i++) sum[i] += s.a[i]
    n++
  }
  return n ? { dir: norm(sum), n } : { dir: null, n: 0 }
}

// 1秒ごとの重力の向き（加速度の1秒の平均。走っている間の揺れは1歩ごとに打ち消し合う。tools/coach.py と同じ見方）
export function perSecondGravity(samples, min = 20) {
  const acc = new Map()
  for (const s of samples) {
    const k = Math.floor(s.tt)
    const e = acc.get(k) ?? { sum: [0, 0, 0], n: 0 }
    for (let i = 0; i < 3; i++) e.sum[i] += s.a[i]
    e.n++
    acc.set(k, e)
  }
  const out = new Map()
  for (const [k, e] of acc) if (e.n >= min) out.set(k, norm(e.sum))
  return out
}

// 立った姿勢 base からの傾き。tilt：向きによらない角度（hunch.ts と同じ）。
// pitch：走っている間にいちばん傾いた向き（fwd）に沿った角度（走った秒の平均が正になる側）。side：それと直角の向き
export function tiltSeries(grav, base, runSecs) {
  const raw = new Map()
  for (const [k, u] of grav) {
    if (!u) continue
    const c = Math.max(-1, Math.min(1, dot(u, base)))
    const d = [u[0] - c * base[0], u[1] - c * base[1], u[2] - c * base[2]]
    raw.set(k, { tilt: Math.acos(c) * DEG, c, d })
  }
  // 前の向き：走った秒の傾きの向き d の2乗の和（中心を引かない）のいちばん大きい向き。符号は、走った秒の平均が正になる側
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const mean3 = [0, 0, 0]
  for (const k of runSecs) {
    const r = raw.get(k)
    if (!r) continue
    for (let i = 0; i < 3; i++) {
      mean3[i] += r.d[i]
      for (let j = 0; j < 3; j++) M[i * 3 + j] += r.d[i] * r.d[j]
    }
  }
  let fwd = norm(mean3) ?? norm([1, 0, 0])
  for (let it = 0; it < 50 && fwd; it++) fwd = norm([0, 1, 2].map((i) => M[i * 3] * fwd[0] + M[i * 3 + 1] * fwd[1] + M[i * 3 + 2] * fwd[2]))
  if (fwd && dot(fwd, mean3) < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]]
  const side = fwd ? norm(cross(base, fwd)) : null
  const out = new Map()
  for (const [k, r] of raw) {
    out.set(k, {
      tilt: r.tilt,
      pitch: fwd ? Math.atan2(dot(r.d, fwd), r.c) * DEG : NaN,
      side: side ? Math.atan2(dot(r.d, side), r.c) * DEG : NaN,
    })
  }
  return out
}

// 足首の加速度の大きさの自己相関で、片足の周期 → 両足の歩数/分（tools/coach.py の cadence と同じ：和で割らない自己相関の、
// lag 0.4〜2秒でいちばん高いところ）。窓が短いと2歩ぶん（片足2周期）の山を取ることがあるので、半分の lag の近くに
// 0.8 倍以上の山があればそちらにする
export function cadenceOf(samples) {
  if (samples.length < 3) return NaN
  const dur = samples[samples.length - 1].tt - samples[0].tt
  if (dur < 3) return NaN
  const fs = (samples.length - 1) / dur
  const m = samples.map((s) => Math.hypot(s.a[0], s.a[1], s.a[2]))
  const mu = m.reduce((a, b) => a + b, 0) / m.length
  const x = m.map((v) => v - mu)
  const ac = []
  for (let L = 0; L < x.length; L++) {
    let s = 0
    for (let i = 0; i + L < x.length; i++) s += x[i] * x[i + L]
    ac[L] = s
  }
  const lo = Math.round(0.4 * fs)
  const hi = Math.min(x.length - 2, Math.round(2 * fs))
  const top = (a, b) => {
    let k = -1
    for (let L = Math.max(1, a); L <= Math.min(hi, b); L++) if (k < 0 || ac[L] > ac[k]) k = L
    return k
  }
  let lag = top(lo, hi)
  if (lag < 0 || !(ac[lag] > 0)) return NaN
  const half = top(Math.round(lag * 0.42), Math.round(lag * 0.58))
  if (half >= lo && ac[half] >= 0.8 * ac[lag] && ac[half] >= ac[half - 1] && ac[half] >= ac[half + 1]) lag = half
  // となりの lag で放物線をあてて、コマの間まで細かく求める
  const a = ac[lag - 1]
  const b = ac[lag]
  const c = ac[lag + 1]
  const den = a - 2 * b + c
  const f = den < 0 ? lag + (0.5 * (a - c)) / den : lag
  return 120 / (f / fs)
}

// 衝撃の山の間隔から、両足の歩数/分（同じ足首の、となりの山の間の中央値。0.4〜2秒の間だけ使う）
export function cadenceFromPeaks(peaks) {
  const d = []
  for (let i = 1; i < peaks.length; i++) {
    const x = peaks[i].t - peaks[i - 1].t
    if (x >= 0.4 && x <= 2) d.push(x)
  }
  return d.length ? 120 / median(d) : NaN
}

// 足首の衝撃の山：加速度の大きさが min g を越え、前後 sep 秒でいちばん大きい件（片足の1歩ごと）
export function impactPeaks(samples, { min = 2, sep = 0.45 } = {}) {
  const m = samples.map((s) => Math.hypot(s.a[0], s.a[1], s.a[2]))
  const out = []
  for (let i = 0; i < m.length; i++) {
    if (m[i] < min) continue
    let top = true
    for (let j = i - 1; j >= 0 && samples[i].tt - samples[j].tt <= sep; j--) if (m[j] > m[i]) top = false
    for (let j = i + 1; top && j < m.length && samples[j].tt - samples[i].tt <= sep; j++) if (m[j] >= m[i]) top = false
    if (top) out.push({ t: samples[i].tt, g: m[i] })
  }
  return out
}

// 加速度の軸のどれかが範囲（range g）の端に張りついた件（衝撃が範囲を越えて、山が頭打ちになっている）
export function saturated(samples, range = 16) {
  let n = 0
  for (const s of samples) if (s.a.some((v) => Math.abs(v) >= range * 0.995)) n++
  return n
}

// ---- カメラ ----

// 記録の1行を名前で読めるようにする。点は LOG_POINTS の並び（MediaPipe の番号 points[k]）で、(x, y, v)
export function cameraRows(log) {
  const cols = log.columns.filter((c) => !c.startsWith('...'))
  const idx = Object.fromEntries(cols.map((c, i) => [c, i]))
  const P = cols.length
  return log.rows.map((r) => {
    const o = { t: r[idx.t], phase: log.phases[r[idx.phase]], moving: r[idx.moving] === 1 }
    for (const c of ['cadence', 'neck', 'trunk', 'body', 'pitch', 'yaw', 'headLean', 'chin']) {
      const v = r[idx[c]]
      o[c] = v === undefined || v === null || v === NO || (c === 'cadence' && v < 0) ? NaN : v
    }
    if (r.length >= P + log.points.length * 3) {
      const pts = {}
      log.points.forEach((mp, k) => (pts[mp] = { x: r[P + k * 3], y: r[P + k * 3 + 1], v: r[P + k * 3 + 2] }))
      o.pts = pts
    }
    return o
  })
}

// 33点の骨格（LandingMeter に渡す形）。記録にない点は見えない点にする
export function frameOf(pts) {
  return Array.from({ length: 33 }, (_, i) => pts[i] ?? { x: 0, y: 0, v: 0 })
}

// 走っていた区間：カメラの段階が run で、歩数で走っていたコマ（moving）。途中で maxGap 秒より長く止まったら、区間を分ける。
// minLen 秒より短い区間（走り出す前に体を動かしただけ、など）は使わない
export function runSpans(rows, maxGap = 3, minLen = 5) {
  const spans = []
  let cur = null
  for (const r of rows) {
    if (r.phase !== 'run' || !r.moving) continue
    if (cur && r.t - cur[1] <= maxGap) cur[1] = r.t
    else spans.push((cur = [r.t, r.t]))
  }
  return spans.filter(([a, b]) => b - a >= minLen)
}

// 腕振り：手首の前後の位置（肩の中心から、体幹の長さで割る）
export function armOffset(pts, wrist, shL = 11, shR = 12, hipL = 23, hipR = 24) {
  const w = pts[wrist]
  if (!w) return NaN
  const sx = (pts[shL].x + pts[shR].x) / 2
  const sy = (pts[shL].y + pts[shR].y) / 2
  const hx = (pts[hipL].x + pts[hipR].x) / 2
  const hy = (pts[hipL].y + pts[hipR].y) / 2
  const torso = Math.hypot(sx - hx, sy - hy)
  return torso > 0 ? (w.x - sx) / torso : NaN
}

// ---- 線を決める ----

// センサーの値 xs で、カメラの答え labels（true = 崩れ）を分ける線。線より大きい（dir = 1）か小さい（dir = -1）を崩れとみて、
// 当たりの割合（崩れを見つけた割合と、崩れでないのを崩れでないとした割合の平均＝つり合いのとれた一致率）がいちばん高い線を選ぶ。
// 同じなら、外れの声が少ない（崩れでないのを崩れとしない）ほう
export function bestThreshold(xs, labels) {
  const p = []
  for (let i = 0; i < xs.length; i++) if (finite(xs[i]) && typeof labels[i] === 'boolean') p.push([xs[i], labels[i]])
  const pos = p.filter((v) => v[1]).length
  const neg = p.length - pos
  if (!pos || !neg) return { n: p.length, pos, neg, threshold: NaN, auc: NaN }
  // AUC（線を動かしたときの、崩れと崩れでないの分かれ方。0.5 は分からない、1 は完全に分かれる）
  let wins = 0
  for (const [x, l] of p) if (l) for (const [y, m] of p) if (!m) wins += x > y ? 1 : x === y ? 0.5 : 0
  const auc = wins / (pos * neg)
  const dir = auc >= 0.5 ? 1 : -1
  const cands = [...new Set(p.map((v) => v[0]))].sort((a, b) => a - b)
  let best = null
  for (let i = 0; i < cands.length; i++) {
    // 2つの値の間に線を引く
    const th = i + 1 < cands.length ? (cands[i] + cands[i + 1]) / 2 : cands[i] + 1e-9
    let tp = 0
    let tn = 0
    for (const [x, l] of p) {
      const say = dir > 0 ? x > th : x <= th
      if (say && l) tp++
      if (!say && !l) tn++
    }
    const sens = tp / pos
    const spec = tn / neg
    const bal = (sens + spec) / 2
    if (!best || bal > best.bal + 1e-12 || (Math.abs(bal - best.bal) < 1e-12 && spec > best.spec)) best = { threshold: th, sens, spec, bal, agree: (tp + tn) / p.length }
  }
  return { n: p.length, pos, neg, dir, auc, ...best }
}

// t0 から win 秒ごとの窓に分け、窓ごとに fn(その窓の値の並び) を出す
export function windows(spans, win) {
  const out = []
  for (const [a, b] of spans) for (let t = a; t + win <= b + 1e-9; t += win) out.push([t, t + win])
  return out
}
