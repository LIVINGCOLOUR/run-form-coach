import { describe, expect, it } from 'vitest'
import { CueEngine } from '../../core/engine'
import { PhoneAnalyzer, PHONE_CUE, PHONE_SAY } from './analyzer'
import { mountFeatures, mountVerdict } from './mount'
import { estimate, isRunning, type PhoneMeasure, type Vec3 } from './signal'
import { cadenceIn, simulateRun, simulateRunWithSteps, simulateStanding, type MountSim, type RunSpec } from './simulate'
import { HIP_REF, RUNNING } from '../../core/params'
import { PHRASES, phraseId } from '../../core/phrases'

// 模擬データに入れた正解と、測った値の差を確かめる
// 許す差（模擬データで計算が正しいかを見る線。実際の走りでの精度は、トレッドミルでカメラ版と比べて確かめる）
//   cadence：4秒の窓の中の実際の歩から出した正解と 2 歩/分（1歩ごとの周期が 2% ばらつくとき）、
//     ばらつかなければ 1 歩/分（着地の衝撃の山が、毎秒60回の測り方では毎歩違う形で拾われるため）。
//     1秒ごとの値を1分ならせば、その1分の実際の歩と 0.3 歩/分
//   bounceCm：0.6 cm（1歩ごとの周期がばらつくと、1歩ごとの上下動も少し変わる）
const TOL = { cadence: 2, cadenceSteady: 1, cadenceMinute: 0.3, bounceCm: 0.6, brakingMs: 0.05 }

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
            const e = estimate(ms)
            expect(e).not.toBeNull()
            expect(Math.abs(e!.cadence - cadenceIn(steps, 0, 4))).toBeLessThan(TOL.cadence)
            expect(Math.abs(e!.bounceCm - bounceCm)).toBeLessThan(TOL.bounceCm)
            expect(Math.abs(e!.brakingMs - brakingMs)).toBeLessThan(TOL.brakingMs)
          }
  })

  it('1歩ごとの周期がそろっていれば、ピッチは 1 歩/分以内', () => {
    for (let cadence = 140; cadence <= 210; cadence += 7) {
      const ms = simulateRun({ cadence, bounceCm: 7, brakingMs: 0.3, seconds: 4, orientation: [180, 20, -60], seed: cadence, ...REAL, jitter: 0 })
      expect(Math.abs(estimate(ms)!.cadence - cadence)).toBeLessThan(TOL.cadenceSteady)
    }
  })

  it('1秒ごとの値を1分ならせば、入れたピッチに合う', () => {
    const analyzer = new PhoneAnalyzer()
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
      const e = estimate(ms)!
      expect(Math.abs(e.cadence - cadenceIn(steps, 0, 4))).toBeLessThan(TOL.cadence)
      expect(Math.abs(e.bounceCm - 8)).toBeLessThan(TOL.bounceCm)
      expect(Math.abs(e.brakingMs - 0.3)).toBeLessThan(TOL.brakingMs)
    }
  })

  it('前向きは、進む向き（水平）を指す', () => {
    // 付け方が [0,0,0] で前傾なしなら、スマホの座標＝体の座標（x 前・z 上）
    const ms = simulateRun({ cadence: 175, bounceCm: 8, brakingMs: 0.3, seconds: 4, seed: 5, ...REAL })
    const e = estimate(ms)!
    expect(e.forward[0]).toBeGreaterThan(0.98)
    expect(e.up[2]).toBeGreaterThan(0.98)
  })

  it('走っているか：走りは true、立って止まっているときは false', () => {
    const run = simulateRun({ cadence: 165, bounceCm: 8, brakingMs: 0.3, seconds: 4, seed: 7, ...REAL })
    expect(isRunning(estimate(run), RUNNING.runSpm)).toBe(true)
    const stand = simulateStanding({ seconds: 4, noise: 0.05, orientation: [30, -50, 120] })
    expect(isRunning(estimate(stand), RUNNING.runSpm)).toBe(false)
  })

  it('値が短すぎるときは出さない', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 1.5, seed: 8 })
    expect(estimate(ms)).toBeNull()
  })
})

