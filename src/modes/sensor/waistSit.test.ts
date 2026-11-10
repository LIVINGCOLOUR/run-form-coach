import { describe, expect, it } from 'vitest'
import type { PhoneMeasure } from '../phone/signal'
import { WAIST_SIT } from './params'
import { G0, waistGait, WaistSit, type WaistGait } from './waistSit'
import { WaistPhone, WAIST_RAW_COLUMNS } from './waist'
import type { MotionLike } from '../phone/sensor'

// 作りものの走り：1歩ごとに、接地の間（tc 秒）だけ上下の加速度が半分のサインの山になり、浮いている間は 0（重力を含む加速度。落ちている間は 0）。
// 1歩の平均が 1g になるように山の高さを決める（A = g·π·T ÷ (2·tc)）。接地が長いほど山は低く、1g を上回る時間は長くなる（腰を落とした走りの形）
function run(sec: number, o: { cad?: number; tcFrac?: number; t0?: number; fs?: number } = {}): PhoneMeasure[] {
  const cad = o.cad ?? 170
  const T = 60 / cad
  const tc = T * (o.tcFrac ?? 0.6)
  const A = (G0 * Math.PI * T) / (2 * tc)
  const fs = o.fs ?? 60
  const t0 = o.t0 ?? 0
  const out: PhoneMeasure[] = []
  for (let i = 0; i < sec * fs; i++) {
    const t = t0 + i / fs
    const ph = t % T
    const v = ph < tc ? A * Math.sin((Math.PI * ph) / tc) : 0
    // スマホは少し傾いてポーチに入っている（上向きが z から 10° 前へ）
    const k = (10 * Math.PI) / 180
    out.push({ t, ax: v * Math.sin(k), ay: 0.3 * Math.sin((2 * Math.PI * t) / (2 * T)), az: v * Math.cos(k), gx: 0.1, gy: 0, gz: 0 })
  }
  return out
}

describe('腰落ちの値（waistGait）', () => {
  it('接地が長い（腰を落とした形）と、接地の割合が増えて上下の加速度の山が下がる。弾む形はその逆', () => {
    const base = waistGait(run(6))!
    const sit = waistGait(run(6, { tcFrac: 0.7 }))!
    const bouncy = waistGait(run(6, { tcFrac: 0.5 }))!
    expect(base.cad).toBeCloseTo(170, -1)
    expect(sit.duty).toBeGreaterThan(base.duty * 1.08)
    expect(sit.peakG).toBeLessThan(base.peakG * 0.92)
    expect(bouncy.duty).toBeLessThan(base.duty)
    expect(bouncy.peakG).toBeGreaterThan(base.peakG * 1.1)
    // 接地の割合 ＝ 有効接地時間 ÷ 1歩の時間
    expect(base.duty).toBeCloseTo(base.contactMs / 1000 / (60 / base.cad), 6)
  })

  it('走る動きでなければ（止まっている）出さない', () => {
    const still: PhoneMeasure[] = Array.from({ length: 360 }, (_, i) => ({ t: i / 60, ax: 0, ay: 0, az: 9.8 }))
    expect(waistGait(still)).toBeNull()
  })
})

