import { PHONE } from './params'

// 腰に付けたスマホのセンサーの値から、ピッチ・上下動・ブレーキを出す
//
// 入力は DeviceMotionEvent の accelerationIncludingGravity と同じ決まり：スマホの向きの座標（x・y・z）で、
// 重力を含む加速度（m/s²）。止まっているときは、上向きに約 9.8 になる（W3C DeviceOrientation Event の決まり）。
// iOS のネイティブ（Core Motion）は単位が g で、重力の向きが逆なので、渡す前にそろえる
//
// スマホがどの向きでベルトに入っていても測れるよう、向きは値そのものから決める：
//   上下：数歩ぶんの平均の加速度の向き（一定の速さで走っていれば、平均には重力だけが残る）
//   前後：水平面の中で、1歩ごとにくり返す揺れがいちばん大きい向き（左右の揺れは2歩で1回なので分けられる）
// ジャイロは、付け方の確認（mount.ts）と、ブレーキの向きの直し（levelled）で使う。ジャイロがない端末では、ブレーキは数歩の平均の向きのまま出す

export type Vec3 = [number, number, number]

// 1コマ分のスマホのセンサーの値
export interface PhoneMeasure {
  t: number // 秒
  ax: number // 重力を含む加速度（m/s²）
  ay: number
  az: number
  gx?: number // 角速度（rad/s）。付け方の確認とブレーキの向きの直しで使う。取れない端末では無い
  gy?: number
  gz?: number
}

export interface Estimate {
  cadence: number // ピッチ（歩／分）
  regularity: number // 1歩ずらした自己相関（1に近いほど1歩ごとにそろっている）
  accRms: number // 上下の加速度のばらつき（m/s²）
  bounceCm: number // 上下動（1歩の中の高さの振れ幅、cm）
  brakingMs: number // 1歩の中の、前後の速さの振れ幅（m/s）。着地のブレーキで落ちた速さ。ジャイロがあれば1コマごとに向きを直してから出す
  brakingFixed: number // 同じものを、数歩の平均の向きで固定して出した値（ジャイロで直す前の方法。記録して比べるため）
  gyroLevel: boolean // ブレーキをジャイロで向きを直して出したか
  apRegularity: number // 前後の加速度の、1歩ずらした自己相関（疲れると下がる：Schütte 2015）
  ratioV: number // 3方向の揺れの割合：上下・前後・左右の加速度のばらつき（RMS）÷ 3方向合わせたばらつき（2乗の和は1）
  ratioAP: number
  ratioML: number
  contactMs: number // 有効接地時間（ms）：1歩の中で、上下の加速度（重力を含む）が1gを上回っている時間の平均（Patoz 2021）
  up: Vec3 // スマホの座標で見た上向き
  forward: Vec3 // スマホの座標で見た前向き（水平）
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const unit = (a: Vec3) => scale(a, 1 / norm(a))
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// 測った時刻はばらつくので、決まった間隔に並べ直す（前後の値の直線補間）。gyro はすべての値に角速度があるときだけ
export function resample(ms: PhoneMeasure[], fs = PHONE.fs): { t: number[]; acc: Vec3[]; gyro?: Vec3[] } {
  const t: number[] = []
  const acc: Vec3[] = []
  const hasGyro = ms.length > 0 && ms.every((m) => m.gx !== undefined && m.gy !== undefined && m.gz !== undefined)
  const gyro: Vec3[] = []
  if (ms.length < 2) return { t, acc }
  let j = 0
  for (let x = ms[0].t; x <= ms[ms.length - 1].t; x += 1 / fs) {
    while (j + 1 < ms.length - 1 && ms[j + 1].t < x) j++
    const a = ms[j]
    const b = ms[j + 1]
    const w = b.t > a.t ? Math.min(1, Math.max(0, (x - a.t) / (b.t - a.t))) : 0
    t.push(x)
    acc.push([a.ax + (b.ax - a.ax) * w, a.ay + (b.ay - a.ay) * w, a.az + (b.az - a.az) * w])
    if (hasGyro) gyro.push([a.gx! + (b.gx! - a.gx!) * w, a.gy! + (b.gy! - a.gy!) * w, a.gz! + (b.gz! - a.gz!) * w])
  }
  return hasGyro ? { t, acc, gyro } : { t, acc }
}

// 1歩の周期（秒）を、上下の加速度の自己相関の山から出す
// 腰の加速度の自己相関で、1歩ずらしたところと2歩ずらしたところに山が出る（Moe-Nilssen & Helbostad 2004,
// J Biomech 37:121-126）。探す範囲を 1歩の周期だけにして、2歩の山と取り違えないようにする
export function stepPeriod(x: number[], fs = PHONE.fs): { period: number; regularity: number } | null {
  const n = x.length
  const m = mean(x)
  const d = x.map((v) => v - m)
  const v0 = d.reduce((s, v) => s + v * v, 0) / n
  if (v0 <= 0) return null
  const lo = Math.floor((60 / PHONE.spmMax) * fs)
  const hi = Math.ceil((60 / PHONE.spmMin) * fs)
  if (hi + 2 >= n) return null
  const ac: number[] = []
  for (let lag = 0; lag <= hi + 1; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag]
    ac.push(s / (n - lag) / v0) // ずらした分だけ重なりが減るので、重なった数で割る
  }
  let best = -1
  for (let lag = Math.max(1, lo); lag <= hi; lag++) {
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && (best < 0 || ac[lag] > ac[best])) best = lag
  }
  if (best < 0) return null
  // 山の頂点を、前後の3点の放物線で細かく求める
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]]
  const den = a - 2 * b + c
  const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0
  return { period: (best + off) / fs, regularity: b }
}

