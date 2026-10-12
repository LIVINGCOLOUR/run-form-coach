import { describe, expect, it } from 'vitest'
import { PHRASES } from '../../core/phrases'
import { PHONE_CUE } from './analyzer'
import { PRACTICE } from './params'
import { nextPractice, practiceBpm, practiceOn, practiceOnShare, practiceProgress, practiceTempoPct, PracticeRun, type PracticeResult } from './practice'
import { toMeasure } from './sensor'
import { PhoneRun, type PhoneSession } from './session'
import { demoRun } from './simulate'

// ピッチを上げる練習（docs/phone-spec.md 機能3）：回ごとのテンポ、鳴らす時間の減り方、進みの数え方、ふつうのメトロノームと混ざらないこと

const DAY = 24 * 3600 * 1000

describe('練習：回ごとのテンポ', () => {
  it('1回目は 2.5% ずつ上げて、+7.5% で止める', () => {
    expect(practiceTempoPct(1, 0)).toBe(2.5)
    expect(practiceTempoPct(1, PRACTICE.rampEvery - 1)).toBe(2.5)
    expect(practiceTempoPct(1, PRACTICE.rampEvery)).toBe(5)
    expect(practiceTempoPct(1, PRACTICE.rampEvery * 2)).toBe(7.5)
    expect(practiceTempoPct(1, 3600)).toBe(7.5)
  })

  it('一度に上げる幅は、気づかれにくい 4% より小さい（Van Dyck 2015）', () => {
    expect(PRACTICE.rampStep).toBeLessThan(4)
  })

  it('2回目からは、はじめから +7.5%', () => {
    for (let n = 2; n <= 8; n++) {
      expect(practiceTempoPct(n, 0)).toBe(7.5)
      expect(practiceTempoPct(n, 1000)).toBe(7.5)
    }
  })

  it('テンポは自分のピッチから出す', () => {
    expect(practiceBpm(160, 1, 0)).toBe(164)
    expect(practiceBpm(160, 3, 0)).toBe(172)
  })
})

describe('練習：鳴らす時間の減り方', () => {
  const share = (n: number) => {
    let on = 0
    for (let t = 0; t < PRACTICE.cycle * 10; t++) if (practiceOn(n, t)) on++
    return on / (PRACTICE.cycle * 10)
  }

  it('1〜4回目はずっと鳴らす', () => {
    for (let n = 1; n <= 4; n++) expect(share(n)).toBe(1)
  })

  it('5〜8回目は、回を追うごとに減る', () => {
    const xs = [5, 6, 7, 8].map(share)
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i]).toBeCloseTo(practiceOnShare(5 + i), 2)
      expect(xs[i]).toBeLessThan(i === 0 ? 1 : xs[i - 1])
    }
  })

  it('くり返しの頭で鳴らし、残りで止める', () => {
    expect(practiceOn(6, 0)).toBe(true)
    expect(practiceOn(6, PRACTICE.cycle * 0.6 - 1)).toBe(true)
    expect(practiceOn(6, PRACTICE.cycle * 0.6)).toBe(false)
    expect(practiceOn(6, PRACTICE.cycle)).toBe(true)
  })
})

describe('練習：1回の走りの中', () => {
  it('1回目は、基準ができてから鳴らし始め、テンポを上げるたびに鳴らし直す', () => {
    const p = new PracticeRun({ programId: 1, n: 1, base: null })
    expect(p.intro()).toBe(PHRASES.practiceFirst)
    // 基準ができるまでは鳴らさない
    for (let t = 0; t < 180; t++) expect(p.second(t, 160, null, true).tone).toBeUndefined()
    const first = p.second(180, 160, 160, true)
    expect(first).toEqual({ tone: 'on', say: PHRASES.practiceGo })
    expect(p.tempo()).toBe(164)
    const ons: number[] = []
    for (let t = 181; t < 180 + PRACTICE.rampEvery * 3; t++) if (p.second(t, 165, 160, true).tone === 'on') ons.push(t)
    expect(ons).toEqual([180 + PRACTICE.rampEvery, 180 + PRACTICE.rampEvery * 2])
    expect(p.tempo()).toBe(172)
  })

  it('5回目からは止める時間があり、言葉で知らせる。止まった間のピッチを分けて残す', () => {
    const p = new PracticeRun({ programId: 1, n: 5, base: 160 })
    expect(p.intro()).toBeNull()
    const ev: { t: number; tone?: string; say?: string }[] = []
    for (let t = 10; t < 10 + PRACTICE.cycle * 6; t++) {
      const since = t - 10
      const on = practiceOn(5, since)
      ev.push({ t, ...p.second(t, on ? 172 : 168, null, true) })
    }
    expect(ev[0].say).toBe(PHRASES.practiceFade)
    const offs = ev.filter((e) => e.tone === 'off').length
    const ons = ev.filter((e) => e.tone === 'on').length
    expect(offs).toBe(6)
    expect(ons).toBe(6)
    const r = p.result()
    expect(r.practiceSec).toBe(PRACTICE.cycle * 6)
    expect(r.counted).toBe(true)
    expect(r.onSec / r.practiceSec).toBeCloseTo(0.8, 2)
    expect(r.cadenceOn).toBeCloseTo(172)
    expect(r.cadenceOff).toBeCloseTo(168)
  })

  it('走りが止まったら鳴らすのをやめ、短い回は1回と数えない', () => {
    const p = new PracticeRun({ programId: 1, n: 2, base: 160 })
    p.second(0, 170, null, true)
    expect(p.halt()).toBe(true)
    expect(p.tempo()).toBeNull()
    expect(p.halt()).toBe(false)
    expect(p.second(1, 170, null, true).tone).toBe('on')
    expect(p.result().counted).toBe(false)
  })
})

