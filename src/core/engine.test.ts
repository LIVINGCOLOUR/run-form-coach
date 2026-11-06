import { describe, expect, it } from 'vitest'
import { CueEngine, TONE_TEXT, type CoachEvent, type EngineSay, type ItemSpec, type ModeAnalyzer, type SecondContext, type Values } from './engine'
import { RECOVER, SAY } from './phrases'
import { CUE, HIP_REF, LIMIT, TONE } from './params'

// しくみだけを確かめるための、作りものの入り口。1コマの測定は「項目 a の値」で、null ならその秒は判定しない
type Item = 'a' | 'b'
interface M {
  a: number | null
  b?: number
}

const ITEMS: ItemSpec<Item>[] = [
  { key: 'a', limits: { full: 1, zero: 10, cue: 5 }, cue: 'a が崩れています。' },
  { key: 'b', limits: { full: 1, zero: 10, cue: 5 }, cue: 'b が崩れています。' },
]

class ToyAnalyzer implements ModeAnalyzer<M, { t: number; score: number | null }, Item> {
  items = ITEMS
  say?: Partial<EngineSay>
  constructor(say?: Partial<EngineSay>) {
    this.say = say
  }
  second(b: M[], t: number, ctx: SecondContext<Item>) {
    if (b.length < 3) return null
    const last = b[b.length - 1]
    const values: Values<Item> = {}
    if (last.a !== null) values.a = last.a
    if (last.b !== undefined) values.b = last.b
    return { sample: { t, score: ctx.score(values) }, values, ready: t === HIP_REF.to + 1 }
  }
}

class Toy extends CueEngine<M, { t: number; score: number | null }, Item> {
  result() {
    return this.summary()
  }
}

function run(e: Toy, from: number, sec: number, m: M | null) {
  const speak: string[] = []
  for (let i = 0; i < sec * 10; i++) {
    const inp = m ? { t: from + i / 10, present: true, moving: true, m } : { t: from + i / 10, present: false, moving: false }
    for (const ev of e.update(inp)) if (ev.type === 'speak') speak.push(ev.text)
  }
  return speak
}

describe('入り口ごとの言葉', () => {
  it('見えなくなったとき・戻らないときの言葉を、入り口が替えられる。替えなかった言葉はそのまま', () => {
    const e = new Toy(new ToyAnalyzer({ lost: 'センサーが途切れました。', giveUp: 'センサーが戻らないので終わります。' }))
    const a = run(e, 0, 5, { a: 0 })
    expect(a[0]).toBe(SAY.start)
    const b = run(e, 5, 40, null)
    expect(b).toEqual(['センサーが途切れました。', 'センサーが戻らないので終わります。'])
  })
  it('替えなければ、カメラの言葉のまま', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 5, { a: 0 })
    expect(run(e, 5, 40, null)).toEqual([SAY.lost, SAY.giveUp])
  })
})

describe('判定しない秒', () => {
  it('点数は判定した項目だけで出し、1つもなければ null', () => {
    const e = new Toy(new ToyAnalyzer())
    expect(e.score({ a: 10, b: 0 })).toBe(0)
    expect(e.score({ b: 0 })).toBe(100)
    expect(e.score({ a: 7 })).toBe(33)
    expect(e.score({})).toBeNull()
  })

  it('良い・ふつう・悪いの割合に入れない（満点として数えない）', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 100, { a: null }) // 判定しない
    run(e, 100, 100, { a: 10 }) // 悪い
    const s = e.result()
    expect(s.share.bad).toBeCloseTo(1, 5)
    expect(s.share.good).toBe(0)
  })

  it('判定しない秒が続いても、ほめたり声なしの見守りに入ったりしない', () => {
    const e = new Toy(new ToyAnalyzer())
    const said = run(e, 0, 900, { a: null })
    expect(said).toEqual([SAY.start])
    expect(e.quiet).toBe(false)
    expect(e.quietHeldSec).toBe(0)
  })

  it('声かけは、その項目を判定した秒だけで平均する。判定しない秒で崩れが薄まらず、判定しない秒だけでは声をかけない', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 30, { a: null, b: 0 })
    // a を判定しない間に b は崩れていない。a は判定した秒だけが線を越えている
    const said = run(e, 30, 10, { a: 8, b: 0 })
    expect(said).toContain('a が崩れています。')
    // a を判定しない秒が続くだけでは、a の声はかからない（記録が足りない）
    const e3 = new Toy(new ToyAnalyzer())
    const s3 = run(e3, 0, 60, { a: null, b: 0 })
    expect(s3.some((x) => x.includes('a が'))).toBe(false)
  })

  it('声なしの見守り中に判定しない秒があっても、保てた時間には数えない', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 400, { a: 0 })
    expect(e.quiet).toBe(true)
    const before = e.quietHeldSec
    run(e, 400, 100, { a: null })
    expect(e.quietHeldSec).toBe(before)
  })
})

