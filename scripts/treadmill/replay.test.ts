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
    expect(b.frames).toBeLessThan(a.frames * 0.8)
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