// 保存した走りの形（進みの数え方を見るだけなので、練習の結果以外はほとんど空）
const session = (startedAt: number, practice: Partial<PracticeResult> & { programId: number; n: number }): PhoneSession => ({
  id: `phone-${startedAt}`,
  mode: 'phone',
  startedAt,
  durationSec: 1200,
  samples: [],
  cues: [],
  share: { good: 0, mid: 0, bad: 0 },
  quietHeldSec: 0,
  ref: null,
  mount: null,
  kind: 'practice',
  practice: { base: 160, counted: true, practiceSec: 900, onSec: 900, tempoPct: 7.5, cadence: 170, cadenceOn: 170, cadenceOff: null, ...practice },
})

describe('練習：進みの数え方', () => {
  const t0 = 1_760_000_000_000

  it('練習がなければ1回目から', () => {
    expect(nextPractice([], t0)).toEqual({ programId: t0, n: 1, base: null })
  })

  it('数えた回の次で、1回目の自分のピッチを使い続ける', () => {
    const ss = [
      session(t0, { programId: t0, n: 1, base: 158 }),
      session(t0 + DAY, { programId: t0, n: 2, counted: false, base: 158 }),
      session(t0 + 2 * DAY, { programId: t0, n: 2, base: 158 }),
    ]
    expect(nextPractice(ss, t0 + 3 * DAY)).toEqual({ programId: t0, n: 3, base: 158 })
  })

  it('8回終えたら、または間があきすぎたら、はじめから', () => {
    const done = Array.from({ length: 8 }, (_, i) => session(t0 + i * DAY, { programId: t0, n: i + 1 }))
    expect(nextPractice(done, t0 + 9 * DAY).n).toBe(1)
    const old = [session(t0, { programId: t0, n: 1 })]
    expect(nextPractice(old, t0 + (PRACTICE.restartDays + 1) * DAY)).toEqual({ programId: t0 + (PRACTICE.restartDays + 1) * DAY, n: 1, base: null })
  })

  it('進み：数えた回と、最後の回のピッチ（音が止まった間があればそれ）の変化', () => {
    const ss = [
      session(t0, { programId: t0, n: 1, base: 160 }),
      session(t0 + DAY, { programId: t0, n: 5, base: 160, cadenceOn: 172, cadenceOff: 168 }),
      session(t0 - 30 * DAY, { programId: 1, n: 1, base: 150 }), // 別の練習
    ]
    const g = practiceProgress(ss, t0)
    expect(g.done).toBe(2)
    expect(g.base).toBe(160)
    expect(g.latest).toBe(168)
    expect(g.changePct).toBeCloseTo(5)
  })
})

describe('練習の走り：ふつうのメトロノームと混ざらない', () => {
  // 模擬の走り：4分目のあとにピッチが約8%落ちる。ふつうの走りなら、ピッチの声とメトロノームがかかる
  const data = demoRun()
  const play = (kind?: ConstructorParameters<typeof PhoneRun>[3]) => {
    const base = 1000
    const run = new PhoneRun({ perfMs: base * 1000, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 }, 'treadmill', kind)
    const said: string[] = []
    const tones: { on: boolean; item: string; bpm: number | null }[] = []
    for (const d of data) {
      const m = toMeasure({ accelerationIncludingGravity: { x: d.ax, y: d.ay, z: d.az }, rotationRate: d.gx === undefined ? null : { alpha: (d.gz! * 180) / Math.PI, beta: (d.gx * 180) / Math.PI, gamma: (d.gy! * 180) / Math.PI } }, base + d.t)!
      for (const e of run.feed(m)) {
        if (e.type === 'speak') said.push(e.text)
        if (e.type === 'tone') tones.push({ on: e.on, item: e.item, bpm: e.on ? run.tempo() : null })
      }
    }
    return { run, said, tones }
  }

  it('ふつうの走りでは、ピッチのメトロノームがかかる（比べるため）', () => {
    const { tones } = play()
    expect(tones.some((x) => x.on && x.item === 'cadence')).toBe(true)
  })

  it('練習の走りでは、ピッチが落ちても声とふつうのメトロノームはかからず、練習のテンポだけが鳴る', () => {
    const { run, said, tones } = play({ kind: 'practice', plan: { programId: 1, n: 2, base: 160 } })
    expect(said).not.toContain(PHONE_CUE.cadence)
    expect(tones.filter((x) => x.item !== 'practice')).toEqual([])
    expect(tones[0]).toEqual({ on: true, item: 'practice', bpm: 172 })
    expect(said).toContain(PHRASES.practiceGo)
    const { session } = run.finish()
    expect(session!.kind).toBe('practice')
    expect(session!.practice!.n).toBe(2)
    expect(session!.practice!.cadenceOn).toBeGreaterThan(150)
  })

  it('1回目は、走り始めの3分で測った自分のピッチから、テンポを上げていく', () => {
    const { run, tones } = play({ kind: 'practice', plan: { programId: 1, n: 1, base: null } })
    const base = run.practice!.base!
    expect(base).toBeCloseTo(172, 0)
    const bpms = tones.filter((x) => x.on).map((x) => x.bpm)
    expect(bpms[0]).toBeCloseTo(base * 1.025, 0)
    expect(bpms[bpms.length - 1]).toBeCloseTo(base * 1.075, 0)
    // 走り出して3分までは鳴らさない（記録の時刻は 1000 秒から。5秒立ってから走り出す）
    expect(run.log.events.find((e) => e[1].startsWith('tone:on:practice'))![0]).toBeGreaterThan(1000 + 5 + 180)
  })
})