describe('声をかける項目', () => {
  it('注意していない項目も、大きく崩れたら声をかける（ふつう）', () => {
    const e = new Toy(new ToyAnalyzer(), { items: ['a'] })
    const said = run(e, 0, 40, { a: 0, b: 9 })
    expect(said).toContain('b が崩れています。')
  })

  it('muteOthers なら、注意していない項目は大きく崩れても声をかけない。注意している項目には声をかける', () => {
    const e = new Toy(new ToyAnalyzer(), { items: ['a'], muteOthers: true })
    expect(run(e, 0, 40, { a: 0, b: 9 }).some((x) => x.includes('b が'))).toBe(false)
    expect(run(e, 40, 20, { a: 8, b: 9 })).toContain('a が崩れています。')
  })
})

describe('見る役が声を待たせる（defer）・見る役が決めた声（cue）', () => {
  // a を until 秒まで待たせ、want 秒からは force の項目の声を頼む見る役（カメラ：猫背が上がってきている間の頭）
  class Deferring extends ToyAnalyzer {
    asked: number[] = []
    private readonly until: number
    force: { item: Item; from: number } | null = null
    constructor(until: number) {
      super()
      this.until = until
    }
    defer(k: Item, t: number) {
      if (k !== 'a') return false
      this.asked.push(t)
      return t < this.until
    }
    second(b: M[], t: number, ctx: SecondContext<Item>) {
      const out = super.second(b, t, ctx)
      if (out && this.force && t >= this.force.from && ctx.since() >= CUE.gap && !ctx.full(this.force.item)) {
        const cue = this.force.item
        this.force = null
        return { ...out, cue }
      }
      return out
    }
  }
  it('待たせている秒は、その項目も、優先順であとの項目も言わない。待たせ終われば言う', () => {
    const an = new Deferring(30)
    const e = new Toy(an)
    expect(run(e, 0, 25, { a: 9, b: 9 }).filter((x) => x.includes('崩れて'))).toEqual([])
    expect(an.asked.length).toBeGreaterThan(0)
    expect(run(e, 25, 15, { a: 9, b: 9 })).toContain('a が崩れています。')
    expect(e.cues.find((c) => c.item === 'a')!.t).toBeGreaterThanOrEqual(30)
  })
  it('線を越えていない間は聞かない（声なしの見守りをやめるかを見るときにも聞かない）', () => {
    const an = new Deferring(1e9)
    const e = new Toy(an)
    run(e, 0, 20, { a: 0 })
    expect(an.asked).toEqual([])
  })
  it('見る役が決めた声は、線の下でも言い、直ったらほめる。前の声からの間（CUE.gap）は守る', () => {
    const an = new Deferring(0)
    const e = new Toy(an)
    an.force = { item: 'b', from: 5 }
    run(e, 0, 20, { a: 0, b: 0 })
    const b = e.cues.find((c) => c.item === 'b')!
    expect(b.t).toBeGreaterThanOrEqual(5)
    expect(b.t).toBeLessThan(7)
    expect(e.cues.some((c) => c.item === 'recover')).toBe(true)
  })
})

