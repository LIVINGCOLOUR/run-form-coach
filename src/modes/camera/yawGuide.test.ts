import { describe, expect, it } from 'vitest'
import { SETUP } from './params'
import { PHRASES } from '../../core/phrases'
import { YAW_PHRASE, yawHint, yawInside, yawOffDeg, yawSideOf } from './yawGuide'

// 立った姿勢の仮想実験の値（sim/result-head-yaw.md）を、度に直して確かめる
const at = (deg: number) => SETUP.yawCenter + deg * SETUP.yawPerDeg

describe('真横からのずれの案内', () => {
  it('仮想実験の立った姿勢の値は、置いた向きと約1°以内で合う', () => {
    expect(yawOffDeg(0.01)).toBeCloseTo(0, 5)
    for (const [deg, v] of [[5, 0.031], [10, 0.053], [-5, -0.012], [-10, -0.034], [15, 0.074], [-20, -0.075]] as const) {
      expect(Math.abs(yawOffDeg(v) - deg)).toBeLessThan(1.3)
    }
  })

  it('外から入るのは5°以内、入ったら8°を越えるまでは内側（線の際で入ったり出たりしない）', () => {
    expect(yawInside(4.9, false)).toBe(true)
    expect(yawInside(5.5, false)).toBe(false)
    expect(yawInside(-5.5, false)).toBe(false)
    expect(yawInside(7.5, true)).toBe(true)
    expect(yawInside(-7.5, true)).toBe(true)
    expect(yawInside(8.5, true)).toBe(false)
  })

  it('前側から撮っていれば後ろへ、後ろ側からなら前へ。ずれの大きさで言い分ける', () => {
    expect(yawHint(yawOffDeg(at(20)), false)).toEqual({ side: 'front', level: 'far' })
    expect(yawHint(yawOffDeg(at(10)), false)).toEqual({ side: 'front', level: 'mid' })
    expect(yawHint(yawOffDeg(at(6)), false)).toEqual({ side: 'front', level: 'near' })
    expect(yawHint(yawOffDeg(at(-6)), false)).toEqual({ side: 'behind', level: 'near' })
    expect(yawHint(yawOffDeg(at(-20)), false)).toEqual({ side: 'behind', level: 'far' })
    expect(yawHint(yawOffDeg(at(3)), false)).toBeNull()
    expect(yawHint(yawOffDeg(at(6)), true)).toBeNull()
    expect(YAW_PHRASE.front.mid).toContain('後ろのほう')
    expect(YAW_PHRASE.behind.mid).toContain('前のほう')
  })

  it('同じ向きの案内は、大きさが変わっても同じ案内として扱う', () => {
    expect(yawSideOf(PHRASES.guideFrontFar)).toBe('front')
    expect(yawSideOf(PHRASES.guideFrontNear)).toBe('front')
    expect(yawSideOf(PHRASES.guideBehind)).toBe('behind')
    expect(yawSideOf(PHRASES.guideSideOk)).toBeNull()
    expect(yawSideOf(PHRASES.guideNear)).toBeNull()
    expect(yawSideOf(null)).toBeNull()
  })

  it('結果の画面の「頭が大きく出ているかも」の線は、前の置き方の線（前側に約8°）のまま', () => {
    expect(Math.abs(SETUP.frontMax - at(SETUP.yawOut))).toBeLessThan(0.001)
  })
})
