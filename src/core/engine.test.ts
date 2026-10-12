import { describe, expect, it } from 'vitest'
import { CueEngine, type EngineSay, type ItemSpec, type ModeAnalyzer, type SecondContext, type Values } from './engine'
import { SAY } from './phrases'
import { HIP_REF } from './params'

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
