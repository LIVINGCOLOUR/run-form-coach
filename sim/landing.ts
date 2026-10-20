// 着地が体より前か（オーバーストライド）の仮想実験と確かめの道具（sim/landing.sim.ts・scripts/landing-check.ts）で使う測り方。
// 測り方そのもの（LandingMeter・summarize・speedOf など）は、アプリと同じ src/modes/camera/landing.ts をそのまま使う
// （結果は sim/result-landing.md と form-videos/notes/判定テスト.md の 7）。ここに置くのは、調べるためだけのまとめ（腰の揺れ）
import type { Track } from '../src/modes/camera/landing'

export * from '../src/modes/camera/landing'

// 腰の前後・上下の揺れの、1歩の周期の成分の大きさ（÷ 脚の長さ、山から谷の半分）。
// 1周ぶん（前後に半周ずつ）のならしで、ゆっくりした動きを除いてから、1歩の周期（1周の半分）の正弦をあてる
export function hipSway(track: Track[], t0: number, t1: number, strideSec: number) {
  const tr = track.filter((x) => x.t >= t0 && x.t < t1)
  if (tr.length < 20 || !(strideSec > 0)) return { fa: NaN, vert: NaN }
  const w = strideSec / 2
  const detr = (k: 'hx' | 'hy') =>
    tr.map((x) => {
      const nb = tr.filter((y) => Math.abs(y.t - x.t) <= w)
      return x[k] - nb.reduce((a, y) => a + y[k], 0) / nb.length
    })
  const om = (2 * Math.PI) / (strideSec / 2)
  const fit = (ys: number[]) => {
    // 最小二乗で a cos + b sin
    let cc = 0
    let ss = 0
    let cs = 0
    let yc = 0
    let ys2 = 0
    tr.forEach((x, i) => {
      const c = Math.cos(om * x.t)
      const s = Math.sin(om * x.t)
      cc += c * c
      ss += s * s
      cs += c * s
      yc += ys[i] * c
      ys2 += ys[i] * s
    })
    const det = cc * ss - cs * cs
    const a = (yc * ss - ys2 * cs) / det
    const b = (ys2 * cc - yc * cs) / det
    return Math.hypot(a, b)
  }
  return { fa: fit(detr('hx')), vert: fit(detr('hy')) }
}
