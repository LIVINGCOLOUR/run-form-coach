import type { PhoneMeasure, Vec3 } from './signal'

// 模擬データ：走っている人の腰（または胸）に付けたスマホの加速度・ジャイロを合成する。測り方のテスト用
//
// 体の重心の上下はばね・質量の形で作る（接地中は上向きの力が半分のサイン波、空中は重力だけ）。
// 接地の長さを変えて、入れたい上下動になるように合わせる。前後は接地の前半が減速・後半が加速の
// サイン波1周期（前半で落ちる速さ＝ブレーキ）、左右は2歩で1回の揺れ。骨盤（上体）は2歩で1回、左右に傾き・ねじれる。
// スマホは、体に対して好きな向きで付けられる（orientation）。座標は 世界：x 前・y 左・z 上
//
// 実際の腰は、重心の真上ではなく、骨盤の回転も大きく、足の着地の衝撃（短く鋭い山）も乗る。ここで合わせられるのは
// 「測り方の計算が正しいか」までで、実際の走りでの精度はトレッドミルで確かめる

export const G = 9.81

export interface RunSpec {
  cadence: number // 歩／分
  bounceCm: number // 重心の上下動（cm）
  brakingMs: number // 1歩ごとに着地で落ちる速さ（m/s）
  leanDeg?: number // 上体の前傾（度）。腰に付けたときは骨盤の前傾として扱う
  seconds: number
  fs?: number // センサーの回数（毎秒）
  noise?: number // 加速度の雑音（m/s²、標準偏差）
  jitter?: number // 1歩ごとの周期のばらつき（割合、標準偏差）
  sway?: number // 左右の揺れの強さ（m/s²）
  rollDeg?: number // 骨盤の左右の傾きの振れ（度）
  yawDeg?: number // 骨盤のねじれの振れ（度）
  impact?: number // 着地の衝撃の山の高さ（m/s²）。幅 10ms ほどの鋭い山と、すぐあとの揺り戻し（面積0。重心の高さはほとんど変えない）
  orientation?: Vec3 // スマホの付け方（体に対する x・y・z 回りの回転、度）
  seed?: number
  t0?: number
}

type Mat = number[][]
const rad = (d: number) => (d * Math.PI) / 180
const mul = (a: Mat, b: Mat): Mat => a.map((r) => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)))
const tr = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]))
const apply = (a: Mat, v: Vec3): Vec3 => [0, 1, 2].map((i) => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]) as Vec3
const rx = (d: number): Mat => {
  const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))]
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ]
}
const ry = (d: number): Mat => {
  const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))]
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ]
}
const rz = (d: number): Mat => {
  const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))]
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ]
}
// スマホの座標 → 体の座標
const deviceToBody = (o: Vec3): Mat => mul(rz(o[2]), mul(ry(o[1]), rx(o[0])))

// 決まった乱数（テストが毎回同じになるように）
export function rng(seed: number) {
  let a = seed >>> 0
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni())
}

// 1歩の周期 T のうち、割合 r だけ接地するときの上下動（m）。1周期を細かく刻んで2回積分する
export function bounceOf(T: number, r: number): number {
  const N = 4000
  const tc = r * T
  const A = (Math.PI * G * T) / (2 * tc)
  const a: number[] = []
  for (let i = 0; i < N; i++) {
    const tau = (i / N) * T
    a.push((tau < tc ? A * Math.sin((Math.PI * tau) / tc) : 0) - G)
  }
  const dt = T / N
  const v: number[] = []
  let s = 0
  for (const x of a) v.push((s += x * dt))
  const vm = v.reduce((p, q) => p + q, 0) / N
  let z = 0
  let lo = Infinity
  let hi = -Infinity
  for (const x of v) {
    z += (x - vm) * dt
    lo = Math.min(lo, z)
    hi = Math.max(hi, z)
  }
  return hi - lo
}