// 走り（秒ごとに区切った区間をつなぐ）。t は続けて数える
function run(parts: ({ seconds: number; cadence: number } & Partial<RunSpec>)[], o: Vec3, seed = 1): PhoneMeasure[] {
  const out: PhoneMeasure[] = []
  let t0 = 0
  for (const p of parts) {
    out.push(...simulateRun({ bounceCm: 8, brakingMs: 0.3, ...REAL, ...p, orientation: o, seed: seed++, t0 }))
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
    const analyzer = new PhoneAnalyzer()
    const { coach, said } = drive(analyzer, run([{ seconds: 210, cadence: 172 }, { seconds: 50, cadence: 158 }], o))
    expect(coach.state).toBe('running')
    expect(analyzer.ref!.cadence).toBeCloseTo(172, 0)
    const cues = said.filter((s) => Object.values(PHONE_CUE).includes(s.text))
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0].text).toBe(PHONE_CUE.cadence)
    expect(cues[0].t).toBeGreaterThan(210) // 落ちる前には声をかけない
    expect(coach.samples.length).toBeGreaterThan(200)
  })

  it('崩れなければ声をかけない', () => {
    const analyzer = new PhoneAnalyzer()
    const { said } = drive(analyzer, run([{ seconds: 260, cadence: 170 }], [10, 80, 200]))
    expect(said.filter((s) => Object.values(PHONE_CUE).includes(s.text))).toEqual([])
  })
})

describe('スマホ：判定しない秒と、途切れたとき', () => {
  it('走り始めの基準ができるまでは判定しない（点数は null、良いに数えない）', () => {
    const analyzer = new PhoneAnalyzer()
    const { coach } = drive(analyzer, run([{ seconds: 230, cadence: 170 }], [90, 0, 0]))
    const before = coach.samples.filter((s) => s.t <= HIP_REF.to)
    const after = coach.samples.filter((s) => s.t > HIP_REF.to)
    expect(before.length).toBeGreaterThan(100)
    expect(before.every((s) => s.score === null)).toBe(true)
    expect(after.length).toBeGreaterThan(20)
    expect(after.every((s) => s.score !== null)).toBe(true)
  })

  it('センサーの値が途切れたら、スマホの言葉で知らせ、戻らなければ終わる', () => {
    const analyzer = new PhoneAnalyzer()
    const { coach, said } = drive(analyzer, run([{ seconds: 40, cadence: 170 }], [90, 0, 0]))
    expect(coach.state).toBe('running')
    // 値が来ないまま、タイマーで update を呼ぶ
    for (let t = 40; t <= 80; t += 0.1) {
      for (const ev of coach.update({ t, present: analyzer.connected(t), moving: analyzer.moving }))
        if (ev.type === 'speak') said.push({ t, text: ev.text })
    }
    const lost = said.filter((s) => s.text === PHRASES.phoneLost)
    expect(lost.length).toBe(1)
    expect(lost[0].t).toBeGreaterThan(44)
    expect(said.some((s) => s.text === PHRASES.lost)).toBe(false) // カメラの言葉は言わない
    expect(said[said.length - 1].text).toBe(PHRASES.phoneGiveUp)
    expect(coach.state).toBe('ended')
  })

  it('値の間があいていなければ、つながっているとみなす', () => {
    const analyzer = new PhoneAnalyzer()
    expect(analyzer.connected(0)).toBe(false) // まだ1つも来ていない
    analyzer.feed({ t: 10, ax: 0, ay: 0, az: 9.8 })
    expect(analyzer.connected(10.4)).toBe(true)
    expect(analyzer.connected(10.6)).toBe(false)
  })

  it('スマホの言葉はどれも PHRASES にあり、音声がある', () => {
    const voices = Object.keys(import.meta.glob('../../../public/voices/female/*.m4a'))
    for (const text of [...Object.values(PHONE_CUE), ...Object.values(PHONE_SAY)]) {
      const id = phraseId(text!)
      expect(id).toBeDefined()
      expect(voices).toContain(`../../../public/voices/female/${id}.m4a`)
    }
  })
})

