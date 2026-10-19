import { describe, expect, it } from 'vitest'
import { activeItems, afterRun, startPhrase, startProgress } from './level'
import { PHRASES } from './phrases'
import { LEVEL } from './params'
import { category } from './scoring'
import { breakdownMinute } from './engine'
import { fmtMinSec, quietDelta, splitMinSec } from './quiet'
import type { ItemKey, Sample, Session } from './types'

// 入り口に共通の部分（点数の分け方、崩れ始め、ランナーのレベル、声なしで保てた時間）。
// カメラ版の測り方と声かけのテストは src/modes/camera/camera.test.ts

describe('点数', () => {
  it('良い・ふつう・悪い', () => {
    expect(category(85)).toBe('good')
    expect(category(60)).toBe('mid')
    expect(category(20)).toBe('bad')
  })
})

describe('崩れ始め', () => {
  it('後半にスコアが下がった時刻を見つける', () => {
    const samples: Sample[] = Array.from({ length: 3600 }, (_, t) => ({ t, head: 0, trunk: 7, body: 3, hipDrop: 0, score: t < 2280 ? 92 : 55, quiet: false }))
    const m = breakdownMinute(samples)
    expect(m).toBeGreaterThanOrEqual(36)
    expect(m).toBeLessThanOrEqual(42)
  })
  it('崩れなければ出さない', () => {
    const samples: Sample[] = Array.from({ length: 1800 }, (_, t) => ({ t, head: 0, trunk: 7, body: 3, hipDrop: 0, score: 90, quiet: false }))
    expect(breakdownMinute(samples)).toBeUndefined()
  })
})

describe('ランナーのレベル', () => {
  const run = (sec: number, items: ItemKey[] = []): Session =>
    ({ id: 'x', startedAt: 0, durationSec: sec, samples: [], cues: items.map((item, i) => ({ t: i, item, text: '' })), strides: {}, share: { good: 1, mid: 0, bad: 0 }, quietHeldSec: 0 }) as Session

  it('初心者は前かがみから始め、声がかからない走りが2回続くと腰を足し、次の走り出しで伝える', () => {
    let p = startProgress('beginner')
    expect(activeItems(p.step)).toEqual(['trunk', 'body'])
    expect(startPhrase(p)).toBe(PHRASES.focusUpright)
    p = afterRun(p, run(900))
    expect(p.step).toBe(0)
    p = afterRun(p, run(900, ['trunk'])) // 声がかかったら数え直し
    expect(p.clean).toBe(0)
    p = afterRun(p, run(900, ['head'])) // まだ見ていない項目の声かけは数えない
    p = afterRun(p, run(900))
    expect(p.step).toBe(1)
    expect(activeItems(p.step)).toEqual(['trunk', 'body', 'hip', 'trunkBack', 'bodyBack'])
    expect(startPhrase(p)).toBe(PHRASES.stepHip)
    p = afterRun(p, run(900, ['hip']))
    expect(startPhrase(p)).toBe(PHRASES.focusHip)
  })

  it('短い走りと動画で試した走りは数えない', () => {
    let p = startProgress('beginner')
    p = afterRun(p, run(LEVEL.minRunSec - 1))
    p = afterRun(p, { ...run(900), provisionalBaseline: true })
    expect(p.clean).toBe(0)
  })

  it('中級は腰から、上級は最初からすべて見る', () => {
    expect(activeItems(startProgress('intermediate').step)).toEqual(['trunk', 'body', 'hip', 'trunkBack', 'bodyBack'])
    const adv = startProgress('advanced')
    expect(activeItems(adv.step)).toEqual(['trunk', 'body', 'hip', 'trunkBack', 'bodyBack', 'head'])
    expect(startPhrase(adv)).toBe(PHRASES.focusAll)
    expect(afterRun(adv, run(900)).step).toBe(adv.step)
  })
})

describe('声なしで保てた時間', () => {
  it('分と秒に分けて書く', () => {
    expect(splitMinSec(750)).toEqual({ min: 12, sec: 30 })
    expect(splitMinSec(59.6)).toEqual({ min: 1, sec: 0 }) // 端数の秒は四捨五入
    expect(splitMinSec(-3)).toEqual({ min: 0, sec: 0 })
    expect(fmtMinSec(750)).toBe('12分30秒')
    expect(fmtMinSec(600)).toBe('10分')
    expect(fmtMinSec(45)).toBe('45秒')
    expect(fmtMinSec(0)).toBe('0秒')
  })

  it('前回との差（前回がなければ出さない）', () => {
    expect(quietDelta(600, 450)).toBe(150)
    expect(quietDelta(300, 450.4)).toBe(-150)
    expect(quietDelta(0, 0)).toBe(0)
    expect(quietDelta(600, undefined)).toBeNull()
  })
})
