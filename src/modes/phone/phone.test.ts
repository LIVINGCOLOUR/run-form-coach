import { describe, expect, it } from 'vitest'
import { CueEngine } from '../../core/engine'
import { PhoneAnalyzer, PHONE_CUE } from './analyzer'
import { estimate, isRunning, uprightFrom, type PhoneMeasure, type Vec3 } from './signal'
import { cadenceIn, simulateRun, simulateRunWithSteps, simulateStanding } from './simulate'
import { RUNNING } from '../../core/params'

// 模擬データに入れた正解と、測った値の差を確かめる
// 許す差（模擬データで計算が正しいかを見る線。実際の走りでの精度は、トレッドミルでカメラ版と比べて確かめる）
//   cadence：4秒の窓の中の実際の歩から出した正解と 2 歩/分（1歩ごとの周期が 2% ばらつくとき）、
//     ばらつかなければ 1 歩/分（着地の衝撃の山が、毎秒60回の測り方では毎歩違う形で拾われるため）。
//     1秒ごとの値を1分ならせば、その1分の実際の歩と 0.3 歩/分
//   bounceCm：0.6 cm（1歩ごとの周期がばらつくと、1歩ごとの上下動も少し変わる）
const TOL = { cadence: 2, cadenceSteady: 1, cadenceMinute: 0.3, bounceCm: 0.6, brakingMs: 0.05, lean: 1 }

// スマホの付け方（体に対する x・y・z 回りの回転、度）。ベルトの中で横向き・逆さ・斜めなど
const ORIENTATIONS: Vec3[] = [
  [0, 0, 0],
  [90, 0, 0],
  [-90, 0, 180],
  [30, -50, 120],
  [10, 80, 200],
  [180, 20, -60],
]

// 実際の走りに近づけた乱れ：加速度の雑音、1歩ごとの周期のばらつき、骨盤の傾き・ねじれ、着地の衝撃
const REAL = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20 }

describe('スマホ：ピッチ・上下動・ブレーキ（腰）', () => {
  it('付け方によらず、入れた値を測れる', () => {
    let seed = 10
    for (const o of ORIENTATIONS)
      for (const cadence of [150, 165, 180, 195])
        for (const bounceCm of [6, 8, 10])
          for (const brakingMs of [0.2, 0.4]) {
            if (cadence >= 180 && bounceCm >= 10) continue // このピッチでは作れない上下動（空中が長すぎる）
            const { ms, steps } = simulateRunWithSteps({ cadence, bounceCm, brakingMs, seconds: 4, orientation: o, seed: seed++, ...REAL })
            const e = estimate(ms, 'waist')
            expect(e).not.toBeNull()
            expect(Math.abs(e!.cadence - cadenceIn(steps, 0, 4))).toBeLessThan(TOL.cadence)
            expect(Math.abs(e!.bounceCm - bounceCm)).toBeLessThan(TOL.bounceCm)
            expect(Math.abs(e!.brakingMs - brakingMs)).toBeLessThan(TOL.brakingMs)
            expect(e!.lean).toBeUndefined() // 腰では前傾を出さない
          }
  })

  it('1歩ごとの周期がそろっていれば、ピッチは 1 歩/分以内', () => {
    for (let cadence = 140; cadence <= 210; cadence += 7) {
      const ms = simulateRun({ cadence, bounceCm: 7, brakingMs: 0.3, seconds: 4, orientation: [180, 20, -60], seed: cadence, ...REAL, jitter: 0 })
      expect(Math.abs(estimate(ms, 'waist')!.cadence - cadence)).toBeLessThan(TOL.cadenceSteady)
    }
  })

  it('1秒ごとの値を1分ならせば、入れたピッチに合う', () => {
    const analyzer = new PhoneAnalyzer('waist')
    const got: number[] = []
    const { ms, steps } = simulateRunWithSteps({ cadence: 168, bounceCm: 8, brakingMs: 0.3, seconds: 64, orientation: [90, 0, 0], seed: 3, ...REAL })
    for (const m of ms) {
      analyzer.feed(m)
      if (m.t >= 4 && Math.abs(m.t - Math.round(m.t)) < 0.009 && analyzer.last) got.push(analyzer.last.cadence)
    }
    expect(got.length).toBeGreaterThan(50)
    expect(Math.abs(got.reduce((a, b) => a + b, 0) / got.length - cadenceIn(steps, 0, 64))).toBeLessThan(TOL.cadenceMinute)
  })

  it('センサーの回数が違っても測れる', () => {
    for (const fs of [30, 50, 100]) {
      const { ms, steps } = simulateRunWithSteps({ cadence: 172, bounceCm: 8, brakingMs: 0.3, seconds: 4, fs, orientation: [30, -50, 120], seed: fs, ...REAL })
      const e = estimate(ms, 'waist')!
      expect(Math.abs(e.cadence - cadenceIn(steps, 0, 4))).toBeLessThan(TOL.cadence)
      expect(Math.abs(e.bounceCm - 8)).toBeLessThan(TOL.bounceCm)
      expect(Math.abs(e.brakingMs - 0.3)).toBeLessThan(TOL.brakingMs)
    }
  })

  it('前向きは、進む向き（水平）を指す', () => {
    // 付け方が [0,0,0] で前傾なしなら、スマホの座標＝体の座標（x 前・z 上）
    const ms = simulateRun({ cadence: 175, bounceCm: 8, brakingMs: 0.3, seconds: 4, seed: 5, ...REAL })
    const e = estimate(ms, 'waist')!
    expect(e.forward[0]).toBeGreaterThan(0.98)
    expect(e.up[2]).toBeGreaterThan(0.98)
  })

  it('走っているか：走りは true、立って止まっているときは false', () => {
    const run = simulateRun({ cadence: 165, bounceCm: 8, brakingMs: 0.3, seconds: 4, seed: 7, ...REAL })
    expect(isRunning(estimate(run, 'waist'), RUNNING.runSpm)).toBe(true)
    const stand = simulateStanding({ seconds: 4, noise: 0.05, orientation: [30, -50, 120] })
    expect(isRunning(estimate(stand, 'waist'), RUNNING.runSpm)).toBe(false)
  })

  it('値が短すぎるときは出さない', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 1.5, seed: 8 })
    expect(estimate(ms, 'waist')).toBeNull()
  })
})

