import type { Frame, Measure, Pt } from './types'
import { L } from './landmarks'

const DEG = 180 / Math.PI

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

// 下の点 a から上の点 b へ向かう線と鉛直の角度（度）。dir の向きに傾いていれば正
export function leanFromVertical(a: Pt, b: Pt, dir: 1 | -1): number {
  const dx = (b.x - a.x) * dir
  const up = a.y - b.y
  return Math.atan2(dx, up) * DEG
}

// 画像を roll 度だけ回して、本当の鉛直を画像の縦にそろえる
export function rotateFrame(frame: Frame, rollDeg: number, cx: number, cy: number): Frame {
  if (!rollDeg) return frame
  const r = -rollDeg / DEG
  const c = Math.cos(r)
  const s = Math.sin(r)
  return frame.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c, v: p.v }))
}

// カメラに近い側（よく見えている側）を選ぶ
export function nearSide(frame: Frame): 'left' | 'right' {
  const l = frame[L.leftShoulder].v + frame[L.leftHip].v + frame[L.leftKnee].v + frame[L.leftEar].v
  const r = frame[L.rightShoulder].v + frame[L.rightHip].v + frame[L.rightKnee].v + frame[L.rightEar].v
  return l >= r ? 'left' : 'right'
}

// 鼻が耳より前にある向きを、進む向きとみなす
export function facing(frame: Frame): 1 | -1 {
  const ear = mid(frame[L.leftEar], frame[L.rightEar])
  return frame[L.nose].x >= ear.x ? 1 : -1
}

// 真横からどれだけずれているか（0 = 真横）。両肩・両腰の見えている幅を体幹の長さで割る
export function sideOffRatio(frame: Frame): number {
  const torso = dist(mid(frame[L.leftShoulder], frame[L.rightShoulder]), mid(frame[L.leftHip], frame[L.rightHip]))
  if (torso === 0) return 1
  const sw = Math.abs(frame[L.leftShoulder].x - frame[L.rightShoulder].x)
  const hw = Math.abs(frame[L.leftHip].x - frame[L.rightHip].x)
  return (sw + hw) / 2 / torso
}

// 真横からのずれを角度の目安に直す（肩幅 ≒ 体幹の長さ × 0.8 として）
export function sideOffDeg(frame: Frame): number {
  const ratio = Math.min(1, sideOffRatio(frame) / 0.8)
  return Math.asin(ratio) * DEG
}

export function legLength(frame: Frame): number {
  const l = dist(frame[L.leftHip], frame[L.leftKnee]) + dist(frame[L.leftKnee], frame[L.leftAnkle])
  const r = dist(frame[L.rightHip], frame[L.rightKnee]) + dist(frame[L.rightKnee], frame[L.rightAnkle])
  return (l + r) / 2
}

// 1コマから角度を測る。frame は鉛直をそろえたピクセル座標
export function measure(frame: Frame): Measure {
  const dir = facing(frame)
  const side = nearSide(frame)
  const ear = side === 'left' ? frame[L.leftEar] : frame[L.rightEar]
  const shoulder = side === 'left' ? frame[L.leftShoulder] : frame[L.rightShoulder]
  const hip = side === 'left' ? frame[L.leftHip] : frame[L.rightHip]
  // 接地している側の足首 = 画像で下にある方
  const la = frame[L.leftAnkle]
  const ra = frame[L.rightAnkle]
  const stance = la.y >= ra.y ? la : ra

  const trunk = leanFromVertical(hip, shoulder, dir)
  const neckLean = leanFromVertical(shoulder, ear, dir)
  const body = leanFromVertical(stance, shoulder, dir)
  const leg = legLength(frame)
  const hipRatio = leg > 0 ? (stance.y - mid(frame[L.leftHip], frame[L.rightHip]).y) / leg : 0

  return { neck: neckLean - trunk, trunk, body, hipRatio, dir }
}
