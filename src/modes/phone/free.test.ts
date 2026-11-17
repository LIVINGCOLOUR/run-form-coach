import { describe, expect, it } from 'vitest'
import { CUE } from '../../core/params'
import { PHRASES } from '../../core/phrases'
import { FreeCoach, lineText, type FreeSec } from './free'
import { FREE } from './params'

// 自由走の試しの声（free.ts）：答えつきの区間で線を作り、自由走で、線を続けて越えたときだけ1つ言う

const UP: [number, number, number] = [0, 0, 1]
const sec = (t: number, o: Partial<FreeSec> = {}): FreeSec => ({ t, judged: true, stopped: false, up: UP, cadence: 170, bounceCm: 8, brakingMs: 0.3, duty: 0.44, peakG: 3, speed: null, ...o })
// 揺れを少し入れたふつうの値（ふつうの上の端が線の下にあるように）
const wobble = (i: number) => ({ cadence: 170 + (i % 3) - 1, bounceCm: 8 + ((i % 5) - 2) * 0.1, brakingMs: 0.3 + ((i % 4) - 1.5) * 0.004, duty: 0.44 + ((i % 7) - 3) * 0.002, peakG: 3 + ((i % 6) - 2.5) * 0.02 })

// 答えつきの区間をまねて学ばせる：最初のふつう 240秒・腰を深く落とす 30秒×2（接地の割合 +10%・山 −12%）・弾む 30秒×2（上下動 +40%）・
// 足を前に出しすぎる（over）は、ふつうと同じ値（分かれない）。戻し 40秒ずつ
function learned(o: { overSame?: boolean } = {}) {
  const c = new FreeCoach()
  let t = 0
  const run = (key: string, n: number, f: (i: number) => Partial<FreeSec>) => {
    for (let i = 0; i < n; i++) c.learn(key, i, sec(t++, { ...wobble(i), ...f(i) }))
  }
  run('normal1', 240, () => ({}))
  for (const k of ['sitdeep', 'sitdeep']) {
    run(k, 30, () => ({ duty: 0.484, peakG: 2.64 }))
    run('back', 40, () => ({}))
  }
  for (const k of ['bouncy', 'bouncy']) {
    run(k, 30, () => ({ bounceCm: 11.2 }))
    run('back', 40, () => ({}))
  }
  if (o.overSame) run('over', 30, () => ({}))
  run('normal2', 60, () => ({}))
  c.build()
  return { c, t }
}

describe('自由走の試しの声：線の作り方', () => {
  it('ふつうの上の端と、わざとの崩しの真ん中の間に線を引く。崩しの区間がない・分かれない項目は線を作らない（声にしない）', () => {
    const { c } = learned({ overSame: true })
    const by = Object.fromEntries(c.lines.map((l) => [l.item, l]))
    expect(by.sit.why).toBe('ok')
    expect(by.sit.line!).toBeGreaterThan(by.sit.normalHi!)
    expect(by.sit.line!).toBeLessThan(by.sit.crit!)
    expect(by.bounce.why).toBe('ok')
    expect(by.bounce.line!).toBeCloseTo((by.bounce.normalHi! + by.bounce.crit!) / 2, 6)
    expect(by.over.why).toBe('overlap') // 足を前に出しすぎるがふつうと同じ値
    expect(by.over.line).toBeNull()
    // ピッチは研究の 5%（崩しは要らない）
    expect(by.cadence.line).toBe(5)
    expect(lineText(by.over)).toBe(`free:line over none overlap hi ${by.over.normalHi!.toFixed(2)} crit ${by.over.crit!.toFixed(2)} n ${by.over.nNormal}/${by.over.nCrit}`)
  })

  it('崩しの区間を走らなかった項目は few（線なし）', () => {
    const { c } = learned()
    expect(c.lines.find((l) => l.item === 'over')?.why).toBe('few')
  })

  it('最初のふつうが短く、基準が作れなければ、どの項目も声にしない', () => {
    const c = new FreeCoach()
    for (let i = 0; i < 90; i++) c.learn('normal1', i, sec(i))
    c.build()
    expect(c.lines.every((l) => l.line === null && l.why === 'noBase')).toBe(true)
    expect(c.judge(sec(1000, { duty: 0.6, peakG: 2 }))).toBeNull()
  })
})