// 自己相関の山は、並べ直した間隔（1/fs 秒）の刻みでしか取れず、180歩/分で1刻みが約6%にあたる。
// 山の近く（±PHONE.refineSpan）で、1歩の周期の1〜3倍の波の強さがいちばん大きくなる周波数を探して細かくする
// （窓の端の影響を減らすため、ハン窓をかける）
export function refineFreq(t: number[], x: number[], f0: number): number {
  const n = x.length
  const m = mean(x)
  const w = x.map((v, i) => (v - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))))
  const power = (f: number) => {
    let p = 0
    for (let k = 1; k <= 3; k++) {
      const om = 2 * Math.PI * k * f
      let re = 0
      let im = 0
      for (let i = 0; i < n; i++) {
        re += w[i] * Math.cos(om * t[i])
        im += w[i] * Math.sin(om * t[i])
      }
      p += re * re + im * im
    }
    return p
  }
  const N = PHONE.refineSteps
  const fs = Array.from({ length: 2 * N + 1 }, (_, i) => f0 * (1 + (PHONE.refineSpan * (i - N)) / N))
  const ps = fs.map(power)
  let best = 0
  for (let i = 1; i < ps.length; i++) if (ps[i] > ps[best]) best = i
  if (best === 0 || best === ps.length - 1) return f0 // 探した範囲の端なら、山が見つかっていない
  const [a, b, c] = [ps[best - 1], ps[best], ps[best + 1]]
  const den = a - 2 * b + c
  const off = den !== 0 ? (0.5 * (a - c)) / den : 0
  return fs[best] + off * (fs[1] - fs[0])
}

// くり返す波を、1歩の周期の整数倍の波（k = 1〜K）の重ね合わせとして表す
function harmonics(t: number[], x: number[], f: number, K: number): { re: number; im: number }[] {
  const n = x.length
  const out: { re: number; im: number }[] = []
  for (let k = 1; k <= K; k++) {
    const w = 2 * Math.PI * k * f
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(w * t[i])
      im -= x[i] * Math.sin(w * t[i])
    }
    out.push({ re: (2 * re) / n, im: (2 * im) / n })
  }
  return out
}

// 1歩ずつの切れ目：上下の加速度をならした波（1歩の 1/3 の長さの移動平均。着地の衝撃の鋭い山を消す）の、
// 前後 0.4 歩の中でいちばん高いところ（接地の真ん中、重心がいちばん低いところ）
// at：切れ目の位置を、前後の3点の放物線で細かくしたもの（コマの番号、小数）。ピッチはこの間隔から出す
export function stepCuts(x: number[], period: number): { cuts: number[]; at: number[] } {
  const h = Math.max(1, Math.round(period / 6))
  const sm = x.map((_, i) => {
    let s = 0
    let n = 0
    for (let j = Math.max(0, i - h); j <= Math.min(x.length - 1, i + h); j++, n++) s += x[j]
    return s / n
  })
  const r = Math.max(1, Math.round(period * 0.4))
  const cuts: number[] = []
  const at: number[] = []
  for (let i = r; i < sm.length - r; i++) {
    let top = true
    for (let j = i - r; j <= i + r && top; j++) if (sm[j] > sm[i] || (sm[j] === sm[i] && j < i)) top = false
    if (!top) continue
    cuts.push(i)
    const den = sm[i - 1] - 2 * sm[i] + sm[i + 1]
    at.push(i + (den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sm[i - 1] - sm[i + 1])) / den)) : 0))
  }
  return { cuts, at }
}

