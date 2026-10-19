import { describe, expect, it } from 'vitest'
import { PHRASES, SAY } from '../../core/phrases'
import { findSegments, readPhone } from './compare'
import { Drill, DRILL_TIME, drillPlan, drillSteps } from './drill'
import { PhoneRun } from './session'
import { demoDrill } from './simulate'

// 崩しの撮影（drill.ts）：時刻 → いまの区間・声を出す時刻と、記録の区間の印。compare.ts が印で区間を決めるか

const runsOf = (o: Parameters<typeof drillPlan>[0]) => drillPlan(o).phases.filter((p) => p.kind === 'run')

describe('崩しの撮影：区間の並び', () => {
  it('ふつう版：ふつう6分 → 上半身の崩し6つ → 脚の崩し5つ（ピッチは2分）→ ふつう2分、区間のあいだに15秒の休み', () => {
    const runs = runsOf({ version: 'full', extra: false })
    expect(runs.map((p) => p.mark)).toEqual(['normal1', 'head', 'down', 'hunch', 'lean', 'armstill', 'armcross', 'sit', 'slow', 'bouncy', 'heel', 'flat', 'normal2'])
    expect(runs.map((p) => p.sec)).toEqual([360, 60, 60, 60, 60, 60, 60, 60, 120, 60, 60, 60, 120])
    const { phases } = drillPlan({ version: 'full', extra: false })
    expect(phases.map((p) => p.kind).slice(0, 5)).toEqual(['setup', 'jump', 'still', 'belt', 'run'])
    expect(phases.filter((p) => p.kind === 'rest').every((p) => p.sec === DRILL_TIME.rest)).toBe(true)
    expect(phases.slice(-2).map((p) => p.kind)).toEqual(['endJump', 'done'])
    // 段は切れ目なく続く
    phases.slice(1).forEach((p, i) => expect(p.start).toBe(phases[i].start + phases[i].sec))
  })

  it('短い版：ふつう5分、崩しは30秒（ピッチは1分）、最後のふつう1分。付け方の区間を足すと、その前の休みは長い', () => {
    const runs = runsOf({ version: 'short', extra: true })
    expect(runs.map((p) => p.mark)).toEqual(['normal1', 'head', 'down', 'hunch', 'lean', 'armstill', 'armcross', 'sit', 'slow', 'bouncy', 'heel', 'flat', 'normal2', 'loose', 'hand', 'pocket'])
    expect(runs.map((p) => p.sec)).toEqual([300, 30, 30, 30, 30, 30, 30, 30, 60, 30, 30, 30, 60, 30, 30, 30])
    const { phases } = drillPlan({ version: 'short', extra: true })
    const restBefore = (key: string) => phases[phases.findIndex((p) => p.mark === key) - 1]
    expect(restBefore('loose').sec).toBe(DRILL_TIME.restMount)
    expect(restBefore('head').sec).toBe(DRILL_TIME.rest)
    expect(drillSteps({ version: 'short', extra: false }).some((s) => s.extra)).toBe(false)
  })

  it('上半身だけ：脚に負担のかかる区間と付け方の区間は走らない（付け方を選んでいても）。最後はふつうに戻してジャンプ', () => {
    const runs = runsOf({ version: 'full', extra: true, upper: true })
    expect(runs.map((p) => p.mark)).toEqual(['normal1', 'head', 'down', 'hunch', 'lean', 'armstill', 'armcross', 'normal2'])
    expect(runs.map((p) => p.sec)).toEqual([360, 60, 60, 60, 60, 60, 60, 120])
    const { phases } = drillPlan({ version: 'full', extra: true, upper: true })
    expect(phases.slice(-2).map((p) => p.kind)).toEqual(['endJump', 'done'])
    expect(phases.filter((p) => p.kind === 'rest').every((p) => p.sec === DRILL_TIME.rest)).toBe(true)
    expect(runsOf({ version: 'short', extra: false, upper: true }).map((p) => p.sec)).toEqual([300, 30, 30, 30, 30, 30, 30, 60])
  })
})

