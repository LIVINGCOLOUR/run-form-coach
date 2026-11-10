import { describe, expect, it } from 'vitest'
import { ContactJudge, StepDetector, cadLow, dfNorm, principalAxis, swingSign, type Step } from './contact'
import { ContactCoach, contactValues } from './contactCoach'
import { ANKLES, CONTACT, CONTACT_BUZZ, STEP } from './params'
import { PHRASES } from '../../core/phrases'
import type { Vec3 } from './parse'

// 作りもののすねの角速度（dps、振り出しが正）。着地を 0 とした1歩きの中の折れ線：
//   着地のあと後ろへ回り（-300）、立脚の真ん中で小さく、離地のあと toLead 秒で谷（-250）、その 0.11秒後に 0 を上へ切り、
//   振り出しの山（peak）、着地の icDelay 秒前に 0 を下へ切る。着地・離地の本当の時刻は、作り方から決まる（StepDetector のずらす量と同じ形）
function shank(u: number, ct: number, T: number, peak: number): number {
  const z2 = ct + STEP.toLead + 0.11
  const zc = T - STEP.icDelay
  const knots: [number, number][] = [
    [0, -150],
    [0.06, -300],
    [ct * 0.6, -30],
    [ct + STEP.toLead, -250],
    [z2, 0],
    [(z2 + zc) / 2, peak],
    [zc, 0],
    [T, -150],
  ]
  for (let k = 0; k + 1 < knots.length; k++) {
    const [a, va] = knots[k]
    const [b, vb] = knots[k + 1]
    if (u >= a && u <= b) return va + ((vb - va) * (u - a)) / (b - a)
  }
  return -150
}

// 1つの足首に、hz で sec 秒ぶんの値を流す。axis：センサーの中での前後の面の回転の軸（符号で付け方の向きを変える）
function feed(d: StepDetector, o: { sec: number; ct: number | ((t: number) => number); T: number; peak?: number; hz?: number; axis?: Vec3; t0?: number; phase?: number }) {
  const hz = o.hz ?? 100
  const ax = o.axis ?? [0, 0, 1]
  const out: Step[] = []
  const t0 = o.t0 ?? 0
  for (let i = 0; i < o.sec * hz; i++) {
    const t = t0 + i / hz
    const u = (((t + (o.phase ?? 0)) % o.T) + o.T) % o.T
    const ct = typeof o.ct === 'number' ? o.ct : o.ct(t)
    const s = shank(u, ct, o.T, o.peak ?? 450)
    // 前後の面のほかに、小さな横の揺れも足す
    const g: Vec3 = [ax[0] * s + 20 * Math.sin(t * 9), ax[1] * s, ax[2] * s]
    d.sample(t, g, [0, 1, 0])
    out.push(...d.steps())
  }
  return out
}

describe('足首の1歩（StepDetector）', () => {
  it('作りものの走りで、接地時間・接地の割合を 10ms 以内で出す（100Hz・50Hz、付け方の向きが逆でも）', () => {
    for (const hz of [100, 50])
      for (const axis of [[0, 0, 1], [0, -1, 0], [0.6, 0, -0.8]] as Vec3[]) {
        const d = new StepDetector()
        d.running = true
        const steps = feed(d, { sec: 40, ct: 0.27, T: 0.72, hz, axis })
        expect(d.axis).not.toBeNull()
        expect(steps.length).toBeGreaterThan(30)
        for (const s of steps) {
          expect(Math.abs(s.ct - 0.27)).toBeLessThan(0.01)
          expect(Math.abs(s.stride - 0.72)).toBeLessThan(0.01)
          expect(Math.abs(s.df - 0.27 / 0.72)).toBeLessThan(0.015)
        }
      }
  })

  it('走っていない間は軸を決めず、1歩も出さない', () => {
    const d = new StepDetector()
    expect(feed(d, { sec: 30, ct: 0.27, T: 0.72 })).toHaveLength(0)
    expect(d.axis).toBeNull()
  })

  it('歩き（接地の割合が 0.5 を超える）は捨てる', () => {
    const d = new StepDetector()
    d.running = true
    // 1歩き 1.1秒は範囲外、0.95秒で接地 0.55秒（割合 0.58）
    expect(feed(d, { sec: 40, ct: 0.55, T: 0.95 }).length).toBe(0)
  })

  it('軸と符号：振り出しの側（短く高い）を正にする', () => {
    const s = Array.from({ length: 720 }, (_, i) => shank((i / 1000) % 0.72, 0.27, 0.72, 450))
    expect(swingSign(s)).toBe(1)
    expect(swingSign(s.map((v) => -v))).toBe(-1)
    const ax = principalAxis(s.map((v) => [0, v, 0.1 * v] as Vec3))!
    expect(Math.abs(ax[1])).toBeGreaterThan(0.99)
  })
})