// 1歩ずつ、加速度を p 回積分した波の振れ幅（最大−最小）を出し、平均する。
// 1歩の中の平均を引いてから積分し（一定の速さ・同じ高さに戻る、とみなす）、速さも平均を引いてから積分する
export function perStepRange(x: number[], cuts: number[], fs: number, p: 1 | 2): number {
  const out: number[] = []
  for (let c = 0; c + 1 < cuts.length; c++) {
    const seg = x.slice(cuts[c], cuts[c + 1]) // 終わりの点は次の歩の始まりなので入れない
    const m = mean(seg)
    let v = 0
    const vs = seg.map((a) => (v += (a - m) / fs))
    let ys = vs
    if (p === 2) {
      const vm = mean(vs)
      let z = 0
      ys = vs.map((u) => (z += (u - vm) / fs))
    }
    out.push(Math.max(...ys) - Math.min(...ys))
  }
  return mean(out)
}

// 直近の値から、ピッチ・上下動・ブレーキを出す。値が足りない・走る動きでないときは null
export function estimate(ms: PhoneMeasure[]): Estimate | null {
  if (ms.length < 3 || ms[ms.length - 1].t - ms[0].t < PHONE.minWindow) return null
  const { t, acc, gyro } = resample(ms)
  const fs = PHONE.fs

  // 1. 上向きと1歩の周期（全体の平均の向きで、まず仮に上下を出す）
  const g0: Vec3 = [mean(acc.map((a) => a[0])), mean(acc.map((a) => a[1])), mean(acc.map((a) => a[2]))]
  if (norm(g0) < PHONE.gravityMin || norm(g0) > PHONE.gravityMax) return null
  const sp = stepPeriod(
    acc.map((a) => dot(a, unit(g0))),
    fs,
  )
  if (!sp) return null
  const f = refineFreq(
    t,
    acc.map((a) => dot(a, unit(g0))),
    1 / sp.period,
  )

  // 2. 1歩の周期の整数倍の長さだけを使う（端の半端な歩で、平均や波の分け方がずれないように）
  const steps = Math.floor((t[t.length - 1] - t[0]) * f)
  if (steps < 1) return null
  const from = Math.max(0, t.length - Math.round((steps / f) * fs))
  const tt = t.slice(from)
  const aa = acc.slice(from)
  const g: Vec3 = [mean(aa.map((a) => a[0])), mean(aa.map((a) => a[1])), mean(aa.map((a) => a[2]))]
  const up = unit(g)
  const vert = aa.map((a) => dot(a, up) - norm(g))
  const vertAll = acc.map((a) => dot(a, up) - norm(g))
  const accRms = Math.sqrt(mean(vert.map((v) => v * v)))

  // 3. 上下動：腰の上下の加速度を2回積分する（Zijlstra & Hof 2003, Gait Posture 18:1-10。走りでは
  //    Gullstrand ら 2009, Gait Posture 30:71-75 が光学式と比べている）。1歩ずつに切って、その中で積分する
  //    （1歩ごとに周期がばらつくので、窓全体を1つのくり返す波として扱うと、振れ幅が小さく出る）
  const K = Math.max(1, Math.min(PHONE.harmonics, Math.floor(fs / 2 / f) - 1))
  const cv = harmonics(tt, vert, f, K)
  const { cuts, at } = stepCuts(vertAll, fs / f)
  if (cuts.length < 3) return null
  const bounceCm = perStepRange(vertAll, cuts, fs, 2) * 100
  // ピッチ：1歩ずつの切れ目の間隔の平均（窓の中の実際の歩）。周波数から出すより、着地の衝撃や1歩ごとのばらつきに強い
  const cadence = (60 * fs * (at.length - 1)) / (at[at.length - 1] - at[0])

  // 4. 前後の向きとブレーキ：前後の加速度を1回積分した速さの、1歩の中の振れ幅。一定の速さで走っていれば、
  //    着地で落ちた速さと蹴り出しで戻した速さは等しいので、振れ幅＝着地のブレーキで落ちた速さになる
  //    （体重あたりのブレーキの力積と同じもの。腰のスマホでこれを出す方法の研究は見つけていない）
  //    上向きを数歩の平均で固定すると、1歩ごとの骨盤の前後の傾き θ で重力 × sinθ（1°で約 0.17 m/s²）が前後に漏れ込み、
  //    1歩の周期でくり返すので振れ幅にそのまま足される（docs/research/phone-methods.md 1-7）。
  //    ジャイロがあれば、1コマごとの向きの変わりを積み重ねて、加速度を窓の始まりの向きにそろえてから同じことをする
  const fixed = forwardAndAp(tt, aa, acc, up, f, K, cv)
  const brakingFixed = perStepRange(fixed.ap, cuts, fs, 1)
  let brakingMs = brakingFixed
  let gyroLevel = false
  if (gyro && gyro.length === acc.length) {
    const lv = levelled(acc, gyro, fs, up)
    const la = lv.slice(from)
    const lg: Vec3 = [mean(la.map((a) => a[0])), mean(la.map((a) => a[1])), mean(la.map((a) => a[2]))]
    if (norm(lg) >= PHONE.gravityMin && norm(lg) <= PHONE.gravityMax) {
      const lup = unit(lg)
      const lcv = harmonics(tt, la.map((a) => dot(a, lup) - norm(lg)), f, K)
      brakingMs = perStepRange(forwardAndAp(tt, la, lv, lup, f, K, lcv).ap, cuts, fs, 1)
      gyroLevel = true
    }
  }
  const forward = fixed.forward

  // 5. 疲れの見分けの材料（docs/phone-spec.md 機能5）。どれも1歩の周期の整数倍の長さ（aa）から出す
  const apW = aa.map((a) => dot(a, forward))
  const side = cross(up, forward)
  const mlW = aa.map((a) => dot(a, side))
  const apRegularity = lagCorr(apW, fs / f)
  const rms = (xs: number[]) => {
    const m = mean(xs)
    return Math.sqrt(mean(xs.map((v) => (v - m) * (v - m))))
  }
  const [rv, ra, rl] = [rms(vert), rms(apW), rms(mlW)]
  const rt = Math.hypot(rv, ra, rl) || 1
  const contactMs = effectiveContactMs(vertAll.map((v) => v + norm(g)), norm(g), cuts, fs)

  return {
    cadence, regularity: sp.regularity, accRms, bounceCm, brakingMs, brakingFixed, gyroLevel, up, forward,
    apRegularity, ratioV: rv / rt, ratioAP: ra / rt, ratioML: rl / rt, contactMs,
  }
}

