// 仮想のスマホ：3次元の関節を、置き方を変えて2次元の画面に映し、MediaPipe と同じ形の骨格（33点）にする
import type { Frame } from '../src/core/types'
import type { V3 } from './rbds'

export interface Placement {
  yaw: number // 真横からのずれ（度）。正は走る向きの前側へ回り込む
  dist: number // 体の中心からスマホまでの水平の距離（m）
  height: number // スマホの高さ（m）
  roll: number // スマホの左右の傾き（度）。アプリは傾きセンサーで直すが、動画の分析では直さない
  vfov: number // 縦の画角（度）。超広角（0.5倍）は約106°、1倍は約67°
  k1: number // レンズのたる型のゆがみ（負でたる型）
  fix?: boolean // アプリと同じく、傾きセンサーの値で左右の傾きと上下の向きを直してから分析する
}

export const W = 480
export const H = 640

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const n = Math.hypot(...a)
  return [a[0] / n, a[1] / n, a[2] / n]
}

// target（体の中心、mm）を見る向きにスマホを置き、点を画面の画素にする関数を返す
export function makeCamera(pl: Placement, target: V3) {
  const R = (d: number) => (d * Math.PI) / 180
  const C: V3 = [target[0] + pl.dist * 1000 * Math.sin(R(pl.yaw)), pl.height * 1000, target[2] + pl.dist * 1000 * Math.cos(R(pl.yaw))]
  const f = norm(sub(target, C))
  let r = norm(cross(f, [0, 1, 0]))
  let u = cross(r, f)
  // 左右の傾き：見る向きを軸に回す
  const c = Math.cos(R(pl.roll))
  const s = Math.sin(R(pl.roll))
  ;[r, u] = [
    [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s],
    [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s],
  ]
  const focal = H / 2 / Math.tan(R(pl.vfov) / 2)
  // スマホの上下の向き（下向きが正）：傾きセンサーで測れる値
  const pitch = (Math.asin(-f[1]) * 180) / Math.PI
  const project = (p: V3): { x: number; y: number } => {
    const d = sub(p, C)
    const z = dot(d, f)
    let x = dot(d, r) / z
    let y = dot(d, u) / z
    // ゆがみは、画面の縦の半分を1とした距離の2乗に比例させる
    const k = (x * x + y * y) / Math.tan(R(pl.vfov) / 2) ** 2
    x *= 1 + pl.k1 * k
    y *= 1 + pl.k1 * k
    return { x: W / 2 + focal * x, y: H / 2 - focal * y }
  }
  return Object.assign(project, { pitch })
}

export interface Noise {
  sigma: number // 手前の脚の点のぶれ（画面の脚の長さに対する割合）。奥の脚は2倍
  collapse: number // 奥の脚の点が、手前の脚に引き寄せられる割合（0〜1）。隠れた脚を推定が重ねてしまう
  swapPerSec: number // 左右の名前の取り違えが1秒あたり起きる回数（1回0.1秒続く）
}

// 簡単な乱数（毎回同じ結果になるよう、種を決める）
export function rng(seed: number) {
  let x = seed % 2147483647 || 1
  const u = () => (x = (x * 16807) % 2147483647) / 2147483647
  return {
    u,
    gauss: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()),
  }
}

// MediaPipe の33点の番号
const I = { nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankL: 27, ankR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32 }

export interface Body {
  hipR: V3
  hipL: V3
  kneeR: V3
  kneeL: V3
  ankleR: V3
  ankleL: V3
  heelR: V3
  heelL: V3
  toeR: V3
  toeL: V3
  pelvis: V3
}

// 1コマ分の骨格を作る。上半身はデータにないので、骨盤から上へ（7°前傾）置いた仮のもの
// camera は +Z 側（右側）から見る前提なので、右が手前
export function toFrame(b: Body, project: ReturnType<typeof makeCamera>, noise: Noise, state: { ar: number[]; swap: number }, r: ReturnType<typeof rng>, dt: number): Frame {
  const lean = (7 * Math.PI) / 180
  const sh: V3 = [b.pelvis[0] + 500 * Math.sin(lean), b.pelvis[1] + 500 * Math.cos(lean), b.pelvis[2]]
  const ear: V3 = [sh[0] + 20, sh[1] + 230, sh[2]]
  const nose: V3 = [ear[0] + 100, ear[1] - 20, ear[2]]
  const pts: [number, V3, boolean][] = [
    [I.nose, nose, true],
    [I.earL, [ear[0], ear[1], ear[2] - 70], false],
    [I.earR, [ear[0], ear[1], ear[2] + 70], true],
    [I.shL, [sh[0], sh[1], sh[2] - 180], false],
    [I.shR, [sh[0], sh[1], sh[2] + 180], true],
    [I.hipL, b.hipL, false],
    [I.hipR, b.hipR, true],
    [I.kneeL, b.kneeL, false],
    [I.kneeR, b.kneeR, true],
    [I.ankL, b.ankleL, false],
    [I.ankR, b.ankleR, true],
    [I.heelL, b.heelL, false],
    [I.heelR, b.heelR, true],
    [I.toeL, b.toeL, false],
    [I.toeR, b.toeR, true],
  ]
  const f: Frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
  for (const [i, p, near] of pts) {
    const q = project(p)
    f[i] = { x: q.x, y: q.y, v: near ? 0.95 : 0.5 }
  }
  // 画面の脚の長さ
  const d = (a: number, c: number) => Math.hypot(f[a].x - f[c].x, f[a].y - f[c].y)
  const leg = d(I.hipR, I.kneeR) + d(I.kneeR, I.ankR)
  // 奥の脚は手前の脚へ寄せる
  for (const [far, nearI] of [
    [I.kneeL, I.kneeR],
    [I.ankL, I.ankR],
    [I.heelL, I.heelR],
    [I.toeL, I.toeR],
  ]) {
    f[far] = { ...f[far], x: f[far].x + (f[nearI].x - f[far].x) * noise.collapse, y: f[far].y + (f[nearI].y - f[far].y) * noise.collapse }
  }
  // ぶれ：前のコマのぶれを少し引きずる（推定は追跡しながら出すので、ぶれは急には変わらない）
  const keep = Math.exp(-dt / 0.03)
  f.forEach((p, i) => {
    if (!p.v) return
    const s = noise.sigma * leg * (p.v < 0.9 ? 2 : 1)
    for (const k of [0, 1]) {
      const j = i * 2 + k
      state.ar[j] = keep * (state.ar[j] ?? 0) + Math.sqrt(1 - keep * keep) * s * r.gauss()
    }
    f[i] = { ...p, x: p.x + state.ar[i * 2], y: p.y + state.ar[i * 2 + 1] }
  })
  // 左右の取り違え
  if (state.swap > 0) state.swap -= dt
  else if (r.u() < noise.swapPerSec * dt) state.swap = 0.1
  if (state.swap > 0) {
    for (const [a, c] of [
      [I.hipL, I.hipR],
      [I.kneeL, I.kneeR],
      [I.ankL, I.ankR],
      [I.heelL, I.heelR],
      [I.toeL, I.toeR],
    ]) {
      const t = f[a]
      f[a] = { ...f[c], v: t.v }
      f[c] = { ...t, v: f[c].v }
    }
  }
  return f
}