describe('接地の割合の線（dfNorm）', () => {
  it('表の間はつなぎ、外は端の値のまま', () => {
    expect(dfNorm(9).mean).toBeCloseTo(0.377)
    expect(dfNorm(10).mean).toBeCloseTo(0.362)
    expect(dfNorm(6).mean).toBeCloseTo(0.377)
    expect(dfNorm(16).mean).toBeCloseTo(0.326)
  })
})

// 左右の足首を、同じ時計で半歩ずらして流し、ContactCoach の知らせを集める
function runCoach(o: { sec: number; ctL: (t: number) => number; ctR: (t: number) => number; T?: number; peakR?: number }) {
  const co = new ContactCoach()
  const T = o.T ?? 0.72
  const cues: { t: number; kind: string; item: string; places: string[] }[] = []
  const hz = 100
  for (let i = 0; i < o.sec * hz; i++) {
    const t = i / hz
    for (const [side, ct, ph, pk] of [['L', o.ctL, 0, 450], ['R', o.ctR, T / 2, o.peakR ?? 450]] as const) {
      const u = (((t + ph) % T) + T) % T
      const s = shank(u, ct(t), T, pk)
      co.sample(side, t, t, [0, 0, s], [0, 1, 0])
    }
    if (i % 10 === 0) for (const c of co.tick(t, true)) cues.push({ t, kind: c.kind, item: c.item, places: c.places })
  }
  return { co, cues }
}

describe('接地時間の知らせ（ContactCoach）', () => {
  // 1歩き 0.72秒（ピッチ約167）。接地の割合 0.37 は時速9kmの市民ランナーの平均くらい
  it('ふつうの接地では知らせない', () => {
    const { cues, co } = runCoach({ sec: 300, ctL: () => 0.27, ctR: () => 0.27 })
    expect(cues.filter((c) => c.kind === 'cue')).toHaveLength(0)
    expect(co.last?.steady).toBe(true)
  })

  it('接地がずっと長い（割合 0.46）と、両足首で知らせ、戻ったらほめる', () => {
    const ct = (t: number) => (t > 120 && t < 180 ? 0.335 : 0.27)
    const { cues } = runCoach({ sec: 260, ctL: ct, ctR: ct })
    const cue = cues.find((c) => c.kind === 'cue')
    expect(cue?.item).toBe('sit')
    expect(cue!.t).toBeGreaterThan(120)
    expect(cue!.places).toEqual([ANKLES.L, ANKLES.R])
    const praise = cues.find((c) => c.kind === 'praise')
    expect(praise?.item).toBe('sit')
    expect(praise!.t).toBeGreaterThan(180)
  })

  it('右の接地が長い左右差は、右足首で知らせる。左右の振り出しの山が違いすぎれば（付け方の違い）、左右差は見ない', () => {
    const ctR = (t: number) => (t > 120 ? 0.31 : 0.27)
    const a = runCoach({ sec: 240, ctL: () => 0.26, ctR })
    const cue = a.cues.find((c) => c.kind === 'cue')
    expect(cue?.item).toBe('longR')
    expect(cue!.places).toEqual([ANKLES.R])
    const b = runCoach({ sec: 240, ctL: () => 0.26, ctR, peakR: 300 })
    expect(b.cues.filter((c) => c.item === 'longR')).toHaveLength(0)
    expect(b.co.last?.mountDiff).toBe(true)
  })

  it('走り出してすぐ（warmup）と、速さが変わった直後は判定しない', () => {
    const co = new ContactCoach()
    expect(contactValues(null)).toEqual({})
    const J = new ContactJudge()
    const mk = (ic: number, v: number): Step => ({ ic, to: ic + 0.27, ct: 0.27, stride: 0.72, df: 0.375, rom: 80, v, impact: 4, peak: 450 })
    for (let k = 0; k < 40; k++) {
      J.add('L', mk(k * 0.72, k < 20 ? 8 : 10))
      J.add('R', mk(k * 0.72 + 0.36, k < 20 ? 8 : 10))
    }
    // 判定の値は出るが、速さの移り変わりを見る前なので steady ではない
    expect(J.values(0, { L: true, R: true })?.steady).toBe(false)
    expect(co.last).toBeNull()
    expect(CONTACT_BUZZ.praiseCount).toBeGreaterThan(1)
    expect(CONTACT.warmup).toBeGreaterThan(0)
  })
})

// 1歩を直接入れて、ContactCoach の知らせを集める。cad(t)：ピッチ（歩/分）、ct(t)：接地時間（秒）。見積もった速さはずっと同じ（ベルトの速さが同じ）
function runStrides(o: { sec: number; cad: (t: number) => number; ct?: (t: number) => number; v?: (t: number) => number }) {
  const co = new ContactCoach()
  const cues: { t: number; kind: string; item: string; places: string[]; text: string }[] = []
  const next = { L: 0, R: 0.36 }
  for (let i = 0; i < o.sec * 10; i++) {
    const t = i / 10
    for (const side of ['L', 'R'] as const) {
      while (next[side] <= t) {
        const ic = next[side]
        const stride = 120 / o.cad(ic)
        const ct = o.ct?.(ic) ?? 0.255
        co.addStep(side, t, { ic, to: ic + ct, ct, stride, df: ct / stride, rom: 90, v: o.v?.(ic) ?? 9, impact: 4, peak: 450 })
        next[side] = ic + stride
      }
    }
    for (const c of co.tick(t, true)) cues.push({ t, kind: c.kind, item: c.item, places: c.places, text: c.text })
  }
  return { co, cues }
}

