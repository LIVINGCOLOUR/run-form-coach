import { describe, expect, it } from 'vitest'
import { buildPlan, clickWav, DEFAULT_STEPS, DEFAULTS, len, metronomeBpm, STEPS } from './plan.mjs'

const RUN = ['normal', 'drill', 'gap', 'speed']

describe('トレッドミルの区間の時刻表', () => {
  it('既定：歩き5分 → ジャンプ → ジョグ22分30秒（起きた形の走り出し・ふつう4分・崩しと戻し・速さを変える・残り）→ スマホを動かして2分 → 歩き3分', () => {
    const p = buildPlan()
    const by = (kind) => p.sections.filter((s) => s.kind === kind)
    expect(by('walk')[0].plannedSec).toBe(300)
    expect(by('drill').map((s) => s.key)).toEqual(['upright', ...DEFAULT_STEPS])
    expect(by('gap')).toHaveLength(DEFAULT_STEPS.length)
    expect(by('gap').map((s) => s.after)).toEqual(DEFAULT_STEPS)
    const jog = p.sections.filter((s) => RUN.includes(s.kind)).reduce((a, s) => a + s.plannedSec, 0)
    expect(jog).toBe(DEFAULTS.jog)
    expect(by('cool')[0].plannedSec).toBe(180)
    // 区間はすき間なく続く
    p.sections.slice(1).forEach((s, i) => expect(s.plannedStart).toBe(p.sections[i].plannedStart + p.sections[i].plannedSec))
    expect(p.warnings).toEqual([])
    // 全体は35分前後（本人が楽に走れる時速8km で、前回は31分）
    expect(p.total / 60).toBeGreaterThan(33)
    expect(p.total / 60).toBeLessThan(40)
  })

  it('起きた形で走り出し（「スタート」はその区間の始まり）、そのあとのふつうは4分', () => {
    const p = buildPlan()
    const i = p.sections.findIndex((s) => s.key === 'upright')
    expect(p.sections[i - 1].kind).toBe('speedup')
    expect(p.sections[i + 1]).toMatchObject({ key: 'normal1', kind: 'normal', plannedSec: 240 })
    const start = p.cues.find((c) => c.begin === i)
    expect(start.say.startsWith('スタート。')).toBe(true)
    expect(start.say).toContain('アプリの声')
    expect(STEPS.upright.camera).toEqual(['bodyBack', 'trunkBack'])
    // 入れないときは、ふつうの区間が「スタート」から始まる
    const q = buildPlan({ upright: 0 })
    expect(q.sections.some((s) => s.key === 'upright')).toBe(false)
    expect(q.cues.find((c) => c.begin === q.sections.findIndex((s) => s.key === 'normal1')).say).toBe('スタート。')
  })

  it('着地の崩し（大また・ピッチを1割落とす）は1分ずつで、ピッチを落とす区間はいつものピッチの0.9倍のメトロノームを鳴らす', () => {
    const p = buildPlan()
    const heel = p.sections.find((s) => s.key === 'heel')
    const slow = p.sections.find((s) => s.key === 'slow')
    expect(heel.plannedSec).toBe(60)
    expect(slow.plannedSec).toBe(60)
    expect(STEPS.heel.camera).toEqual(['landing'])
    expect(STEPS.slow.camera).toEqual(['landing'])
    expect(slow.metronome).toBe(Math.round(DEFAULTS.cadence * 0.9))
    const c = p.cues.find((x) => x.begin === p.sections.indexOf(slow))
    expect(c).toMatchObject({ metronome: metronomeBpm(DEFAULTS, 'slow'), sec: 60 })
    expect(c.say).toContain('メトロノーム')
    expect(buildPlan({ cadence: 170 }).sections.find((s) => s.key === 'slow').metronome).toBe(153)
  })

  it('速さを 8 → 9 → 10 → 8km/h と1分ずつ変え、区間の始めに時速を言う。戻しの区間は走ったまま', () => {
    const p = buildPlan()
    const sp = p.sections.filter((s) => s.kind === 'speed')
    expect(sp.map((s) => s.kmh)).toEqual([9, 10, 8])
    expect(sp.map((s) => s.plannedSec)).toEqual([60, 60, 60])
    for (const s of sp) expect(p.cues.find((c) => c.begin === p.sections.indexOf(s)).say).toContain(`時速${s.kmh.toFixed(1)}`)
    for (const g of p.sections.filter((s) => s.kind === 'gap')) expect(p.cues.find((c) => c.begin === p.sections.indexOf(g)).say).toContain('走ったまま')
    expect(buildPlan({ speeds: [] }).sections.some((s) => s.kind === 'speed')).toBe(false)
  })

  it('最後に、止めてスマホを走る向きと反対へ約30cm動かし（画面から30秒外れる前に戻る）、2分走る', () => {
    const p = buildPlan()
    const keys = p.sections.map((s) => s.key)
    const i = keys.indexOf('move')
    expect(keys.slice(i - 1, i + 4)).toEqual(['stop2', 'move', 'speedup2', 'moved', 'cool'])
    expect(p.sections[i].plannedSec).toBeLessThan(30)
    expect(p.sections[i + 2].plannedSec).toBe(120)
    expect(p.cues.find((c) => c.begin === i).say).toContain('30センチ')
    expect(buildPlan({ moveSec: 40 }).warnings.length).toBe(1)
  })

  it('速さを変える区間の始めに速さを言い、ジャンプの「はい」がジョグの前にある', () => {
    const p = buildPlan()
    const say = p.cues.map((c) => c.say)
    expect(say.some((s) => s?.includes('時速5.0'))).toBe(true)
    expect(say.some((s) => s?.includes('時速8.0'))).toBe(true)
    const jump = p.cues.find((c) => c.jump)
    const jog = p.sections.find((s) => s.key === 'upright')
    expect(jump.at).toBeLessThan(jog.plannedStart)
  })

  it('心拍の目安は崩しと戻し・速さを変える区間に重ならず、続けて言わない', () => {
    const p = buildPlan()
    const hr = p.cues.filter((c) => c.say?.startsWith('心拍'))
    expect(hr.length).toBeGreaterThan(0)
    for (const c of hr) for (const s of p.sections.filter((x) => ['drill', 'gap', 'speed'].includes(x.kind))) expect(c.at < s.plannedStart - 8 || c.at >= s.plannedStart + s.plannedSec).toBe(true)
    hr.slice(1).forEach((c, i) => expect(c.at - hr[i].at).toBeGreaterThanOrEqual(DEFAULTS.hrEvery / 2))
  })

  it('並びと長さを変えられ、入りきらなければ知らせる', () => {
    const p = buildPlan({ steps: ['head', 'bouncy'], sec: 60, gap: 0, jog: 400, upright: 0, speeds: [] })
    expect(p.sections.filter((s) => s.kind === 'drill').map((s) => s.plannedSec)).toEqual([60, 60])
    expect(p.sections.some((s) => s.kind === 'gap')).toBe(false)
    expect(buildPlan({ jog: 300 }).warnings.length).toBe(1)
    expect(() => buildPlan({ steps: ['nope'] })).toThrow()
    expect(len(150)).toBe('2分30秒')
  })

  it('メトロノームの音は、テンポどおりの間隔で鳴る WAV', () => {
    const buf = clickWav(150, 4, 8000)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.readUInt32LE(24)).toBe(8000)
    const n = (buf.length - 44) / 2
    expect(n).toBe(32000)
    // 拍の始まり（音が鳴り始めたサンプル）の間隔は 60/150 秒
    const on = []
    for (let i = 1; i < n; i++) if (Math.abs(buf.readInt16LE(44 + i * 2)) > 1000 && on.every((x) => i - x > 400)) on.push(i)
    expect(on.length).toBe(10)
    expect((on[1] - on[0]) / 8000).toBeCloseTo(0.4, 2)
  })
})
