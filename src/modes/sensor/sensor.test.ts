import { describe, expect, it } from 'vitest'
import { parseBattery, parsePacket, type Vec3 } from './parse'
import { LeanDetector, type LeanStep } from './lean'
import { batteryPercent } from './battery'
import { decodeBlock, nodeHz, SensorRecorder } from './log'
import { HEAD, HUNCH, HUNCH_BY_LEVEL, SENSOR_LOG } from './params'
import { slipNotes } from './slipText'
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
const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)

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

// 胸の向き：立った姿勢（重力が z）から、前（x）へ deg 度、横（y）へ side 度傾けた加速度（g）
const lean = (deg: number, side = 0): Vec3 => {
  const r = Math.PI / 180
  return [Math.sin(deg * r) * Math.cos(side * r), Math.sin(side * r), Math.cos(deg * r) * Math.cos(side * r)]
}

// 100Hz で胸の値を流し、0.1秒ごとに判定する。tiltAt(秒) → 傾き、runAt(秒) → 走っているか
function play(d: LeanDetector, from: number, to: number, tiltAt: (t: number) => number, runAt: (t: number) => boolean, sideAt: (t: number) => number = () => 0) {
  const out: ({ t: number } & LeanStep)[] = []
  for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
    const t = i / 100
    d.sample(t, lean(tiltAt(t), sideAt(t)))
    if (i % 10 === 0) out.push({ t, ...d.update(t, runAt(t)) })
  }
  return out
}

