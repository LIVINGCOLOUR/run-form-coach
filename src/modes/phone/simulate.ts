import type { PhoneMeasure, Vec3 } from './signal'

// 模擬データ：走っている人の腰に付けたスマホの加速度・ジャイロを合成する。測り方と付け方の確認のテスト用
//
// 体の重心の上下はばね・質量の形で作る（接地中は上向きの力が半分のサイン波、空中は重力だけ）。
// 接地の長さを変えて、入れたい上下動になるように合わせる。前後は接地の前半が減速・後半が加速の
// サイン波1周期（前半で落ちる速さ＝ブレーキ）、左右は2歩で1回の揺れ。骨盤は2歩で1回、左右に傾き・ねじれる。
// スマホは、体に対して好きな向きで付けられる（orientation）。座標は 世界：x 前・y 左・z 上
//
// 実際の腰は、重心の真上ではなく、骨盤の回転も大きく、足の着地の衝撃（短く鋭い山）も乗る。ここで合わせられるのは
// 「測り方の計算が正しいか」までで、実際の走りでの精度はトレッドミルで確かめる
//
// 付け方の確認のために、腰以外・ゆるい・途中でずれた付け方も作れる（mount）。どれも体の動きの教科書的な形から
// 作った仮のもので、実際の腕・手・ポケット・ゆるいベルトの値と比べてはいない

export const G = 9.81

export interface RunSpec {
  cadence: number // 歩／分
  bounceCm: number // 重心の上下動（cm）
  brakingMs: number // 1歩ごとに着地で落ちる速さ（m/s）
  tiltDeg?: number // 骨盤の前傾（度）。坂や疲れで変わる
  seconds: number
  fs?: number // センサーの回数（毎秒）
  noise?: number // 加速度の雑音（m/s²、標準偏差）
  jitter?: number // 1歩ごとの周期のばらつき（割合、標準偏差）
  sway?: number // 左右の揺れの強さ（m/s²）
  rollDeg?: number // 骨盤の左右の傾きの振れ（度）
  yawDeg?: number // 骨盤のねじれの振れ（度）
  impact?: number // 着地の衝撃の山の高さ（m/s²）。幅 10ms ほどの鋭い山と、すぐあとの揺り戻し（面積0。重心の高さはほとんど変えない）
  orientation?: Vec3 // スマホの付け方（体に対する x・y・z 回りの回転、度）
  asym?: number // 左右の歩の強さの差（割合）。右と左で上下の力が 1±asym 倍になる。2歩で1回の揺れが上下にも乗る
  mount?: MountSim // 腰以外・ゆるい・途中でずれた付け方。なければ腰にしっかり付けている
  seed?: number
  t0?: number
}

// 付け方の模擬
//   arm：アームバンド（二の腕）。肩を支点に、2歩で1回、前後に振れる
//   hand：手に持つ。肩を支点に、腕より長い腕で大きく振れる
//   pocket：ズボンの前ポケット（太もも）。股関節を支点に、2歩で1回、前後に振れる
//   loose：ゆるいベルト。着地のたびに、スマホが体に対して揺れる（ふつう 6〜10 回／秒、すぐおさまる）。ゆっくりした傾きのぶれも乗る
//   shift：途中でずれた。at 秒から 0.5 秒で、rotate（度）だけ向きが変わる
export type MountSim =
  | { kind: 'arm' | 'hand' | 'pocket'; swingDeg?: number; radius?: number; offsetDeg?: number }
  | { kind: 'loose'; tiltDeg: number; accMs: number }
  | { kind: 'shift'; at: number; rotate: Vec3 }

