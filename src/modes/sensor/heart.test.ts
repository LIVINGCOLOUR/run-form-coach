import { afterEach, describe, expect, it } from 'vitest'
import { HeartLatest, HeartMonitor, parseHeartRate, type HeartReading, type HeartSource, type HeartView } from './heart'
import { HEART, SLOTS } from './params'
import { sensors } from './ble'
import { SensorRunner } from './runner'
import { SENSOR_LOG_PATHS } from './runLog'
import type { Packet } from './parse'

// 心拍計（heart.ts）：Heart Rate Measurement（0x2A37）の読み方、1秒ごとのまとめの値、走りの記録（runner.ts）への入り方

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer)

describe('Heart Rate Measurement を読む', () => {
  it('8ビットの心拍（フラグ 0）', () => {
    expect(parseHeartRate(dv([0x00, 152]))).toEqual({ bpm: 152, rr: [], contact: null, energy: null })
  })

  it('16ビットの心拍（bit0）', () => {
    expect(parseHeartRate(dv([0x01, 0x2c, 0x01]))!.bpm).toBe(300)
  })

  it('皮膚に触れているか（bit2 で知らせる機器、bit1 が触れている）', () => {
    expect(parseHeartRate(dv([0x06, 140]))!.contact).toBe(true)
    expect(parseHeartRate(dv([0x04, 0]))!.contact).toBe(false)
    expect(parseHeartRate(dv([0x02, 140]))!.contact).toBe(null) // bit2 がなければ、bit1 は使わない
  })

  it('RR 間隔（bit4、1/1024 秒）は ms にする。消費エネルギー（bit3）があれば、その後ろから読む', () => {
    // 1024 → 1000ms、410 → 400ms
    expect(parseHeartRate(dv([0x10, 150, 0x00, 0x04, 0x9a, 0x01]))).toEqual({ bpm: 150, rr: [1000, 400], contact: null, energy: null })
    // 16ビットの心拍 + エネルギー 0x0102 = 258 kJ + RR 512 → 500ms
    expect(parseHeartRate(dv([0x19, 0x96, 0x00, 0x02, 0x01, 0x00, 0x02]))).toEqual({ bpm: 150, rr: [500], contact: null, energy: 258 })
  })

  it('短すぎる値は読まない（途中で切れた RR は捨てる）', () => {
    expect(parseHeartRate(dv([0x00]))).toBe(null)
    expect(parseHeartRate(dv([0x01, 0x10]))).toBe(null)
    expect(parseHeartRate(dv([0x10, 150, 0x00]))!.rr).toEqual([])
  })
})

describe('いちばん新しい心拍（HeartLatest）', () => {
  const r = (t: number, bpm: number, rr: number[] = [], contact: boolean | null = null): HeartReading => ({ t, bpm, rr, contact, energy: null })

  it('HEART.stale 秒より古ければ null。0 や、皮膚に触れていないときの心拍は使わない', () => {
    const h = new HeartLatest()
    expect(h.at(0)).toBe(null)
    h.fix(r(10, 150))
    expect(h.at(10 + HEART.stale)).toBe(150)
    expect(h.at(10 + HEART.stale + 0.1)).toBe(null)
    h.fix(r(11, 0))
    h.fix(r(12, 90, [], false))
    expect(h.at(12)).toBe(150)
  })

  it('RR 間隔はためて、取り出したら空にする。1回の通知から HEART.rrMax 個まで', () => {
    const h = new HeartLatest()
    h.fix(r(1.234, 150, [400, 410]))
    h.fix(r(2, 150, Array.from({ length: HEART.rrMax + 3 }, () => 400)))
    const got = h.takeRR()
    expect(got[0]).toEqual([1.23, 400])
    expect(got).toHaveLength(2 + HEART.rrMax)
    expect(h.takeRR()).toEqual([])
  })
})

describe('心拍計につなぐ役（HeartMonitor）', () => {
  it('Web Bluetooth のないところ（テスト）では none。届いた通知は心拍として画面と受け手に渡す', () => {
    const m = new HeartMonitor()
    expect(m.supported).toBe(false)
    expect(m.snapshot().status).toBe('none')
    m.clock = () => 5
    const got: HeartReading[] = []
    const off = m.onReading((x) => got.push(x))
    m.value(dv([0x00, 148]))
    expect(got).toEqual([{ t: 5, bpm: 148, rr: [], contact: null, energy: null }])
    expect(m.snapshot().t).toBe(5)
    off()
    m.value(dv([0x00, 149]))
    expect(got).toHaveLength(1)
  })
})

// 走りの記録に入れる口（runner.ts）を差し替える
class FakeHeart implements HeartSource {
  view: HeartView = { status: 'idle', message: '', name: null, bpm: null, t: null }
  diag: { t: number; text: string }[] = []
  diagTotal = 0
  private watchers = new Set<() => void>()
  private readers = new Set<(r: HeartReading) => void>()
  snapshot = () => this.view
  subscribe = (fn: () => void) => {
    this.watchers.add(fn)
    return () => void this.watchers.delete(fn)
  }
  onReading(fn: (r: HeartReading) => void) {
    this.readers.add(fn)
    return () => void this.readers.delete(fn)
  }
  set(status: HeartView['status'], name: string | null = 'Charge 6') {
    this.view = { ...this.view, status, name }
    for (const fn of this.watchers) fn()
  }
  beat(t: number, bpm: number, rr: number[] = []) {
    for (const fn of this.readers) fn({ t, bpm, rr, contact: null, energy: null })
  }
  note(text: string) {
    this.diagTotal++
    this.diag.push({ t: 0, text })
  }
  get readerCount() {
    return this.readers.size
  }
}

