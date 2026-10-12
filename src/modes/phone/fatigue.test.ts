import { describe, expect, it } from 'vitest'
import { fatigueOf, type FatigueSec } from './fatigue'
import { FATIGUE } from './params'
import { PhoneRun } from './session'
import { estimate, type PhoneMeasure, type Vec3 } from './signal'
import { simulateRun, simulateStanding, type RunSpec } from './simulate'

// 疲れの見分け（fatigue.ts）と、ブレーキの向きの直し（signal.ts の levelled）を、模擬データで確かめる

const REAL = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20 }
const O: Vec3 = [90, 0, 0]

describe('スマホ：ブレーキの向きをジャイロで直す', () => {
  // 骨盤が1歩ごとに前後に5°傾く走り。位相（傾きが接地のどこで山になるか）を振って、入れたブレーキ 0.3 m/s と比べる
  // 模擬データでの値（6通りの乱数の平均）：向きを固定すると 0.23〜0.39、ジャイロで直すと 0.31〜0.32
  it('骨盤が前後に傾いても、ジャイロで直せば入れた値に近い', () => {
    for (const pitchPhase of [0, 90, 180, 270]) {
      const fixed: number[] = []
      const gyro: number[] = []
      for (let seed = 1; seed <= 4; seed++) {
        const e = estimate(simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: [30, -50, 120], seed, ...REAL, pitchDeg: 5, pitchPhase }))!
        expect(e.gyroLevel).toBe(true)
        fixed.push(e.brakingFixed)
        gyro.push(e.brakingMs)
      }
      const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      expect(Math.abs(m(gyro) - 0.3)).toBeLessThan(0.03)
      expect(Math.abs(m(gyro) - 0.3)).toBeLessThan(Math.abs(m(fixed) - 0.3))
    }
  })

  it('骨盤の傾きの揺れが変わっても、ジャイロで直した値は動かない（固定した向きでは動く）', () => {
    const at = (pitchDeg: number) => estimate(simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: O, seed: 3, ...REAL, pitchDeg, pitchPhase: 90 }))!
    const [a, b] = [at(2), at(6)]
    expect(Math.abs(b.brakingFixed - a.brakingFixed)).toBeGreaterThan(0.04)
    expect(Math.abs(b.brakingMs - a.brakingMs)).toBeLessThan(0.02)
  })

  it('ジャイロのずれ（バイアス）があっても、直した値はほとんど変わらない', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: [30, -50, 120], seed: 3, ...REAL, pitchDeg: 5, pitchPhase: 90 })
    const a = estimate(ms)!
    const b = estimate(ms.map((m) => ({ ...m, gx: m.gx! + 0.05, gy: m.gy! - 0.05, gz: m.gz! + 0.05 })))!
    expect(Math.abs(a.brakingMs - b.brakingMs)).toBeLessThan(0.01)
  })

  it('ジャイロがない端末では、今の方法（向きを固定）のまま', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: O, seed: 3, ...REAL, pitchDeg: 5 })
    const e = estimate(ms.map(({ t, ax, ay, az }) => ({ t, ax, ay, az })))!
    expect(e.gyroLevel).toBe(false)
    expect(e.brakingMs).toBe(e.brakingFixed)
  })
})

describe('スマホ：疲れの材料', () => {
  it('1歩ごとの動きがそろわなくなると、規則性が下がり、左右の揺れの割合が増える', () => {
    const avg = (spec: Partial<RunSpec>) => {
      const es = [1, 2, 3, 4, 5, 6].map((seed) => estimate(simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: O, seed, ...REAL, ...spec }))!)
      const m = (f: (e: (typeof es)[number]) => number) => es.reduce((a, e) => a + f(e), 0) / es.length
      return { reg: m((e) => e.regularity), ap: m((e) => e.apRegularity), ml: m((e) => e.ratioML), sum: m((e) => e.ratioV ** 2 + e.ratioAP ** 2 + e.ratioML ** 2) }
    }
    const fresh = avg({})
    const tired = avg({ jitter: 0.06, vary: 0.15, sway: 2.5 })
    expect(tired.reg).toBeLessThan(fresh.reg)
    expect(tired.ap).toBeLessThan(fresh.ap)
    expect(tired.ml).toBeGreaterThan(fresh.ml)
    expect(fresh.sum).toBeCloseTo(1, 6)
  })

  it('有効接地時間は、接地が長い走り（上下動が小さい）ほど長い', () => {
    const at = (bounceCm: number) => estimate(simulateRun({ cadence: 170, bounceCm, brakingMs: 0.3, seconds: 4, orientation: O, seed: 2, ...REAL }))!.contactMs
    expect(at(6)).toBeGreaterThan(at(9))
  })
})

// 立って5秒 → 走る。minute 分目から、1分ごとに少しずつ疲れる（1歩ごとの周期と力のばらつき、左右の揺れが増える）
function run(minutes: number, tiredFrom: number | null): PhoneMeasure[] {
  const out: PhoneMeasure[] = [...simulateStanding({ seconds: 5, orientation: O, noise: 0.05 })]
  for (let k = 0; k < minutes; k++) {
    const x = tiredFrom === null || k < tiredFrom ? 0 : Math.min(1, (k - tiredFrom + 1) / 3)
    out.push(...simulateRun({ ...REAL, cadence: 170, bounceCm: 8, brakingMs: 0.3, orientation: O, pitchDeg: 3, seconds: 60, seed: 100 + k, t0: 5 + 60 * k, jitter: 0.02 + 0.04 * x, vary: 0.15 * x, sway: 1.5 + x }))
  }
  return out
}

