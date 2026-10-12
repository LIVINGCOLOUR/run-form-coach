import { describe, expect, it } from 'vitest'
import { PHONE_CUE, PHONE_SAY } from './analyzer'
import { PHONE_RAW_COLUMNS, PHONE_SECOND_COLUMNS, PHONE_STATES } from './log'
import { toMeasure, type MotionLike } from './sensor'
import { PhoneRun } from './session'
import { estimate, type PhoneMeasure } from './signal'
import { demoRun, simulateRun } from './simulate'

// スマホ版の画面の裏側（センサーの値の直し方、1回の走り、記録の書き出し）を、模擬データで確かめる

const DEG = 180 / Math.PI
const asMotion = (m: PhoneMeasure): MotionLike => ({
  accelerationIncludingGravity: { x: m.ax, y: m.ay, z: m.az },
  rotationRate: m.gx === undefined ? null : { alpha: m.gz! * DEG, beta: m.gx * DEG, gamma: m.gy! * DEG },
})

describe('スマホ：センサーの値の直し方', () => {
  it('角速度は deg/s から rad/s に直し、alpha は z、beta は x、gamma は y にする', () => {
    const m = toMeasure({ accelerationIncludingGravity: { x: 1, y: 2, z: 9.8 }, rotationRate: { alpha: 180, beta: 90, gamma: -45 } }, 3)!
    expect(m).toMatchObject({ t: 3, ax: 1, ay: 2, az: 9.8 })
    expect(m.gx).toBeCloseTo(Math.PI / 2)
    expect(m.gy).toBeCloseTo(-Math.PI / 4)
    expect(m.gz).toBeCloseTo(Math.PI)
  })

  it('角速度が取れないときは付けず、加速度が取れないときは null', () => {
    const m = toMeasure({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, rotationRate: null }, 0)!
    expect(m.gx).toBeUndefined()
    expect(toMeasure({ accelerationIncludingGravity: { x: null, y: 0, z: 9.8 }, rotationRate: null }, 0)).toBeNull()
    expect(toMeasure({ accelerationIncludingGravity: null, rotationRate: null }, 0)).toBeNull()
  })

  it('加速度の3つの軸の符号がそろって逆の機種でも、同じ値を測る', () => {
    const ms = simulateRun({ cadence: 170, bounceCm: 8, brakingMs: 0.3, seconds: 4, orientation: [30, -50, 120], seed: 4, noise: 0.5, jitter: 0.02, impact: 20 })
    const a = estimate(ms)!
    const b = estimate(ms.map((m) => ({ ...m, ax: -m.ax, ay: -m.ay, az: -m.az })))!
    expect(b.cadence).toBeCloseTo(a.cadence, 6)
    expect(b.bounceCm).toBeCloseTo(a.bounceCm, 6)
    expect(b.brakingMs).toBeCloseTo(a.brakingMs, 6)
  })
})

// センサーの値を、画面と同じ道（toMeasure）で流し込む。時刻は performance.now() の秒にあたる値
function feedAll(data: PhoneMeasure[], base = 1000) {
  const run = new PhoneRun({ perfMs: base * 1000, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 })
  const said: { t: number; text: string }[] = []
  for (const d of data) {
    const t = base + d.t
    for (const e of run.feed(toMeasure(asMotion(d), t)!)) if (e.type === 'speak') said.push({ t, text: e.text })
  }
  return { run, said, end: base + data[data.length - 1].t }
}

