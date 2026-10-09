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

// スマホが下（または上）を向いていると、画面の縦の線は下（上）にすぼまって映る。スマホの上下の向き pitchDeg
// （下向きが正）とレンズの縦の画角から、「スマホをまっすぐ立てて撮ったら」の位置に骨格の点を戻す。
// 左右の傾き（rotateFrame）を直したあとに使う
export function levelFrame(frame: Frame, pitchDeg: number, vfovDeg: number, w: number, h: number): Frame {
  if (!pitchDeg) return frame
  const f = h / 2 / Math.tan(vfovDeg / 2 / DEG)
  const c = Math.cos(pitchDeg / DEG)
  const s = Math.sin(pitchDeg / DEG)
  return frame.map((p) => {
    const u = (p.x - w / 2) / f
    const v = (p.y - h / 2) / f // 下が正
    const y = v * c + s
    const z = -v * s + c
    if (z <= 0.05) return p
    return { x: w / 2 + (f * u) / z, y: h / 2 + (f * y) / z, v: p.v }
  })
}

// スマホが体の前側から撮っているか、後ろ側から撮っているか。真横で0、前側で正、後ろ側で負（脚の長さに対する割合）
// 前側から撮ると奥の腰・肩が手前の腰・肩より前に、後ろ側から撮ると後ろに映る（仮想実験で、30°後ろから約 −0.2）
export function yawSign(frame: Frame): number {
  const nearR = frame[L.rightHip].v + frame[L.rightShoulder].v >= frame[L.leftHip].v + frame[L.leftShoulder].v
  const [nh, fh, ns, fs] = nearR ? [L.rightHip, L.leftHip, L.rightShoulder, L.leftShoulder] : [L.leftHip, L.rightHip, L.leftShoulder, L.rightShoulder]
  const leg = legLength(frame)
  if (!leg) return 0
  return ((((frame[fh].x - frame[nh].x) + (frame[fs].x - frame[ns].x)) / 2) * facing(frame)) / leg
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
  // 接地している側の足首 = 画像で下にある方（腰の高さを測るのに使う）
  const la = frame[L.leftAnkle]
  const ra = frame[L.rightAnkle]
  const stance = la.y >= ra.y ? la : ra
  // 上体と体全体の傾きは、左右の真ん中を通る線で測る（腰の中心→肩の中心、足首の中心→肩の中心）。
  // 手前側の腰→肩で測ると、斜めから撮ったときに肩と股関節の左右の張り出しの違いで線が傾き、
  // 低いほうの足首を使うと、見下ろし気味に撮ったとき奥の足が高く映って選び違える
  // （研究データの仮想実験で、体全体の傾きが +3.3° → +0.4°、後ろ側30°からの上体が +4.3° → −0.1° になった）
  const hipC = mid(frame[L.leftHip], frame[L.rightHip])
  const shC = mid(frame[L.leftShoulder], frame[L.rightShoulder])
  const ankC = mid(la, ra)
  const trunk = leanFromVertical(hipC, shC, dir)
  const body = leanFromVertical(ankC, shC, dir)
  // 頭は、手前側の肩→耳と手前側の腰→肩の差（走り始めの自分との差で見る）
  const neckLean = leanFromVertical(shoulder, ear, dir)
  const trunkNear = leanFromVertical(hip, shoulder, dir)
  const leg = legLength(frame)
  const hipRatio = leg > 0 ? (stance.y - mid(frame[L.leftHip], frame[L.rightHip]).y) / leg : 0

  return { neck: neckLean - trunkNear, headLean: neckLean, yaw: yawSign(frame), trunk, body, hipRatio, dir }
}
