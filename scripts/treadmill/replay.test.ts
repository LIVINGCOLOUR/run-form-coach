import { describe, expect, it } from 'vitest'
import { makeCameraSample, type SampleSection } from './sample'
import { classify, inventory, replayCamera, type Ev } from './replay'

// ふつう3分 → 頭を前に30秒 → 戻し30秒 → 体ごと前に30秒 → 戻し30秒（区間の始まりは 17:00 から1分後）
const t0 = new Date(2026, 9, 19, 17, 0, 0).getTime()
const parts: [string, string, number][] = [['normal', 'normal', 180], ['head', 'drill', 30], ['gap', 'gap', 30], ['lean', 'drill', 30], ['gap', 'gap', 30]]
const sections: SampleSection[] = []
let at = t0 + 60_000
for (const [key, kind, sec] of parts) {
  sections.push({ key, kind, start: at, end: at + sec * 1000 })
  at += sec * 1000
}
const cues = (evs: Ev[]) => evs.filter((e) => classify(e.text)?.kind === 'cue').map((e) => `${Math.round(e.T / 1000)}:${e.text}`)
const logged = (f: ReturnType<typeof makeCameraSample>) => f.log.events.map(([t, text]) => ({ T: f.log.clock!.epochMs + t * 1000 - f.log.clock!.perfMs, text }))

describe('トレッドミルの採点：カメラ版の全コマ記録', () => {
  const full = makeCameraSample(sections, null, 1, true)
  const thin = makeCameraSample(sections, null, 1, false)

  it('全コマ記録は、走っている間の毎コマが残る（ふだんの記録は間引いた分だけ少ない）', () => {
    expect(full.log.full).toBe(true)
    expect(thin.log.full).toBeUndefined()
    const a = inventory(full)
    const b = inventory(thin)
    expect(a.full).toBe(true)
    expect(b.full).toBe(false)
    // 走り始めの基準ができるまで（約3分）は、ふだんの記録も毎コマ取る。間引くのはそのあとの約2分だけ
    expect(b.frames).toBeLessThan(a.frames * 0.95)
    // 走る段のコマにすき間がない（毎秒15コマ）
    const run = full.log.rows.filter((r) => r[1] === full.log.phases.indexOf('run')).map((r) => r[0])
    const gaps = run.slice(1).map((t, i) => t - run[i])
    expect(Math.max(...gaps)).toBeLessThan(0.1)
  })

  it('通し直すと、撮ったときと同じ声が同じ時刻に出る', () => {
    const r = replayCamera(full)
    expect(cues(r.events).length).toBeGreaterThan(0)
    expect(cues(r.events)).toEqual(cues(logged(full)))
  })

  it('thin で、ふだんの間引きで撮ったときと同じ声になる', () => {
    expect(cues(replayCamera(full, { thin: true }).events)).toEqual(cues(logged(thin)))
    expect(replayCamera(thin, { thin: true }).warnings.some((w) => w.includes('--thin'))).toBe(true)
  })
})

describe('トレッドミルの採点：走り始めの基準と「走っている」の決め直し', () => {
  const full = makeCameraSample(sections, null, 1, true)

  it('基準を作った時刻（走り始めて30秒〜3分）と、その値を返す', () => {
    const r = replayCamera(full)
    expect(r.runStartT).not.toBeNull()
    expect(r.ref).toBeTruthy()
    const ref = r.ref!
    expect((ref.from - r.runStartT!) / 1000).toBeGreaterThan(29)
    expect((ref.from - r.runStartT!) / 1000).toBeLessThan(32)
    expect((ref.to - r.runStartT!) / 1000).toBeGreaterThan(179)
    expect((ref.to - r.runStartT!) / 1000).toBeLessThan(182)
    // 値は、その間に記録にある値の平均にほぼ等しい（1秒ごとに平均してから平均するので、少しだけ違う）
    const cols = full.log.columns
    const toT = (t: number) => full.log.clock!.epochMs + t * 1000 - full.log.clock!.perfMs
    const inRef = full.log.rows.filter((row) => toT(row[0]) >= ref.from - 1000 && toT(row[0]) <= ref.to)
    const avg = (n: string) => inRef.reduce((a, row) => a + row[cols.indexOf(n)], 0) / inRef.length
    expect(Math.abs(ref.trunk - avg('trunk'))).toBeLessThan(0.2)
    expect(Math.abs(ref.body - avg('body'))).toBeLessThan(0.2)
    expect(Math.abs(ref.hipRatio! - avg('hipRatio'))).toBeLessThan(0.005)
  })

  it('running: steps は、歩数で走っているコマだけを走っているとする（その場で走るフリの見分けを切ったとき）', () => {
    // 見本は走っている間ずっと歩数で見分けている（by = steps）ので、決め直しても同じ
    expect(cues(replayCamera(full, { running: 'steps' }).events)).toEqual(cues(replayCamera(full).events))
    // 走り始めの1分を「その場で走るフリ」（by = 2）にすると、歩数だけで決め直したときはそのあとで走り始める
    const log = { ...full.log, rows: full.log.rows.map((r) => [...r]) }
    const ib = log.columns.indexOf('by')
    const toT = (t: number) => log.clock!.epochMs + t * 1000 - log.clock!.perfMs
    const from = sections[0].start
    for (const r of log.rows) if (r[ib] === 1 && toT(r[0]) < from + 60_000) r[ib] = 2
    const f = { log, session: full.session }
    const a = replayCamera(f)
    const b = replayCamera(f, { running: 'steps' })
    // 走り始めは、直近10秒のコマの8割が走っているになってから、さらに2秒（約10秒）
    expect((a.runStartT! - from) / 1000).toBeLessThan(13)
    expect((b.runStartT! - from) / 1000).toBeGreaterThan(60)
  })
})