// 支点・振れ幅（片側、度）・支点からの長さ（m）・振れの中心（度）の既定値。
// 走りの腕振りは肩で ±25〜40°、股関節は −15〜+45° ほど（教科書的な値。ここでは確かめていない）
export const LIMB = {
  arm: { swingDeg: 30, radius: 0.15, offsetDeg: 0 },
  hand: { swingDeg: 35, radius: 0.4, offsetDeg: 10 },
  pocket: { swingDeg: 30, radius: 0.2, offsetDeg: 15 },
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
const I3: Mat = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const unitOf = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

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
  const tilt = s.tiltDeg ?? 0
  const asym = s.asym ?? 0
  const mount = s.mount
  const impact = s.impact ?? 0
  const t0 = s.t0 ?? 0
  const gauss = rng(s.seed ?? 1)
  const ratio = contactRatioFor(s.cadence, s.bounceCm)
  const D = deviceToBody(s.orientation ?? [0, 0, 0])
  const T0 = 60 / s.cadence

  // 1歩ごとの始まりの時刻
  const starts: number[] = [0]
  while (starts[starts.length - 1] < s.seconds + 1) starts.push(starts[starts.length - 1] + T0 * (1 + jitter * gauss()))

  // ゆるいときの、1歩ごとの揺れ（向きの揺れ2つ・体に対する加速度、その周波数と向き）とゆっくりしたぶれ
  // （付け方の乱数は別にして、しっかり付けたときの模擬データを変えない）
  const g2 = rng((s.seed ?? 1) + 7919)
  const shake = starts.map(() => ({ a: g2(), b: g2(), c: g2(), f: 6 + 2 * Math.abs(g2()), dir: unitOf([g2(), g2(), g2()]) }))
  const drift = [0, 1].map(() => ({ f: 0.2 + 0.3 * Math.abs(g2()), p: 2 * Math.PI * Math.abs(g2()) }))

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
    const side = 1 + (i % 2 ? asym : -asym)
    const vert = (tau < tc ? side * A * Math.sin((Math.PI * tau) / tc) : 0) + impact * mexicanHat((tau - 0.015) / IMPACT_SD)
    const ap = tau < tc ? -B * Math.sin((2 * Math.PI * tau) / tc) : 0
    const ph = Math.PI * (i + tau / T) // 2歩で1回
    const ml = sway * Math.sin(ph)
    const fw: Vec3 = [ap, ml, vert]
    const w = Math.PI / T // 位相の進む速さ（rad/s）。角速度は世界の座標で近似し、スマホの座標に直す
    // 体の向き：骨盤の前傾に、2歩で1回の左右の傾きとねじれ
    const body = mul(rz(yaw * Math.cos(ph)), mul(rx(roll * Math.sin(ph)), ry(tilt)))
    const om: Vec3 = [rad(roll * Math.cos(ph)) * w, 0, rad(-yaw * Math.sin(ph)) * w]
    // 付け方：体に対するスマホの向き（rel）と、体に対する加速度（世界の座標で近似）
    let rel: Mat = I3
    if (mount && (mount.kind === 'arm' || mount.kind === 'hand' || mount.kind === 'pocket')) {
      const d = { ...LIMB[mount.kind], ...mount }
      const th0 = rad(d.swingDeg)
      const th = th0 * Math.sin(ph) + rad(d.offsetDeg)
      const thd = th0 * Math.cos(ph) * w
      const thdd = -th0 * Math.sin(ph) * w * w
      rel = ry((th * 180) / Math.PI)
      // 支点から radius 下の点の加速度（支点は体と一緒に動く）
      fw[0] += -d.radius * (Math.cos(th) * thdd - Math.sin(th) * thd * thd)
      fw[2] += d.radius * (Math.sin(th) * thdd + Math.cos(th) * thd * thd)
      om[1] += thd
    } else if (mount?.kind === 'loose') {
      const k = shake[i]
      const env = Math.exp(-tau / 0.08)
      const sn = Math.sin(2 * Math.PI * k.f * tau)
      const cs = Math.cos(2 * Math.PI * k.f * tau)
      const osc = env * sn
      const oscD = env * (2 * Math.PI * k.f * cs - sn / 0.08)
      const slow = (n: number) => 0.5 * mount.tiltDeg * Math.sin(2 * Math.PI * drift[n].f * t + drift[n].p)
      const slowD = (n: number) => 0.5 * rad(mount.tiltDeg) * 2 * Math.PI * drift[n].f * Math.cos(2 * Math.PI * drift[n].f * t + drift[n].p)
      const al = mount.tiltDeg * k.a * osc + slow(0)
      const be = mount.tiltDeg * k.b * osc + slow(1)
      rel = mul(rx(al), ry(be))
      for (let j = 0; j < 3; j++) fw[j] += mount.accMs * k.c * osc * k.dir[j]
      om[0] += rad(mount.tiltDeg * k.a) * oscD + slowD(0)
      om[1] += rad(mount.tiltDeg * k.b) * oscD + slowD(1)
    } else if (mount?.kind === 'shift') {
      const u = Math.min(1, Math.max(0, (t - mount.at) / 0.5))
      const [a, b, c] = mount.rotate
      rel = mul(rz(u * c), mul(ry(u * b), rx(u * a)))
      if (u > 0 && u < 1) for (let j = 0; j < 3; j++) om[j] += (rad(mount.rotate[j]) / 0.5)
    }
    const R = mul(body, mul(rel, D)) // スマホ → 世界
    const f = apply(tr(R), fw)
    const omega = apply(tr(R), om)
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

// 立って止まっているとき
export function simulateStanding(s: { seconds: number; orientation?: Vec3; fs?: number; noise?: number; seed?: number; t0?: number }): PhoneMeasure[] {
  const fs = s.fs ?? 60
  const gauss = rng(s.seed ?? 2)
  const noise = s.noise ?? 0
  const R = deviceToBody(s.orientation ?? [0, 0, 0])
  const f = apply(tr(R), [0, 0, G])
  const out: PhoneMeasure[] = []
  for (let n = 0; n / fs < s.seconds; n++) {
    out.push({ t: (s.t0 ?? 0) + n / fs, ax: f[0] + noise * gauss(), ay: f[1] + noise * gauss(), az: f[2] + noise * gauss(), gx: 0, gy: 0, gz: 0 })
  }
  return out
}

// 画面で試すための模擬の走り（ブラウザで、センサーの代わりに流し込む）。立って5秒 → ピッチ172で4分 → 158で1分半。
// 4分目のあとにピッチが約8%落ちるので、走り始めの基準ができたあと、ピッチの声がかかる
export function demoRun(): PhoneMeasure[] {
  const o: Vec3 = [90, 0, 0]
  const real = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20, bounceCm: 8, brakingMs: 0.3, orientation: o }
  return [
    ...simulateStanding({ seconds: 5, orientation: o, noise: 0.05 }),
    ...simulateRun({ ...real, cadence: 172, seconds: 240, seed: 11, t0: 5 }),
    ...simulateRun({ ...real, cadence: 158, seconds: 90, seed: 12, t0: 245 }),
  ]
}