// 付け方の確認。線の根拠は模擬データだけ（params.ts の MOUNT）。ここでは、作った模擬データで
// 「腰にしっかり付けた走りでは鳴らない」「腕・手・ポケット・ゆるい・ずれたは見分ける」ことを確かめる
// 腰でも乱れを大きくした走り：雑音・周期のばらつき・骨盤の傾きとねじれ・左右の揺れ・左右の差・着地の衝撃をどれも大きく
const HARD = { noise: 1, jitter: 0.04, rollDeg: 8, yawDeg: 12, sway: 3, asym: 0.1, impact: 40 }
const MOUNT_CASES: { name: string; spec: Partial<RunSpec>; want: 'ok' | 'notWaist' | 'loose' }[] = [
  { name: '腰', spec: REAL, want: 'ok' },
  { name: '腰（乱れ大）', spec: HARD, want: 'ok' },
  { name: '腰（乱れ大・骨盤の前傾15°）', spec: { ...HARD, tiltDeg: 15 }, want: 'ok' },
  { name: '腕', spec: { ...REAL, mount: { kind: 'arm' } }, want: 'notWaist' },
  { name: '腕（振り小）', spec: { ...REAL, mount: { kind: 'arm', swingDeg: 20 } }, want: 'notWaist' },
  { name: '手', spec: { ...REAL, mount: { kind: 'hand' } }, want: 'notWaist' },
  { name: 'ポケット', spec: { ...REAL, mount: { kind: 'pocket' } }, want: 'notWaist' },
  { name: 'ポケット（振り小）', spec: { ...REAL, mount: { kind: 'pocket', swingDeg: 20 } }, want: 'notWaist' },
  { name: 'ゆるい', spec: { ...REAL, mount: { kind: 'loose', tiltDeg: 8, accMs: 3 } }, want: 'loose' },
  { name: '少しゆるい', spec: { ...REAL, mount: { kind: 'loose', tiltDeg: 4, accMs: 1.5 } }, want: 'loose' },
]

const noGyro = (ms: PhoneMeasure[]) => ms.map(({ t, ax, ay, az }) => ({ t, ax, ay, az }))

