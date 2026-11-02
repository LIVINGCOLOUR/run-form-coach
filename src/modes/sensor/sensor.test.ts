import { describe, expect, it } from 'vitest'
import { parseBattery, parsePacket, type Vec3 } from './parse'
import { HunchDetector } from './hunch'
import { decodeBlock, SensorRecorder } from './log'
import { HUNCH, SENSOR_LOG } from './params'
import type { RunLog } from '../../core/types'

// 自作のセンサー：通知のパーサ（hardware/sensor/viewer/test_parse.mjs と同じ例）、猫背の見分け、記録の詰め方

// ファームと同じ詰め方：先頭の通し番号 u16、先頭の時刻 u32、加速度の範囲 u8（g）、1件 = 時刻の差 u8 + ジャイロ i16×3 + 加速度 i16×3
type Raw = { t: number; g: number[]; a: number[] }
function build(seq: number, samples: Raw[], range = 16) {
  const v = new DataView(new ArrayBuffer(7 + samples.length * 13))
  v.setUint16(0, seq, true)
  v.setUint32(2, samples[0].t, true)
  v.setUint8(6, range)
  samples.forEach((s, k) => {
    const o = 7 + k * 13
    v.setUint8(o, s.t - samples[0].t)
    s.g.forEach((x, i) => v.setInt16(o + 1 + i * 2, x, true))
    s.a.forEach((x, i) => v.setInt16(o + 7 + i * 2, x, true))
  })
  return v
}
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('センサーの通知を読む', () => {
  it('MTU 247 の18件：値・時刻・通し番号（65535 の次は 0）', () => {
    const t0 = 4294967000 - 100 // uint32 の上のほうでも正しく読めるか
    const raw = Array.from({ length: 18 }, (_, k) => ({
      t: t0 + Math.floor((Math.floor((k * 1024) / 100) * 1000) / 1024),
      g: [k * 100 - 900, -32768, 32767],
      a: [4096, -4096 + k, k * -7],
    }))
    const p = parsePacket(build(65530, raw, 8))
    expect(p.n).toBe(18)
    expect(p.seq).toBe(65530)
    expect(p.range).toBe(8)
    p.samples.forEach((s, k) => {
      expect(s.seq).toBe((65530 + k) & 0xffff)
      expect(s.t).toBe(raw[k].t)
      raw[k].g.forEach((x, i) => near(s.g[i], x * 0.07))
      raw[k].a.forEach((x, i) => near(s.a[i], x * 0.000244))
      expect(s.raw.length).toBe(12)
    })
    near(p.samples[0].g[1], -2293.76)
  })

  it('加速度の換算：±8g と ±16g で、同じ数が違う g になる', () => {
    let p = parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [4096, 32767, -32768] }], 8))
    near(p.samples[0].a[0], 0.999424)
    near(p.samples[0].a[1], 7.995148)
    near(p.samples[0].a[2], -7.995392)
    p = parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [2048, 32767, -32768] }], 16))
    expect(p.range).toBe(16)
    near(p.samples[0].a[0], 0.999424)
    near(p.samples[0].a[1], 15.990296)
    near(p.samples[0].a[2], -15.990784)
  })

  it('MTU 23 のとき：20 バイトに1件', () => {
    const p = parsePacket(build(7, [{ t: 123456, g: [1, 2, 3], a: [-1, -2, -3] }]))
    expect(p.n).toBe(1)
    expect(p.samples[0].t).toBe(123456)
    near(p.samples[0].a[2], -3 * 0.000488)
  })

  it('古い形と知らない範囲は 0 件（でたらめな値を出さない）', () => {
    expect(parsePacket(new DataView(new ArrayBuffer(16))).n).toBe(0)
    expect(parsePacket(new DataView(new ArrayBuffer(6 + 13))).n).toBe(0)
    expect(parsePacket(new DataView(new ArrayBuffer(6 + 18 * 13))).n).toBe(0)
    expect(parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [0, 0, 0] }], 4)).n).toBe(0)
  })

  it('50Hz で、時刻の差が 255 ms まで入る', () => {
    const p = parsePacket(build(0, [0, 20, 40, 255].map((d) => ({ t: 1000 + d, g: [0, 0, 0], a: [0, 0, 0] }))))
    expect(p.samples.map((s) => s.t)).toEqual([1000, 1020, 1040, 1255])
  })

  it('電池：uint16 ミリボルト', () => {
    const b = new DataView(new ArrayBuffer(2))
    b.setUint16(0, 3917, true)
    near(parseBattery(b), 3.917)
  })
})

