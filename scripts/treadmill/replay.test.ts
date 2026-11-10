import { describe, expect, it } from 'vitest'
import { makeCameraSample, type SampleSection } from './sample'
import { classify, inventory, loggedStand, replayCamera, type Ev } from './replay'
import { CUE as CUE_P } from '../../src/core/params'

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
// 同じ声が同じ順で、時刻は CUE.sustain 秒まで（記録の値は小数1桁に丸めてあり、1秒の区切りも撮ったときと少しずれるので、
// 1秒ごとの値が線の際の秒は、通し直すと線の内側と外側が入れ替わることがある。声は1秒ごとの値が線の外に CUE.sustain 秒続いてから
// なので、1秒入れ替わるだけで、続いた秒の数え直しの分（CUE.sustain 秒まで）ずれる。前は1秒まで）
const expectSame = (a: string[], b: string[]) => {
  expect(a.map((x) => x.split(':')[1])).toEqual(b.map((x) => x.split(':')[1]))
  a.forEach((x, i) => expect(Math.abs(Number(x.split(':')[0]) - Number(b[i].split(':')[0]))).toBeLessThanOrEqual(CUE_P.sustain))
}
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
    expectSame(cues(r.events), cues(logged(full)))
  })

  it('thin で、ふだんの間引きで撮ったときと同じ声になる', () => {
    expectSame(cues(replayCamera(full, { thin: true }).events), cues(logged(thin)))
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
    // 終わりは3分の少し前でもよい：この記録は3分ちょうどから頭を前に出すので、仮の基準（FORM.early）から崩れた秒はためない
    expect((ref.to - r.runStartT!) / 1000).toBeGreaterThan(170)
    expect((ref.to - r.runStartT!) / 1000).toBeLessThan(182)
    // 値は、その間に記録にある値の平均にほぼ等しい（1秒ごとに平均してから平均するので、少しだけ違う）
    const cols = full.log.columns
    const toT = (t: number) => full.log.clock!.epochMs + t * 1000 - full.log.clock!.perfMs
    const inRef = full.log.rows.filter((row) => toT(row[0]) >= ref.from - 1000 && toT(row[0]) <= ref.to)
    const avg = (n: string) => inRef.reduce((a, row) => a + row[cols.indexOf(n)], 0) / inRef.length
    expect(Math.abs(ref.trunk - avg('trunk'))).toBeLessThan(0.2)
    expect(Math.abs(ref.body - avg('body'))).toBeLessThan(0.2)
    // 腰は、骨格の点（小数1桁に丸めて記録）から測り直した立脚中期の値なので、記録の hipRatio の列（浮いたコマも含めた前の測り方）とは少しずれる
    expect(Math.abs(ref.hipRatio! - avg('hipRatio'))).toBeLessThan(0.01)
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

describe('トレッドミルの採点：立った姿勢 a（イベント pose:a）', () => {
  const log = (events: [number, string][], rows: number[][] = []) => ({ columns: ['t', 'phase', 'visible', 'hipRatio'], rows, events }) as unknown as Parameters<typeof loggedStand>[0]

  it('イベントの頭の位置・首・腰の高さを読む。無ければ null', () => {
    expect(loggedStand(log([[10, 'pose:a head 24.1 trunk -4.6 neck 28.4 headLean 22.5 yaw 0.028 hip 1.012']]))).toEqual({ headLean: 22.5, neck: 28.4, hip: 1.012, hipFrom: 'event' })
    expect(loggedStand(log([[10, 'pose:b head 24.5 trunk -7.0 neck 31.5 headLean 21.9 yaw 0.115']]))).toBeNull()
    // 測り直したら、あとの a
    expect(loggedStand(log([[10, 'pose:a head 1 trunk 0 neck 2 headLean 3 yaw 0'], [20, 'pose:a head 1 trunk 0 neck 5 headLean 6 yaw 0']]))).toMatchObject({ neck: 5, headLean: 6 })
  })

  it('腰の高さが無い前の記録は、a を測った3秒（イベントの直前）の、見えていた行の腰の高さの真ん中で代える', () => {
    const rows = [[5, 1, 1, 0.5], [8, 1, 1, 1.0], [9, 1, 1, 1.04], [9.5, 1, 0, 0.2], [10, 1, 1, 1.02], [11, 1, 1, 0.7]]
    expect(loggedStand(log([[10, 'pose:a head 24.1 trunk -4.6 neck 28.4 headLean 22.5 yaw 0.028']], rows))).toEqual({ headLean: 22.5, neck: 28.4, hip: 1.02, hipFrom: 'rows' })
  })
})
