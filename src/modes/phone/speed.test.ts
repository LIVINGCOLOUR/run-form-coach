import { describe, expect, it } from 'vitest'
import { PHONE_CUE } from './analyzer'
import { PHONE_GPS_COLUMNS, PHONE_SECOND_COLUMNS } from './log'
import { SPEED } from './params'
import { PhoneRun, type PhoneWhere } from './session'
import type { PhoneMeasure } from './signal'
import { rng, simulateRun } from './simulate'
import { SPEED_GATES, SpeedTrack, distanceM, speedGate, type GpsFix } from './speed'

// 速さで判定を止める（docs/phone-spec.md 機能4）を、模擬データで確かめる

// 1秒に1回の位置。speedAt(秒) の速さで北へ進む。noise は端末が出す速さのゆれ（m/s、標準偏差）
function gpsTrack(seconds: number, speedAt: (t: number) => number | null, opts: { noise?: number; deviceSpeed?: boolean; seed?: number } = {}): GpsFix[] {
  const g = rng(opts.seed ?? 7)
  const out: GpsFix[] = []
  let lat = 36.38
  for (let t = 1; t <= seconds; t++) {
    const v = speedAt(t)
    if (v === null) continue
    lat += v / 111195 // 1秒に v m 北へ
    const sp = Math.max(0, v + (opts.noise ?? 0.3) * g())
    out.push({ t, lat, lon: 140.25, accuracy: 6, speed: opts.deviceSpeed === false ? null : sp, altitude: 40, altitudeAccuracy: 8 })
  }
  return out
}

// センサーの値と位置を、時刻の順に流し込む（t は 1000 から。画面の performance.now() の秒にあたる）
function feedRun(data: PhoneMeasure[], fixes: GpsFix[], where: PhoneWhere = 'outdoor') {
  const base = 1000
  const run = new PhoneRun({ perfMs: base * 1000, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 }, where)
  const said: { t: number; text: string }[] = []
  const tones: { t: number; on: boolean }[] = []
  let j = 0
  for (const d of data) {
    const t = base + d.t
    while (j < fixes.length && base + fixes[j].t <= t) run.gps({ ...fixes[j], t: base + fixes[j++].t })
    for (const e of run.feed({ ...d, t })) {
      if (e.type === 'speak') said.push({ t, text: e.text })
      if (e.type === 'tone') tones.push({ t, on: e.on })
    }
  }
  return { run, said, tones }
}

const o: [number, number, number] = [90, 0, 0]
const real = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20, bounceCm: 8, brakingMs: 0.3, orientation: o }
// 172 で5分 → ピッチ 158（約8%下がる）で1分 → 172 に戻して1分
const run7 = () => [
  ...simulateRun({ ...real, cadence: 172, seconds: 300, seed: 41 }),
  ...simulateRun({ ...real, cadence: 158, seconds: 60, seed: 42, t0: 300 }),
  ...simulateRun({ ...real, cadence: 172, seconds: 60, seed: 43, t0: 360 }),
]
const col = (k: (typeof PHONE_SECOND_COLUMNS)[number]) => PHONE_SECOND_COLUMNS.indexOf(k)
const cadenceCue = <T extends { text: string }>(said: T[]) => said.filter((s) => s.text === PHONE_CUE.cadence)

