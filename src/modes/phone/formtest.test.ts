import { describe, expect, it } from 'vitest'
import { PHRASES } from '../../core/phrases'
import type { PhoneSample } from './analyzer'
import { compareFormTests, formTestOf, prevFormTest, type FormTestResult } from './formtest'
import { FORM_TEST } from './params'
import { toMeasure } from './sensor'
import { PhoneRun, type PhoneSession } from './session'
import { simulateRun, simulateStanding } from './simulate'

// フォームのテスト（docs/phone-spec.md 機能7）：値のまとめ方と、前のテストとの比べ方

const sample = (t: number, o: Partial<PhoneSample> = {}): PhoneSample => ({
  t,
  cadence: 170,
  bounceCm: 8,
  brakingMs: 0.3,
  score: null,
  quiet: false,
  mount: null,
  values: {},
  fat: { regularity: 0.9, apRegularity: 0.8, ratioV: 0.5, ratioAP: 0.3, ratioML: 0.2, contactMs: 250 },
  ...o,
})
const secs = (f: (t: number) => Partial<PhoneSample>) => Array.from({ length: FORM_TEST.seconds }, (_, t) => sample(t, f(t)))

describe('テスト：値のまとめ方', () => {
  it('始めの数十秒を除いて平均する', () => {
    const r = formTestOf(secs((t) => ({ cadence: t < FORM_TEST.skip ? 150 : 170, speed: 3 })), null, 'outdoor')
    expect(r.ok).toBe(true)
    expect(r.cadence).toBeCloseTo(170)
    expect(r.contactMs).toBeCloseTo(250)
    expect(r.speed).toBeCloseTo(3)
    expect(r.steady).toBe(1)
    expect(r.sec).toBe(FORM_TEST.seconds - FORM_TEST.skip)
  })

  it('測れた秒が足りない・付け方に問題があれば、比べるのに使わない', () => {
    const short = formTestOf(secs(() => ({})).slice(0, 120), null, 'outdoor')
    expect(short).toMatchObject({ ok: false, why: 'short' })
    expect(formTestOf(secs(() => ({})), 'loose', 'outdoor')).toMatchObject({ ok: false, why: 'mount' })
  })

  it('速さが一定でなかった秒の割合を出す', () => {
    // 半分の秒は 3.0 m/s、残りは 3.6 m/s：平均 3.3 から ±5% に入る秒がない
    const r = formTestOf(secs((t) => ({ speed: t % 2 ? 3.6 : 3.0 })), null, 'outdoor')
    expect(r.steady).toBe(0)
  })
})

const result = (o: Partial<FormTestResult> = {}): FormTestResult => ({ ok: true, where: 'outdoor', sec: 240, speed: 3, steady: 1, cadence: 170, bounceCm: 8, brakingMs: 0.3, contactMs: 250, ...o })
const DAY = 24 * 3600 * 1000

describe('テスト：前のテストとの比べ方', () => {
  it('速さがそろっていれば、差だけを出す。ピッチの小さな差は「変わらず」', () => {
    const c = compareFormTests(result({ cadence: 172, bounceCm: 7.5, speed: 3.05 }), 30 * DAY, result(), 0)
    expect(c.days).toBe(30)
    expect(c.speedOk).toBe(true)
    expect(c.steadyOk).toBe(true)
    expect(c.notes).toEqual([])
    const cad = c.items.find((x) => x.key === 'cadence')!
    expect(cad.diff).toBeCloseTo(2)
    expect(cad.same).toBe(true)
    const b = c.items.find((x) => x.key === 'bounceCm')!
    expect(b.diff).toBeCloseTo(-0.5)
    expect(b.same).toBeUndefined() // 上下動には「変わらず」の目安がない
  })

  it('ピッチの差が測れる最小の変化を超えたら「変わった」', () => {
    const c = compareFormTests(result({ cadence: 175 }), DAY, result(), 0)
    expect(c.items.find((x) => x.key === 'cadence')!.same).toBe(false)
  })

  it('速さがそろっていなければ、そう言う', () => {
    const c = compareFormTests(result({ speed: 3.3 }), DAY, result(), 0)
    expect(c.speedOk).toBe(false)
    expect(c.speedDiff).toBeCloseTo(0.1)
    expect(c.notes[0]).toContain('速さがそろっていません（前より 10% 速い）')
  })

  it('テストの中で速さが一定でなければ、そう言う', () => {
    const c = compareFormTests(result({ steady: 0.5 }), DAY, result(), 0)
    expect(c.steadyOk).toBe(false)
    expect(c.notes.join()).toContain('一定ではありませんでした（一定だった時間 50%）')
  })

  it('GPS の速さがない・場所が違うときも、そう言う', () => {
    expect(compareFormTests(result({ speed: null, steady: null }), DAY, result(), 0).notes.join()).toContain('GPS の速さが取れなかった')
    expect(compareFormTests(result({ where: 'treadmill', speed: null, steady: null }), DAY, result(), 0).notes.join()).toContain('場所')
  })

  it('前のテストは、それより前の使えるテストのうち一番新しいもの', () => {
    const s = (startedAt: number, test?: FormTestResult) => ({ id: `${startedAt}`, startedAt, test }) as PhoneSession
    const ss = [s(1, result()), s(3, result({ ok: false, why: 'short' })), s(2, result()), s(4)]
    expect(prevFormTest(ss, 5)!.startedAt).toBe(2)
    expect(prevFormTest(ss, 2)!.startedAt).toBe(1)
    expect(prevFormTest(ss, 1)).toBeNull()
  })
})

describe('テストの走り', () => {
  it('ピッチが落ちても声もメトロノームもかけず、終えたら値を残す', () => {
    const o: [number, number, number] = [90, 0, 0]
    const real = { noise: 0.5, jitter: 0.02, impact: 20, bounceCm: 8, brakingMs: 0.3, orientation: o }
    const data = [
      ...simulateStanding({ seconds: 5, orientation: o, noise: 0.05 }),
      ...simulateRun({ ...real, cadence: 172, seconds: 200, seed: 21, t0: 5 }),
      ...simulateRun({ ...real, cadence: 155, seconds: 110, seed: 22, t0: 205 }),
    ]
    const run = new PhoneRun({ perfMs: 1e6, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 }, 'treadmill', { kind: 'test' })
    expect(run.intro()).toBe(PHRASES.testStart)
    const said: string[] = []
    let tones = 0
    for (const d of data) {
      const m = toMeasure({ accelerationIncludingGravity: { x: d.ax, y: d.ay, z: d.az }, rotationRate: d.gx === undefined ? null : { alpha: (d.gz! * 180) / Math.PI, beta: (d.gx * 180) / Math.PI, gamma: (d.gy! * 180) / Math.PI } }, 1000 + d.t)!
      for (const e of run.feed(m)) {
        if (e.type === 'speak') said.push(e.text)
        if (e.type === 'tone') tones++
      }
    }
    expect(tones).toBe(0)
    expect(said.filter((x) => x !== PHRASES.start)).toEqual([])
    const { session } = run.finish()
    expect(session!.kind).toBe('test')
    expect(session!.test!.ok).toBe(true)
    expect(session!.test!.where).toBe('treadmill')
    expect(session!.test!.speed).toBeNull()
    expect(session!.test!.cadence).toBeGreaterThan(155)
    expect(session!.test!.cadence).toBeLessThan(172)
  })
})