describe('音で知らせる項目（tone）', () => {
  const TONE_ITEMS: ItemSpec<Item>[] = [{ ...ITEMS[0], tone: true }, ITEMS[1]]
  class ToneAnalyzer extends ToyAnalyzer {
    items = TONE_ITEMS
  }
  type Ev = { t: number; ev: CoachEvent }
  function events(e: Toy, from: number, sec: number, m: M): Ev[] {
    const out: Ev[] = []
    for (let i = 0; i < sec * 10; i++) {
      const t = from + i / 10
      for (const ev of e.update({ t, present: true, moving: true, m })) out.push({ t, ev })
    }
    return out
  }
  const speaks = (xs: Ev[]) => xs.flatMap((x) => (x.ev.type === 'speak' ? [x.ev.text] : []))
  const tones = (xs: Ev[]) => xs.flatMap((x) => (x.ev.type === 'tone' ? [{ t: x.t, on: x.ev.on }] : []))

  it('初めは言葉と音、戻ったら音を止めてほめる言葉は言わない。2回目からは音だけ', () => {
    const e = new Toy(new ToneAnalyzer())
    events(e, 0, 20, { a: 0 })
    const first = events(e, 20, 20, { a: 8 })
    expect(speaks(first)).toEqual(['a が崩れています。'])
    const on1 = first.findIndex((x) => x.ev.type === 'tone' && x.ev.on)
    expect(on1).toBeGreaterThanOrEqual(0)
    expect(first[on1].ev).toEqual({ type: 'tone', on: true, item: 'a', bars: TONE.bars })
    const back = events(e, 40, 15, { a: 0 })
    expect(tones(back).map((x) => x.on)).toEqual([false])
    expect(speaks(back)).toEqual([]) // 「いい感じです」も言わない
    const second = events(e, 55, 30, { a: 8 })
    expect(speaks(second)).toEqual([])
    expect(tones(second)[0].on).toBe(true)
    expect(e.cues.filter((c) => c.item === 'a').map((c) => c.tone ?? false)).toEqual([false, true])
    expect(e.cues[1].text).toBe(TONE_TEXT)
  })

  it('外れたままなら、くり返すほど間をあける（TONE.fadeFrom 回目まではふつうの間）', () => {
    const e = new Toy(new ToneAnalyzer())
    events(e, 0, 20, { a: 0 })
    const xs = events(e, 20, 1200, { a: 8 })
    const ons = tones(xs).filter((x) => x.on).map((x) => x.t)
    const gaps = ons.slice(1).map((t, i) => Math.round(t - ons[i]))
    const want = gaps.map((_, i) => {
      const n = i + 2 // 何回目の知らせか
      return n <= TONE.fadeFrom ? CUE.cooldown : Math.min(TONE.fadeMax, CUE.cooldown + (n - TONE.fadeFrom) * TONE.fadeStep)
    })
    expect(gaps.length).toBeGreaterThan(5)
    expect(gaps).toEqual(want)
    expect(gaps[gaps.length - 1]).toBe(TONE.fadeMax)
    expect(speaks(xs)).toEqual(['a が崩れています。']) // 言葉は初めの1回だけ
    // 鳴らしたまま次を鳴らさない：on と off が交互
    const seq = tones(xs).map((x) => x.on)
    seq.forEach((on, i) => expect(on).toBe(i % 2 === 0))
  })

  it('止まったら音も止める', () => {
    const e = new Toy(new ToneAnalyzer(), { pause: true })
    events(e, 0, 20, { a: 0 })
    events(e, 20, 10, { a: 8 })
    const stop: Ev[] = []
    for (let i = 0; i < 50; i++) for (const ev of e.update({ t: 30 + i / 10, present: true, moving: false, m: { a: 8 } })) stop.push({ t: 30 + i / 10, ev })
    expect(tones(stop).map((x) => x.on)).toEqual([false])
  })

  it('tone のない項目（カメラ版）は、これまでどおり毎回言葉で、音の知らせは出さない', () => {
    const e = new Toy(new ToyAnalyzer())
    events(e, 0, 20, { a: 0 })
    const xs = [...events(e, 20, 20, { a: 8 }), ...events(e, 40, 15, { a: 0 }), ...events(e, 55, 30, { a: 8 })]
    expect(tones(xs)).toEqual([])
    expect(speaks(xs).filter((x) => x === 'a が崩れています。').length).toBe(2)
    expect(speaks(xs).some((x) => (RECOVER as readonly string[]).includes(x))).toBe(true)
  })
})

// 見る役が自分で決める声（カメラの「整える」のしくみ）：say・hold・score
class LeadAnalyzer extends ToyAnalyzer {
  holdUntil = 0 // この秒まで hold
  cueAt: number[] = [] // この秒に、見る役が a の声を言う（間が足りなければ言わない）
  ackAt: number[] = []
  since: number[] = [] // 見る役に渡された「前の声からの秒数」
  scoreOverride: number | null | undefined = undefined
  second(b: M[], t: number, ctx: SecondContext<Item>) {
    const out = super.second(b, t, ctx)
    if (!out) return null
    this.since.push(ctx.since('a'))
    let say: { kind: 'cue'; item: Item; text: string } | { kind: 'ack'; text: string } | undefined
    if (this.cueAt.includes(t) && ctx.since() >= CUE.gap) say = { kind: 'cue', item: 'a', text: 'a を見る役が知らせます。' }
    else if (this.ackAt.includes(t)) say = { kind: 'ack', text: 'その形です。' }
    return { ...out, say, hold: t <= this.holdUntil, ...(this.scoreOverride !== undefined ? { score: this.scoreOverride } : {}) }
  }
}