describe('崩しの撮影：時刻 → いまの区間と声', () => {
  const T0 = 1000
  const plan = drillPlan({ version: 'full', extra: false })
  const at = (key: string) => plan.phases.find((p) => p.mark === key)!

  it('いまの段・残り・次に走る区間（休みは飛ばす）', () => {
    const d = new Drill({ version: 'full', extra: false }, T0)
    expect(d.at(T0).phase.kind).toBe('setup')
    expect(d.at(T0).remaining).toBe(DRILL_TIME.setup)
    const n1 = at('normal1')
    const a = d.at(T0 + n1.start + 100)
    expect(a.phase.mark).toBe('normal1')
    expect(a.remaining).toBe(260)
    expect(a.next?.mark).toBe('head')
    const rest = d.at(T0 + n1.start + n1.sec + 1)
    expect(rest.phase.kind).toBe('rest')
    expect(rest.next?.mark).toBe('head')
    expect(d.at(T0 + plan.total + 1).done).toBe(true)
  })

  it('休みの始めに「休みます」と次の区間のやり方、区間の始めに合図、残り10秒で予告。印は予定の時刻で、終わり→始まりの順', () => {
    const d = new Drill({ version: 'full', extra: false }, T0)
    const head = at('head')
    const n1 = at('normal1')
    d.advance(T0 + n1.start + n1.sec - 11)
    expect(d.advance(T0 + n1.start + n1.sec - 10).say).toEqual([PHRASES.drillSoon])
    const endN1 = d.advance(T0 + n1.start + n1.sec)
    expect(endN1.marks).toEqual([{ t: T0 + n1.start + n1.sec, text: 'protocol:normal1:end' }])
    expect(endN1.say).toEqual([PHRASES.drillRest, PHRASES.drillHead])
    const go = d.advance(T0 + head.start + 0.2)
    expect(go.say).toEqual([PHRASES.drillGo])
    expect(go.marks).toEqual([{ t: T0 + head.start, text: 'protocol:head:start' }])
    // 時間を飛ばしても、来た分はまとめて出る
    const rest = d.advance(T0 + plan.total)
    expect(rest.done).toBe(true)
    expect(rest.say[rest.say.length - 1]).toBe(PHRASES.drillDone)
    expect(rest.marks.map((m) => m.text).slice(-4)).toEqual(['protocol:normal2:end', 'protocol:jump2:start', 'protocol:jump2:end', 'protocol:done'])
  })

  it('誘導の声の前6秒・後3秒は busy（ほかの声を待たせる）', () => {
    const d = new Drill({ version: 'full', extra: false }, T0)
    const n1 = at('normal1')
    expect(d.busy(T0 + n1.start + 100)).toBe(false)
    expect(d.busy(T0 + n1.start + 2)).toBe(true)
    expect(d.busy(T0 + n1.start + n1.sec - 14)).toBe(true) // 予告の4秒前
  })

  it('途中でやめると、始まっていて閉じていない区間を閉じ、やめた印を付ける', () => {
    const d = new Drill({ version: 'full', extra: false }, T0)
    d.advance(T0 + at('hunch').start + 5)
    expect(d.stop()).toEqual(['protocol:hunch:end', 'protocol:stopped'])
    expect(d.stop()).toEqual([])
  })
})