describe('胸のセンサーで猫背を見る', () => {
  // 立つ（0〜5秒）→ 基準 → 走る（ふつう 14°）。走る前傾を覚えたあと、猫背 27° にする
  const setup = (p = HUNCH) => {
    const d = new LeanDetector(p)
    play(d, 0, 5, () => 0, () => false)
    expect(d.stand(5, 3)).toBe(true)
    return d
  }

  it('立った姿勢を覚える前と、値が足りないときは知らせない', () => {
    const d = new LeanDetector(HUNCH)
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

  it('線のすぐ下（走る前傾 + margin − 1°）や、走っていない間は知らせない', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    expect(play(d, 50, 70, () => 14 + HUNCH.margin - 1, () => true).some((o) => o.cue)).toBe(false)
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
  // ベルトの上でセンサーが少しずつずれる（2026-11-02 の走り：3分半で約15°）。基準をゆっくり寄せて、鳴らさない
  it('ゆっくりのずれ（3分半で +21°）では知らせない。寄せないと鳴り続ける', () => {
    const drift = (t: number) => (t < 50 ? 14 : 14 + (t - 50) * 0.1)
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    const out = play(d, 50, 260, drift, () => true)
    expect(out.some((o) => o.cue)).toBe(false)
    expect(out[out.length - 1].ref!).toBeGreaterThan(28) // 基準がずれについていった
    const fixed = setup({ ...HUNCH, follow: 0 })
    play(fixed, 5, 50, () => 14, () => true)
    expect(play(fixed, 50, 260, drift, () => true).filter((o) => o.cue).length).toBeGreaterThan(10)
  })

  it('ずれたあとでも、数秒で 12° 前に傾けば知らせる', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    play(d, 50, 260, (t) => 14 + (t - 50) * 0.1, () => true) // 35° までずれる
    const out = play(d, 260, 290, (t) => 35 + Math.min(12, (t - 260) * 4), () => true) // 3秒で +12°
    const cues = out.filter((o) => o.cue)
    expect(cues.length).toBeGreaterThanOrEqual(5) // 超えている間は基準を動かさないので、知らせ続ける
    expect(cues[0].t).toBeLessThan(266)
  })

  // 寄せることの代わり：ゆっくり進む猫背（疲れて少しずつ丸まる）は吸ってしまう。follow 60秒・margin 8° で、+12° なら約50秒より速く進めば知らせる
  it('+12° の猫背：30秒で進めば知らせ、3分かけて進めば知らせない', () => {
    for (const [sec, want] of [[30, true], [180, false]] as const) {
      const d = setup()
      play(d, 5, 50, () => 14, () => true)
      const out = play(d, 50, 50 + sec + 20, (t) => 14 + Math.min(12, ((t - 50) * 12) / sec), () => true)
      expect(out.some((o) => o.cue)).toBe(want)
    }
  })

  // ずれの見張り（2026-11-03 15:08 の走り：胸のセンサーがずれて、傾きが +13° 前後のまま9分続いた。カメラの上体は 3〜6° のまま）
  it('急にずれて線を越えたまま：slipSec 秒で基準を置き直し、それからは鳴らない', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    const out = play(d, 50, 400, () => 27, () => true) // 50秒で +13° ずれ、そのまま
    const slips = out.filter((o) => o.slip)
    expect(slips.length).toBe(1)
    expect(slips[0].t).toBeGreaterThan(50 + HUNCH.slipSec)
    expect(slips[0].t).toBeLessThan(50 + HUNCH.slipSec + 3)
    expect(slips[0].slip!.from).toBeCloseTo(14, 0)
    expect(slips[0].slip!.to).toBeCloseTo(27, 0)
    expect(d.slips).toBe(1)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    expect(cues.length).toBeGreaterThan(15) // それまでは4秒ごと
    expect(cues.every((t) => t < slips[0].t)).toBe(true) // 置き直したあとは鳴らない
    // 置き直したあとでも、そこから数秒で崩れれば知らせる
    expect(play(d, 400, 420, () => 27 + 12, () => true).some((o) => o.cue)).toBe(true)
    // 見張らなければ、走り終わるまで鳴り続ける
    const off = setup({ ...HUNCH, slipSec: 0, slipDrift: 0 })
    play(off, 5, 50, () => 14, () => true)
    expect(play(off, 50, 400, () => 27, () => true).filter((o) => o.cue).length).toBeGreaterThan(80)
  })

  it('わざとの猫背 60秒は、ずれとみなさず知らせ続ける。60秒あけてもう一度でも同じ', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    const out = play(d, 50, 250, (t) => ((t >= 60 && t < 120) || (t >= 180 && t < 240) ? 27 : 14), () => true)
    expect(out.some((o) => o.slip)).toBe(false)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    expect(cues.filter((t) => t >= 60 && t < 121).length).toBeGreaterThanOrEqual(14)
    expect(cues.filter((t) => t >= 180 && t < 241).length).toBeGreaterThanOrEqual(14)
  })

  it('ゆっくりずれて基準が slipDrift より前へ動いたら、ずれとみなす（知らせはしない）', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    const out = play(d, 50, 260, (t) => 14 + (t - 50) * 0.1, () => true) // 3分半で +21°
    expect(out.some((o) => o.cue)).toBe(false)
    const slips = out.filter((o) => o.slip)
    expect(slips.length).toBeGreaterThanOrEqual(1)
    expect(slips[0].ref! - 14).toBeGreaterThan(HUNCH.slipDrift - 1) // 基準が動いた量が slipDrift に届いたところ（置き直した先は今の傾き）
    // 後ろへ動いた（傾きが減った）のは、ずれとみなさない
    const back = setup()
    play(back, 5, 50, () => 20, () => true)
    expect(play(back, 50, 300, (t) => 20 - Math.min(15, (t - 50) * 0.1), () => true).some((o) => o.slip)).toBe(false)
  })

  it('横に傾いただけ（前への傾きは同じ）では知らせない', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    expect(d.fwd).not.toBeNull()
    const out = play(d, 50, 70, () => 14, () => true, () => 20)
    expect(out.some((o) => o.cue)).toBe(false)
    expect(out[out.length - 1].tilt!).toBeCloseTo(14, 0)
  })
})

