import type { Frame, ItemKey, Pt, Stride } from '../core/types'
import { L } from '../core/landmarks'
import { legLength, mid } from '../core/geometry'

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

// 記録がまだないときの見本：計算で作る1歩（右向き、近い側は左）
//
// 研究の値（Novacheck 1998「The biomechanics of running」ほか）をもとに、関節の角度を時間で決めて骨格を組む
//   ピッチは毎分180歩。接地は1周の0〜31%（1歩あたり約0.21秒）、両足が浮いている時間が1歩あたり約0.13秒
//     （Novacheck の 3.2m/s は離地39%で、ゆっくりのジョグ。軽快に走る市民ランナーに合わせて短くした）
//   左右は半周ずれる
//   太もも（鉛直からの角度、前が正）：接地 +24°、接地の真ん中で足首が腰の真下に来る +23°、離地で一番後ろ −20°、
//     離地のあとはすぐ前へ戻し（脚を後ろに流さない）、振り出しで一番前 +36°、接地の前に少し戻してから着く
//   膝の曲がり：接地 20°、接地中に一番曲がって 46°（研究では約45°。ここで沈んで、離地で伸び上がる）、離地 14°（地面を押し切って伸びる）、
//     離地のあとすぐ太ももを前に戻しながら膝を 118° までたたむ（踵がお尻の下を通り、脚が後ろに残らない）、接地の直前 16°
//   すね：接地の瞬間はほぼ鉛直（太もも 24° − 膝 20° ＝ 前に4°）。15°以上前に倒れるとオーバーストライド
//   宙に浮いている間は、放物線で上がって下りる（浮いている時間から重力で高さを決める）
//   腕：脚と逆（左脚が前のとき左腕は後ろ）。肘は90°前後、後ろに大きく引く
//   腰の高さ：接地している足が地面に着くように決める（宙に浮いたり沈んだりしない）
type Key = [number, number][]
const THIGH: Key = [[0, 24], [0.12, 23], [0.31, -20], [0.4, 10], [0.5, 30], [0.65, 35], [0.82, 38], [0.94, 30]]
const KNEE: Key = [[0, 20], [0.12, 46], [0.31, 14], [0.4, 90], [0.5, 118], [0.65, 90], [0.82, 40], [0.94, 16]]
const ANKLE: Key = [[0, -2], [0.12, -24], [0.25, 0], [0.31, 30], [0.45, 10], [0.8, -2]] // 底屈が正（つま先が下がる）。接地中は足裏が地面に沿う
const STANCE = 0.31
// 見本の速さ：毎分180歩（1周＝2歩＝0.667秒）。毎秒30コマで再生するので、1周は20コマ
export const DEMO_SPM = 180
export const DEMO_FRAMES = 20
const PX_PER_CM = 164 / 90 // 脚の長さ164（描画）を90cm とみなす
const G = 981 // cm/s²
const THIGH_LEN = 82
const SHANK_LEN = 82
const FOOT_LEN = 18
const HEEL_LEN = 6

// 周期的になめらかにつなぐ（Catmull-Rom）
function curve(keys: Key, ph: number): number {
  const t = ((ph % 1) + 1) % 1
  const n = keys.length
  let i = n - 1
  for (let k = 0; k < n; k++) if (keys[k][0] <= t) i = k
  const at = (k: number) => {
    const j = ((k % n) + n) % n
    const wrap = Math.floor(k / n)
    return { x: keys[j][0] + wrap, y: keys[j][1] }
  }
  const p0 = at(i - 1)
  const p1 = at(i)
  const p2 = at(i + 1)
  const p3 = at(i + 2)
  const u = (t - p1.x) / (p2.x - p1.x)
  const m1 = ((p2.y - p0.y) / (p2.x - p0.x)) * (p2.x - p1.x)
  const m2 = ((p3.y - p1.y) / (p3.x - p1.x)) * (p2.x - p1.x)
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * p1.y + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2.y + (u3 - u2) * m2
}

// over（0〜1）：オーバーストライドの見本用。接地で太ももを前に出し、膝を伸ばして着く（すねが前に倒れる）
export function demoStride(cfg: { lean: number; head: number; drop: number; over?: number } = { lean: 7, head: 0, drop: 0 }, n = DEMO_FRAMES): Frame[] {
  const R = (d: number) => (d * Math.PI) / 180
  const o = cfg.over ?? 0
  const THIGH_K: Key = THIGH.map(([p, v]) => [p, p === 0 || p >= 0.9 ? v + 12 * o : v])
  const KNEE_K: Key = KNEE.map(([p, v]) => [p, p === 0 || p >= 0.9 ? v - 10 * o : v])
  const down = (o: Pt, len: number, deg: number): Pt => ({ x: o.x + len * Math.sin(R(deg)), y: o.y + len * Math.cos(R(deg)), v: 1 })
  // 腰を (0,0) としたときの片脚の形
  const leg = (ph: number) => {
    const th = curve(THIGH_K, ph)
    const sh = th - curve(KNEE_K, ph)
    const K = down({ x: 0, y: 0, v: 1 }, THIGH_LEN, th)
    const A = down(K, SHANK_LEN, sh)
    const footDeg = sh + 90 - curve(ANKLE, ph)
    return { K, A, F: down(A, FOOT_LEN, footDeg), H: down(A, HEEL_LEN, footDeg + 180) }
  }
  const low = (l: ReturnType<typeof leg>) => Math.max(l.A.y, l.F.y, l.H.y)
  // 腰の高さ：接地中の脚の一番低い点が地面になるように。宙に浮いている間は、離地と接地の高さをなめらかにつなぐ
  const ground = (ph: number) => low(leg(ph % 1))
  const hipDepth = (t: number): number => {
    const u = ((t % 0.5) + 0.5) % 0.5 // 半周ごとに左右が入れ替わる
    const ph = t - Math.floor(t)
    const stanceLeg = ph < 0.5 ? ph : ph - 0.5
    if (u < STANCE) return ground(stanceLeg)
    const a = ground(STANCE)
    const b = ground(0)
    const s = (u - STANCE) / (0.5 - STANCE)
    // 宙に浮いている間は放物線。浮いている時間 T で、真ん中の高さは g·T²/8
    const T = (0.5 - STANCE) * ((2 * 60) / DEMO_SPM)
    return a + (b - a) * s + ((G * T * T) / 8) * PX_PER_CM * 4 * s * (1 - s)
  }
  const depths = Array.from({ length: n }, (_, i) => hipDepth(i / n))
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
      const th = curve(THIGH, ph)
      const a = 18 - ((th + 12) / 50) * 58 // 前 +18° 〜 後ろ −40°
      const E = down(S, 54, a)
      const elbow = 88 + Math.max(0, -a - 20) * 0.5 // 後ろに引いたときだけ、肘が少し開く
      return { E: { ...E, v }, W: { ...down(E, 44, a + elbow), v } }
    }
    const ln = place(leg(t), 1)
    const lf = place(leg(t + 0.5), 0.5)
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
