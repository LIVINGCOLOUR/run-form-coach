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
export function demoStride(cfg = { lean: 7, head: 0, drop: 0 }, n = 36): Frame[] {
  const R = (d: number) => (d * Math.PI) / 180
  const frames: Frame[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f: Frame = Array.from({ length: 33 }, () => ({ x: CX, y: CY, v: 0.3 }))
    const hip = { x: CX, y: CY + cfg.drop - 6 * Math.cos(4 * Math.PI * t), v: 1 }
    const S = { x: hip.x + 128 * Math.sin(R(cfg.lean)), y: hip.y - 128 * Math.cos(R(cfg.lean)), v: 1 }
    const ear = { x: S.x + 4 + cfg.head * 2.2, y: S.y - 30 + cfg.head * 0.6, v: 1 }
    const nose = { x: ear.x + 14, y: ear.y - 4, v: 1 }
    const leg = (ph: number) => {
      const th = R(26 * Math.sin(2 * Math.PI * ph))
      const kf = R(15 + 50 * (1 - Math.cos(2 * Math.PI * (ph - 0.15))))
      const K = { x: hip.x + 82 * Math.sin(th), y: hip.y + 82 * Math.cos(th), v: 1 }
      const A = { x: K.x + 82 * Math.sin(th - kf), y: K.y + 82 * Math.cos(th - kf), v: 1 }
      return { K, A, F: { x: A.x + 16, y: A.y + 3, v: 1 } }
    }
    const arm = (ph: number) => {
      const a = R(-32 * Math.sin(2 * Math.PI * ph))
      const E = { x: S.x + 54 * Math.sin(a), y: S.y + 54 * Math.cos(a), v: 1 }
      const fa = a + R(95)
      return { E, W: { x: E.x + 44 * Math.sin(fa), y: E.y + 44 * Math.cos(fa), v: 1 } }
    }
    const ln = leg(t)
    const lf = leg(t + 0.5)
    const an = arm(t + 0.5)
    const af = arm(t)
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
    f[L.rightKnee] = { ...lf.K, v: 0.5 }
    f[L.rightAnkle] = { ...lf.A, v: 0.5 }
    f[L.rightFoot] = { ...lf.F, v: 0.5 }
    f[L.leftElbow] = an.E
    f[L.leftWrist] = an.W
    f[L.rightElbow] = { ...af.E, v: 0.5 }
    f[L.rightWrist] = { ...af.W, v: 0.5 }
    frames.push(f)
  }
  return frames
}
