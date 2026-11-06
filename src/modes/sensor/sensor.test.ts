import { describe, expect, it } from 'vitest'
import { parseBattery, parsePacket, type Vec3 } from './parse'
import { HeadYield, LeanDetector, type LeanStep } from './lean'
import { batteryPercent } from './battery'
import { decodeBlock, nodeHz, SensorRecorder } from './log'
import { HEAD, HEAD_YIELD, HUNCH, HUNCH_BY_LEVEL, SENSOR_LOG } from './params'
import { slipNotes } from './slipText'
import type { RunLog } from '../../core/types'
import { CUE as CUE_P } from '../../core/params'

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

  it('猫背が3秒（CUE.sustain）続いたら知らせ、超えたままなら4秒ごとに知らせ直す。戻れば止まる', () => {
    const d = setup()
    play(d, 5, 50, () => 14, () => true)
    expect(d.runLean).not.toBeNull()
    expect(HUNCH.hold).toBe(CUE_P.sustain)
    // 50秒から 27° の猫背を 20秒、そのあと 14° に戻す
    const out = play(d, 50, 80, (t) => (t < 70 ? 27 : 14), () => true)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    expect(cues.length).toBe(5) // 約53秒（ならし＋3秒）から 4秒ごと、70秒まで
    expect(cues[0]).toBeGreaterThan(50 + CUE_P.sustain)
    expect(cues[0]).toBeLessThan(54.5)
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
    // 見張らなければ、走り終わるまで鳴り続ける（1時間の上限 LIMIT.perHour も外して見る。上限は limit.test.ts）
    const off = new LeanDetector({ ...HUNCH, slipSec: 0, slipDrift: 0 }, 5, Infinity)
    play(off, 0, 5, () => 0, () => false)
    expect(off.stand(5, 3)).toBe(true)
    play(off, 5, 50, () => 14, () => true)
    expect(play(off, 50, 400, () => 27, () => true).filter((o) => o.cue).length).toBeGreaterThan(80)
  })

  it('わざとの猫背 60秒は、ずれとみなさず知らせ続ける。60秒あけてもう一度でも同じ', () => {
    // 1つの立ち方で見るときは4秒ごとなので、60秒 ×2 で1時間の上限（20回）を越える。ここではずれの見張りだけを見るので、上限は外す
    const d = new LeanDetector(HUNCH, 5, Infinity)
    play(d, 0, 5, () => 0, () => false)
    expect(d.stand(5, 3)).toBe(true)
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
    expect(cues.length).toBe(3) // 約53秒（ならし＋3秒）から 4秒ごと、65秒まで
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

describe('猫背を頭より先に（胸が猫背のときは頭を震わせない）', () => {
  // アプリ（session.ts の tick・resolveHead）と同じく胸を先に見て、頭が知らせる直前に HeadYield に聞き、tick ごとに待たせた知らせを片づける。
  // chest・head：その tick に震わせたか（待ち終わりに替えた知らせも入れる）。y が null なら前と同じ（胸と頭は別々）
  type Tick = { t: number; chest: boolean; head: boolean }
  const both = (chest: LeanDetector, head: LeanDetector, y: HeadYield | null, from: number, to: number, c: (t: number) => number, h: (t: number) => number) => {
    const out: Tick[] = []
    for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
      const t = i / 100
      chest.sample(t, lean(c(t)))
      head.sample(t, lean(h(t)))
      if (i % 10 !== 0) continue
      const rc = chest.update(t, true)
      const rh = head.update(t, true, chest.bent(t), null, y ? () => y.defer(t, chest) : undefined)
      const o = { t, chest: rc.cue, head: rh.cue }
      const r = y?.resolve(t, true, chest, rc.cue) ?? null
      if (r === 'done' || r === 'chest') head.consume(t)
      if (r === 'chest') {
        chest.force(t)
        o.chest = true
      }
      if (r === 'head') {
        head.force(t)
        o.head = true
      }
      out.push(o)
    }
    return out
  }
  // 立つ → 走る（胸 14°・頭 6°）。走る前傾を覚えたあとの 44秒で返す（続きは 44秒から流す）
  const setup = (y: HeadYield | null) => {
    const chest = new LeanDetector(HUNCH, 5, Infinity)
    const head = new LeanDetector(HEAD, 5, Infinity)
    both(chest, head, y, 0, 5, () => 0, () => 0)
    chest.stand(5, 3)
    head.stand(5, 3)
    both(chest, head, y, 5, 44, () => 14, () => 6)
    return { chest, head }
  }
  const chestLine = 14 + HUNCH.margin
  const slight = 14 + 0.8 * HUNCH.margin // 胸が線の手前（線の幅の 0.8。直近 riseSec 秒の平均が riseFrac を越える）
  const headUp = 6 + HEAD.margin + 10 // 頭が線を 10° 越える（confirmAbove には届かない）
  const headAt = (t: number) => (t < 50 ? 6 : headUp) // 頭は 50秒で前に出る
  const first = (out: Tick[], k: 'chest' | 'head') => out.find((o) => o[k])?.t

  it('頭が先に線を越えても、胸の猫背が上がってきていれば頭を待たせ、胸が越えたら胸だけを震わせる', () => {
    const chestOf = (t: number) => (t < 50 ? 14 : t < 51.5 ? slight : chestLine + 4)
    const y = new HeadYield()
    const { chest, head } = setup(y)
    const out = both(chest, head, y, 44, 70, chestOf, headAt)
    expect(first(out, 'chest')).toBeDefined()
    expect(first(out, 'head')).toBeUndefined()
    // 待たせないと、頭が胸より先に震える
    const b = setup(null)
    const old = both(b.chest, b.head, null, 44, 70, chestOf, headAt)
    expect(first(old, 'head')!).toBeLessThan(first(old, 'chest')!)
  })

  it('待ち終わりに胸が線を越えたまま3秒（CUE.sustain）続いていれば、頭の代わりに胸を震わせる。すぐあとに頭は震わせない', () => {
    // 胸は線の手前で頭を待たせ（頭が線を越えて3秒、約53秒から）、待つ間の 53.5秒から線を越える。
    // 胸が自分で震える前に待ち終わり（約57秒）が来るよう、胸の次の知らせまでの間を 58秒まであけておく
    const y = new HeadYield()
    const a = setup(y)
    const chestOf = (t: number) => (t < 44 ? 14 : t < 53.5 ? slight : chestLine + 4)
    a.chest.consume(54)
    const now = both(a.chest, a.head, y, 44, 64, chestOf, headAt)
    expect(first(now, 'head')).toBeUndefined()
    expect(first(now, 'chest')).toBeDefined()
    // 胸に替えたあとは、頭はすぐには震わせない（頭の次の知らせまでの間を数え直す）
    expect(now.filter((o) => o.head && o.t < first(now, 'chest')! + HEAD.cooldown - 0.05)).toEqual([])
  })

  it('待ち終わりに胸が上がってきているだけ（線の手前）か、一瞬だけ線を越えたなら、胸には替えず頭を震わせる', () => {
    for (const chestOf of [(t: number) => (t < 44 ? 14 : slight), (t: number) => (t < 44 ? 14 : t >= 55 && t < 56 ? chestLine + 4 : slight)]) {
      const y = new HeadYield()
      const a = setup(y)
      const now = both(a.chest, a.head, y, 44, 60, chestOf, headAt)
      const b = setup(null)
      const old = both(b.chest, b.head, null, 44, 60, chestOf, headAt)
      expect(first(old, 'chest')).toBeUndefined()
      expect(first(now, 'chest')).toBeUndefined()
      // 待たせた分（HEAD_YIELD.hold）だけ遅れて、頭を震わせる
      expect(first(now, 'head')! - first(old, 'head')!).toBeCloseTo(HEAD_YIELD.hold, 0)
    }
  })

  it('待ち終わりに胸が上がってこなくなっていれば、頭を震わせる（頭が線の下に戻っていても、なくさない）', () => {
    // 胸は 44〜52秒だけ線の手前、頭は 50〜55秒だけ前に出る（頭は越えて3秒で知らせる）
    const chestOf = (t: number) => (t >= 44 && t < 52 ? slight : 14)
    const headOf = (t: number) => (t >= 50 && t < 55 ? headUp : 6)
    const y = new HeadYield()
    const a = setup(y)
    const now = both(a.chest, a.head, y, 44, 70, chestOf, headOf)
    expect(first(now, 'chest')).toBeUndefined()
    expect(now.filter((o) => o.head).length).toBe(1)
  })

  it('胸がふつう（14°のまま）なら、頭だけ前に出たのを前と同じ時刻に震わせる', () => {
    const y = new HeadYield()
    const a = setup(y)
    const now = both(a.chest, a.head, y, 44, 70, () => 14, () => headUp)
    const b = setup(null)
    const old = both(b.chest, b.head, null, 44, 70, () => 14, () => headUp)
    expect(first(now, 'head')).toBeDefined()
    expect(first(now, 'head')).toBe(first(old, 'head'))
  })

  it('胸が線を越えている間は、頭は震わせない（胸が知らせ続ける）。胸が戻れば、頭を震わせる', () => {
    const y = new HeadYield()
    const { chest, head } = setup(y)
    const out = both(chest, head, y, 44, 90, (t) => (t < 70 ? chestLine + 5 : 14), () => headUp)
    expect(out.filter((o) => o.t < 70 && o.chest).length).toBeGreaterThan(1)
    expect(out.some((o) => o.t < 70 && o.head)).toBe(false)
    expect(out.some((o) => o.t >= 70 && o.head)).toBe(true)
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

// 2つの立ち方（lean.ts の setPoses、params.ts の POSE）。a：いつもの楽な立ち方（猫背）、b：胸を開いた立ち方。
// ここでは b を 0°、a を前へ 15° とし、走ると体ごと 8° 前に傾く（猫背のままなら 15 + 8 = 23°）
describe('2つの立ち方で猫背を見る', () => {
  const A = 15
  const BODY = 8
  // 0〜3秒 a、3〜6秒 b で立ち、6秒で決める。cam があれば、b のときのカメラの上体を渡す
  const setup = (p = HUNCH, camB: number | null = null, a = A) => {
    const d = new LeanDetector(p)
    play(d, 0, 3, () => a, () => false)
    const da = d.dirOver(3, 3)!
    play(d, 3, 6, () => 0, () => false)
    const db = d.dirOver(6, 3)!
    return { d, ok: d.setPoses(da, db, camB) }
  }
  const run = (d: LeanDetector, from: number, to: number, tiltAt: (t: number) => number, cam: ((t: number) => { trunk: number; head: number }) | null = null, sideAt: (t: number) => number = () => 0) => {
    const out: ({ t: number } & LeanStep)[] = []
    for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
      const t = i / 100
      d.sample(t, lean(tiltAt(t), sideAt(t)))
      if (i % 10 === 0) out.push({ t, ...d.update(t, true, false, cam ? cam(t) : null) })
    }
    return out
  }

  it('a と b の角度を猫背の大きさ、b → a を前の向きにする。胸の線は決まった度数（poseLine）で、a と b の差によらない', () => {
    const { d, ok } = setup()
    expect(ok).toBe(true)
    expect(d.pose!.deg).toBeCloseTo(A, 1)
    expect(HUNCH.poseLine).toBe(5)
    expect(d.margin()).toBe(HUNCH.poseLine)
    expect(setup(HUNCH, null, 25).d.margin()).toBe(HUNCH.poseLine) // 胸をよく開ける人でも、線は遠くならない
    expect(d.fwd![0]).toBeCloseTo(1, 3) // 前（x）
    // 猫背の割合：b ＝ 0、a ＝ 1
    run(d, 6, 10, () => A)
    expect(d.index()!).toBeGreaterThan(0.95)
  })

  it('差が poseMin より小さければ覚えない（呼ぶ側が測り直す）', () => {
    const { d, ok } = setup(HUNCH, null, HUNCH.poseMin - 1)
    expect(ok).toBe(false)
    expect(d.pose).toBeNull()
    expect(d.base).toBeNull()
  })

  it('猫背のまま走り出しても知らせる（走る前傾は poseCap までしか差し引かない）。今までの見方では知らせなかった', () => {
    const { d } = setup()
    const out = run(d, 6, 6 + HUNCH.skip + HUNCH.learn + 30, () => A + BODY)
    const learned = out.find((o) => o.learned !== undefined)!
    expect(learned.learned!).toBeCloseTo(A + BODY, 0)
    expect(learned.offset!).toBeCloseTo(HUNCH.poseCap, 5)
    expect(d.offset!.by).toBe('cap')
    expect(out.filter((o) => o.cue && o.t > learned.t).length).toBeGreaterThan(3)
    // 今までの見方（b を立った姿勢、走り出しの前傾 + margin）：猫背を基準にして知らせない
    const old = new LeanDetector(HUNCH)
    play(old, 0, 3, () => 0, () => false)
    old.stand(3, 3)
    expect(play(old, 3, 3 + HUNCH.skip + HUNCH.learn + 30, () => A + BODY, () => true).some((o) => o.cue)).toBe(false)
  })

  it('胸を開いたまま走れば（体ごとの前傾だけ）知らせない。そこから猫背になれば知らせる', () => {
    const { d } = setup()
    const out = run(d, 6, 6 + HUNCH.skip + HUNCH.learn + 30, () => BODY)
    expect(out.find((o) => o.learned !== undefined)!.offset!).toBeCloseTo(BODY, 0) // poseCap より小さいので、そのまま差し引く
    expect(d.offset!.by).toBe('sensor')
    expect(out.some((o) => o.cue)).toBe(false)
    const t0 = 6 + HUNCH.skip + HUNCH.learn + 30
    expect(run(d, t0, t0 + 10, () => A + BODY).some((o) => o.cue)).toBe(true)
  })

  it('体ごとの前傾が大きくても、poseCap + 線の幅の内なら知らせない。越えると知らせる（体ごとの前傾と猫背は分けられない）', () => {
    const line = HUNCH.poseCap + HUNCH.poseLine
    for (const [lean, cue] of [[line - 1, false], [line + 2, true]] as const) {
      const { d } = setup()
      expect(run(d, 6, 6 + HUNCH.skip + HUNCH.learn + 30, () => lean).some((o) => o.cue)).toBe(cue)
    }
  })

  it('カメラ版：カメラの上体の増えが小さければ、差し引く分をそれ + poseCamSlack までに抑える', () => {
    // b のときのカメラの上体 −4°。走り出しでカメラの上体は +2°（増え 6°）だが、胸は猫背のまま 23°
    const { d } = setup(HUNCH, -4)
    const out = run(d, 6, 6 + HUNCH.skip + HUNCH.learn + 30, () => A + BODY, () => ({ trunk: 2, head: 40 }))
    const want = Math.min(HUNCH.poseCap, 6 + HUNCH.poseCamSlack)
    expect(out.find((o) => o.learned !== undefined)!.offset!).toBeCloseTo(want, 3)
    expect(d.offset!.by).toBe(want < HUNCH.poseCap ? 'camera' : 'cap')
    expect(d.offset!.cam!).toBeCloseTo(6, 3)
    expect(out.some((o) => o.cue)).toBe(true)
    // カメラの値がなければ、センサーランと同じ（poseCap まで）
    const s = setup(HUNCH, -4).d
    run(s, 6, 6 + HUNCH.skip + HUNCH.learn + 1, () => A + BODY)
    expect(s.offset!.by).toBe('cap')
  })

  const L0 = 6 + HUNCH.skip + HUNCH.learn // 走る前傾を覚え終わる t

  it('猫背のまま3分走り続けても、ずれとみなさず知らせ続ける。5回のあとは poseBackoffEvery 秒ごと', () => {
    const { d } = setup()
    const out = run(d, 6, L0 + 180, () => A + BODY)
    expect(out.some((o) => o.slip)).toBe(false)
    expect(out.filter((o) => o.tilt !== null && o.t > L0 + 2).every((o) => o.plausible)).toBe(true)
    const cues = out.filter((o) => o.cue).map((o) => o.t)
    // はじめの5回は cooldown（4秒）ごと、そのあとは poseBackoffEvery ごと
    cues.slice(1, HUNCH.poseBackoffAfter).forEach((t, i) => expect(t - cues[i]).toBeCloseTo(HUNCH.cooldown, 5))
    cues.slice(HUNCH.poseBackoffAfter).forEach((t, i) => expect(t - cues[HUNCH.poseBackoffAfter - 1 + i]).toBeCloseTo(HUNCH.poseBackoffEvery, 5))
    expect(cues[cues.length - 1]).toBeGreaterThan(L0 + 165) // 最後まで知らせている
    // 線の下に poseBackoffReset 秒いたら、また4秒ごとに戻る
    const t1 = L0 + 180
    run(d, t1, t1 + HUNCH.poseBackoffReset + 5, () => BODY)
    const again = run(d, t1 + HUNCH.poseBackoffReset + 5, t1 + HUNCH.poseBackoffReset + 20, () => A + BODY).filter((o) => o.cue).map((o) => o.t)
    expect(again[1] - again[0]).toBeCloseTo(HUNCH.cooldown, 5)
  })

  it('ベルトが横に回った（b→a と直角に 25°）なら、猫背ではないので slipSec 秒でずれとみなす', () => {
    const { d } = setup()
    run(d, 6, L0 + 20, () => BODY)
    const out = run(d, L0 + 20, L0 + 200, () => BODY + 12, null, () => 25)
    const slip = out.find((o) => o.slip)
    expect(slip).toBeDefined()
    expect(slip!.t - (L0 + 20)).toBeGreaterThan(HUNCH.slipSec)
    expect(slip!.t - (L0 + 20)).toBeLessThan(HUNCH.slipSec + 5)
    expect(out.filter((o) => o.cue && o.t > slip!.t)).toHaveLength(0)
  })

  it('前へ大きく（猫背の割合が poseSlipIdx より大きい）傾いたままでも、ずれとみなす', () => {
    const { d } = setup()
    run(d, 6, L0 + 20, () => BODY)
    const out = run(d, L0 + 20, L0 + 200, () => BODY + A * (HUNCH.poseSlipIdx + 0.5))
    expect(out.some((o) => o.slip)).toBe(true)
  })

  it('今までの見方（stand）では、前と同じく越えたままなら slipSec 秒でずれとみなし、4秒ごとのまま', () => {
    const old = new LeanDetector(HUNCH)
    play(old, 0, 3, () => 0, () => false)
    old.stand(3, 3)
    play(old, 3, 3 + HUNCH.skip + HUNCH.learn + 10, () => BODY, () => true)
    const out = play(old, 53, 200, () => BODY + 15, () => true)
    expect(out.some((o) => o.slip)).toBe(true)
    expect(out.every((o) => o.plausible === undefined)).toBe(true)
  })

  it('stand で覚え直すと、2つの立ち方の物差しは消えて今までの見方に戻る', () => {
    const { d } = setup()
    play(d, 6, 9, () => 0, () => false)
    d.stand(9, 3)
    expect(d.pose).toBeNull()
    expect(d.margin()).toBe(HUNCH.margin)
  })

  it('頭：差が HEAD.poseMin 以上なら同じ見方、線は max(頭の poseMargin, poseFrac × 差)（今までの頭の margin 18° より狭い。頭は poseLine 0 で、割合のまま）', () => {
    expect(HEAD.poseLine).toBe(0)
    const { d, ok } = setup(HEAD, null, 12)
    expect(ok).toBe(true)
    expect(d.margin()).toBe(Math.max(HEAD.poseMargin, HEAD.poseFrac * 12))
    expect(d.margin()).toBeLessThan(HEAD.margin)
    expect(setup(HEAD, null, HEAD.poseMin - 1).ok).toBe(false)
  })

  it('2つの立ち方の胸の線は、どのレベルも同じ決まった度数（仮の 5°）。2つの立ち方で見られないときの線（margin）はレベルごと', () => {
    const m = (lv: keyof typeof HUNCH_BY_LEVEL) => setup(HUNCH_BY_LEVEL[lv], null, 30).d.margin()
    expect(m('beginner')).toBe(5)
    expect(m('intermediate')).toBe(5)
    expect(m('advanced')).toBe(5)
    expect(HUNCH_BY_LEVEL.beginner.margin).toBeGreaterThan(HUNCH_BY_LEVEL.advanced.margin)
  })

  it('差が大きい人（25°）でも、線（5°）のすぐ上の猫背は、猫背としてありうる（ずれの見張りに数えない）。割合の下の端 poseIdxMin × 差 は 10°', () => {
    const { d } = setup(HUNCH, null, 25)
    run(d, 6, L0 + 20, () => BODY)
    const out = run(d, L0 + 20, L0 + 200, () => d.offset!.deg + HUNCH.poseLine + 3)
    expect(HUNCH.poseIdxMin * 25).toBeGreaterThan(HUNCH.poseLine + 3)
    expect(out.filter((o) => o.tilt !== null && o.t > L0 + 32).every((o) => o.plausible)).toBe(true)
    expect(out.some((o) => o.slip)).toBe(false)
    expect(out.filter((o) => o.cue).length).toBeGreaterThan(5)
  })
})

// 頭のセンサーは、おでこにヘッドバンドで付ける（頭のてっぺんはセンサーの後ろ）。頭は固いので、どこに付けても頭の回り方（うなずき）は同じに見える
describe('頭：最初から頭が前に出たまま走り出したのを、すぐ知らせ、直ったらほめる（2つの立ち方）', () => {
  const HABIT = 12 // a（いつもの楽な立ち方）の頭の回り方（b から、度）
  const BODY = 1 // 走ると頭が回る分（体ごとの前傾は頭にはほとんど出ない。params.ts の HEAD の説明）
  // 体の向き（x 前・y 左・z 上）の重力 → センサーの読み。crown：頭のてっぺん（z が上）、forehead：おでこ（x が左・y が上・z が前。
  // おでこは後ろへ約15°傾いている）、forehead90：おでこで、板を90°回して付けた
  const r15 = (15 * Math.PI) / 180
  const MOUNTS: Record<string, (v: Vec3) => Vec3> = {
    crown: (v) => v,
    forehead: ([x, y, z]) => [y, z * Math.cos(r15) - x * Math.sin(r15), x * Math.cos(r15) + z * Math.sin(r15)],
    forehead90: ([x, y, z]) => [-(z * Math.cos(r15) - x * Math.sin(r15)), y, x * Math.cos(r15) + z * Math.sin(r15)],
  }
  const T0 = 6 // 走り出す t
  const setup = (mount = MOUNTS.forehead, habit = HABIT) => {
    const d = new LeanDetector(HEAD)
    const feed = (from: number, to: number, deg: number, running: boolean) => {
      const out: ({ t: number } & LeanStep)[] = []
      for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
        const t = i / 100
        d.sample(t, mount(lean(deg)))
        if (i % 10 === 0) out.push({ t, ...d.update(t, running) })
      }
      return out
    }
    feed(0, 3, habit, false)
    const da = d.dirOver(3, 3)!
    feed(3, 6, 0, false)
    const db = d.dirOver(6, 3)!
    expect(d.setPoses(da, db)).toBe(true)
    return { d, run: (from: number, to: number, deg: number) => feed(from, to, deg, true) }
  }
  const cueTimes = (xs: ({ t: number } & LeanStep)[]) => xs.filter((o) => o.cue).map((o) => o.t)

  it('前に出たまま走り出すと、走る前傾を覚え終わる前（poseStart + poseHold 秒ごろ）から知らせ、直すと1回ほめる', () => {
    const { d, run } = setup()
    const habit = run(T0, T0 + 20, HABIT + BODY)
    const cues = cueTimes(habit)
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0] - T0).toBeGreaterThanOrEqual(HEAD.poseStart + HEAD.poseHold - 0.2)
    expect(cues[0] - T0).toBeLessThan(HEAD.poseStart + HEAD.poseHold + 1)
    expect(d.runLean).toBeNull() // まだ覚えている途中
    expect(habit.some((o) => o.praise)).toBe(false)
    // 直す（顎を引く）：知らせが止まり、posePraise 秒たったら1回ほめる
    const fixed = run(T0 + 20, T0 + 35, BODY)
    expect(fixed.filter((o) => o.cue)).toHaveLength(0)
    const praise = fixed.filter((o) => o.praise)
    expect(praise).toHaveLength(1)
    expect(praise[0].t - (T0 + 20)).toBeGreaterThanOrEqual(HEAD.posePraise)
    expect(praise[0].t - (T0 + 20)).toBeLessThan(HEAD.posePraise + 1.5)
  })

  it('胸を開いて顎を引いたまま（b）走れば、知らせもほめもしない。差し引く走る前傾は頭の poseCap まで', () => {
    const { d, run } = setup()
    const out = run(T0, T0 + HEAD.skip + HEAD.learn + 60, BODY)
    expect(out.some((o) => o.cue || o.praise)).toBe(false)
    expect(d.offset!.deg).toBeCloseTo(BODY, 0)
    // いつもの頭のまま走り出したときは、poseCap（3°）しか差し引かない（胸は10°）
    const h = setup()
    h.run(T0, T0 + HEAD.skip + HEAD.learn + 1, HABIT + BODY)
    expect(h.d.offset!.deg).toBe(HEAD.poseCap)
    expect(HEAD.poseCap).toBeLessThan(HUNCH.poseCap)
  })

  it('直したあと、いつもの頭に戻っていくと、また知らせる（直した頭を基準にし、いつもの頭へは寄せない）', () => {
    const { d, run } = setup()
    run(T0, T0 + 15, HABIT + BODY)
    run(T0 + 15, T0 + HEAD.skip + HEAD.learn + 30, BODY) // 直して、走る前傾を覚え終わる
    expect(d.runLean).not.toBeNull()
    const t1 = T0 + HEAD.skip + HEAD.learn + 30
    // 2分かけて、ゆっくりいつもの頭へ戻る（follow 60秒でも吸わない）
    const drift: ({ t: number } & LeanStep)[] = []
    for (let k = 0; k < 120; k++) drift.push(...run(t1 + k, t1 + k + 1, BODY + (HABIT * k) / 120))
    drift.push(...run(t1 + 120, t1 + 150, HABIT + BODY))
    expect(drift.some((o) => o.cue)).toBe(true)
    expect(drift.some((o) => o.slip)).toBe(false)
    expect(d.ref!).toBeLessThanOrEqual(HEAD.poseCap + 0.01)
  })

  it('前に出たまま3分走り続けても、知らせ続ける。はじめの poseBackoffAfter 回は cooldown ごと、そのあとは poseBackoffEvery 秒ごと（胸よりまばら）', () => {
    const { run } = setup()
    const out = run(T0, T0 + 180, HABIT + BODY)
    expect(out.some((o) => o.slip)).toBe(false)
    const cues = cueTimes(out)
    // 0.1秒ごとに見るので、間隔は 0.1秒までずれる
    cues.slice(1, HEAD.poseBackoffAfter).forEach((t, i) => expect(Math.abs(t - cues[i] - HEAD.cooldown)).toBeLessThan(0.15))
    cues.slice(HEAD.poseBackoffAfter).forEach((t, i) => expect(Math.abs(t - cues[HEAD.poseBackoffAfter - 1 + i] - HEAD.poseBackoffEvery)).toBeLessThan(0.15))
    expect(cues[cues.length - 1]).toBeGreaterThan(T0 + 180 - HEAD.poseBackoffEvery - 1)
    expect(HEAD.poseBackoffEvery).toBeGreaterThan(HUNCH.poseBackoffEvery)
    // 3分で 3 + 約5回（胸の間隔なら約14回）
    expect(cues.length).toBeLessThan(10)
  })

  it('一瞬（poseHold 秒より短く）下を向いただけでは知らせない', () => {
    const { run } = setup()
    run(T0, T0 + 60, BODY)
    const glance = run(T0 + 60, T0 + 60 + HEAD.poseHold - 1, 30)
    const after = run(T0 + 60 + HEAD.poseHold - 1, T0 + 70, BODY)
    expect([...glance, ...after].some((o) => o.cue)).toBe(false)
  })

  it('付け方（頭のてっぺん・おでこ・おでこで板を90°回す）によらず、同じ時刻に知らせ、ほめる', () => {
    const times = Object.values(MOUNTS).map((m) => {
      const { run } = setup(m)
      const out = [...run(T0, T0 + 20, HABIT + BODY), ...run(T0 + 20, T0 + 35, BODY), ...run(T0 + 35, T0 + 50, HABIT + BODY)]
      return { cue: cueTimes(out), praise: out.filter((o) => o.praise).map((o) => o.t) }
    })
    expect(times[0].cue.length).toBeGreaterThan(2)
    expect(times[0].praise).toHaveLength(1)
    for (const x of times.slice(1)) expect(x).toEqual(times[0])
  })

  it('今までの見方（stand。2つの立ち方がない・差が小さい）は変えない：覚え終わるまで知らせず、ほめない', () => {
    const d = new LeanDetector(HEAD)
    play(d, 0, 3, () => 0, () => false)
    d.stand(3, 3)
    const out = play(d, 3, 3 + HEAD.skip + HEAD.learn - 1, () => 30, () => true)
    expect(out.some((o) => o.cue)).toBe(false)
    const later = play(d, 3 + HEAD.skip + HEAD.learn - 1, 3 + HEAD.skip + HEAD.learn + 20, (t) => (t < 3 + HEAD.skip + HEAD.learn + 5 ? 30 : 60), () => true)
    expect(later.some((o) => o.cue)).toBe(true)
    expect(play(d, 63, 80, () => 30, () => true).some((o) => o.praise)).toBe(false)
  })
})
