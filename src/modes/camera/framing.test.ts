import { describe, expect, it } from 'vitest'
import { framing, FramingWindow } from './framing'
import { demoStride } from './ui/figure'
import type { Frame } from '../../core/types'

// 見本の走りの1コマ（頭から足まで、高さ約 300 の画面に収まる）
const base = demoStride()[0]
const ys = base.map((p) => p.y)
const top = Math.min(...ys)
const bottom = Math.max(...ys)
// 画面の高さ：上下に少し余白を置いて、全身が入るようにする
const H = bottom + top
const shift = (f: Frame, dy: number): Frame => f.map((p) => ({ ...p, y: p.y + dy }))

describe('体が画面に収まっているか（framing）', () => {
  it('全身が入っていれば ok、骨格がなければ none', () => {
    expect(framing(base, H)).toBe('ok')
    expect(framing(null, H)).toBe('none')
  })
  it('体が下にずれて足首が画面の下のふちを越えたら、足が切れている', () => {
    expect(framing(shift(base, top * 0.9 + 20), H)).toBe('feet')
  })
  it('体が上にずれて鼻が画面の上のふちより上なら、頭が切れている', () => {
    expect(framing(shift(base, -top + 2), H)).toBe('head')
  })
  it('近すぎて頭も足も入らなければ、両方', () => {
    const big = base.map((p) => ({ ...p, y: (p.y - H / 2) * 3 + H / 2 }))
    expect(framing(big, H)).toBe('both')
  })
  it('足首の点が見えない（確からしさが低い）のも、足が切れている', () => {
    expect(framing(base.map((p, i) => ([27, 28].includes(i) ? { ...p, v: 0.1 } : p)), H)).toBe('feet')
  })
  it('肩も腰も見えなければ、映っていない', () => {
    expect(framing(base.map((p, i) => ([11, 12, 23, 24].includes(i) ? { ...p, v: 0.1 } : p)), H)).toBe('none')
  })
  it('ならすと、半分以上のコマが ok なら ok、そうでなければ多かった理由', () => {
    const w = new FramingWindow(1)
    for (let i = 0; i < 10; i++) w.push(i * 0.1, i < 4 ? 'feet' : 'ok')
    expect(w.current()).toBe('ok')
    for (let i = 10; i < 20; i++) w.push(i * 0.1, i < 17 ? 'feet' : 'none')
    expect(w.current()).toBe('feet')
    expect(w.fps).toBeGreaterThan(9)
  })
})