// 前後の向き（水平面の2つの向きのうち、1歩ごとの揺れ（k 倍の波）の強さがいちばん大きい向き）と、全体の前後の加速度
//   aa：1歩の周期の整数倍の長さの加速度（向きを決める）、all：窓全体の加速度（前後の加速度を出す）、cv：上下の加速度の波
function forwardAndAp(tt: number[], aa: Vec3[], all: Vec3[], up: Vec3, f: number, K: number, cv: { re: number; im: number }[]): { forward: Vec3; ap: number[] } {
  const e1 = unit(Math.abs(up[0]) < 0.9 ? cross(up, [1, 0, 0]) : cross(up, [0, 1, 0]))
  const e2 = cross(up, e1)
  const c1 = harmonics(tt, aa.map((a) => dot(a, e1)), f, K)
  const c2 = harmonics(tt, aa.map((a) => dot(a, e2)), f, K)
  let s11 = 0
  let s22 = 0
  let s12 = 0
  c1.forEach((a, i) => {
    const b = c2[i]
    s11 += a.re * a.re + a.im * a.im
    s22 += b.re * b.re + b.im * b.im
    s12 += a.re * b.re + a.im * b.im
  })
  let phi = 0.5 * Math.atan2(2 * s12, s11 - s22) // 2×2 の行列のいちばん大きい向き
  // 前と後ろの区別：着地の直後（上向きの加速度が増えている間）は前後の加速度が負（ブレーキ）、
  // 蹴り出し（減っている間）は正になる、という走りの形を使う。前後の加速度と、上下の加速度の変化の向きが
  // 逆に動くほうを前とする（仮定。実機で、前に走ったときに forward が進む向きを指すか確かめる）
  const cap = c1.map((a, i) => ({ re: a.re * Math.cos(phi) + c2[i].re * Math.sin(phi), im: a.im * Math.cos(phi) + c2[i].im * Math.sin(phi) }))
  // Σ Re(AP_k · conj(iω_k V_k)) ＝ 前後の加速度と、上下の加速度の変化の向きの重なり
  const agree = cap.reduce((s, a, i) => {
    const w = 2 * Math.PI * (i + 1) * f
    const dv = { re: -w * cv[i].im, im: w * cv[i].re }
    return s + a.re * dv.re + a.im * dv.im
  }, 0)
  if (agree > 0) phi += Math.PI
  const forward = unit([
    e1[0] * Math.cos(phi) + e2[0] * Math.sin(phi),
    e1[1] * Math.cos(phi) + e2[1] * Math.sin(phi),
    e1[2] * Math.cos(phi) + e2[2] * Math.sin(phi),
  ])
  return { forward, ap: all.map((a) => dot(a, forward)) }
}

