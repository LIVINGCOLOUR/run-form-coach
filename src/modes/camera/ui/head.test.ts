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

// ホームの人形（figure.ts の paths）も、頭の丸の中心が耳より鼻の側に出ない（顔の前に出て頭が突き出て見えたため）
describe('人形の頭の丸（figure.ts）', () => {
  it('右向き・左向きとも、中心は耳より後ろ・上', async () => {
    const { paths, demoStride } = await import('./figure')
    const { L } = await import('../landmarks')
    const f = demoStride()[0]
    const p = paths(f, true)
    const ear = f[L.leftEar]
    expect(p.hx).toBeLessThan(ear.x) // 右向き（鼻が右）なので、後ろ＝左
    expect(p.hy).toBeLessThan(ear.y)
    const m = f.map((q) => ({ ...q, x: -q.x }))
    const pm = paths(m, true)
    expect(pm.hx).toBeGreaterThan(m[L.leftEar].x)
  })
})
