import { describe, expect, it } from 'vitest'
import type { CueLog, FormResult, Sample } from '../../core/types'
import { badCause, runSummary } from './summary'
import { formRows, withRunLines } from './nextStep'
import { FORM, strictness } from './params'

const cues = (n: number, item: CueLog['item'] = 'head'): CueLog[] => Array.from({ length: n }, (_, i) => ({ t: 30 + i * 30, item, text: '' }))
const CALM = '大きく崩れずに走れました'

describe('結果の画面の、走りのひとこと', () => {
  it('良い 16%・悪い 53%・声 17回（13分。走り出しから崩れていて、崩れ始めは見つからない）では、大きく崩れずにとは言わない', () => {
    const text = runSummary({ durationSec: 13 * 60, share: { good: 0.16, mid: 0.31, bad: 0.53 }, cues: cues(17) })
    expect(text).not.toContain(CALM)
    expect(text).toContain('良い姿勢は16%、悪い姿勢は53%')
  })

  it('本当に崩れの少ない走り（良い 86%・悪い 3%・声 22回で61分）では、大きく崩れずにと言う', () => {
    const text = runSummary({ durationSec: 61 * 60, share: { good: 0.86, mid: 0.11, bad: 0.03 }, cues: [...cues(22), ...cues(5, 'recover')] })
    expect(text).toBe('大きく崩れずに走れました。声をかけた所は、すぐに戻せています。')
    expect(runSummary({ durationSec: 21 * 60, share: { good: 0.96, mid: 0.02, bad: 0.02 }, cues: [] })).toBe('最後まで、大きく崩れずに走れました。')
  })

  it('声がなくても、悪いが多ければ大きく崩れずにとは言わない（良い 48%・悪い 30%）', () => {
    expect(runSummary({ durationSec: 4 * 60, share: { good: 0.48, mid: 0.22, bad: 0.3 }, cues: [] })).not.toContain(CALM)
  })

  it('割合がよくても、声が1分に1回より多ければ大きく崩れずにとは言わない', () => {
    expect(runSummary({ durationSec: 10 * 60, share: { good: 0.8, mid: 0.15, bad: 0.05 }, cues: cues(15) })).not.toContain(CALM)
  })

  it('姿勢を判定した秒がなければ、割合も大きく崩れずにとも言わない', () => {
    expect(runSummary({ durationSec: 60, share: { good: 0, mid: 0, bad: 0 }, cues: [] })).toBe('姿勢を判定できた時間がありませんでした。')
  })

  it('崩れ始めが見つかれば、その時刻を言う', () => {
    expect(runSummary({ durationSec: 29 * 60, breakdownMin: 7, share: { good: 0.3, mid: 0.07, bad: 0.63 }, cues: cues(70) })).toMatch(/^7分から崩れ始めました/)
  })
})

// 2026-11-19：上級で走った記録の結果に、ふつう（中級）の線を出していた。悪い姿勢の理由も見出しの下に添える
describe('結果の画面は、その走りのレベルの線で出す', () => {
  // 11-06（上級、13分）の頭の行：首 38.1°・頭の位置 39.2°、上級の線（首32°・頭の位置36°）の外
  const head: FormResult = { group: 'head', key: 'head', value: 38.1, value2: 39.2, over: 5, inside: 0.2, cues: 13, fixed: false, judged: true }
  const run = { focus: { level: 'advanced' as const, step: 4 }, speedKmh: 7.6, speedSource: 'camera' as const }

  it('上級の走りは、上級の頭の線を出し、線の外を主役にする（線はあとで元に戻す）', () => {
    const before = { level: strictness, neck: FORM.head.neck }
    const row = withRunLines(run, () => formRows([head], run.speedKmh))[0]
    expect(row.line).toContain('首32°と頭の位置36°')
    expect(row.line).toContain('外でした')
    expect(row.lineOut).toBe(true)
    expect({ level: strictness, neck: FORM.head.neck }).toEqual(before)
  })

  it('レベルが分からない走りは、既定（中級）の線', () => {
    const row = withRunLines({}, () => formRows([head]))[0]
    expect(row.line).toContain('首46°と頭の位置50°')
  })

  it('悪い秒のほとんどが頭の線の外なら、理由は頭の位置', () => {
    const sec = (t: number, form: Sample['form'], score: number): Sample => ({ t, head: 0, trunk: 5, body: 8, hipDrop: 0, score, quiet: false, judge: { trunk: 9, body: 11 }, back: { trunk: 0, body: 0 }, form })
    const samples = [
      ...Array.from({ length: 8 }, (_, i) => sec(i, { head: 13, trunkBack: -2 }, 0)),
      sec(8, { head: 2, trunk: 19 }, 10),
      ...Array.from({ length: 10 }, (_, i) => sec(10 + i, { head: 2 }, 100)),
    ]
    const c = badCause({ ...run, samples, share: { good: 0.5, mid: 0, bad: 0.5 } })
    expect(c?.group).toBe('head')
    expect(c!.part).toBeCloseTo(8 / 9)
  })

  it('悪い姿勢が少ない走りでは、理由を言わない', () => {
    expect(badCause({ ...run, samples: [], share: { good: 0.95, mid: 0, bad: 0.05 } })).toBeNull()
  })
})