// 胸の向き：立った姿勢（重力が z）から、前へ deg 度傾けた加速度（g）
const lean = (deg: number): Vec3 => [Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)]

// 100Hz で胸の値を流し、0.1秒ごとに判定する。tiltAt(秒) → 傾き、runAt(秒) → 走っているか
function play(d: HunchDetector, from: number, to: number, tiltAt: (t: number) => number, runAt: (t: number) => boolean) {
  const out: { t: number; cue: boolean; learned?: number; tilt: number | null }[] = []
  for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
    const t = i / 100
    d.sample(t, lean(tiltAt(t)))
    if (i % 10 === 0) out.push({ t, ...d.update(t, runAt(t)) })
  }
  return out
}

describe('胸のセンサーで猫背を見る', () => {
  // 立つ（0〜5秒）→ 基準 → 走る（ふつう 14°）。走る前傾を覚えたあと、猫背 27° にする
  const setup = () => {
    const d = new HunchDetector()
    play(d, 0, 5, () => 0, () => false)
    expect(d.stand(5, 3)).toBe(true)
    return d
  }

  it('立った姿勢を覚える前と、値が足りないときは知らせない', () => {
    const d = new HunchDetector()
    const out = play(d, 0, 60, () => 30, () => true)
    expect(out.every((o) => !o.cue && o.tilt === null)).toBe(true)
    expect(d.stand(60, 0.5)).toBe(false) // 0.5秒（50件）では足りない
  })

  it('走り出して10秒あとからの30秒の真ん中を、走る前傾にする', () => {
    const d = setup()
    const out = play(d, 5, 5 + HUNCH.skip + HUNCH.learn + 2, (t) => (t < 5 + HUNCH.skip ? 25 : 14), () => true)
    const learned = out.find((o) => o.learned !== undefined)
    expect(learned).toBeDefined()
    expect(learned!.learned!).toBeGreaterThan(13.5)
    expect(learned!.learned!).toBeLessThan(14.5) // 走り出しの 25° は入れない
    expect(out.some((o) => o.cue)).toBe(false)
  })

  it('猫背が1.5秒続いたら知らせ、超えたままなら4秒ごとに知らせ直す。戻れば止まる', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    expect(d.runLean).not.toBeNull()
    // 50秒から 27° の猫背を 20秒、そのあと 14° に戻す
    const out = play(d, 50, 80, (t) => (t < 70 ? 27 : 14), () => true)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    expect(cues.length).toBe(5) // 約51.5秒（ならし＋1.5秒）から 4秒ごと、70秒まで
    expect(cues[0]).toBeGreaterThan(51.5)
    expect(cues[0]).toBeLessThan(53)
    cues.slice(1).forEach((t, i) => expect(t - cues[i]).toBeCloseTo(HUNCH.cooldown, 5))
    expect(cues[cues.length - 1]).toBeLessThan(71)
  })

  it('線のすぐ下（走る前傾 + 7°）や、走っていない間は知らせない', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    expect(play(d, 50, 70, () => 21, () => true).some((o) => o.cue)).toBe(false)
    expect(play(d, 70, 90, () => 30, () => false).some((o) => o.cue)).toBe(false) // 止まって前かがみ（ベルトを止めたあと）
  })

  it('胸の値が途切れている間は、止まった値で覚えたり知らせたりしない', () => {
    const d = setup()
    play(d, 5, 8, () => 30, () => true) // 走り出してすぐ、猫背の向きのまま切れる
    const out: { cue: boolean; learned?: number; tilt: number | null }[] = []
    for (let t = 8 + HUNCH.stale + 0.1; t < 60; t += 0.1) out.push(d.update(t, true)) // 値が来ないまま判定だけ進む（切れて stale 秒あとから）
    expect(out.every((o) => o.tilt === null && !o.cue && o.learned === undefined)).toBe(true)
    expect(d.runLean).toBeNull()
  })

  it('一瞬（1.5秒未満）だけ超えたのは知らせない', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    const out = play(d, 50, 70, (t) => (Math.floor(t) % 3 === 0 ? 40 : 14), () => true)
    expect(out.some((o) => o.cue)).toBe(false)
  })
})