// 模擬の走りを流し込み、誘導が最後まで進み、記録に印が残り、compare.ts がその印で区間を決めるか
describe.each([
  { label: '短い版・付け方の区間つき', o: { version: 'short', extra: true } as const },
  { label: '短い版・上半身だけ', o: { version: 'short', extra: false, upper: true } as const },
])('崩しの撮影：模擬データで最後まで（$label）', ({ o }) => {
  const base = 500
  const run = new PhoneRun({ perfMs: base * 1000, epochMs: 1_760_000_000_000 }, { userAgent: 'test', intervalMs: 16.7 }, 'treadmill', { kind: 'drill', drill: o })
  const data = demoDrill(run.drill!.phases)
  const said: { t: number; text: string }[] = []
  let next = base
  let done = false
  for (const m of data) {
    const t = base + m.t
    for (const e of run.feed({ ...m, t })) if (e.type === 'speak') said.push({ t, text: e.text })
    if (t >= next) {
      next += 0.25
      for (const e of run.guide(t)) if (e.type === 'speak') said.push({ t, text: e.text })
      if (run.drill!.at(t).done) {
        done = true
        break
      }
    }
  }
  const { log, session } = run.finish()
  const events = log.events.map((e) => e[1])
  const steps = drillSteps(o)

  it('最後まで進み、すべての区間の始まりと終わりの印が順に残る', () => {
    expect(done).toBe(true)
    const marks = events.filter((e) => e.startsWith('protocol:'))
    expect(marks).toEqual([
      'protocol:jump1:start', 'protocol:jump1:end', 'protocol:still:start', 'protocol:still:end',
      ...steps.flatMap((s) => [`protocol:${s.key}:start`, `protocol:${s.key}:end`]),
      'protocol:jump2:start', 'protocol:jump2:end', 'protocol:done',
    ])
    expect(events).toContain(o.upper ? 'kind:drill:short:upper' : 'kind:drill:short:extra')
    expect(session?.kind).toBe('drill')
    expect(said.map((s) => s.text)).toContain(PHRASES.drillDone)
  })

  it('しくみの始め・一時停止・再開の声は言わない。ピッチの声と付け方の確認の声は、誘導の声の近くでは出さない', () => {
    const texts = said.map((s) => s.text)
    for (const x of [SAY.start, SAY.pause, SAY.resume]) expect(texts).not.toContain(x)
    const d = run.drill!
    const guideTexts = new Set(Object.entries(PHRASES).filter(([id]) => id.startsWith('drill')).map(([, v]) => v as string))
    const other = said.filter((s) => !guideTexts.has(s.text))
    // 上半身だけの模擬の走りは、どの区間もピッチ・付け方がふつうと同じなので、ほかの声はかからない
    if (o.upper) {
      expect(other).toEqual([])
      return
    }
    expect(other.length).toBeGreaterThan(0)
    for (const s of other) expect(d.busy(s.t)).toBe(false)
    // ピッチを落とす区間で、ピッチの声がかかる（模擬データでは 172 → 155）
    const slow = d.phases.find((p) => p.mark === 'slow')!
    const cad = said.find((s) => s.text === PHRASES.phoneCadence)
    expect(cad).toBeDefined()
    expect(cad!.t - base).toBeGreaterThanOrEqual(slow.start)
    expect(cad!.t - base).toBeLessThanOrEqual(slow.start + slow.sec + DRILL_TIME.rest)
    // メトロノームを鳴らし始めるのは走る区間の中だけ（休みに前の区間の分を鳴らさない）
    const tonesOn = log.events.filter((e) => e[1].startsWith('tone:on:'))
    expect(tonesOn.length).toBeGreaterThan(0)
    for (const [t] of tonesOn) expect(d.at(t).phase.kind).toBe('run')
    // 付け方の区間で、付け方の確認の声がかかる
    const loose = d.phases.find((p) => p.mark === 'loose')!
    const mount = said.find((s) => s.text === PHRASES.phoneMount || s.text === PHRASES.phoneLoose || s.text === PHRASES.phonePlace)
    expect(mount).toBeDefined()
    expect(mount!.t - base).toBeGreaterThanOrEqual(loose.start)
  })

  it('compare.ts は印で区間を決める（休みの見分けより先）', () => {
    const ph = readPhone(JSON.parse(JSON.stringify({ log, session })))
    const { segments, warnings } = findSegments(ph)
    expect(segments.map((s) => s.step?.key)).toEqual(steps.map((s) => s.key))
    if (o.extra) expect(segments.find((s) => s.step?.key === 'hand')?.step?.expect).toBe('notWaist')
    if (o.upper) expect(segments.find((s) => s.step?.key === 'armcross')?.step?.name).toBe('腕を横に振る')
    const plan = run.drill!.phases.filter((p) => p.kind === 'run')
    segments.forEach((s, i) => {
      expect(s.end - s.start).toBeCloseTo(plan[i].sec, 3)
    })
    expect(warnings[0]).toContain('印')
    // 名前を渡したときは、今までどおり休みで区切る
    expect(findSegments(ph, undefined, ['a']).warnings.some((w) => w.includes('印'))).toBe(false)
  })
})