describe('走る前傾が小さいとき（2026-11-05：頭 2.9°・胸 6.1°）', () => {
  // 立つ → 走る前傾は横向きに 3°（揺れで決まった向き）→ 頭を前に 26° 出す（線は 3 + 18°）
  const run = (p: typeof HEAD) => {
    const d = new LeanDetector(p)
    play(d, 0, 5, () => 0, () => false)
    d.stand(5, 3)
    play(d, 5, 50, () => 0, () => true, () => 3)
    return { d, out: play(d, 50, 70, () => 26, () => true, () => 3) }
  }

  it('前の向きを決めず（向きによらない角度）、前に出た頭を知らせる', () => {
    const { d, out } = run(HEAD)
    expect(HEAD.fwdMin).toBeGreaterThan(3)
    expect(d.fwd).toBeNull()
    expect(out.some((o) => o.cue)).toBe(true)
  })

  it('前の向きを小さい傾きで決めると（前の fwdMin 1°）、横向きになって前に出た頭を数えない', () => {
    const { d, out } = run({ ...HEAD, fwdMin: 1 })
    expect(d.fwd).not.toBeNull()
    expect(out.some((o) => o.cue)).toBe(false)
  })

  it('走る前傾が fwdMin より大きければ、前と同じく前の向きを決める', () => {
    const d = new LeanDetector(HUNCH)
    play(d, 0, 5, () => 0, () => false)
    d.stand(5, 3)
    play(d, 5, 50, () => HUNCH.fwdMin + 4, () => true)
    expect(d.fwd).not.toBeNull()
  })
})

describe('カメラ版：カメラが崩れていないと見ている間の、胸のずれ', () => {
  // 走る前傾 14°。50秒で胸のバンドが回って +13°（27°）のまま。カメラの上体・頭の位置は cam(t) で渡す
  const run = (cam: (t: number) => { trunk: number; head: number } | null, p = HUNCH) => {
    const d = new LeanDetector(p)
    const out: ({ t: number } & LeanStep)[] = []
    for (let i = 0; i < 20000; i++) {
      const t = i / 100
      d.sample(t, lean(t < 5 ? 0 : t < 50 ? 14 : 27))
      if (i === 500) d.stand(5, 3)
      if (i > 500 && i % 10 === 0) out.push({ t, ...d.update(t, true, false, cam(t)) })
    }
    return out
  }

  it('カメラの上体も頭の位置も変わらなければ、約 camSlipSec 秒でずれとみなして黙る', () => {
    const out = run(() => ({ trunk: 4, head: 35 }))
    const slip = out.find((o) => o.slip)
    expect(slip).toBeDefined()
    expect(slip!.t).toBeGreaterThan(50 + HUNCH.camSlipSec)
    expect(slip!.t).toBeLessThan(50 + HUNCH.camSlipSec + 3)
    expect(out.filter((o) => o.cue && o.t > slip!.t)).toHaveLength(0)
    expect(out.filter((o) => o.cue).length).toBeLessThanOrEqual(4)
  })

  it('カメラも崩れたと見ている（上体 +3°・頭 +6°）なら、ずれとみなさず知らせ続ける', () => {
    const out = run((t) => (t < 50 ? { trunk: 4, head: 35 } : { trunk: 7, head: 41 }))
    expect(out.filter((o) => o.slip && o.t < 50 + HUNCH.slipSec)).toHaveLength(0)
    expect(out.filter((o) => o.cue && o.t < 50 + HUNCH.slipSec).length).toBeGreaterThan(10)
  })

  it('上体は変わらなくても、頭の位置が前に出ていれば（背中を丸めると頭が落ちる）ずれとみなさない', () => {
    const out = run((t) => (t < 50 ? { trunk: 4, head: 35 } : { trunk: 4.5, head: 41 }))
    expect(out.filter((o) => o.slip && o.t < 50 + HUNCH.slipSec)).toHaveLength(0)
  })

  it('カメラの値がなければ（センサーラン・カメラが間引いている間）、前と同じく slipSec 秒を待つ', () => {
    const slip = run(() => null).find((o) => o.slip)
    expect(slip!.t).toBeGreaterThan(50 + HUNCH.slipSec)
    expect(HEAD.camSlipSec).toBe(0) // 頭は見ない（頭でずれたことはまだない）
  })
})