describe('足が体より前に着く（オーバーストライド）', () => {
  it('同じ速さでピッチが 10% 落ちたまま30秒：overHold 秒たってから両足首で知らせ、戻ったらほめる', () => {
    const cad = (t: number) => (t >= 180 && t < 210 ? 153 : 170)
    const ct = (t: number) => (t >= 180 && t < 210 ? 0.3 : 0.255)
    const { cues } = runStrides({ sec: 260, cad, ct })
    const cue = cues.find((c) => c.kind === 'cue')
    expect(cue?.item).toBe('stride')
    expect(cue!.t).toBeGreaterThan(180 + CONTACT.overHold)
    expect(cue!.places).toEqual([ANKLES.L, ANKLES.R])
    expect(cue!.text).toBe(PHRASES.cueLanding)
    const praise = cues.find((c) => c.kind === 'praise')
    expect(praise?.item).toBe('stride')
    expect(praise!.t).toBeGreaterThan(210)
    // ピッチが変わった間は、接地の割合がのびても「腰が落ちている」とは言わない
    expect(cues.filter((c) => c.item === 'sit')).toHaveLength(0)
  })

  it('わざと一瞬（15秒）大またにしたのは知らせない（2026-11-05 の形）', () => {
    const cad = (t: number) => (t >= 180 && t < 195 ? 148 : 170)
    expect(runStrides({ sec: 260, cad }).cues.filter((c) => c.kind === 'cue')).toHaveLength(0)
  })

  it('ふつうのピッチの揺れ（±2.5%）では知らせない', () => {
    const cad = (t: number) => 170 + 4 * Math.sin(t / 7)
    expect(runStrides({ sec: 400, cad }).cues.filter((c) => c.kind === 'cue')).toHaveLength(0)
  })

  it('速さを上げ下げしてピッチが変わったのは比べない。新しい速さで覚え直す', () => {
    // 200秒で時速9 → 7km に落とし、ピッチも 170 → 160（速さに合わせて落ちた）
    const slow = (t: number) => t >= 200
    const { co, cues } = runStrides({ sec: 400, cad: (t) => (slow(t) ? 160 : 170), v: (t) => (slow(t) ? 7 : 9) })
    expect(cues.filter((c) => c.kind === 'cue')).toHaveLength(0)
    expect(co.last?.ref?.v).toBeCloseTo(7, 0)
    expect(co.last?.ref?.cad).toBeCloseTo(160, 0)
  })

  it('基準は走り出しの refSec 秒で覚える。その前は比べない', () => {
    const J = new ContactJudge()
    const mk = (ic: number): Step => ({ ic, to: ic + 0.255, ct: 0.255, stride: 120 / 170, df: 0.36, rom: 90, v: 9, impact: 4, peak: 450 })
    let t = 0
    let k = 0
    let first: number | null = null
    for (; t < 120; t += 0.1) {
      while (k * 0.353 <= t) {
        J.add(k % 2 ? 'R' : 'L', mk(k * 0.353))
        k++
      }
      const m = J.values(t, { L: true, R: true })
      if (m?.ref && first === null) first = t
    }
    expect(first).not.toBeNull()
    expect(first!).toBeGreaterThanOrEqual(CONTACT.steadySec - 1 + CONTACT.refSec - 1)
  })
})

describe('オーバーストライドの安全網（記録だけ。CONTACT.cadLow）', () => {
  it('研究データの下の端：表の間は直線、外は端の値', () => {
    expect(cadLow(8)).toBe(CONTACT.cadLow[0][1])
    expect(cadLow(20)).toBe(CONTACT.cadLow[CONTACT.cadLow.length - 1][1])
    expect(cadLow((8.9 + 12.4) / 2)).toBeCloseTo((150 + 155) / 2, 5)
  })

  it('走り出しから低いピッチ（大また）で走り続けると、走り出しの基準では知らせないが、安全網の値は線を越える。知らせはしない', () => {
    const low = cadLow(9)
    const cad = () => low * 0.9 // 下の端より 1割低いまま
    const { co, cues } = runStrides({ sec: 200, cad })
    expect(cues.filter((c) => c.kind === 'cue')).toHaveLength(0)
    expect(co.last!.cadDropHeld).toBeLessThan(CONTACT.overDrop)
    expect(co.last!.cadDropNetHeld).toBeGreaterThan(CONTACT.overDrop)
  })

  it('ふつうのピッチ（下の端より上）の人は、安全網の値は走り出しからの落ち方と同じ', () => {
    const { co } = runStrides({ sec: 200, cad: () => 170 })
    expect(co.last!.cadDropNet).toBeCloseTo(co.last!.cadDrop, 5)
  })
})

