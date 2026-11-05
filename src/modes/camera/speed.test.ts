import { afterEach, describe, expect, it } from 'vitest'
import { applySpeed, applyStrictness, FORM, GOOD, GOOD_SPEED, goodAt, STRICT, typicalHipAt, GAIT } from './params'
import { formOver } from './form'
import { formRows, gaitRows, goodGap, HEAD_LINE_NOTE, nextItem, speedNote, todayFocus } from './nextStep'
import { parseKmh, runSpeedOf } from './belt'
import { Coach } from './coach'
import { startProgress } from '../../core/level'
import type { FormGroup, FormResult, Session } from '../../core/types'

// 速さごとのよい例（params.ts の GOOD_SPEED・goodAt）と、ベルトの速さ（belt.ts）
afterEach(() => applyStrictness('beginner', undefined))

const formOf = (group: FormGroup, value: number, value2?: number): FormResult => {
  const v = { body: GOOD.body.mid, trunk: GOOD.trunk.mid, neck: GOOD.head.neck.mid, headLean: value2 ?? GOOD.head.headLean.mid, [group === 'head' ? 'neck' : group]: value }
  const o = formOver(group, v)
  return { group, key: o.key, value, over: o.over, inside: 1, cues: 0, fixed: false, judged: true, ...(group === 'head' ? { value2: v.headLean, yaw: 0.01 } : {}) }
}
const runOf = (body: number, trunk: number, neck: number, headLean: number, speedKmh?: number): Session =>
  ({ id: 'r', startedAt: 0, durationSec: 900, samples: [], cues: [], strides: {}, share: { good: 1, mid: 0, bad: 0 }, quietHeldSec: 0, form: [formOf('body', body), formOf('trunk', trunk), formOf('head', neck, headLean)], ...(speedKmh !== undefined ? { speedKmh, speedSource: 'belt' } : {}) }) as Session

describe('速さごとのよい例（goodAt）', () => {
  it('速さが分からなければ、講師の速さの範囲（GOOD）そのもの', () => {
    const g = goodAt()
    expect(g.body).toEqual(GOOD.body)
    expect(g.head).toEqual(GOOD.head)
    expect(g.provisional).toBe(false)
    expect(goodAt(GOOD_SPEED.anchor).body).toMatchObject({ min: GOOD.body.min, max: GOOD.body.max })
  })

  it('遅いほど体全体・上体は下がり、首の上の端は上がり、頭の位置と着地は動かない。講師の速さから離れるほど広く、例のない速さは仮', () => {
    const g9 = goodAt(9)
    const g7 = goodAt(7)
    expect(g9.body.mid).toBeCloseTo(GOOD.body.mid - 3 * GOOD_SPEED.slope, 5)
    expect(g9.trunk.mid).toBeCloseTo(GOOD.trunk.mid - 3 * GOOD_SPEED.slope, 5)
    expect(g9.head.neck.mid).toBeCloseTo(GOOD.head.neck.mid + 3 * GOOD_SPEED.slope, 5)
    expect(g9.head.headLean.mid).toBe(GOOD.head.headLean.mid)
    expect(g9.landing).toEqual(GOOD.landing)
    expect(g7.body.max - g7.body.min).toBeGreaterThan(g9.body.max - g9.body.min)
    expect(g9.body.max - g9.body.min).toBeGreaterThan(GOOD.body.max - GOOD.body.min)
    expect(g9.provisional).toBe(true)
    expect(goodAt(11).provisional).toBe(false)
    // 端の外は止める：時速5km は 7km と同じずらし、15km より速いと 12km と同じ真ん中
    expect(goodAt(5).body.mid).toBe(g7.body.mid)
    expect(goodAt(16).body.mid).toBe(GOOD.body.mid)
  })
})

