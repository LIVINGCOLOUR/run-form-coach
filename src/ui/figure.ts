import type { Frame, ItemKey, Pt, Stride } from '../core/types'
import { L } from '../core/landmarks'
import { legLength, mid } from '../core/geometry'
import reference from '../core/reference.json'

// 描画用の座標系：腰の平均が (170, 262)、脚の長さが 164、右向き
const CX = 170
const CY = 262
const LEG = 164

export function normalizeStride(s: Stride): Frame[] {
  const hips = s.frames.map((f) => mid(f[L.leftHip], f[L.rightHip]))
  const hx = hips.reduce((a, b) => a + b.x, 0) / hips.length
  const hy = hips.reduce((a, b) => a + b.y, 0) / hips.length
  const leg = s.frames.reduce((a, f) => a + legLength(f), 0) / s.frames.length || 1
  const k = LEG / leg
  return s.frames.map((f) => f.map((p) => ({ x: CX + (p.x - hx) * k * s.dir, y: CY + (p.y - hy) * k, v: p.v })))
}

// 画面上で反時計回りに deg 度まわす（右向きの人なら、前傾を deg 度へらす）
function rot(p: Pt, c: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * Math.cos(a) + dy * Math.sin(a), y: c.y - dx * Math.sin(a) + dy * Math.cos(a), v: p.v }
}

const UPPER = Array.from({ length: 23 }, (_, i) => i) // 顔・肩・腕・手
const FACE = Array.from({ length: 11 }, (_, i) => i)

function rotateSet(f: Frame, idx: number[], pivot: Pt, deg: number): Frame {
  const out = f.slice()
  for (const i of idx) out[i] = rot(f[i], pivot, deg)
  return out
}

const hipMid = (f: Frame) => mid(f[L.leftHip], f[L.rightHip])
const shoulderMid = (f: Frame) => mid(f[L.leftShoulder], f[L.rightShoulder])

// 次の一歩：直す項目だけを from → to に直した形
export function nextStepFrame(f: Frame, item: ItemKey, from: number, to: number): Frame {
  const d = from - to
  if (item === 'head') return rotateSet(f, FACE, shoulderMid(f), d)
  if (item === 'trunk' || item === 'body') return rotateSet(f, UPPER, hipMid(f), d)
  const lift = (d / 100) * LEG
  return f.map((p, i) => (i <= 26 ? { ...p, y: p.y - lift } : p))
}

// 理想の形：体幹を 7° に、頭を直立の並びに
export function idealFrame(f: Frame, avg: Stride['avg']): Frame {
  const a = rotateSet(f, UPPER, hipMid(f), avg.trunk - 7)
  return rotateSet(a, FACE, shoulderMid(a), avg.head)
}

export function lerpFrame(a: Frame, b: Frame, k: number): Frame {
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k, v: p.v }))
}

export interface Paths {
  legBack: string
  legFront: string
  armBack: string
  armFront: string
  trunk: string
  neck: string
  hx: number
  hy: number
}

