import { describe, expect, it } from 'vitest'
import type { CueLog } from '../../core/types'
import { runSummary } from './summary'

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