describe('スマホ：上体の前傾（ベスト・胸）', () => {
  it('立ったときの向きを基準に、入れた前傾を測れる', () => {
    let seed = 100
    for (const placement of ['vest', 'chest'] as const)
      for (const o of ORIENTATIONS)
        for (const lean of [-3, 0, 5, 10, 15]) {
          const upright = uprightFrom(simulateStanding({ seconds: 3, noise: 0.05, orientation: o, seed: seed++ }))!
          expect(upright).not.toBeNull()
          const ms = simulateRun({ cadence: 175, bounceCm: 8, brakingMs: 0.3, leanDeg: lean, seconds: 4, orientation: o, seed: seed++, ...REAL })
          const e = estimate(ms, placement, upright)!
          expect(Math.abs(e.lean! - lean)).toBeLessThan(TOL.lean)
        }
  })

  it('動いている間は、前傾の基準を取らない', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 3, seed: 9 })
    expect(uprightFrom(ms)).toBeNull()
  })
})

// 走り（秒ごとに区切った区間をつなぐ）。t は続けて数える
function run(parts: { seconds: number; cadence: number; bounceCm?: number; brakingMs?: number; leanDeg?: number }[], o: Vec3, seed = 1): PhoneMeasure[] {
  const out: PhoneMeasure[] = []
  let t0 = 0
  for (const p of parts) {
    out.push(...simulateRun({ bounceCm: 8, brakingMs: 0.3, ...p, orientation: o, seed: seed++, t0, ...REAL }))
    t0 += p.seconds
  }
  return out
}

function drive(analyzer: PhoneAnalyzer, ms: PhoneMeasure[]) {
  const coach = new CueEngine(analyzer, { pause: true })
  const said: { t: number; text: string }[] = []
  for (const m of ms) {
    analyzer.feed(m)
    for (const ev of coach.update({ t: m.t, present: true, moving: analyzer.moving, m })) if (ev.type === 'speak') said.push({ t: m.t, text: ev.text })
  }
  return { coach, said }
}

describe('スマホ：声かけのしくみにつなぐ', () => {
  it('走り始めを基準にし、ピッチが落ちたら声をかける', () => {
    const o: Vec3 = [90, 0, 0]
    const analyzer = new PhoneAnalyzer('waist')
    const { coach, said } = drive(analyzer, run([{ seconds: 210, cadence: 172 }, { seconds: 50, cadence: 158 }], o))
    expect(coach.state).toBe('running')
    expect(analyzer.ref!.cadence).toBeCloseTo(172, 0)
    const cues = said.filter((s) => Object.values(PHONE_CUE).includes(s.text))
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0].text).toBe(PHONE_CUE.cadence)
    expect(cues[0].t).toBeGreaterThan(210) // 落ちる前には声をかけない
    expect(coach.samples.length).toBeGreaterThan(200)
  })

  it('ベストでは、上体が前に倒れてきたら声をかける', () => {
    const o: Vec3 = [30, -50, 120]
    const upright = uprightFrom(simulateStanding({ seconds: 3, noise: 0.05, orientation: o }))!
    const analyzer = new PhoneAnalyzer('vest', upright)
    expect(analyzer.items.map((s) => s.key)).toEqual(['lean', 'cadence', 'braking', 'bounce'])
    const { said } = drive(analyzer, run([{ seconds: 210, cadence: 172, leanDeg: 6 }, { seconds: 50, cadence: 172, leanDeg: 14 }], o))
    expect(analyzer.ref!.lean).toBeCloseTo(6, 0)
    const cues = said.filter((s) => Object.values(PHONE_CUE).includes(s.text))
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0].text).toBe(PHONE_CUE.lean)
    expect(cues[0].t).toBeGreaterThan(210)
  })

  it('腰では前傾の項目を持たない。崩れなければ声をかけない', () => {
    const analyzer = new PhoneAnalyzer('waist')
    expect(analyzer.items.map((s) => s.key)).toEqual(['cadence', 'braking', 'bounce'])
    const { said } = drive(analyzer, run([{ seconds: 260, cadence: 170 }], [10, 80, 200]))
    expect(said.filter((s) => Object.values(PHONE_CUE).includes(s.text))).toEqual([])
  })
})