const P = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`

export function nearIsLeft(frames: Frame[]): boolean {
  let l = 0
  let r = 0
  for (const f of frames) {
    l += f[L.leftShoulder].v + f[L.leftHip].v + f[L.leftKnee].v
    r += f[L.rightShoulder].v + f[L.rightHip].v + f[L.rightKnee].v
  }
  return l >= r
}

export function paths(f: Frame, nearLeft: boolean): Paths {
  const n = nearLeft
    ? { e: L.leftEar, s: L.leftShoulder, el: L.leftElbow, w: L.leftWrist, h: L.leftHip, k: L.leftKnee, a: L.leftAnkle, ft: L.leftFoot }
    : { e: L.rightEar, s: L.rightShoulder, el: L.rightElbow, w: L.rightWrist, h: L.rightHip, k: L.rightKnee, a: L.rightAnkle, ft: L.rightFoot }
  const o = nearLeft
    ? { s: L.rightShoulder, el: L.rightElbow, w: L.rightWrist, h: L.rightHip, k: L.rightKnee, a: L.rightAnkle, ft: L.rightFoot }
    : { s: L.leftShoulder, el: L.leftElbow, w: L.leftWrist, h: L.leftHip, k: L.leftKnee, a: L.leftAnkle, ft: L.leftFoot }
  const hip = hipMid(f)
  const sh = shoulderMid(f)
  const ear = f[n.e]
  const nose = f[L.nose]
  const head = { x: (ear.x + nose.x) / 2, y: (ear.y + nose.y) / 2 - 8 }
  return {
    legBack: `M${P(hip)} L${P(f[o.k])} L${P(f[o.a])} L${P(f[o.ft])}`,
    legFront: `M${P(hip)} L${P(f[n.k])} L${P(f[n.a])} L${P(f[n.ft])}`,
    armBack: `M${P(sh)} L${P(f[o.el])} L${P(f[o.w])}`,
    armFront: `M${P(sh)} L${P(f[n.el])} L${P(f[n.w])}`,
    trunk: `M${P(hip)} L${P(sh)}`,
    neck: `M${P(sh)} L${P(ear)}`,
    hx: head.x,
    hy: head.y,
  }
}

// 記録がまだないときの見本：研究データから作る1歩（右向き、近い側は左）
//
// 関節の角度は、市民ランナーをトレッドミルで測った公開データ（Fukuchi ら 2017、CC BY 4.0）のうち、
// 着地のすねが鉛直に近い上位4分の1の脚の平均の曲線を使う
// （scripts/build-reference.mjs で src/core/reference.json を作る。秒速4.0m＝キロ4分10秒、サブ3のペース）
//   股関節・膝・足首の前後の角度、接地の長さ（1周の割合）、ピッチ はデータどおり
//   股関節の角度は骨盤から見た太ももの角度なので、骨盤の前傾ぶんを引いて鉛直からの角度にする。
//     前傾の大きさはデータにないので、接地中に膝が一番曲がる瞬間に足首が腰の真下に来るように決める
//   データにないもの：腕（脚と逆に振る。肘は90°前後）、上体の傾き（設定の lean）、頭
//   腰の高さ：接地している足が地面に着くように決め、宙に浮いている間は放物線で上がって下りる
export const REFERENCE = reference
const IDEAL = reference.ideal
const STANCE = IDEAL.stancePct / 100
export const DEMO_SPM = reference.cadence
// 毎秒30コマで再生するので、1周（2歩）のコマ数
export const DEMO_FRAMES = Math.round((30 * 120) / DEMO_SPM)
const PX_PER_CM = 164 / 90 // 脚の長さ164（描画）を90cm とみなす
const G = 981 // cm/s²
const THIGH_LEN = 82
const SHANK_LEN = 82
// 足：足首の関節は足裏から約8cm上にある。かかとは足首の約5cm後ろ、つま先（指の付け根）は約15cm前
// （足首を地面に置くと、接地中に腰が上下しなくなり、跳ねて見えない）
const ANKLE_H = 8 * PX_PER_CM
// 接地の真ん中で、脚の角度から決まる高さよりさらに沈む量。重心の上下動を、市民ランナー860人の実測
// （7.7 ± 1.2cm、Malisoux ら 2023）に合わせるため。平面の骨格では骨盤や腕の動きがないぶん上下動が小さく出るので、
// 接地中の膝で補う。膝の曲がりは最大約51°で、データの平均（43°）より標準偏差1.5個ぶん深い
const SINK = 1.5 * PX_PER_CM
const HEEL_BACK = 5 * PX_PER_CM
const TOE_FWD = 15 * PX_PER_CM

// 0〜100% の曲線（101点）から、ph（0〜1）の値を取る
function at(curve: number[], ph: number): number {
  const t = (((ph % 1) + 1) % 1) * 100
  const i = Math.floor(t)
  const u = t - i
  return curve[i] + (curve[Math.min(100, i + 1)] - curve[i]) * u
}
const HIP = IDEAL.hip[0]
const KNEE = IDEAL.knee[0]
const ANKLE = IDEAL.ankle[0]
// 骨盤の前傾ぶん：接地中に膝が一番曲がる瞬間、太もも＝膝の曲がりの半分なら足首が腰の真下
const MID = KNEE.slice(0, Math.round(IDEAL.stancePct)).reduce((m, v, i, a) => (v > a[m] ? i : m), 0)
export const PELVIS_TILT = HIP[MID] - KNEE[MID] / 2
const TH_MIN = Math.min(...HIP) - PELVIS_TILT
const TH_MAX = Math.max(...HIP) - PELVIS_TILT

// over（0〜1）：オーバーストライドの見本用。接地で太ももを前に出し、膝を伸ばして着く（すねが前に倒れる）
// arm：腕振りの大きさ（1 = 見本、0 = 振らない）
export function demoStride(cfg: { lean: number; head: number; drop: number; over?: number; arm?: number } = { lean: 7, head: 0, drop: 0 }, n = DEMO_FRAMES): Frame[] {
  const R = (d: number) => (d * Math.PI) / 180
  const o = cfg.over ?? 0
  // オーバーストライドは、接地の前後だけ太ももを前に、膝を伸ばす
  const nearContact = (ph: number) => Math.max(0, Math.cos(2 * Math.PI * ph)) ** 4
  const down = (o: Pt, len: number, deg: number): Pt => ({ x: o.x + len * Math.sin(R(deg)), y: o.y + len * Math.cos(R(deg)), v: 1 })
  // 腰を (0,0) としたときの片脚の形。e は接地中に膝をさらに曲げる量（足首の前後位置が変わらないよう、太ももも半分だけ前へ）
  const leg = (ph: number, e = 0) => {
    const w = o * nearContact(ph)
    const th = at(HIP, ph) - PELVIS_TILT + 12 * w + e / 2
    const sh = th - (at(KNEE, ph) - 10 * w + e)
    const K = down({ x: 0, y: 0, v: 1 }, THIGH_LEN, th)
    const A = down(K, SHANK_LEN, sh)
    const footDeg = sh + 90 + at(ANKLE, ph) // 足裏の向き（つま先の方向）。背屈が正
    const sole = down(A, ANKLE_H, footDeg - 90) // 足首の真下の足裏
    return { K, A, F: down(sole, TOE_FWD, footDeg), H: down(sole, HEEL_BACK, footDeg + 180) }
  }
  const low = (l: ReturnType<typeof leg>) => Math.max(l.A.y, l.F.y, l.H.y)
  // 腰の高さ：接地中の脚の一番低い点が地面になるように。宙に浮いている間は、離地と接地の高さをなめらかにつなぐ
  const ground = (ph: number) => low(leg(ph % 1))
  const hipDepth = (t: number): number => {
    const u = ((t % 0.5) + 0.5) % 0.5 // 半周ごとに左右が入れ替わる
    const ph = t - Math.floor(t)
    const stanceLeg = ph < 0.5 ? ph : ph - 0.5
    // 接地中は、脚の角度で決まる高さより、真ん中でさらに少し沈む（重心の上下動を実測値に合わせる。膝で吸収する）
    if (u < STANCE) return ground(stanceLeg) - SINK * Math.sin((Math.PI * u) / STANCE)
    const a = ground(STANCE)
    const b = ground(0)
    const s = (u - STANCE) / (0.5 - STANCE)
    // 宙に浮いている間は放物線。浮いている時間 T で、真ん中の高さは g·T²/8
    const T = (0.5 - STANCE) * ((2 * 60) / DEMO_SPM)
    const fly = a + (b - a) * s + ((G * T * T) / 8) * PX_PER_CM * 4 * s * (1 - s)
    // 浮いている間に、着こうとしている足が先に地面に着かないようにする
    return Math.max(fly, low(leg(ph)) + 2, low(leg(ph + 0.5)) + 2)
  }
  const depths = Array.from({ length: n }, (_, i) => hipDepth(i / n))
  // 接地している脚は、腰の高さに合わせて足裏が地面に着くよう、膝の曲げを足す
  const planted = (ph: number, depth: number) => {
    const p = ((ph % 1) + 1) % 1
    if (p >= STANCE) return leg(p)
    let lo = 0
    let hi = 20
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (low(leg(p, mid)) > depth) lo = mid
      else hi = mid
    }
    return leg(p, lo)
  }
  const meanDepth = depths.reduce((a, b) => a + b, 0) / n

  const frames: Frame[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f: Frame = Array.from({ length: 33 }, () => ({ x: CX, y: CY, v: 0.3 }))
    // 平均の腰の高さを CY にそろえる。腰が深く沈むほど y が大きい（画面の下）
    const hip = { x: CX, y: CY + cfg.drop + (meanDepth - depths[i]), v: 1 }
    const S = { x: hip.x + 128 * Math.sin(R(cfg.lean)), y: hip.y - 128 * Math.cos(R(cfg.lean)), v: 1 }
    const ear = { x: S.x + 4 + cfg.head * 2.2, y: S.y - 30 + cfg.head * 0.6, v: 1 }
    const nose = { x: ear.x + 14, y: ear.y - 4, v: 1 }
    const place = (l: ReturnType<typeof leg>, v: number) => {
      const m = (p: Pt) => ({ x: hip.x + p.x, y: hip.y + p.y, v })
      return { K: m(l.K), A: m(l.A), F: m(l.F), H: m(l.H) }
    }
    // 腕は同じ側の脚と逆に振る：太ももが一番後ろ（−12°）で腕は一番前、太ももが一番前（+38°）で腕は一番後ろ
    const arm = (ph: number, v: number) => {
      const th = at(HIP, ph) - PELVIS_TILT
      const full = 18 - ((th - TH_MIN) / (TH_MAX - TH_MIN)) * 58 // 前 +18° 〜 後ろ −40°
      const a = -11 + (full + 11) * (cfg.arm ?? 1)
      const E = down(S, 54, a)
      const elbow = 88 + Math.max(0, -a - 20) * 0.5 // 後ろに引いたときだけ、肘が少し開く
      return { E: { ...E, v }, W: { ...down(E, 44, a + elbow), v } }
    }
    const ln = place(planted(t, depths[i]), 1)
    const lf = place(planted(t + 0.5, depths[i]), 0.5)
    const an = arm(t, 1)
    const af = arm(t + 0.5, 0.5)
    f[L.nose] = nose
    f[L.leftEar] = ear
    f[L.rightEar] = { ...ear, v: 0.5 }
    f[L.leftShoulder] = S
    f[L.rightShoulder] = { ...S, v: 0.5 }
    f[L.leftHip] = hip
    f[L.rightHip] = { ...hip, v: 0.5 }
    f[L.leftKnee] = ln.K
    f[L.leftAnkle] = ln.A
    f[L.leftFoot] = ln.F
    f[L.leftHeel] = ln.H
    f[L.rightKnee] = lf.K
    f[L.rightAnkle] = lf.A
    f[L.rightFoot] = lf.F
    f[L.rightHeel] = lf.H
    f[L.leftElbow] = an.E
    f[L.leftWrist] = an.W
    f[L.rightElbow] = af.E
    f[L.rightWrist] = af.W
    frames.push(f)
  }
  return frames
}

// 見本の走りを数字で確かめる（テスト用）。frames は1周ぶん、strideSec は1周の秒数
export function strideStats(frames: Frame[], strideSec: number) {
  const lowOf = (f: Frame, side: 'l' | 'r') => {
    const pts = side === 'l' ? [L.leftAnkle, L.leftHeel, L.leftFoot] : [L.rightAnkle, L.rightHeel, L.rightFoot]
    return Math.max(...pts.map((i) => f[i].y))
  }
  const ground = Math.max(...frames.flatMap((f) => [lowOf(f, 'l'), lowOf(f, 'r')]))
  const on = (f: Frame, side: 'l' | 'r') => lowOf(f, side) >= ground - 1.5
  const n = frames.length
  const contactL = frames.filter((f) => on(f, 'l')).length / n
  const flight = frames.filter((f) => !on(f, 'l') && !on(f, 'r')).length / n
  const hips = frames.map((f) => f[L.leftHip].y)
  // 接地の瞬間：左足が地面に着いた最初のコマ
  const ic = frames.findIndex((f, i) => on(f, 'l') && !on(frames[(i - 1 + n) % n], 'l'))
  const f0 = frames[ic]
  const shank = (Math.atan2(f0[L.leftAnkle].x - f0[L.leftKnee].x, f0[L.leftAnkle].y - f0[L.leftKnee].y) * 180) / Math.PI
  return {
    cadence: (2 * 60) / strideSec,
    contactMs: contactL * strideSec * 1000,
    flightMsPerStep: (flight / 2) * strideSec * 1000,
    verticalCm: (Math.max(...hips) - Math.min(...hips)) / PX_PER_CM,
    shankAtContact: shank,
    footAheadAtContactCm: (f0[L.leftAnkle].x - f0[L.leftHip].x) / PX_PER_CM,
  }
}
