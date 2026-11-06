import { describe, expect, it } from 'vitest'
import { headCircle } from './head'

describe('撮る画面の頭の丸', () => {
  it('中心は耳より鼻側に出ない（右向きでも左向きでも）。耳より上で、半径は耳と鼻の距離くらい', () => {
    for (const dir of [1, -1]) {
      const ear = { x: 100, y: 100 }
      const nose = { x: 100 + 20 * dir, y: 104 }
      const c = headCircle(ear, nose)
      // 耳→鼻の向きに測った中心の位置は 0 以下（耳より後ろ）
      expect((c.x - ear.x) * (nose.x - ear.x) + (c.y - ear.y) * (nose.y - ear.y)).toBeLessThanOrEqual(0)
      expect(c.y).toBeLessThan(ear.y)
      expect(c.r).toBeGreaterThan(15)
      expect(c.r).toBeLessThan(25)
    }
  })
})