describe('見る役が自分で決める声（say・hold・score）', () => {
  it('hold の秒は、線を越えていても、しくみは自分では声をかけない。見る役の声はそのまま言って、lead の印を付けて残す', () => {
    const a = new LeadAnalyzer()
    a.holdUntil = 60
    a.cueAt = [20]
    a.ackAt = [30]
    const e = new Toy(a)
    const s = run(e, 0, 62, { a: 9 })
    expect(s).toContain('a を見る役が知らせます。')
    expect(s).toContain('その形です。')
    expect(s).not.toContain(ITEMS[0].cue) // しくみ自身の声はない
    const lead = e.cues.filter((c) => c.lead)
    expect(lead.map((c) => c.item)).toEqual(['a', 'recover'])
    // hold が終わると、しくみがふつうに声をかける。見る役の声も、同じ項目の間（CUE.cooldown）に数える
    const s2 = run(e, 62, 30, { a: 9 })
    expect(s2).toContain(ITEMS[0].cue)
    const own = e.cues.find((c) => c.item === 'a' && !c.lead)!
    expect(own.t - 20).toBeGreaterThanOrEqual(CUE.cooldown)
  })
  it('見る役には、その項目の前の声からの秒数を渡す（まだなければとても大きい）', () => {
    const a = new LeadAnalyzer()
    a.holdUntil = 100
    a.cueAt = [20]
    const e = new Toy(a)
    run(e, 0, 40, { a: 0 })
    expect(a.since[0]).toBeGreaterThan(1e6)
    expect(a.since[a.since.length - 1]).toBeGreaterThan(5)
    expect(a.since[a.since.length - 1]).toBeLessThan(25)
  })
  it('見る役が点数を決めたら、それで割合を数える', () => {
    const a = new LeadAnalyzer()
    a.scoreOverride = 20
    const e = new Toy(a)
    run(e, 0, 100, { a: 0 }) // values だけなら満点
    expect(e.result().share.bad).toBeCloseTo(1, 5)
  })
  it('見る役の崩れの声は、声なしの見守りもやめる', () => {
    const a = new LeadAnalyzer()
    const e = new Toy(a)
    run(e, 0, 400, { a: 0 })
    expect(e.quiet).toBe(true)
    a.cueAt = [Math.floor(e.active) + 5]
    run(e, 400, 10, { a: 0 })
    expect(e.quiet).toBe(false)
    expect(e.cues[e.cues.length - 1]).toMatchObject({ item: 'a', lead: true })
  })
})

describe('1時間の上限（LIMIT.perHour）', () => {
  it('同じ項目の知らせが1時間の枠で上限に達したら、その枠の残りは知らせない。次の枠で数え直す。回数と達した時刻を結果に残す', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 5, { a: 0 })
    run(e, 5, 7150, { a: 8 }) // 崩れたまま、走った時間で2時間近く（3つ目の枠には入らない）
    const a = e.cues.filter((c) => c.item === 'a')
    const hour0 = a.filter((c) => c.t < 3600)
    const hour1 = a.filter((c) => c.t >= 3600)
    expect(hour0.length).toBe(LIMIT.perHour) // 30秒ごとなら約120回のところ
    expect(hour1.length).toBe(LIMIT.perHour)
    expect(e.capped).toEqual([{ item: 'a', t: hour0[hour0.length - 1].t }, { item: 'a', t: hour1[hour1.length - 1].t }])
    const s = e.result()
    expect(s.cueCounts).toEqual({ a: LIMIT.perHour * 2 })
    expect(s.capped).toBe(e.capped)
    // 知らせない間も判定して記録している（点数は悪いまま）
    expect(s.share.bad).toBeGreaterThan(0.9)
  })

  it('上限に達した項目は、ほかの項目の知らせを止めない', () => {
    const e = new Toy(new ToyAnalyzer())
    run(e, 0, 5, { a: 0, b: 0 })
    run(e, 5, 1200, { a: 8, b: 0 }) // a が上限に達する
    expect(e.capped.map((c) => c.item)).toEqual(['a'])
    const said = run(e, 1205, 120, { a: 8, b: 8 })
    expect(said).toContain('b が崩れています。')
    expect(said).not.toContain('a が崩れています。')
  })

  it('上限に達した項目は、見る役に渡す「その項目の前の声からの秒数」を 0 にする（カメラの正しいフォームの線の声も、その1時間は出ない）', () => {
    // カメラの form.ts と同じ決め方：どの項目でも前の声から CUE.gap、その項目の前の声からも間があいていれば言う
    class FormLike extends ToyAnalyzer {
      cueAt: number[] = []
      since: number[] = []
      second(b: M[], t: number, ctx: SecondContext<Item>) {
        const out = super.second(b, t, ctx)
        if (!out) return null
        this.since.push(ctx.since('a'))
        const say = this.cueAt.includes(t) && ctx.since() >= CUE.gap && ctx.since('a') >= CUE.gap ? { kind: 'cue' as const, item: 'a' as const, text: 'a を見る役が知らせます。' } : undefined
        return { ...out, say }
      }
    }
    const an = new FormLike()
    const e = new Toy(an)
    run(e, 0, 5, { a: 0 })
    run(e, 5, 1200, { a: 8 })
    expect(e.capped.length).toBe(1)
    expect(an.since[an.since.length - 1]).toBe(0)
    an.cueAt = [Math.floor(e.active) + 5]
    run(e, 1205, 10, { a: 8 })
    expect(e.cues.some((c) => c.lead)).toBe(false)
    // 上限に達していなければ、今までどおり言う
    const fresh = new FormLike()
    const e2 = new Toy(fresh)
    run(e2, 0, 5, { a: 0 })
    fresh.cueAt = [Math.floor(e2.active) + 2] // しくみ自身の声（6秒の平均）より先
    run(e2, 5, 10, { a: 8 })
    expect(e2.cues.some((c) => c.lead)).toBe(true)
  })
})