// WaistSit は1秒ごとの値（WaistGait）から決める。ここでは値そのものを作って渡す（速い）
describe('腰落ちの見分け（WaistSit。記録だけ）', () => {
  // 決まった揺れ（擬似乱数）：ふつうの走りの duty・山は、それぞれ約 3%・4% ばらつく
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const gait = (dutyMul = 1, peakMul = 1): WaistGait => ({ cad: 170, bounceCm: 7, contactMs: 155, duty: 0.44 * dutyMul * (1 + 0.05 * rnd()), peakG: 3.0 * peakMul * (1 + 0.06 * rnd()) })
  const make = () => {
    seed = 1
    const events: [number, string][] = []
    const w = new WaistSit((t, x) => events.push([t, x]))
    let t = 0
    const feed = (sec: number, f: () => WaistGait | null, o: { chest?: boolean; v?: number | null; running?: boolean } = {}) => {
      const out = []
      for (let i = 0; i < sec; i++) out.push(w.second(++t, f(), o.running ?? true, !!o.chest, o.v === undefined ? 8 : o.v))
      return out
    }
    return { w, events, feed, names: () => events.map((e) => e[1].split(' ')[0]) }
  }
  const sitLike = () => gait(1.11, 0.87) // 11-09 の腰落ち（接地の割合 +11%、山 −13%）くらい
  const bouncy = () => gait(0.97, 1.25) // 弾む（山 +25%）

  it('走り出し warm 秒から span 秒で仮の基準を作るまでは判定しない', () => {
    const { feed, events } = make()
    const xs = feed(WAIST_SIT.warm + WAIST_SIT.span - 1, () => gait())
    expect(xs.every((x) => x.skip === 'noRef')).toBe(true)
    feed(1, () => gait())
    expect(events[0][1]).toMatch(/^waist:ref warm duty 0\.4\d+ peak 3\.\d+ v 8\.0 n 60 fixedSd$/)
  })

  it('腰落ちの形が続くと waist:sit、戻ると waist:sitOk。弾む形では出ない', () => {
    const { feed, names, events } = make()
    feed(240, () => gait())
    const b = feed(30, bouncy)
    expect(Math.max(...b.map((x) => x.index!))).toBeLessThan(0)
    feed(30, () => gait())
    expect(names()).toEqual(['waist:ref'])
    const s = feed(20, sitLike)
    expect(names()).toEqual(['waist:ref', 'waist:sit'])
    // 窓6秒の値が、続けて (hold − window + 1) 秒決まりを満たしたら
    const at = events[1][0]
    const first = s.findIndex((x) => x.sit === 1)
    expect(at - 300).toBeGreaterThanOrEqual(first + 1 + WAIST_SIT.hold - WAIST_SIT.window)
    expect(events[1][1]).toMatch(/^waist:sit \d+\.\d -\d+\.\d \d\.\d\d$/)
    feed(10, () => gait())
    expect(names()).toEqual(['waist:ref', 'waist:sit', 'waist:sitOk'])
  })

  it('ふつうの走りのゆれだけでは、長く走っても出ない（settle で基準を置き換える）', () => {
    const { feed, names, w } = make()
    feed(1200, () => gait())
    expect(names()).toEqual(['waist:ref', 'waist:ref'])
    expect(w.ref!.by).toBe('settle')
    expect(w.ref!.fixedSd).toBe(false)
  })

  it('6〜10分に腰落ちの区間があっても、決まりの下の秒だけで基準を作る', () => {
    const { feed, w } = make()
    feed(400, () => gait())
    feed(30, sitLike)
    feed(40, () => gait())
    feed(30, sitLike)
    feed(120, () => gait())
    expect(w.ref!.by).toBe('settle')
    expect(w.ref!.duty).toBeLessThan(0.44 * 1.02)
  })

  it('胸が猫背の線を越えている秒は判定しない（数え直さず持ち越す）。続けて chestGap 秒より長ければ数え直す', () => {
    const { feed, names } = make()
    feed(240, () => gait())
    // 1秒おきに胸が越える：決まりの秒は数え続けて、出る
    for (let i = 0; i < 12; i++) feed(1, sitLike, { chest: i % 2 === 1 })
    expect(names()).toContain('waist:sit')
    const b = make()
    b.feed(240, () => gait())
    // 胸が越えたままなら出ない
    const xs = b.feed(20, sitLike, { chest: true })
    expect(xs.every((x) => x.skip === 'chest')).toBe(true)
    expect(b.names()).not.toContain('waist:sit')
  })

  it('速さが基準から speedTol より違えば判定しない。その速さが続けば、その速さの基準を作る', () => {
    const { feed, names, w } = make()
    feed(240, () => gait())
    const xs = feed(WAIST_SIT.speedWarm + WAIST_SIT.speedSpan + 1, () => gait(0.95, 1.1), { v: 10 })
    expect(xs[0].skip).toBe('speed')
    expect(names()).toEqual(['waist:ref', 'waist:ref'])
    expect(w.ref!.by).toBe('speed')
    expect(w.ref!.v).toBeCloseTo(10, 1)
    // 元の速さに戻れば、元の基準
    const back = feed(1, () => gait(), { v: 8 })
    expect(back[0].skip).toBe('judged')
    expect(w.ref!.v).toBeCloseTo(8, 1)
  })

  it('走っていない秒は数えない', () => {
    const { feed } = make()
    const xs = feed(5, () => gait(), { running: false })
    expect(xs.every((x) => x.skip === 'notRunning')).toBe(true)
  })
})

describe('腰のスマホ（WaistPhone）の腰落ちと生の値', () => {
  it('角速度も受け取り（deg/s → rad/s）、1秒ごとに腰落ちの値を出し、生の値を WAIST_RAW_COLUMNS の行で渡す', () => {
    let emit: (e: MotionLike) => void = () => {}
    let now = 0
    const events: string[] = []
    const w = new WaistPhone((_t, x) => events.push(x), (cb) => ((emit = cb), () => {}), () => now)
    const ms = run(8)
    for (const m of ms) {
      now = m.t
      emit({ accelerationIncludingGravity: { x: m.ax, y: m.ay, z: m.az }, rotationRate: { alpha: 0, beta: 90, gamma: 0 } })
    }
    const s = w.second(now, { running: true, chestOver: false, v: 8 })
    expect(s.gait!.cad).toBeCloseTo(170, -1)
    expect(s.sit!.skip).toBe('noRef')
    const raw = w.takeRaw()
    expect(raw).toHaveLength(ms.length)
    expect(raw[0]).toHaveLength(WAIST_RAW_COLUMNS.length)
    expect(raw[0][4]).toBeCloseTo(Math.PI / 2, 3) // beta 90 deg/s → gx 1.5708 rad/s
    expect(w.takeRaw()).toHaveLength(0)
    // ctx を渡さなければ、前と同じ（向きだけ）
    expect(w.second(now).gait).toBeNull()
  })
})
