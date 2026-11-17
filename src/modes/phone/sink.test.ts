import { describe, expect, it } from 'vitest'
import { hipSink, sinkPct, stepHeight, stepSinks } from './sink'
import type { PhoneMeasure } from './signal'

const G = 9.80665

// ばねと重さの形の走り（模擬）：空中は自由落下（重力を引いた上下の加速度 −g）、接地中は床を押す力が正弦波（A sin(πτ/Tc) − g）。
// 1歩の速さの変わりが 0 になるよう、A ＝ g × 1歩の時間 × π ÷ (2 × 接地時間)
function springRun(o: { spm: number; tc: number }) {
  const P = 60 / o.spm
  const A = (G * P * Math.PI) / (2 * o.tc)
  // 1歩の中の、重力を引いた上下の加速度（τ は着地からの秒）
  const net = (t: number) => {
    const tau = ((t % P) + P) % P
    return tau < o.tc ? A * Math.sin((Math.PI * tau) / o.tc) - G : -G
  }
  // 本当の沈み込み：着地の速さ（空中の半分の時間の自由落下）から、細かく積分して、着地からいちばん低いところまで
  const v0 = (G * (P - o.tc)) / 2
  const dt = 1e-5
  let v = -v0
  let h = 0
  let low = 0
  for (let tau = 0; tau < o.tc; tau += dt) {
    v += net(tau) * dt
    h += v * dt
    low = Math.min(low, h)
  }
  return { net, sinkCm: -low * 100, P }
}

// スマホの値にする：毎秒約60回（時刻は少しばらつく）、向きは傾けて付けた形。bias：上下の加速度の一定のずれ（m/s²）、trend：窓の間に増えるずれ（m/s²）
function phoneOf(net: (t: number) => number, o: { sec?: number; bias?: number; trend?: number; tilt?: number } = {}): PhoneMeasure[] {
  const sec = o.sec ?? 4
  const tilt = ((o.tilt ?? 25) * Math.PI) / 180
  const up: [number, number, number] = [Math.sin(tilt), Math.cos(tilt) * Math.cos(0.4), Math.cos(tilt) * Math.sin(0.4)]
  const ms: PhoneMeasure[] = []
  let k = 0
  for (let t = 0.013; t < sec; k++, t = k / 60 + 0.002 * Math.sin(k * 1.7)) {
    const a = net(t) + G + (o.bias ?? 0) + ((o.trend ?? 0) * t) / sec
    ms.push({ t, ax: a * up[0], ay: a * up[1], az: a * up[2] })
  }
  return ms
}

describe('腰の沈み込み（sink.ts）', () => {
  it('1区切りの積分は、始めと終わりの高さがそろう', () => {
    const a = Array.from({ length: 20 }, (_, i) => Math.sin((2 * Math.PI * i) / 20) + 0.5)
    const h = stepHeight(a, 50)
    expect(Math.abs(h[h.length - 1])).toBeLessThan(1e-9)
  })

  it('模擬の走りで、本当の沈み込みに近い値を出す', () => {
    for (const o of [
      { spm: 170, tc: 0.25 },
      { spm: 170, tc: 0.28 },
      { spm: 160, tc: 0.24 },
      { spm: 180, tc: 0.22 },
    ]) {
      const r = springRun(o)
      const e = hipSink(phoneOf(r.net))
      expect(e).not.toBeNull()
      // 着地を「床を押す力が山の1割を超えたところ」で取るので、本当の着地より少し遅く、少し小さく出る
      expect(e!.sinkCm).toBeGreaterThan(r.sinkCm * 0.8)
      expect(e!.sinkCm).toBeLessThan(r.sinkCm * 1.05)
      // 着地から離地までの時間も、接地時間に近い
      expect(Math.abs(e!.contactMs - o.tc * 1000)).toBeLessThan(30)
    }
  })

  it('沈み込みの大きい走りを大きく、小さい走りを小さく出す', () => {
    const small = springRun({ spm: 185, tc: 0.2 })
    const large = springRun({ spm: 150, tc: 0.3 })
    expect(large.sinkCm).toBeGreaterThan(small.sinkCm * 1.3)
    const s = hipSink(phoneOf(small.net))!
    const l = hipSink(phoneOf(large.net))!
    expect(l.sinkCm).toBeGreaterThan(s.sinkCm * 1.3)
  })

  it('上下の加速度の一定のずれ・ゆっくりしたずれがあっても、値がほとんど変わらない（1歩ずつ積分するので、長い積分のずれがたまらない）', () => {
    const r = springRun({ spm: 170, tc: 0.25 })
    const clean = hipSink(phoneOf(r.net))!.sinkCm
    const drift = hipSink(phoneOf(r.net, { bias: 0.4, trend: 0.6 }))!.sinkCm
    expect(Math.abs(drift - clean)).toBeLessThan(0.15)
    // 長い窓（6秒、センサーランの腰の iPhone）でも同じ
    const long = hipSink(phoneOf(r.net, { sec: 6, bias: -0.3, trend: 0.8 }))!.sinkCm
    expect(Math.abs(long - clean)).toBeLessThan(0.15)
  })

  it('じっと立っている・値が短いときは出さない', () => {
    const still = phoneOf(() => 0)
    expect(hipSink(still)).toBeNull()
    const r = springRun({ spm: 170, tc: 0.25 })
    expect(hipSink(phoneOf(r.net, { sec: 1.5 }))).toBeNull()
  })

  it('接地の山が区切りの端まで続く（着地が分からない）歩は使わない', () => {
    // 区切り（コマ 10〜29）の始めから山まで、ずっと線より上：着地が見つからない
    const vert = Array.from({ length: 60 }, (_, i) => (i < 10 ? 0 : i <= 20 ? 5 + (i === 20 ? 5 : 0) : i < 30 ? 10 - (i - 20) * 1.2 : 0))
    expect(stepSinks(vert, [0, 20, 40, 60], 50)).toEqual([])
  })

  it('身長比は、身長が分かるときだけ', () => {
    expect(sinkPct(5.1, 170)).toBeCloseTo(3, 5)
    expect(sinkPct(5.1, null)).toBeNull()
    expect(sinkPct(null, 170)).toBeNull()
  })
})