describe('スマホ：付け方の確認', () => {
  it('1つの窓（4秒）の見立て：腰は ok、腕・手・ポケット・ゆるいを見分ける（付け方6通り × ピッチ3通り）', () => {
    for (const c of MOUNT_CASES) {
      let seed = 1
      for (const o of ORIENTATIONS)
        for (const cadence of [155, 175, 195]) {
          const ms = simulateRun({ cadence, bounceCm: 7, brakingMs: 0.3, seconds: 4, orientation: o, seed: seed++, ...c.spec })
          const e = estimate(ms)
          const x = mountFeatures(ms, e && isRunning(e, RUNNING.runSpm) ? e.cadence / 60 : undefined)
          expect(x, `${c.name} ${cadence}`).not.toBeNull()
          expect(mountVerdict(x!), `${c.name} ${cadence} ${o}`).toBe(c.want)
        }
    }
  })

  it('腰にしっかり付けた走りでは、最後まで鳴らない（坂で骨盤の傾きが変わっても）', () => {
    for (const o of ORIENTATIONS.slice(0, 3))
      for (const spec of [REAL, HARD]) {
        const analyzer = new PhoneAnalyzer()
        const { said } = drive(analyzer, run([{ seconds: 100, cadence: 170, ...spec }, { seconds: 60, cadence: 165, ...spec, tiltDeg: 8 }, { seconds: 40, cadence: 172, ...spec }], o))
        expect(analyzer.mount.issue).toBeNull()
        expect(said.filter((s) => s.text === PHRASES.phoneMount || s.text === PHRASES.phonePlace)).toEqual([])
      }
  }, 60000)

  const RUNS: { name: string; mount: MountSim; issue: 'notWaist' | 'loose'; text: string }[] = [
    { name: '腕', mount: { kind: 'arm' }, issue: 'notWaist', text: PHRASES.phonePlace },
    { name: '手', mount: { kind: 'hand' }, issue: 'notWaist', text: PHRASES.phonePlace },
    { name: 'ポケット', mount: { kind: 'pocket' }, issue: 'notWaist', text: PHRASES.phonePlace },
    { name: 'ゆるい', mount: { kind: 'loose', tiltDeg: 6, accMs: 2 }, issue: 'loose', text: PHRASES.phoneMount },
  ]
  for (const r of RUNS)
    it(`${r.name}：走り始めに1回だけ知らせ、記録に印を付け、その走りではもう判定しない`, () => {
      const analyzer = new PhoneAnalyzer()
      // 基準ができた後に、ピッチを落とす。付け方がおかしいと分かっていれば、ピッチの声もかけない
      const { coach, said } = drive(analyzer, run([{ seconds: 210, cadence: 172, mount: r.mount }, { seconds: 50, cadence: 158, mount: r.mount }], [90, 0, 0]))
      expect(coach.state).toBe('running') // 手に持っていても、走り出しに気づく
      expect(analyzer.mount.issue).toBe(r.issue)
      expect(analyzer.mount.issueAt!).toBeLessThanOrEqual(25)
      const mountSaid = said.filter((s) => s.text === PHRASES.phoneMount || s.text === PHRASES.phonePlace)
      expect(mountSaid.map((s) => s.text)).toEqual([r.text])
      expect(said.some((s) => [PHONE_CUE.cadence, PHONE_CUE.braking, PHONE_CUE.bounce].includes(s.text))).toBe(false)
      const after = coach.samples.filter((s) => s.t >= analyzer.mount.issueAt!)
      expect(after.length).toBeGreaterThan(100)
      expect(after.every((s) => s.mount === r.issue && s.score === null)).toBe(true)
      expect(coach.cues.some((c) => c.item === (r.issue === 'notWaist' ? 'place' : 'mount'))).toBe(true)
    }, 30000)

  it('途中でずれたら、ずれたあとに1回だけ知らせる。小さな傾き（20°）では鳴らない', () => {
    const big = new PhoneAnalyzer()
    const r1 = drive(big, simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 160, orientation: [30, -50, 120], seed: 4, ...REAL, mount: { kind: 'shift', at: 100, rotate: [0, 40, 0] } }))
    expect(big.mount.issue).toBe('shifted')
    expect(big.mount.issueAt!).toBeGreaterThan(100)
    expect(r1.said.filter((s) => s.text === PHRASES.phoneMount).length).toBe(1)
    const small = new PhoneAnalyzer()
    drive(small, simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 160, orientation: [30, -50, 120], seed: 4, ...REAL, mount: { kind: 'shift', at: 100, rotate: [0, 20, 0] } }))
    expect(small.mount.issue).toBeNull()
  }, 30000)

  it('ジャイロが取れないときは、ゆるみ・腕・ポケットは見分けず（鳴らさず）、手に持ったときだけ見分ける', () => {
    const verdict = (spec: Partial<RunSpec>) => {
      const ms = noGyro(simulateRun({ cadence: 172, bounceCm: 7, brakingMs: 0.3, seconds: 4, orientation: [90, 0, 0], seed: 5, ...spec }))
      return mountVerdict(mountFeatures(ms)!)
    }
    expect(verdict(HARD)).toBe('ok')
    expect(verdict({ ...REAL, mount: { kind: 'loose', tiltDeg: 8, accMs: 3 } })).toBe('ok')
    expect(verdict({ ...REAL, mount: { kind: 'arm' } })).toBe('ok')
    expect(verdict({ ...REAL, mount: { kind: 'hand' } })).toBe('notWaist')
  })
})