// 入れたい上下動になる接地の割合（二分法。接地が長いほど上下動は小さい）
export function contactRatioFor(cadence: number, bounceCm: number): number {
  const T = 60 / cadence
  let lo = 0.2
  let hi = 0.99
  if (bounceOf(T, hi) * 100 > bounceCm || bounceOf(T, lo) * 100 < bounceCm) throw new Error(`この上下動はこのピッチでは作れません: ${bounceCm}cm @ ${cadence}spm`)
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (bounceOf(T, mid) * 100 > bounceCm) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const IMPACT_SD = 0.006 // 着地の衝撃の山の幅（秒）
const mexicanHat = (u: number) => (1 - u * u) * Math.exp(-0.5 * u * u)

export function simulateRun(s: RunSpec): PhoneMeasure[] {
  return simulateRunWithSteps(s).ms
}

// 入れたピッチの正解：1歩ごとの周期がばらつくので、測る区間に実際に入っていた歩から出す
export function cadenceIn(steps: number[], from: number, to: number): number {
  const inside = steps.filter((x) => x >= from && x <= to)
  return (60 * (inside.length - 1)) / (inside[inside.length - 1] - inside[0])
}

// 模擬データと、1歩ごとの始まりの時刻（t0 を足した時刻）
export function simulateRunWithSteps(s: RunSpec): { ms: PhoneMeasure[]; steps: number[] } {
  const fs = s.fs ?? 60
  const noise = s.noise ?? 0
  const jitter = s.jitter ?? 0
  const sway = s.sway ?? 1.5
  const roll = s.rollDeg ?? 0
  const yaw = s.yawDeg ?? 0
  const lean = s.leanDeg ?? 0
  const impact = s.impact ?? 0
  const t0 = s.t0 ?? 0
  const gauss = rng(s.seed ?? 1)
  const ratio = contactRatioFor(s.cadence, s.bounceCm)
  const D = deviceToBody(s.orientation ?? [0, 0, 0])
  const T0 = 60 / s.cadence

  // 1歩ごとの始まりの時刻
  const starts: number[] = [0]
  while (starts[starts.length - 1] < s.seconds + 1) starts.push(starts[starts.length - 1] + T0 * (1 + jitter * gauss()))

  const out: PhoneMeasure[] = []
  let i = 0
  for (let n = 0; n / fs < s.seconds; n++) {
    const t = n / fs + (noise ? 0.002 * gauss() : 0) // 測る時刻も少しばらつく
    while (starts[i + 1] <= t) i++
    const T = starts[i + 1] - starts[i]
    const tau = Math.max(0, t - starts[i])
    const tc = ratio * T
    const A = (Math.PI * G * T) / (2 * tc)
    const B = (s.brakingMs * Math.PI) / tc
    // 重力を含む上下の加速度（センサーが感じる値）
    const vert = (tau < tc ? A * Math.sin((Math.PI * tau) / tc) : 0) + impact * mexicanHat((tau - 0.015) / IMPACT_SD)
    const ap = tau < tc ? -B * Math.sin((2 * Math.PI * tau) / tc) : 0
    const ph = Math.PI * (i + tau / T) // 2歩で1回
    const ml = sway * Math.sin(ph)
    const fw: Vec3 = [ap, ml, vert]
    // 体の向き：上体（骨盤）の前傾に、2歩で1回の左右の傾きとねじれ
    const body = mul(rz(yaw * Math.cos(ph)), mul(rx(roll * Math.sin(ph)), ry(lean)))
    const R = mul(body, D) // スマホ → 世界
    const f = apply(tr(R), fw)
    const w = Math.PI / T // 位相の進む速さ（rad/s）。角速度は世界の座標で近似し、スマホの座標に直す
    const omega = apply(tr(R), [rad(roll * Math.cos(ph)) * w, 0, rad(-yaw * Math.sin(ph)) * w])
    out.push({
      t: t0 + t,
      ax: f[0] + noise * gauss(),
      ay: f[1] + noise * gauss(),
      az: f[2] + noise * gauss(),
      gx: omega[0],
      gy: omega[1],
      gz: omega[2],
    })
  }
  return { ms: out, steps: starts.map((x) => x + t0) }
}

// 立って止まっているとき（前傾の基準を取る間）
export function simulateStanding(s: { seconds: number; leanDeg?: number; orientation?: Vec3; fs?: number; noise?: number; seed?: number; t0?: number }): PhoneMeasure[] {
  const fs = s.fs ?? 60
  const gauss = rng(s.seed ?? 2)
  const noise = s.noise ?? 0
  const R = mul(ry(s.leanDeg ?? 0), deviceToBody(s.orientation ?? [0, 0, 0]))
  const f = apply(tr(R), [0, 0, G])
  const out: PhoneMeasure[] = []
  for (let n = 0; n / fs < s.seconds; n++) {
    out.push({ t: (s.t0 ?? 0) + n / fs, ax: f[0] + noise * gauss(), ay: f[1] + noise * gauss(), az: f[2] + noise * gauss(), gx: 0, gy: 0, gz: 0 })
  }
  return out
}