describe('スマホ：1回の走りと記録', () => {
  const data = demoRun()
  const { run, said, end } = feedAll(data)

  it('走り始めの基準を作り、ピッチが落ちたら声をかける', () => {
    expect(run.analyzer.ref!.cadence).toBeCloseTo(172, 0)
    const cues = said.filter((s) => Object.values(PHONE_CUE).includes(s.text))
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0].text).toBe(PHONE_CUE.cadence)
    expect(cues[0].t).toBeGreaterThan(1000 + 245) // ピッチが落ちる前には声をかけない
  })

  it('生の値を、届いたコマすべて残す（時刻・ふつうの時刻・加速度・角速度 rad/s・しくみの状態）', () => {
    const log = run.log
    expect(log.columns).toEqual(PHONE_RAW_COLUMNS)
    expect(log.rows.length).toBe(data.length)
    expect(log.device.gyro).toBe(true)
    const i = 5000
    const row = log.rows[i]
    expect(row.length).toBe(PHONE_RAW_COLUMNS.length)
    expect(row[0]).toBeCloseTo(1000 + data[i].t, 3)
    // ふつうの時刻 = epochMs + (t×1000 − perfMs)
    expect(row[1]).toBe(Math.round(1_760_000_000_000 + data[i].t * 1000))
    expect(row[2]).toBeCloseTo(data[i].ax, 3)
    expect(row[5]).toBeCloseTo(data[i].gx!, 4)
    expect(PHONE_STATES[row[8]!]).toBe('running')
    expect(PHONE_STATES[log.rows[0][8]!]).toBe('waiting')
  })

  it('1秒ごとの判定の値を残す。基準ができる前は線と比べた値が null', () => {
    const log = run.log
    const col = (k: (typeof PHONE_SECOND_COLUMNS)[number]) => PHONE_SECOND_COLUMNS.indexOf(k)
    expect(log.secondColumns).toEqual(PHONE_SECOND_COLUMNS)
    expect(log.seconds.length).toBe(run.coach.samples.length)
    expect(log.seconds.length).toBeGreaterThan(300)
    for (const r of log.seconds) expect(r.length).toBe(PHONE_SECOND_COLUMNS.length)
    const early = log.seconds.find((r) => (r[col('sec')] as number) > 60 && (r[col('sec')] as number) < 120)!
    expect(early[col('cadence')]).toBeCloseTo(172, -1)
    expect(early[col('vCadence')]).toBeNull()
    expect(early[col('gyroHf')]).not.toBeNull()
    const late = log.seconds[log.seconds.length - 1]
    expect(late[col('vCadence')] as number).toBeGreaterThan(5) // 172 → 158 で約8%の下がり
    expect(late[col('wallMs')]).toBe(Math.round(1_760_000_000_000 + ((late[col('t')] as number) - 1000) * 1000))
  })

  it('話した言葉と、しくみの状態の切り替えを、時刻つきで残す', () => {
    const texts = run.log.events.map((e) => e[1])
    expect(texts).toContain('state:running')
    expect(texts).toContain(PHONE_CUE.cadence)
  })

  it('値が途切れたら、途切れたときの言葉を言う', () => {
    const r2 = feedAll(data.slice(0, 60 * 60))
    const said: string[] = []
    for (let t = r2.end; t < r2.end + 10; t += 0.25) for (const e of r2.run.tick(t)) if (e.type === 'speak') said.push(e.text)
    expect(said).toContain(PHONE_SAY.lost)
    expect(r2.run.log.events.map((e) => e[1])).toContain(PHONE_SAY.lost)
  })

  it('走り終わると結果をまとめ、記録とつなぐ。書き出しても形が崩れない', () => {
    expect(run.tick(end + 0.1)).toEqual([])
    const { session, log } = run.finish()
    expect(session).not.toBeNull()
    expect(session!.mode).toBe('phone')
    expect(session!.logId).toBe(log.id)
    expect(log.sessionId).toBe(session!.id)
    expect(session!.ref!.cadence).toBeCloseTo(172, 0)
    expect(session!.mount).toBeNull()
    expect(session!.durationSec).toBeGreaterThan(300)
    const back = JSON.parse(JSON.stringify({ log, session }))
    expect(back.log.rows.length).toBe(data.length)
    expect(back.log.seconds[0].length).toBe(PHONE_SECOND_COLUMNS.length)
  })

  it('走りが短ければ、結果は作らず記録だけ返す', () => {
    const r = feedAll(data.slice(0, 60 * 20))
    const { session, log } = r.run.finish()
    expect(session).toBeNull()
    expect(log.rows.length).toBe(60 * 20)
  })
})