describe('胸の線はレベルごと（カメラの猫背の線に合わせる）', () => {
  const run = (p: typeof HUNCH, deg: number) => {
    const d = new LeanDetector(p)
    play(d, 0, 5, () => 0, () => false)
    d.stand(5, 3)
    play(d, 5, 50, () => 14, () => true)
    return play(d, 50, 60, () => 14 + deg, () => true).some((o) => o.cue)
  }

  it('上級ほどきびしい（線が低い）。どのレベルも前の線（+8°）より低く、ずれの見張りは 8° のまま', () => {
    const { beginner, intermediate, advanced } = HUNCH_BY_LEVEL
    expect(beginner.margin).toBeGreaterThan(intermediate.margin)
    expect(intermediate.margin).toBeGreaterThan(advanced.margin)
    for (const p of [beginner, intermediate, advanced]) {
      expect(p.margin).toBeLessThan(8)
      expect(p.slipDrift).toBe(8)
      expect(p.place).toBe(HUNCH.place)
    }
    expect(HUNCH).toEqual(intermediate) // レベルが分からないときは中級（カメラの既定と同じ）
  })

  it('同じ +5.5° の猫背に、上級は震え、初心者は震えない。+7° ならどのレベルも震える', () => {
    expect(run(HUNCH_BY_LEVEL.advanced, 5.5)).toBe(true)
    expect(run(HUNCH_BY_LEVEL.beginner, 5.5)).toBe(false)
    for (const p of Object.values(HUNCH_BY_LEVEL)) expect(run(p, 7)).toBe(true)
  })
})

describe('頭のセンサーで、頭が前に出たのを見る', () => {
  const setup = () => {
    const d = new LeanDetector(HEAD)
    play(d, 0, 5, () => 0, () => false)
    expect(d.stand(5, 3)).toBe(true)
    play(d, 5, 50, () => 6, () => true) // 走る前傾 6°（頭はほとんど前に傾かない）
    expect(d.runLean!).toBeCloseTo(6, 0)
    return d
  }

  it('頭が前に出る（+20°）と知らせ、戻れば止まる。線のすぐ下（+13°）では知らせない', () => {
    const d = setup()
    const out = play(d, 50, 80, (t) => (t < 65 ? 26 : 6), () => true)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    expect(cues.length).toBe(4) // 約51.5秒から 4秒ごと、65秒まで
    expect(cues[cues.length - 1]).toBeLessThan(66)
    expect(play(d, 80, 110, () => 6 + HEAD.margin - 1, () => true).some((o) => o.cue)).toBe(false)
  })

  it('うしろへ傾いた（上を向いた）のは知らせない', () => {
    const d = setup()
    expect(play(d, 50, 70, () => -20, () => true).some((o) => o.cue)).toBe(false)
  })
})