describe('センサーの記録', () => {
  const sample = (seq: number, t: number, k: number) => {
    const raw = new Uint8Array(12)
    const v = new DataView(raw.buffer)
    ;[k, -k, 100, 2048, -k * 3, 7].forEach((x, i) => v.setInt16(i * 2, x, true))
    return { seq, t, g: [0, 0, 0] as Vec3, a: [0, 0, 0] as Vec3, raw }
  }

  it('1件おきを残し、戻すと元の値・通し番号・時刻になる（通し番号 65535 をまたぐ）', () => {
    const r = new SensorRecorder([{ place: '胸', name: 'RFC-IMU-2' }])
    const all = Array.from({ length: 300 }, (_, k) => sample((65400 + k) & 0xffff, 5000 + k * 10, k))
    for (let i = 0; i < all.length; i += 3) r.add(0, 10 + i / 100, 16, all.slice(i, i + 3)) // 3件ずつ、届いた順に
    r.finish()
    const got = r.log.blocks.flatMap((b) => decodeBlock(b[2]))
    const kept = all.filter((s) => s.seq % SENSOR_LOG.stride === 0)
    expect(got.length).toBe(kept.length)
    got.forEach((s, i) => {
      expect(s.seq).toBe(kept[i].seq)
      expect(s.t).toBe(kept[i].t)
      const k = (kept[i].seq - 65400) & 0xffff
      near(s.g[0], k * 0.07)
      near(s.a[0], 2048 * 0.000488)
      near(s.a[1], -k * 3 * 0.000488)
    })
    expect(r.log.blocks.length).toBe(3) // 約1秒ずつ
  })

  it('抜けで間があいても、新しいブロックにして時刻を保つ', () => {
    const r = new SensorRecorder([{ place: '胸', name: 'RFC-IMU-2' }])
    r.add(0, 1, 16, [sample(0, 1000, 1), sample(2, 1020, 2)])
    r.add(0, 1.5, 16, [sample(600, 7000, 3)]) // 通し番号が 598 飛んだ
    r.finish()
    expect(r.log.blocks.length).toBe(2)
    expect(decodeBlock(r.log.blocks[1][2])).toMatchObject([{ seq: 600, t: 7000 }])
  })

  it('上限を超えたら値は残さず、知らせた記録は残す', () => {
    const r = new SensorRecorder([{ place: '胸', name: 'RFC-IMU-2' }], { ...SENSOR_LOG, maxChars: 1000 })
    for (let i = 0; i < 2000; i += 2) r.add(0, i / 100, 16, [sample(i, i * 10, 0)])
    r.cue(30, 27.34, true)
    r.finish()
    const chars = r.log.blocks.reduce((n, b) => n + b[2].length, 0)
    expect(chars).toBeLessThanOrEqual(1000)
    expect(r.log.cappedAt).toBeDefined()
    expect(r.log.cues).toEqual([[30, 27.3, 1]])
  })

  it('30分・5個の大きさが上限に収まる', () => {
    const perSec = 5 * (100 / SENSOR_LOG.stride) * 14 + 5 * 7 // 1秒ぶんのバイト（ブロックの頭を足す）
    expect(Math.ceil((perSec * 1800 * 4) / 3)).toBeLessThan(SENSOR_LOG.maxChars)
  })

  it('センサーのない古い記録も、そのまま読める', () => {
    const old = JSON.parse('{"id":"log-1","startedAt":1,"width":0,"height":0,"columns":[],"points":[],"phases":[],"rows":[],"events":[]}') as RunLog
    expect(old.sensors).toBeUndefined()
    expect(old.sensors?.blocks ?? []).toEqual([])
  })
})
