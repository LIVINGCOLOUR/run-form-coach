import type { Frame, Pt } from '../../core/types'
import type { Measure } from './types'
import { L } from './landmarks'
import { HIP_MID } from './params'

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
  // 頭は、手前側の肩→耳と手前側の腰→肩の差（正しいフォームの線と、今日の基準との差で見る）。顎は、手前側の耳→鼻の線の上向き
  const neckLean = leanFromVertical(shoulder, ear, dir)
  const trunkNear = leanFromVertical(hip, shoulder, dir)
  const chin = Math.atan2(ear.y - frame[L.nose].y, (frame[L.nose].x - ear.x) * dir) * DEG
  const leg = legLength(frame)
  const hipRatio = leg > 0 ? (stance.y - mid(frame[L.leftHip], frame[L.rightHip]).y) / leg : 0
  const m: Measure = { neck: neckLean - trunkNear, headLean: neckLean, chin, yaw: yawSign(frame), trunk, body, hipRatio, dir }
  const ms = midstance(frame)
  if (ms) m.mid = ms
  const k = stanceKnee(frame)
  if (k !== null) m.kst = k
  m.hipEar = hipEarLean(frame, dir)
  return m
}

// 腰の中心 → 両耳の真ん中の線の、鉛直からの前傾（度。dir の向きが正）。立った姿勢を基準にした値（params.ts の STAND_REF）と並べて記録するだけ
export function hipEarLean(frame: Frame, dir: 1 | -1 = facing(frame)): number {
  return leanFromVertical(mid(frame[L.leftHip], frame[L.rightHip]), mid(frame[L.leftEar], frame[L.rightEar]), dir)
}

// 3点 a-b-c の b での曲がり（度）。まっすぐで 0
function bend(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!n) return 0
  return 180 - Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * DEG
}

// 立脚中期のコマなら、腰の高さと膝の曲がりを測る（腰落ちの判定に使う。params.ts の HIP_MID）。そうでなければ null。
// 立脚中期：画像で低いほう（接地している側）の足首が、腰の中心の真下（前後に脚の長さの HIP_MID.dx 以内）にあり、
// もう一方の足首がそれより脚の長さの HIP_MID.sep 以上高い（浮いている）コマ。
//   hip：腰の中心から立脚側の足首までの高さ ÷ 立脚側の脚の長さ（腰→膝 + 膝→足首）。knee：立脚側の膝の曲がり（度）
// 全部のコマの平均（hipRatio）では、浮いている（両足が地面から離れた）コマも混ざるので、弾んでよく走るほど低く出て、
// 腰落ちと逆の向きになった（人の動画の腰落ちの悪い例とよい例の12組で、悪い例が2%以上低かったのは 3組。立脚中期だけなら 10組、
// 膝の曲がり（+5°以上）も見ると 11組。docs/camera-mode.md の「腰」）
export function midstance(frame: Frame): { hip: number; knee: number } | null {
  const la = frame[L.leftAnkle]
  const ra = frame[L.rightAnkle]
  const left = la.y >= ra.y
  const A = left ? la : ra
  const K = left ? frame[L.leftKnee] : frame[L.rightKnee]
  const H = left ? frame[L.leftHip] : frame[L.rightHip]
  const leg = legLength(frame)
  const stanceLeg = dist(H, K) + dist(K, A)
  if (!(leg > 0) || !(stanceLeg > 0)) return null
  const hipC = mid(frame[L.leftHip], frame[L.rightHip])
  if (Math.abs(A.x - hipC.x) / leg >= HIP_MID.dx) return null
  if (Math.abs(la.y - ra.y) / leg <= HIP_MID.sep) return null
  return { hip: (A.y - hipC.y) / stanceLeg, knee: bend(H, K, A) }
}

// 片足のコマ（両足首の高さの差が脚の長さの HIP_MID.sep より大きい）なら、低いほう（接地している側）の脚の膝の曲がり（度）。そうでなければ null。
// 立脚中期（midstance）と違い、足首が腰の真下になくてもよい。
// 腰落ちの新しい候補（params.ts の HIP_COMB）に使う。記録するだけ
export function stanceKnee(frame: Frame): number | null {
  const la = frame[L.leftAnkle]
  const ra = frame[L.rightAnkle]
  const left = la.y >= ra.y
  const leg = legLength(frame)
  if (!(leg > 0) || Math.abs(la.y - ra.y) / leg <= HIP_MID.sep) return null
  return left ? bend(frame[L.leftHip], frame[L.leftKnee], la) : bend(frame[L.rightHip], frame[L.rightKnee], ra)
}