describe('結果の画面・次の一歩は、その走りの速さのよい例と比べる', () => {
  it('時速8kmの自分（体全体 6.2°）は、講師の速さでは「起きています」だが、時速8kmの範囲では内側', () => {
    expect(formRows(runOf(6.2, 5, 30, 35).form!)[0]).toMatchObject({ state: 'off', word: '起きています' })
    const row = formRows(runOf(6.2, 5, 30, 35, 8).form!, 8)[0]
    expect(row.state).toBe('in')
    expect(row.good).toBe(`${goodAt(8).body.min}°〜${goodAt(8).body.max}°`)
    expect(nextItem(runOf(6.2, 5, 30, 35))).toMatchObject({ kind: 'good', item: 'bodyBack' })
    expect(nextItem(runOf(6.2, 5, 30, 35, 8))).toBeUndefined()
    expect(goodGap({ group: 'body', value: 6.2 }, goodAt(8)).gap).toBe(0)
  })

  it('速さの範囲から離れていれば、その範囲の端を目指す値にする。near はどの速さでも同じ', () => {
    const g = goodAt(9)
    const n = nextItem(runOf(g.body.max + 1, g.trunk.mid, 30, 35, 9))
    expect(n).toMatchObject({ kind: 'good', item: 'body', to: g.body.max, gap: expect.closeTo(1, 5) })
    expect(nextItem(runOf(g.body.max + GOOD.body.near - 0.2, g.trunk.mid, 30, 35, 9))).toBeUndefined()
    expect(todayFocus([runOf(g.body.max + 1, g.trunk.mid, 30, 35, 9)], startProgress('beginner')).reason).toContain('時速9km')
  })

  it('上級のいつもの頭（首 33°・頭の位置 37°）は線の外だが、時速8kmのよい例の首の範囲には入っている、と書く', () => {
    applyStrictness('advanced')
    const r = formOf('head', 33, 37)
    expect(r.over).toBeGreaterThan(0)
    const row = formRows([r], 8)[0]
    expect(row).toMatchObject({ state: 'in', lineOut: true, note: HEAD_LINE_NOTE })
    // 講師の速さでは、首の角度の差を出す（前のまま）
    expect(formRows([r])[0]).toMatchObject({ state: 'off', lineOut: true })
  })

  it('速さの出どころと、仮の範囲かを説明に書く', () => {
    expect(speedNote(undefined)).toContain('講師の速さ')
    expect(speedNote({ speedKmh: 8, speedSource: 'belt' })).toContain('時速8km')
    expect(speedNote({ speedKmh: 8, speedSource: 'belt' })).toContain('仮')
    expect(speedNote({ speedKmh: 11, speedSource: 'sensor' })).not.toContain('仮')
  })

  it('腰の高さの範囲も速さでずらす（速いほど低い）', () => {
    expect(typicalHipAt()).toEqual(GAIT.typical.hip)
    expect(typicalHipAt(8).mid).toBeGreaterThan(typicalHipAt(12).mid)
    const hip = GAIT.typical.hip.max + 0.005 // 講師の速さの範囲より高いが、時速8kmなら範囲の内側
    expect(gaitRows({ steps: 100, hip }, 1)[0]).toMatchObject({ key: 'hip', state: 'high' })
    expect(gaitRows({ steps: 100, hip }, 1, 8)[0]).toMatchObject({ key: 'hip', state: 'in' })
  })
})

describe('速さで動く線（ベルトの速さが分かっている走りだけ）', () => {
  it('体全体の下の線は、遅いほど下げる（上げない）。上の線と頭の線は動かさない', () => {
    applyStrictness('advanced', 8)
    expect(FORM.body.min).toBeCloseTo(goodAt(8).body.min - 0.3, 5)
    expect(FORM.body.min).toBeLessThan(5.5)
    expect(FORM.body.max).toBe(STRICT.advanced.form.bodyMax)
    expect(FORM.trunk.max).toBe(STRICT.advanced.form.trunkMax)
    expect(FORM.head.neck).toBe(STRICT.advanced.form.neck)
    applySpeed(14)
    expect(FORM.body.min).toBe(5.5)
    applySpeed(undefined)
    expect(FORM.body.min).toBe(5.5)
  })

  it('Coach に速さを渡すとその線で、渡さなければ（level もなければ）いまの線のまま', () => {
    applyStrictness('beginner', undefined)
    new Coach({ pause: false, level: 'beginner', kmh: 8 })
    expect(FORM.body.min).toBeLessThan(5.5)
    FORM.body.min = 4.4 // 採点の道具が線を書き換えたとき
    new Coach({ pause: false })
    expect(FORM.body.min).toBe(4.4)
  })
})

describe('ベルトの速さ（belt.ts）', () => {
  it('入力の文字：空欄・範囲の外は使わない。全角も読む', () => {
    expect(parseKmh('')).toBeUndefined()
    expect(parseKmh('abc')).toBeUndefined()
    expect(parseKmh('1')).toBeUndefined()
    expect(parseKmh('9')).toBe(9)
    expect(parseKmh(' 8.5 ')).toBe(8.5)
    expect(parseKmh('８．５')).toBe(8.5)
  })

  it('その走りの速さ：ベルト → 足首のセンサー（1歩が足りれば）→ カメラの目安', () => {
    const vs = Array.from({ length: 200 }, (_, i) => 8 + (i % 5) * 0.1)
    expect(runSpeedOf({ belt: 9, sensorV: vs, camSv: 1.5 })).toEqual({ kmh: 9, source: 'belt' })
    expect(runSpeedOf({ sensorV: vs, camSv: 1.5 })).toEqual({ kmh: 8.2, source: 'sensor' })
    expect(runSpeedOf({ sensorV: vs.slice(0, 10), camSv: 1.5 })).toEqual({ kmh: Math.round(1.5 * GOOD_SPEED.kmhPerSv * 10) / 10, source: 'camera' })
    expect(runSpeedOf({})).toBeUndefined()
  })
})