describe('体を曲げた（物を拾う）ときは、胸も頭も知らせない', () => {
  // 2026-11-04 の3回に似せた形：頭が先に下を向き（0.8秒で +55°）、胸は 1.2秒で 90° まで曲げて1秒、2秒かけて戻る
  const bendAt = 60
  const ramp = (t: number, t0: number, t1: number, a: number, b: number) => (t <= t0 ? a : t >= t1 ? b : a + ((b - a) * (t - t0)) / (t1 - t0))
  const chestOf = (t: number) => (t < bendAt + 2.2 ? ramp(t, bendAt, bendAt + 1.2, 14, 90) : ramp(t, bendAt + 2.2, bendAt + 4.2, 90, 14))
  const headOf = (t: number) => (t < bendAt + 2.2 ? ramp(t, bendAt - 0.8, bendAt + 0.4, 6, 62) : ramp(t, bendAt + 2.2, bendAt + 4.2, 62, 6))
  // 胸と頭を同じ時計で流す（アプリと同じく胸を先に見て、胸で曲げたと分かれば頭も止める）
  const both = (chest: LeanDetector, head: LeanDetector, from: number, to: number, c: (t: number) => number, h: (t: number) => number) => {
    const out: { t: number; chest: LeanStep; head: LeanStep }[] = []
    for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
      const t = i / 100
      chest.sample(t, lean(c(t)))
      head.sample(t, lean(h(t)))
      if (i % 10 === 0) {
        const rc = chest.update(t, true)
        out.push({ t, chest: rc, head: head.update(t, true, chest.bent(t)) })
      }
    }
    return out
  }
  const setup = () => {
    const chest = new LeanDetector(HUNCH)
    const head = new LeanDetector(HEAD)
    both(chest, head, 0, 5, () => 0, () => 0)
    expect(chest.stand(5, 3) && head.stand(5, 3)).toBe(true)
    both(chest, head, 5, 50, () => 14, () => 6)
    expect(chest.runLean!).toBeCloseTo(14, 0)
    return { chest, head }
  }

  it('曲げて戻る間は、胸も頭も震えない。曲げたことは1回だけ返す。そのあとの猫背は知らせる', () => {
    const { chest, head } = setup()
    const out = both(chest, head, 50, 90, (t) => (t < 75 ? chestOf(t) : 27), (t) => (t < 75 ? headOf(t) : 6))
    expect(out.filter((o) => o.t < 75 && (o.chest.cue || o.head.cue))).toEqual([])
    const bends = out.filter((o) => o.chest.bend !== undefined)
    expect(bends.length).toBe(1)
    expect(bends[0].t).toBeGreaterThan(bendAt)
    expect(bends[0].t).toBeLessThan(bendAt + 1.5)
    expect(out.find((o) => o.t >= bendAt + 6)!.chest.bent).toBe(true) // 戻ってから bendAfter 秒は見ない
    expect(out.some((o) => o.t > 75 && o.chest.cue)).toBe(true)
    expect(chest.slips + head.slips).toBe(0)
  })

  it('見張りを外すと、前と同じく胸も頭も震える（2026-11-04 の形）', () => {
    const chest = new LeanDetector({ ...HUNCH, bend: 0, confirmAbove: 0 })
    const head = new LeanDetector({ ...HEAD, confirmAbove: 0 })
    both(chest, head, 0, 5, () => 0, () => 0)
    chest.stand(5, 3)
    head.stand(5, 3)
    both(chest, head, 5, 50, () => 14, () => 6)
    const out = both(chest, head, 50, 75, chestOf, headOf)
    expect(out.some((o) => o.chest.cue)).toBe(true)
    expect(out.some((o) => o.head.cue)).toBe(true)
  })

  it('曲げている間は、基準を寄せず、越えていた時間も数えない（ずれの見張りに入れない）', () => {
    const { chest } = setup()
    const ref = chest.ref!
    for (let k = 0; k < 20; k++) both(chest, new LeanDetector(HEAD), 50 + k * 10, 60 + k * 10, (t) => ramp(t % 10, 1, 2, 14, 90) * (t % 10 < 4 ? 1 : 0) || 14, () => 6)
    expect(chest.slips).toBe(0)
    expect(Math.abs(chest.ref! - ref)).toBeLessThan(1)
  })

  it('わざとの大きな猫背（基準 +36°、11-03 のテストの大きさ）は曲げたとみなさず、1秒待って知らせる', () => {
    const { chest, head } = setup()
    const out = both(chest, head, 50, 70, (t) => (t < 55 ? 14 : 50), () => 6)
    expect(out.some((o) => o.chest.bend !== undefined || o.chest.bent)).toBe(false)
    const first = out.find((o) => o.chest.cue)!
    expect(first.t).toBeGreaterThan(55 + HUNCH.hold + HUNCH.confirmSec - 0.3)
    expect(first.t).toBeLessThan(55 + HUNCH.hold + HUNCH.confirmSec + 0.6)
  })

  it('ふつうの猫背（+10°）は、前と同じく待たずに知らせる', () => {
    const { chest, head } = setup()
    const out = both(chest, head, 50, 60, (t) => (t < 52 ? 14 : 24), () => 6)
    const first = out.find((o) => o.chest.cue)!
    expect(first.t).toBeLessThan(52 + HUNCH.hold + 0.6)
  })
})