function finish(data: PhoneMeasure[]) {
  const r = new PhoneRun({ perfMs: 0, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 }, 'treadmill')
  for (const m of data) r.feed(m)
  return r.finish()
}

describe('スマホ：疲れの見分け（走った後）', () => {
  it('疲れて規則性が落ちる走りでは、崩れ始めが見つかり、記録の書き出しにも残る', { timeout: 120000 }, () => {
    const { session, log } = finish(run(10, 5))
    const f = session!.fatigue!
    expect(f.base).toBe('early') // 12分より短いので、30秒〜3分を基準にする
    expect(f.onsetSec).not.toBeNull()
    // 疲れを入れたのは走り始めて約5分から。度合いが線を超えるのは、その少し後
    expect(f.onsetSec!).toBeGreaterThanOrEqual(4 * 60)
    expect(f.onsetSec!).toBeLessThanOrEqual(7 * 60)
    expect(session!.breakdownMin).toBe(Math.round(f.onsetSec! / 60))
    expect(log.fatigue).toEqual(f)
    expect(log.secondColumns).toContain('contactMs')
    // 1秒ごとの記録に、疲れの材料が入る
    expect(log.seconds.some((r) => r[log.secondColumns.indexOf('apRegularity')] !== null)).toBe(true)
  })

  it('12分より長い走りでは 5〜12分を基準にして、その後の崩れ始めを見つける', { timeout: 120000 }, () => {
    const f = finish(run(20, 14)).session!.fatigue!
    expect(f.base).toBe('later')
    expect(f.onsetSec!).toBeGreaterThanOrEqual(13 * 60)
    expect(f.onsetSec!).toBeLessThanOrEqual(16 * 60)
  })

  it('ふつうの走りでは、崩れ始めは見つからない', { timeout: 120000 }, () => {
    for (const minutes of [10, 20]) {
      const { session } = finish(run(minutes, null))
      const f = session!.fatigue!
      expect(f.onsetSec).toBeNull()
      expect(session!.breakdownMin).toBeUndefined()
      for (const b of f.blocks) if (b.t >= f.baseTo && b.score !== null) expect(b.score).toBeLessThan(FATIGUE.line)
    }
  })
})

describe('スマホ：疲れの見分けのまとめ方', () => {
  // 1秒ごとの記録を直接作る（12分を超える走りで、5〜12分を基準にする道と、使わない秒を確かめる）
  const sec = (t: number, reg: number, extra: Partial<FatigueSec> = {}): FatigueSec => ({
    t, bounceCm: 8, brakingMs: 0.3, mount: null, gate: null,
    fat: { regularity: reg + 0.01 * Math.sin(t), apRegularity: reg + 0.01 * Math.cos(t), ratioV: 0.95, ratioAP: 0.25, ratioML: 0.19, contactMs: 170 + 3 * Math.sin(t / 3) },
    ...extra,
  })

  it('12分より長く走れば 5〜12分を基準にし、崩れが続いた区間の始まりを崩れ始めにする', () => {
    const ss = Array.from({ length: 1500 }, (_, t) => sec(t, t >= 1200 ? 0.8 : 0.92))
    const f = fatigueOf(ss)!
    expect(f.base).toBe('later')
    expect(f.onsetSec).toBe(1200)
  })

  it('線を超えても FATIGUE.runs 区間続かなければ、崩れ始めにしない', () => {
    const ss = Array.from({ length: 1500 }, (_, t) => sec(t, t >= 900 && t < 900 + FATIGUE.block * (FATIGUE.runs - 1) ? 0.8 : 0.92))
    expect(fatigueOf(ss)!.onsetSec).toBeNull()
  })

  it('速さで判定を止めた秒・付け方の問題が見つかった後の秒は使わない', () => {
    const gated = Array.from({ length: 1500 }, (_, t) => sec(t, t >= 1200 ? 0.8 : 0.92, t >= 1200 ? { gate: 'slow' } : {}))
    expect(fatigueOf(gated)!.onsetSec).toBeNull()
    const loose = Array.from({ length: 1500 }, (_, t) => sec(t, t >= 1200 ? 0.8 : 0.92, t >= 1200 ? { mount: 'loose' } : {}))
    expect(fatigueOf(loose)!.onsetSec).toBeNull()
  })

  it('上下動・ブレーキ・有効接地時間は、基準からの変化として出す', () => {
    const ss = Array.from({ length: 1500 }, (_, t) => sec(t, 0.92, t >= 1200 ? { bounceCm: 9, brakingMs: 0.33 } : {}))
    const f = fatigueOf(ss)!
    const b = f.blocks.find((x) => x.t === 1260)!
    expect(b.dBounceCm).toBeCloseTo(1, 6)
    expect(b.dBrakingPct).toBeCloseTo(10, 6)
    expect(Math.abs(b.dContactMs!)).toBeLessThan(3)
  })

  it('基準の区間を測れていなければ、出さない', () => {
    expect(fatigueOf(Array.from({ length: 100 }, (_, t) => sec(t, 0.92)))).toBeNull()
  })
})