// 2026-11-06 本人「一瞬だけ頭が下がったのを、すぐに言われた。3秒くらい続いたときだけ言ってほしい」（params.ts の CUE.sustain）
describe('一瞬の崩れは言わない（CUE.sustain）', () => {
  const CUE_A = 'a が崩れています。'
  // 線（5）の内側の 4 で走り、len 秒だけ大きく（30）跳ねる。6秒平均は 2秒の跳ねでも (4 × 4 + 30 × 2) ÷ 6 ≈ 12.7 で線を越える
  const spike = (e: Toy, from: number, len: number) => [...run(e, from, 10, { a: 4 }), ...run(e, from + 10, len, { a: 30 }), ...run(e, from + 10 + len, 30, { a: 4 })]
  it('窓の平均が線を越えても、1秒ごとの値が線の外に CUE.sustain 秒続かなければ声をかけない。続けば声をかける', () => {
    const e = new Toy(new ToyAnalyzer(), { pause: false, sustain: CUE.sustain })
    run(e, 0, 20, { a: 0 })
    expect(spike(e, 20, CUE.sustain - 1)).not.toContain(CUE_A)
    expect(spike(e, 70, CUE.sustain)).toContain(CUE_A)
  })
  it('線の外に入ったばかりの秒には言わず、CUE.sustain 秒目に言う', () => {
    const e = new Toy(new ToyAnalyzer(), { pause: false, sustain: CUE.sustain })
    run(e, 0, 20, { a: 0 })
    run(e, 20, 10, { a: 4 })
    const t0 = Math.floor(e.active)
    run(e, 30, 10, { a: 30 })
    const c = e.cues.find((x) => x.item === 'a')!
    expect(c.t - t0).toBeGreaterThanOrEqual(CUE.sustain - 1)
    expect(c.t - t0).toBeLessThanOrEqual(CUE.sustain)
  })
  it('判定しなかった秒は飛ばして数える。線の内側の秒をはさんだら数え直す', () => {
    const e = new Toy(new ToyAnalyzer(), { pause: false, sustain: CUE.sustain })
    run(e, 0, 30, { a: 0 })
    // 線の外・判定しない・線の外（3秒にわたって線の外）
    const a = [...run(e, 30, 1, { a: 30 }), ...run(e, 31, 1, { a: null }), ...run(e, 32, 1, { a: 30 }), ...run(e, 33, 30, { a: 0 })]
    expect(a).toContain(CUE_A)
    const f = new Toy(new ToyAnalyzer(), { pause: false, sustain: CUE.sustain })
    run(f, 0, 30, { a: 0 })
    // 線の外・線の内側・線の外・線の内側…（6秒平均は線を越える）
    const b: string[] = []
    for (let i = 0; i < 6; i++) b.push(...run(f, 30 + i * 2, 1, { a: 30 }), ...run(f, 31 + i * 2, 1, { a: 4 }))
    b.push(...run(f, 42, 20, { a: 0 }))
    expect(b).not.toContain(CUE_A)
  })
  it('sustain を渡さない入り口（スマホ版）は、いままでどおり窓の平均だけで決める', () => {
    const e = new Toy(new ToyAnalyzer(), { pause: false })
    run(e, 0, 20, { a: 0 })
    expect(spike(e, 20, 2)).toContain(CUE_A)
  })
})
