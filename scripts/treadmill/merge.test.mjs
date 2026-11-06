import { describe, expect, it } from 'vitest'
import { buzzItem, clockOffset, findAccJump, REACT, sectionRows, STRONG } from './merge.mjs'

// トレッドミルの突き合わせ（treadmill-merge.mjs）の計算
describe('3台の記録の時計を合わせる', () => {
  it('ジャンプが目立てば、動いた時刻 −（はい + REACT）を時計のずれとして引く。目立たない・ないなら端末の時計のまま。手で決めたらそれ', () => {
    expect(clockOffset({ T: 10_000 + 3_200, strength: 50 }, 10_000)).toEqual({ off: Math.round((3.2 - REACT) * 1000), how: 'jump', lag: 3.2 })
    expect(clockOffset({ T: 10_600, strength: STRONG - 1 }, 10_000)).toMatchObject({ off: 0, how: 'clock' })
    expect(clockOffset(null, 10_000)).toMatchObject({ off: 0, how: 'clock', lag: null })
    expect(clockOffset({ T: 13_200, strength: 50 }, 10_000, -1.5)).toMatchObject({ off: -1500, how: 'manual' })
  })

  it('加速度の大きさで、跳んだ時刻（いちばん大きく動いた半分を越えた最初の値）を見つける', () => {
    const xs = []
    for (let i = 0; i < 1000; i++) {
      const T = 8_000 + i * 10 // 100回/秒
      const jump = T >= 11_230 && T < 11_500 ? 2.5 : 0
      xs.push({ T, a: [0, 0, 1 + jump + (i % 7) * 0.002] })
    }
    const j = findAccJump(xs, 10_000)
    expect(j.T).toBe(11_230)
    expect(j.strength).toBeGreaterThan(STRONG)
    expect(findAccJump(xs.slice(0, 5), 10_000)).toBeNull()
  })
})

describe('区間ごとの値', () => {
  it('区間の中の真ん中と、胸 − カメラの上体（走っている秒だけ、前後 0.5秒のコマと組にする）', () => {
    const sections = [{ key: 'open', kind: 'drill', start: 0, end: 10_000 }, { key: 'normal1', kind: 'normal', start: 10_000, end: 20_000 }]
    const cam = []
    for (let T = 0; T < 20_000; T += 100) cam.push({ T, trunk: T < 10_000 ? 1 : 3, neck: 35, headLean: 34, body: 7 })
    const sec = []
    for (let T = 0; T < 20_000; T += 1000) sec.push({ T, run: T !== 0, chest: T < 10_000 ? 15 : 18, chestRef: 16, head: 2, waist: T < 15_000 ? 4 : null, wHz: 60, v: 7.6 })
    const [a, b] = sectionRows(sections, { cam, sec, voices: [{ T: 12_000, item: 'head' }], buzz: [{ T: 5_000, item: '胸' }] })
    expect(a).toMatchObject({ trunk: 1, chest: 15, pair: 14, pairN: 9, waist: 4, v: 7.6 })
    expect(a.buzz).toHaveLength(1)
    expect(b).toMatchObject({ trunk: 3, chest: 18, pair: 15, pairN: 10, waistShare: 0.5 })
    expect(b.voices).toHaveLength(1)
  })

  it('センサーの events のうち、知らせた振動だけを項目にする', () => {
    expect(buzzItem('sensor:hunch 18.3')).toBe('胸')
    expect(buzzItem('sensor:head 13.2')).toBe('頭')
    expect(buzzItem('sensor:contact sit 2.3')).toBe('接地')
    expect(buzzItem('sensor:headLean 7.8 offset 3.0 cap')).toBeNull()
    expect(buzzItem('sensor:hunchOk 4.9')).toBeNull()
    expect(buzzItem('sensor:yield 頭')).toBeNull()
  })
})