const hub = sensors as unknown as { nodes: { status: string }[]; refresh: () => void; listeners: Set<(n: number, t: number, p: Packet) => void> }
const chest = SLOTS.findIndex((s) => s.place === '胸')

// 胸に、じっと立った値を流す（記録はセンサーの値が届いてから始まる）
function stand(r: SensorRunner, from: number, sec: number, each?: (t: number) => void) {
  let seq = 0
  for (let k = 0; k < sec * 10; k++) {
    const t = from + k / 10
    const samples = Array.from({ length: 10 }, (_, j) => ({ seq: seq++ & 0xffff, t: Math.round((t + j / 100) * 1000), g: [0, 0, 0] as [number, number, number], a: [0, 0, 1] as [number, number, number], raw: new Uint8Array(12) }))
    for (const fn of hub.listeners) fn(chest, t, { seq: samples[0].seq, range: 16, n: 10, samples })
    each?.(t)
    r.tick(t)
  }
  return from + sec
}

describe('心拍を走りの記録に入れる（runner.ts。記録だけ）', () => {
  afterEach(() => {
    hub.nodes[chest].status = 'idle'
    hub.refresh()
  })

  it('つないでいなければ hr: off。つながった・切れた・戻ったを events に残し、心拍を1秒ごとのまとめの hr に、RR を hrRR に入れる', () => {
    hub.nodes[chest].status = 'connected'
    hub.refresh()
    const h = new FakeHeart()
    h.note('選んだ Charge 6')
    const events: string[] = []
    let changed = 0
    // onChange は、作っている途中には呼ばない（SensorLive は onChange の中で runner を読むので、作り終える前に呼ぶと落ちる）
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text), heart: h, onChange: () => void (r ? changed++ : expect.fail('作っている途中に onChange')) })
    expect(changed).toBe(0)
    expect(events).toContain('hr:ble 選んだ Charge 6（0秒前）')
    expect(events).toContain('hr: off')
    h.set('connecting')
    h.set('connected')
    let t = performance.now() / 1000
    t = stand(r, t, 3, (x) => h.beat(x, 150, [400]))
    const log = r.current()!
    const col = log.secCols!.indexOf('hr')
    expect(col).toBeGreaterThan(0)
    expect(log.sec!.some((row) => row[col] === 150)).toBe(true)
    expect(log.hrRR!.length).toBeGreaterThan(0)
    expect(log.hrRR![0][1]).toBe(400)
    // 心拍が来なくなって HEART.stale 秒より経てば null
    t = stand(r, t, HEART.stale + 2)
    expect(log.sec![log.sec!.length - 1][col]).toBe(null)
    h.set('lost')
    h.set('connected')
    h.note('つなぎ直した（1回目）')
    r.tick(t + 0.1)
    expect(events.filter((e) => e.startsWith('hr:'))).toEqual(['hr:ble 選んだ Charge 6（0秒前）', 'hr: off', 'hr: on Charge 6', 'hr: lost', 'hr: back Charge 6', 'hr:ble つなぎ直した（1回目）'])
    // 立っていただけ（走っていない）なので、平均と最大はない。切れた回数は数える
    expect(r.heartSummary()).toEqual({ avg: null, max: null, sec: 0, lost: 1 })
    r.finish()
    expect(h.readerCount).toBe(0) // 受け取りをやめる
  })

  it('走っていた間の平均と最大を数える。一度もつながらなければ summary に入れない', () => {
    const h = new FakeHeart()
    const r = new SensorRunner({ onEvent: () => {}, heart: h, running: () => true })
    h.set('connected')
    const t = performance.now() / 1000
    for (let k = 0; k < 40; k++) {
      h.beat(t + k / 10, k < 20 ? 140 : 160)
      r.tick(t + k / 10)
    }
    const s = r.heartSummary()!
    expect(s.max).toBe(160)
    expect(s.avg).toBeGreaterThanOrEqual(149)
    expect(s.avg).toBeLessThanOrEqual(151)
    r.finish()
    const none = new SensorRunner({ onEvent: () => {}, heart: new FakeHeart() })
    expect(none.heartSummary()).toBe(undefined)
    none.finish()
  })

  it('心拍計を渡さない（カメラ版・腰スマホ）ときは、hr の欄は null のまま', () => {
    hub.nodes[chest].status = 'connected'
    hub.refresh()
    const r = new SensorRunner({ onEvent: () => {} })
    stand(r, performance.now() / 1000, 2)
    const log = r.current()!
    const col = log.secCols!.indexOf('hr')
    expect(log.sec!.every((row) => row[col] === null)).toBe(true)
    expect(log.hrRR).toBe(undefined)
    expect(r.heartSummary()).toBe(undefined)
    r.finish()
  })

  it('RR 間隔は、走っている間に少しずつ端末へ書き出す', () => {
    expect(SENSOR_LOG_PATHS).toContain('sensors.hrRR')
  })
})