describe('センサーの記録', () => {
  const sample = (seq: number, t: number, k: number) => {
    const raw = new Uint8Array(12)
    const v = new DataView(raw.buffer)
    ;[k, -k, 100, 2048, -k * 3, 7].forEach((x, i) => v.setInt16(i * 2, x, true))
    return { seq, t, g: [0, 0, 0] as Vec3, a: [0, 0, 0] as Vec3, raw }
  }

  it('足首は1件おきをそのまま残し、戻すと元の値・通し番号・時刻になる（通し番号 65535 をまたぐ）', () => {
    const r = new SensorRecorder([{ place: '左足首', name: 'RFC-IMU-3' }])
    expect(r.log.strides).toEqual([2])
    const all = Array.from({ length: 300 }, (_, k) => sample((65400 + k) & 0xffff, 5000 + k * 10, k))
    for (let i = 0; i < all.length; i += 3) r.add(0, 10 + i / 100, 16, all.slice(i, i + 3)) // 3件ずつ、届いた順に
    r.finish()
    const got = r.log.blocks.flatMap((b) => decodeBlock(b[2]))
    const kept = all.filter((s) => s.seq % SENSOR_LOG.rates['左足首'].every === 0)
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
    expect(nodeHz(r.log, 0)).toBe(50)
  })

  it('胸は4件ずつの平均（25Hz）を残す。通し番号と時刻は窓の先頭の件', () => {
    const r = new SensorRecorder([{ place: '胸', name: 'RFC-IMU-2' }])
    expect(SENSOR_LOG.rates['胸']).toEqual({ every: 4, mean: true })
    const all = Array.from({ length: 200 }, (_, k) => sample(k + 3, 5000 + k * 10, k)) // 3 から始まる（最初の窓 0〜3 は 3 だけ）
    for (let i = 0; i < all.length; i += 7) r.add(0, 10 + i / 100, 16, all.slice(i, i + 7))
    r.finish()
    const got = r.log.blocks.flatMap((b) => decodeBlock(b[2]))
    expect(got.length).toBe(51) // 0、4、…、200（200〜202 の3件）
    expect(got[0]).toMatchObject({ seq: 0, t: 5000 })
    near(got[0].g[0], 0)
    expect(got[1]).toMatchObject({ seq: 4, t: 5010 })
    near(got[1].g[0], 2.5 * 0.07, 0.036) // k = 1〜4 の平均（1未満は丸め）
    near(got[1].a[0], 2048 * 0.000488)
    near(got[1].a[1], -7.5 * 0.000488, 0.000245)
    expect(got[50]).toMatchObject({ seq: 200, t: 5000 + 197 * 10 })
    expect(r.log.mean).toEqual([true])
    expect(nodeHz(r.log, 0)).toBe(25)
  })

  it('平均の窓は、抜けがあっても通し番号で区切る（65535 をまたいでも）', () => {
    const r = new SensorRecorder([{ place: '頭', name: 'RFC-IMU-1' }])
    r.add(0, 1, 16, [sample(65532, 100, 4), sample(65534, 120, 8), sample(65535, 130, 8)])
    r.add(0, 1.1, 16, [sample(1, 150, 0)])
    r.finish()
    const got = r.log.blocks.flatMap((b) => decodeBlock(b[2]))
    expect(got.map((s) => s.seq)).toEqual([65532, 0])
    near(got[0].g[0], (20 / 3) * 0.07, 0.036)
  })

  it('抜けで間があいても、新しいブロックにして時刻を保つ', () => {
    const r = new SensorRecorder([{ place: '左足首', name: 'RFC-IMU-3' }])
    r.add(0, 1, 16, [sample(0, 1000, 1), sample(2, 1020, 2)])
    r.add(0, 1.5, 16, [sample(600, 7000, 3)]) // 通し番号が 598 飛んだ
    r.finish()
    expect(r.log.blocks.length).toBe(2)
    expect(decodeBlock(r.log.blocks[1][2])).toMatchObject([{ seq: 600, t: 7000 }])
  })

  it('上限はなく、長く走っても最後まで残す', () => {
    const r = new SensorRecorder([{ place: '左足首', name: 'RFC-IMU-3' }])
    for (let i = 0; i < 200_000; i += 2) r.add(0, i / 100, 16, [sample(i & 0xffff, i * 10, 0)])
    r.cue(30, 27.34, true)
    r.finish()
    expect(r.log.cappedAt).toBeUndefined()
    expect(r.log.blocks.reduce((n, b) => n + decodeBlock(b[2]).length, 0)).toBe(100_000)
    expect(r.log.cues).toEqual([[30, 27.3, 1]])
  })

  it('1時間の大きさ：5か所（頭・胸・左手首・両足首）で約12MB（前の 50Hz × 5か所は約17MB）', () => {
    const perHour = (every: (place: string) => number) =>
      ['頭', '胸', '左手首', '左足首', '右足首'].reduce((n, p) => n + (((100 / every(p)) * 14 + 9) * 3600 * 4) / 3, 0) // ブロックの頭 9バイト/秒
    const now = perHour((p) => SENSOR_LOG.rates[p].every)
    const before = perHour(() => 2)
    expect(before / 1e6).toBeGreaterThan(16.5)
    expect(now / 1e6).toBeLessThan(12.5)
    expect(now / 1e6).toBeGreaterThan(11.5)
  })

  it('頭で知らせた記録は head に、胸は前と同じ cues に入る', () => {
    const r = new SensorRecorder([{ place: '頭', name: 'RFC-IMU-1' }])
    r.cue(30, 27.34, true)
    r.cue(31, 22.06, false, 'head')
    expect(r.log.cues).toEqual([[30, 27.3, 1]])
    expect(r.log.head?.cues).toEqual([[31, 22.1, 0]])
  })

  it('頭を見る前の記録（head がない）も、そのまま読める', () => {
    const old = JSON.parse('{"version":1,"nodes":[],"stride":2,"blocks":[],"cues":[[1,30,1]],"runLean":{"t":1,"deg":20}}') as NonNullable<RunLog['sensors']>
    expect(old.head?.cues ?? []).toEqual([])
    expect(old.cues.length).toBe(1)
  })

  it('センサーのない古い記録も、そのまま読める', () => {
    const old = JSON.parse('{"id":"log-1","startedAt":1,"width":0,"height":0,"columns":[],"points":[],"phases":[],"rows":[],"events":[]}') as RunLog
    expect(old.sensors).toBeUndefined()
    expect(old.sensors?.blocks ?? []).toEqual([])
  })
})