describe('スマホ：GPS の速さ', () => {
  it('ゆれのある速さをならす', () => {
    const tr = new SpeedTrack()
    const vs: number[] = []
    for (const f of gpsTrack(120, () => 3.3, { noise: 0.2 })) {
      tr.fix(f)
      if (f.t > 20) vs.push(tr.at(f.t)!)
    }
    const err = Math.max(...vs.map((v) => Math.abs(v - 3.3) / 3.3))
    expect(err).toBeLessThan(SPEED.band) // ならせば、ゆれだけでは判定を止める幅に届かない
  })

  it('端末が速さを出さないときは、前の点からの距離で出す', () => {
    const tr = new SpeedTrack()
    for (const f of gpsTrack(30, () => 3, { deviceSpeed: false })) tr.fix(f)
    expect(tr.at(30)).toBeCloseTo(3, 1)
    expect(distanceM({ lat: 36, lon: 140 }, { lat: 36.001, lon: 140 })).toBeCloseTo(111.2, 0)
  })

  it('誤差の大きい点は使わず、しばらく点が来なければ「取れない」', () => {
    const tr = new SpeedTrack()
    expect(tr.fix({ t: 1, lat: 36, lon: 140, accuracy: SPEED.maxAccuracy + 1, speed: 3, altitude: null, altitudeAccuracy: null }).used).toBe(false)
    expect(tr.at(1)).toBeNull()
    tr.fix({ t: 2, lat: 36, lon: 140, accuracy: 5, speed: 3, altitude: null, altitudeAccuracy: null })
    expect(tr.at(2 + SPEED.stale)).toBe(3)
    expect(tr.at(2 + SPEED.stale + 0.5)).toBeNull()
  })

  it('基準の速さから外れたら止める理由を返す', () => {
    expect(speedGate(3.3, 3.3)).toBeNull()
    expect(speedGate(3.3 * (1 - SPEED.band) - 0.01, 3.3)).toBe('slow')
    expect(speedGate(3.3 * (1 + SPEED.band) + 0.01, 3.3)).toBe('fast')
    expect(speedGate(null, 3.3)).toBe('noGps')
    expect(speedGate(3.3, null)).toBe('noBase')
  })
})

