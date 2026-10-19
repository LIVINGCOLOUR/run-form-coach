import { describe, expect, it } from 'vitest'
import { buildPlan, DEFAULT_STEPS, len } from './plan.mjs'

describe('トレッドミルの区間の時刻表', () => {
  it('既定：歩き7分 → ジャンプ → ジョグ20分（ふつう4分・崩しと戻し30秒ずつ8回・残り）→ 歩き3分', () => {
    const p = buildPlan()
    const by = (kind) => p.sections.filter((s) => s.kind === kind)
    expect(by('walk')[0].plannedSec).toBe(420)
    expect(by('drill').map((s) => s.key)).toEqual(DEFAULT_STEPS)
    expect(by('gap')).toHaveLength(8)
    expect(by('gap').map((s) => s.after)).toEqual(DEFAULT_STEPS)
    const jog = p.sections.filter((s) => ['normal', 'drill', 'gap'].includes(s.kind)).reduce((a, s) => a + s.plannedSec, 0)
    expect(jog).toBe(1200)
    expect(by('cool')[0].plannedSec).toBe(180)
    // 区間はすき間なく続く
    p.sections.slice(1).forEach((s, i) => expect(s.plannedStart).toBe(p.sections[i].plannedStart + p.sections[i].plannedSec))
    expect(p.warnings).toEqual([])
  })

  it('速さを変える区間の始めに速さを言い、ジャンプの「はい」がジョグの前にある', () => {
    const p = buildPlan()
    const say = p.cues.map((c) => c.say)
    expect(say.some((s) => s?.includes('時速5.0'))).toBe(true)
    expect(say.some((s) => s?.includes('時速8.0'))).toBe(true)
    const jump = p.cues.find((c) => c.jump)
    const jog = p.sections.find((s) => s.key === 'normal1')
    expect(jump.at).toBeLessThan(jog.plannedStart)
  })

  it('心拍の目安は崩しと戻しの区間に重ならない', () => {
    const p = buildPlan()
    const hr = p.cues.filter((c) => c.say?.startsWith('心拍'))
    expect(hr).toHaveLength(1)
    for (const c of hr) for (const s of p.sections.filter((x) => x.kind === 'drill' || x.kind === 'gap')) expect(c.at < s.plannedStart - 8 || c.at >= s.plannedStart + s.plannedSec).toBe(true)
  })

  it('並びと長さを変えられ、入りきらなければ知らせる', () => {
    const p = buildPlan({ steps: ['head', 'bouncy'], sec: 60, gap: 0, jog: 300 })
    expect(p.sections.filter((s) => s.kind === 'drill').map((s) => s.plannedSec)).toEqual([60, 60])
    expect(p.sections.some((s) => s.kind === 'gap')).toBe(false)
    expect(buildPlan({ jog: 300 }).warnings.length).toBe(1)
    expect(() => buildPlan({ steps: ['nope'] })).toThrow()
    expect(len(150)).toBe('2分30秒')
  })
})
