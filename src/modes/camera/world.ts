import { L } from './landmarks'

// 骨格の推定の worldLandmarks（腰の中心が原点の3次元の点、m。x は画面の右、y は画面の下、z はカメラから奥）から、
// 体の向きと、体の横の面での角度を出す。記録に残すだけで、判定には使わない（仮想実験で、2次元の点で向きを見積もって直すより悪かった。
// params.ts の CAM_YAW の説明）。実際の点でどれだけ当たるかを、あとで記録から確かめるため
export interface P3 {
  x: number
  y: number
  z: number
}

export interface WorldAngles {
  yaw: number // スマホが体の前側から撮っている角度（度。前側が正。真横で0）
  trunk: number // 腰の中心→肩の中心の前傾（度）
  headLean: number // 手前側の肩→耳の前傾（度）
  neck: number // 首の角度：手前側の肩→耳の前傾 − 腰→肩の前傾（度）
}

const DEG = 180 / Math.PI
const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: P3, k: number): P3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const unit = (a: P3): P3 => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1))
const mid = (a: P3, b: P3) => scale(add(a, b), 0.5)

// rollDeg・pitchDeg：傾きセンサーのスマホの左右の傾きと上下の向き（gravity.ts。2次元の rotateFrame・levelFrame と同じ向き）。
// nearRight：カメラに近い側が右か（2次元の nearSide と同じ側を使う）
export function worldAngles(w: P3[], rollDeg: number, pitchDeg: number, nearRight: boolean): WorldAngles | null {
  if (w.length < 33) return null
  const r = rollDeg / DEG
  const p = pitchDeg / DEG
  // カメラの座標での本当の下（重力）。rotateFrame が画面の (−sin r, cos r) を真下に戻すのと同じ向き。下を向いたスマホでは奥へ傾く
  const down: P3 = { x: -Math.sin(r) * Math.cos(p), y: Math.cos(r) * Math.cos(p), z: Math.sin(p) }
  const up = scale(down, -1)
  const flat = (v: P3) => sub(v, scale(up, dot(v, up)))
  // 体の左右の軸（左 − 右）：腰と肩の平均を、水平に
  const lat = unit(flat(add(sub(w[L.leftHip], w[L.rightHip]), sub(w[L.leftShoulder], w[L.rightShoulder]))))
  let fwd = unit(cross(up, lat))
  // 鼻が耳の真ん中より前にある向きを前にする
  if (dot(sub(w[L.nose], mid(w[L.leftEar], w[L.rightEar])), fwd) < 0) fwd = scale(fwd, -1)
  // 体の前がカメラのほう（z が負）に向いているほど、前側から撮っている
  const view = unit(flat({ x: 0, y: 0, z: 1 }))
  const yaw = Math.asin(Math.max(-1, Math.min(1, -dot(fwd, view)))) * DEG
  const lean = (a: P3, b: P3) => {
    const d = sub(b, a)
    return Math.atan2(dot(d, fwd), dot(d, up)) * DEG
  }
  const [sh, ear, hip] = nearRight ? [L.rightShoulder, L.rightEar, L.rightHip] : [L.leftShoulder, L.leftEar, L.leftHip]
  const trunk = lean(mid(w[L.leftHip], w[L.rightHip]), mid(w[L.leftShoulder], w[L.rightShoulder]))
  const headLean = lean(w[sh], w[ear])
  const neck = headLean - lean(w[hip], w[sh])
  return { yaw, trunk, headLean, neck }
}
