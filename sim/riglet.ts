// 仮想実験の材料（頭と上体）：Riglet ら 2024 の公開データ（CC0、https://doi.org/10.6084/m9.figshare.c.7056797.v1）
//   30人がトレッドミルを楽なペースと速いペースで各2分走り、立ったままの記録（Calibration）もある
//   印は Conventional Gait Model 2.5 の63個。頭に4つ（LFHD RFHD LBHD RBHD）と耳の後ろ（LMAS RMAS）と眉間（GLAB）があり、
//   計算された関節の中心（股関節 HJC・膝 KJC・足首 AJC・肩 SJC）も入っている
//   座標（ファイル）：Z が上。前は人ごとに向きが違うので、骨盤の印（ASIS − PSIS）の向きから決める
// MediaPipe の点に合わせて作るもの
//   腰・膝・足首・肩：関節の中心をそのまま使う
//   耳：耳の後ろの印（MAS）から、頭の前の向きに2cm前
//   鼻：眉間の印（GLAB）。向きを決めるのにしか使わない
import { readC3D } from './c3d'
import type { V3 } from './rbds'

export type Joint = 'hipR' | 'hipL' | 'kneeR' | 'kneeL' | 'ankleR' | 'ankleL' | 'heelR' | 'heelL' | 'toeR' | 'toeL' | 'pelvis' | 'shR' | 'shL' | 'earR' | 'earL' | 'nose'

export interface RigletTrial {
  id: string
  fps: number
  frames: number
  joints: Record<Joint, V3[]>
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const mid = (a: V3, b: V3): V3 => sc(add(a, b), 0.5)

const NAMES = ['RHJC', 'LHJC', 'RKJC', 'LKJC', 'RAJC', 'LAJC', 'RHEE', 'LHEE', 'RTOE', 'LTOE', 'RSJC', 'LSJC', 'RMAS', 'LMAS', 'RFHD', 'LFHD', 'RBHD', 'LBHD', 'GLAB', 'RASI', 'LASI', 'RPSI', 'LPSI']

// 印がすべてそろっている、いちばん長い続きのコマだけを返す
export function loadRiglet(path: string, id: string): RigletTrial {
  const c = readC3D(path)
  const M: Record<string, number[][]> = {}
  for (const n of NAMES) {
    const k = c.labels.indexOf(n)
    if (k < 0) throw new Error(`${id}: ${n} がありません`)
    M[n] = c.points[k]
  }
  const ok = (f: number) => NAMES.every((n) => M[n][f].every(Number.isFinite))
  let best = [0, 0]
  for (let f = 0, s = -1; f <= c.frames; f++) {
    if (f < c.frames && ok(f)) {
      if (s < 0) s = f
    } else if (s >= 0) {
      if (f - s > best[1] - best[0]) best = [s, f]
      s = -1
    }
  }
  const [from, to] = best
  if (to - from < 2) throw new Error(`${id}: 使えるコマがありません`)
  // 前の向き：骨盤の前（ASIS）− 後ろ（PSIS）の水平成分の平均
  let fx = 0
  let fy = 0
  for (let f = from; f < to; f++) {
    const d = sub(mid(M.RASI[f] as V3, M.LASI[f] as V3), mid(M.RPSI[f] as V3, M.LPSI[f] as V3))
    fx += d[0]
    fy += d[1]
  }
  const h = Math.hypot(fx, fy)
  const [cx, cy] = [fx / h, fy / h]
  // 仮想実験の座標（X 前、Y 上、Z 右）。右 = 前 × 上（Z 上の右手系で、前 (cx,cy) の右は (cy,−cx)）
  const conv = (p: number[]): V3 => [p[0] * cx + p[1] * cy, p[2], p[0] * cy - p[1] * cx]
  const out = Object.fromEntries(
    (['hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL', 'heelR', 'heelL', 'toeR', 'toeL', 'pelvis', 'shR', 'shL', 'earR', 'earL', 'nose'] as Joint[]).map((k) => [k, [] as V3[]]),
  ) as Record<Joint, V3[]>
  for (let f = from; f < to; f++) {
    const g = (n: string) => conv(M[n][f])
    const front = mid(g('RFHD'), g('LFHD'))
    const back = mid(g('RBHD'), g('LBHD'))
    const fwd = sub(front, back)
    const fwdH: V3 = [fwd[0], 0, fwd[2]]
    const headFwd = sc(fwdH, 1 / Math.hypot(...fwdH))
    out.hipR.push(g('RHJC'))
    out.hipL.push(g('LHJC'))
    out.kneeR.push(g('RKJC'))
    out.kneeL.push(g('LKJC'))
    out.ankleR.push(g('RAJC'))
    out.ankleL.push(g('LAJC'))
    out.heelR.push(g('RHEE'))
    out.heelL.push(g('LHEE'))
    out.toeR.push(g('RTOE'))
    out.toeL.push(g('LTOE'))
    out.pelvis.push(mid(g('RHJC'), g('LHJC')))
    out.shR.push(g('RSJC'))
    out.shL.push(g('LSJC'))
    out.earR.push(add(g('RMAS'), sc(headFwd, 20)))
    out.earL.push(add(g('LMAS'), sc(headFwd, 20)))
    out.nose.push(g('GLAB'))
  }
  // 高さは床（かかと・つま先のいちばん低いところ）を0にする。立った記録は床、走りはトレッドミルの上で、もとの高さが違う
  const feet = [...out.heelR, ...out.heelL, ...out.toeR, ...out.toeL].map((p) => p[1]).sort((a, b) => a - b)
  const ground = feet[Math.floor(feet.length * 0.02)]
  for (const k of Object.keys(out) as Joint[]) out[k] = out[k].map((p) => [p[0], p[1] - ground, p[2]])
  return { id, fps: c.rate, frames: to - from, joints: out }
}

// 立った記録を、走りの記録と同じ場所（腰の前後・左右の位置）に動かす。スマホは同じ場所に置いたままで測るため
export function placeLike(t: RigletTrial, like: RigletTrial): RigletTrial {
  const avg = (ps: V3[]): V3 => sc(ps.reduce(add, [0, 0, 0]), 1 / ps.length)
  const a = avg(t.joints.pelvis)
  const b = avg(like.joints.pelvis)
  const d: V3 = [b[0] - a[0], 0, b[2] - a[2]]
  const joints = Object.fromEntries(Object.entries(t.joints).map(([k, ps]) => [k, ps.map((p) => add(p, d))])) as Record<Joint, V3[]>
  return { ...t, joints }
}