describe('自由走の試しの声：言うとき', () => {
  // 自由走を、ふつうに走り始めて FREE.afterStop 秒より後から見る
  const start = (c: FreeCoach, t0: number) => {
    for (let i = 0; i <= FREE.afterStop; i++) expect(c.judge(sec(t0 + i, wobble(i)))).toBeNull()
    return t0 + FREE.afterStop + 1
  }

  it('腰落ちの値が FREE.hold 秒続けて線を越えたら、腰落ちの言葉を1回言う。ふつうでは言わない', () => {
    const { c, t } = learned()
    let u = start(c, t)
    for (let i = 0; i < 600; i++) expect(c.judge(sec(u++, wobble(i)))).toBeNull()
    const said = []
    for (let i = 0; i < FREE.hold; i++) said.push(c.judge(sec(u++, { duty: 0.484, peakG: 2.64 })))
    expect(said.slice(0, -1).every((x) => x === null)).toBe(true)
    expect(said.at(-1)?.item).toBe('sit')
    expect(said.at(-1)?.text).toBe(PHRASES.cueHip)
  })

  it('同じ項目は CUE.cooldown 秒あける（崩れたままなら、そのあとまた言う）', () => {
    const { c, t } = learned()
    let u = start(c, t)
    const at: number[] = []
    for (let i = 0; i < 90; i++) {
      const r = c.judge(sec(u, { duty: 0.484, peakG: 2.64 }))
      if (r) at.push(u)
      u++
    }
    expect(at.length).toBeGreaterThan(1)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(CUE.cooldown)
  })

  it('止まったあとは FREE.afterStop 秒、速さ・付け方などで判定しなかった秒のあとは FREE.after 秒、言わない', () => {
    const { c, t } = learned()
    let u = start(c, t)
    c.judge(sec(u++, { stopped: true, cadence: null }))
    for (let i = 0; i < FREE.afterStop - 1; i++) expect(c.judge(sec(u++, { duty: 0.484, peakG: 2.64 }))).toBeNull()
    const { c: c2, t: t2 } = learned()
    let v = start(c2, t2)
    c2.judge(sec(v++, { judged: false }))
    for (let i = 0; i < FREE.after; i++) expect(c2.judge(sec(v++, { duty: 0.484, peakG: 2.64 }))).toBeNull()
    let hit = null
    for (let i = 0; i < FREE.hold + 1 && !hit; i++) hit = c2.judge(sec(v++, { duty: 0.484, peakG: 2.64 }))
    expect(hit?.item).toBe('sit')
  })

  it('スマホの上向きが最初のふつうから PHONE.upShiftDeg より傾いた秒は判定しない', () => {
    const { c, t } = learned()
    let u = start(c, t)
    const tilted: [number, number, number] = [Math.sin(0.2), 0, Math.cos(0.2)] // 約11°
    for (let i = 0; i < 60; i++) expect(c.judge(sec(u++, { up: tilted, duty: 0.484, peakG: 2.64 }))).toBeNull()
  })

  it('外：最初のふつうの速さから SPEED.band より外れた秒・GPS がない秒は判定しない', () => {
    const c = new FreeCoach()
    let t = 0
    for (let i = 0; i < 240; i++) c.learn('normal1', i, sec(t++, { ...wobble(i), speed: 3 }))
    for (let i = 0; i < 60; i++) c.learn('sitdeep', i, sec(t++, { duty: 0.484, peakG: 2.64, speed: 3 }))
    c.build()
    expect(c.base?.speed).toBe(3)
    let u = start(c, t)
    // start は speed: null で走ったので判定していない。速さが外れたまま
    for (let i = 0; i < 60; i++) expect(c.judge(sec(u++, { duty: 0.484, peakG: 2.64, speed: 2.5 }))).toBeNull()
    for (let i = 0; i < 60; i++) expect(c.judge(sec(u++, { duty: 0.484, peakG: 2.64, speed: null }))).toBeNull()
    let hit = null
    for (let i = 0; i < 60 && !hit; i++) hit = c.judge(sec(u++, { duty: 0.484, peakG: 2.64, speed: 3.05 }))
    expect(hit?.item).toBe('sit')
  })
})
