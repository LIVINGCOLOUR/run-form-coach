// 仮想実験の材料（上体）：Van Hooren & Meijer 2024 の公開データ（CC BY、https://osf.io/7qbxc/）
//   トレッドミルで19人。ふつうに走る条件のほかに「上体を前に倒して走る」条件（trunklean）がある
//   印：骨盤（ASIS・PSIS）、膝の外側（LEK）、くるぶしの外側（LM）、かかと（HEE）、つま先（MT2）、
//       首の付け根の背中側（C7）と胸骨の上（JN）。頭と肩の印はない
//   座標（ファイル）：Z が上、−Y が前、−X が右 → 仮想実験の座標（X 前、Y 上、Z 右）に直す
// MediaPipe の点に合わせて作るもの
//   腰：股関節の中心を骨盤の印から推定（Bell の方法：骨盤の幅 PW に対し、両 ASIS の中点から後ろ 19%・下 30%・横 36%）
//   肩：C7 と JN の中点から下に3cm、左右に17cm（骨盤の左右の向きで）
//   頭：首から上体の向きに17cm上を耳、そこから前に10cmを鼻とする（頭の角度は確かめられない）
import { readC3D } from './c3d'
import type { V3 } from './rbds'

export interface UpperTrial {
  id: string
  fps: number
  frames: number
  joints: Record<'hipR' | 'hipL' | 'kneeR' | 'kneeL' | 'ankleR' | 'ankleL' | 'heelR' | 'heelL' | 'toeR' | 'toeL' | 'pelvis' | 'shR' | 'shL' | 'ear' | 'nose', V3[]>
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const mid = (a: V3, b: V3): V3 => sc(add(a, b), 0.5)
const norm = (a: V3): V3 => sc(a, 1 / Math.hypot(...a))
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

export function loadUpper(path: string, id: string): UpperTrial {
  const c = readC3D(path)
  const raw = (name: string): V3[] => {
    const k = c.labels.indexOf(name)
    if (k < 0) throw new Error(`${id}: ${name} がありません`)
    return c.points[k].map(([x, y, z]) => [-y, z, -x])
  }
  const M = Object.fromEntries(['RASIS', 'LASIS', 'RPSIS', 'LPSIS', 'RLEK', 'LLEK', 'RLM', 'LLM', 'RHEE', 'LHEE', 'RMT2', 'LMT2', 'C7', 'JN'].map((n) => [n, raw(n)]))
  const out: UpperTrial['joints'] = { hipR: [], hipL: [], kneeR: [], kneeL: [], ankleR: [], ankleL: [], heelR: [], heelL: [], toeR: [], toeL: [], pelvis: [], shR: [], shL: [], ear: [], nose: [] }
  let last: Record<string, V3> | null = null
  for (let f = 0; f < c.frames; f++) {
    const g = (n: string) => M[n][f]
    const pts = Object.keys(M).map(g)
    if (pts.some((p) => !p.every(Number.isFinite))) {
      // 欠けたコマは前のコマで埋める（欠けは少ない）
      if (last) for (const k of Object.keys(out)) out[k as keyof typeof out].push(last[k])
      continue
    }
    const asis = mid(g('RASIS'), g('LASIS'))
    const psis = mid(g('RPSIS'), g('LPSIS'))
    const right = norm(sub(g('RASIS'), g('LASIS')))
    let fwd = sub(asis, psis)
    fwd = norm(sub(fwd, sc(right, dot(fwd, right))))
    const up = cross(right, fwd)
    const pw = Math.hypot(...sub(g('RASIS'), g('LASIS')))
    const hjc = (side: 1 | -1) => add(add(add(asis, sc(fwd, -0.19 * pw)), sc(up, -0.3 * pw)), sc(right, 0.36 * pw * side))
    const neck = mid(g('C7'), g('JN'))
    const pelvis = mid(hjc(1), hjc(-1))
    const trunkUp = norm(sub(neck, pelvis))
    const shC = add(neck, [0, -30, 0])
    const ear = add(neck, sc(trunkUp, 170))
    const row: Record<string, V3> = {
      hipR: hjc(1),
      hipL: hjc(-1),
      kneeR: g('RLEK'),
      kneeL: g('LLEK'),
      ankleR: g('RLM'),
      ankleL: g('LLM'),
      heelR: g('RHEE'),
      heelL: g('LHEE'),
      toeR: g('RMT2'),
      toeL: g('LMT2'),
      pelvis,
      shR: add(shC, sc(right, 170)),
      shL: add(shC, sc(right, -170)),
      ear,
      nose: add(ear, sc(fwd, 100)),
    }
    for (const k of Object.keys(out)) out[k as keyof typeof out].push(row[k])
    last = row
  }
  return { id, fps: c.rate, frames: out.hipR.length, joints: out }
}