// ジャイロで、1コマごとの加速度を窓の始まりのスマホの向きにそろえる。
//   Q_{i+1} = Q_i · exp(ω_i / fs)（ω はそのコマのスマホの座標の角速度）、そろえた加速度 = Q_i · a_i
// ジャイロのずれ（バイアス。数秒で数度の向きのずれになる）を減らすため、窓の平均の角速度のうち、上下の軸に直交する分を引く
// （骨盤の前後・左右の傾きは1歩・2歩ごとに戻るので、窓の平均は0に近いはず。上下の軸まわりの回転＝曲がる道は残す）
export function levelled(acc: Vec3[], gyro: Vec3[], fs: number, up: Vec3): Vec3[] {
  const gm: Vec3 = [mean(gyro.map((w) => w[0])), mean(gyro.map((w) => w[1])), mean(gyro.map((w) => w[2]))]
  const along = dot(gm, up)
  const bias: Vec3 = [gm[0] - along * up[0], gm[1] - along * up[1], gm[2] - along * up[2]]
  let Q = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const out: Vec3[] = []
  for (let i = 0; i < acc.length; i++) {
    const a = acc[i]
    out.push([Q[0] * a[0] + Q[1] * a[1] + Q[2] * a[2], Q[3] * a[0] + Q[4] * a[1] + Q[5] * a[2], Q[6] * a[0] + Q[7] * a[1] + Q[8] * a[2]])
    const w: Vec3 = [gyro[i][0] - bias[0], gyro[i][1] - bias[1], gyro[i][2] - bias[2]]
    Q = matMul(Q, rodrigues(scale(w, 1 / fs)))
  }
  return out
}

// 回転ベクトル（rad）を回転行列（3×3、行の順）にする
function rodrigues(v: Vec3): number[] {
  const th = norm(v)
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const [x, y, z] = scale(v, 1 / th)
  const c = Math.cos(th)
  const s = Math.sin(th)
  const C = 1 - c
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]
}
function matMul(a: number[], b: number[]): number[] {
  const o: number[] = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c])
  return o
}

// 1歩（lag コマ、小数）ずらした自己相関。小数は前後のコマの値の直線補間
export function lagCorr(x: number[], lag: number): number {
  const m = mean(x)
  const d = x.map((v) => v - m)
  const v0 = mean(d.map((v) => v * v))
  if (v0 <= 0) return 0
  const at = (L: number) => {
    let s = 0
    let n = 0
    for (let i = 0; i + L < d.length; i++, n++) s += d[i] * d[i + L]
    return n ? s / n / v0 : 0
  }
  const lo = Math.floor(lag)
  const w = lag - lo
  return at(lo) * (1 - w) + at(lo + 1) * w
}

// 有効接地時間（Patoz 2021）：上下の加速度（重力を含む、上向き正）が1gを上回っている時間を、1歩ずつ数えて平均する（ms）
// 本当の接地時間より短く出る別物なので、自分の走り始めとの差だけを見る
export function effectiveContactMs(vertWithG: number[], g: number, cuts: number[], fs: number): number {
  const out: number[] = []
  for (let c = 0; c + 1 < cuts.length; c++) {
    let n = 0
    for (let i = cuts[c]; i < cuts[c + 1]; i++) if (vertWithG[i] > g) n++
    out.push((n / fs) * 1000)
  }
  return mean(out)
}

// 走る動きをしているか（engine の moving に渡す）
export function isRunning(e: Estimate | null, runSpm: number): boolean {
  return !!e && e.cadence >= runSpm && e.regularity >= PHONE.minRegularity && e.accRms >= PHONE.runAccRms
}
