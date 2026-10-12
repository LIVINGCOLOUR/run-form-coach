import { describe, expect, it } from 'vitest'
import { CueEngine, TONE_TEXT, type CoachEvent, type EngineSay, type ItemSpec, type ModeAnalyzer, type SecondContext, type Values } from './engine'
import { RECOVER, SAY } from './phrases'
import { CUE, HIP_REF, TONE } from './params'

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