describe('電池の残り', () => {
  it('電圧を % の目安にする（満タン 100、空 0、間は表を直線でつなぐ）', () => {
    expect(batteryPercent(4.25)).toBe(100)
    expect(batteryPercent(4.2)).toBe(100)
    expect(batteryPercent(3.96)).toBe(75)
    expect(batteryPercent(3.74)).toBe(20)
    expect(batteryPercent(3.71)).toBe(15)
    expect(batteryPercent(3.2)).toBe(0)
  })
})

describe('結果の画面の「センサーがずれたようです」', () => {
  const base = { version: 1 as const, nodes: [], stride: 2, blocks: [], cues: [] }
  it('胸と頭の slips から、走り出してからの分で知らせる。ずれていなければ何も出さない', () => {
    expect(slipNotes(undefined)).toEqual([])
    expect(slipNotes({ ...base })).toEqual([])
    const log = { ...base, stand: { t: 80, base: [0, 0, 1] as [number, number, number] }, slips: [[851, 18.2, 34.6]] as [number, number, number][], head: { cues: [], slips: [[200, 6, 25], [230, 25, 45]] as [number, number, number][] } }
    expect(slipNotes(log)).toEqual(['胸のセンサーが13分ごろにずれたようです。次は付け直してください', '頭のセンサーが2分・3分ごろにずれたようです。次は付け直してください'])
  })
})