describe('スマホ：速さで判定を止める（外）', () => {
  const data = run7()

  it('くらべ：速さが同じままピッチが落ちれば、声とメトロノームが出る', () => {
    const { run, said, tones } = feedRun(data, gpsTrack(420, () => 3.3))
    expect(run.analyzer.refSpeed).toBeCloseTo(3.3, 1)
    expect(cadenceCue(said).length).toBe(1)
    expect(cadenceCue(said)[0].t).toBeGreaterThan(1300)
    expect(tones.some((x) => x.on)).toBe(true)
    // 止めた秒はない（判定した秒の gate は 0）
    const gates = run.log.seconds.filter((r) => r[col('vCadence')] !== null).map((r) => r[col('gate')])
    expect(new Set(gates)).toEqual(new Set([0]))
  })

  it('ペースを落とした区間では、ピッチが落ちても声もメトロノームも出ず、記録に止めた理由（slow）が残る', () => {
    // 5分から1分、3.3 → 2.6 m/s（約21%遅い。5:03/km → 6:25/km）
    const { run, said, tones } = feedRun(data, gpsTrack(420, (t) => (t > 300 && t <= 360 ? 2.6 : 3.3)))
    expect(cadenceCue(said)).toEqual([])
    expect(tones.filter((x) => x.on)).toEqual([])
    const log = run.log
    const slow = SPEED_GATES.indexOf('slow')
    const inSlow = log.seconds.filter((r) => (r[col('sec')] as number) >= 306 && (r[col('sec')] as number) < 360)
    expect(inSlow.length).toBeGreaterThan(40)
    for (const r of inSlow) {
      expect(r[col('gate')]).toBe(slow)
      expect(r[col('vCadence')]).toBeNull() // 判定しない秒
    }
    // 速さも残している（ならした速さ。区間の平均は落とした速さに近い）
    const avg = inSlow.reduce((x, r) => x + (r[col('speed')] as number), 0) / inSlow.length
    expect(avg).toBeLessThan(3.3 * (1 - SPEED.band))
    // ピッチ自体は測って残している（あとで線を決めるため）
    expect(inSlow.filter((r) => (r[col('sec')] as number) < 350).every((r) => (r[col('cadence')] as number) < 165)).toBe(true)
    const ev = log.events.map((e) => e[1])
    expect(ev).toContain('gate:on:slow')
    expect(ev).toContain('gate:off')
    expect(ev.some((x) => x.startsWith('ref:speed:3.'))).toBe(true)
    // 結果にも、止めた秒が残る
    const { session } = run.finish()
    expect(session!.where).toBe('outdoor')
    expect(session!.samples.filter((x) => x.gate === 'slow').length).toBeGreaterThan(40)
    expect(log.where).toBe('outdoor')
    expect(log.gpsColumns).toEqual(PHONE_GPS_COLUMNS)
    expect(log.gps!.length).toBeGreaterThanOrEqual(419) // 最後の点は、センサーの最後の値より後
    expect(log.gps![0].length).toBe(PHONE_GPS_COLUMNS.length)
  })

  it('GPS が取れない秒も判定しない（noGps）', () => {
    // 5分からの2分、位置が来ない
    const { run, said, tones } = feedRun(data, gpsTrack(420, (t) => (t > 300 && t <= 420 ? null : 3.3)))
    expect(cadenceCue(said)).toEqual([])
    expect(tones.filter((x) => x.on)).toEqual([])
    const late = run.log.seconds.filter((r) => (r[col('sec')] as number) > 310)
    expect(late.length).toBeGreaterThan(60)
    expect(late.every((r) => r[col('gate')] === SPEED_GATES.indexOf('noGps'))).toBe(true)
  })

  it('位置がまったく取れない走りは、基準の速さが作れず判定しない（noBase）', () => {
    const { run, said } = feedRun(data, [])
    expect(run.analyzer.ref).not.toBeNull()
    expect(run.analyzer.refSpeed).toBeNull()
    expect(cadenceCue(said)).toEqual([])
    expect(run.log.events.map((e) => e[1])).toContain('ref:speed:none')
    expect(run.log.events.map((e) => e[1])).toContain('gate:on:noBase')
  })

  it('メトロノームを鳴らしている途中でペースが落ちたら、すぐ止める', () => {
    // ピッチは5分から落ちたまま。速さは 5分20秒まで同じで、そこから落とす
    const d2 = [...simulateRun({ ...real, cadence: 172, seconds: 300, seed: 41 }), ...simulateRun({ ...real, cadence: 158, seconds: 120, seed: 44, t0: 300 })]
    const { run, tones } = feedRun(d2, gpsTrack(420, (t) => (t > 320 ? 2.6 : 3.3)))
    const on = tones.find((x) => x.on)!
    expect(on.t).toBeGreaterThan(1300)
    expect(on.t).toBeLessThan(1322)
    const gateAt = run.log.events.find((e) => e[1] === 'gate:on:slow')![0]
    const off = tones.find((x) => !x.on && x.t >= on.t)!
    expect(off.t - gateAt).toBeLessThanOrEqual(1.01)
    expect(tones.filter((x) => x.on && x.t > gateAt)).toEqual([])
  })

  it('インターバルで速くした区間も判定しない（fast）', () => {
    const { run } = feedRun(data, gpsTrack(420, (t) => (t > 300 && t <= 360 ? 4.2 : 3.3)))
    const fast = run.log.seconds.filter((r) => r[col('gate')] === SPEED_GATES.indexOf('fast'))
    expect(fast.length).toBeGreaterThan(40)
  })

  it('基準の区間で減速した秒は、ピッチと速さの基準に入れない', () => {
    // 1分から30秒、信号の手前で 2.2 m/s・ピッチ 150 に落とす
    const d3 = [
      ...simulateRun({ ...real, cadence: 172, seconds: 60, seed: 51 }),
      ...simulateRun({ ...real, cadence: 150, seconds: 30, seed: 52, t0: 60 }),
      ...simulateRun({ ...real, cadence: 172, seconds: 150, seed: 53, t0: 90 }),
    ]
    const { run } = feedRun(d3, gpsTrack(240, (t) => (t > 60 && t <= 90 ? 2.2 : 3.3)))
    expect(run.analyzer.refSpeed).toBeCloseTo(3.3, 1)
    expect(run.analyzer.ref!.cadence).toBeCloseTo(172, 0)
  })

  it('トレッドミルでは GPS を使わず、速さで止めない（記録の速さと理由は null）', () => {
    const { run, said } = feedRun(data, gpsTrack(420, (t) => (t > 300 && t <= 360 ? 2.6 : 3.3)), 'treadmill')
    expect(cadenceCue(said).length).toBe(1)
    expect(run.analyzer.speed).toBeNull()
    expect(run.log.where).toBe('treadmill')
    expect(run.log.gps).toBeUndefined()
    expect(run.log.seconds.every((r) => r[col('speed')] === null && r[col('gate')] === null)).toBe(true)
  })
})
