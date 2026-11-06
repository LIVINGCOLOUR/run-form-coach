import { describe, expect, it } from 'vitest'
import { framing, FramingVoice, FramingWindow, humanShape } from './framing'
import { FRAME_SAY } from './params'
import { ABSENCE } from '../../core/params'
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

describe('映り方の声（FramingVoice）', () => {
  // 毎秒10コマで、from 秒から to 秒まで同じ映り方のコマを入れる
  const feed = (v: FramingVoice, from: number, to: number, frame: Frame | null, fps = 10) => {
    const out: (string | null)[] = []
    for (let t = from; t < to - 1e-9; t += 1 / fps) {
      v.push(t, framing(frame, H), frame)
      const f = v.due(t)
      if (f) {
        out.push(f)
        v.said(f, t)
      }
    }
    return out
  }
  const feetCut = shift(base, top * 0.9 + 20)

  it('見本の体は人の形。脚がつぶれた形は人の形ではない', () => {
    expect(humanShape(base)).toBe(true)
    const hipY = (base[23].y + base[24].y) / 2
    const squashed = base.map((p, i) => ([25, 26, 27, 28, 29, 30, 31, 32].includes(i) ? { ...p, y: hipY + (p.y - hipY) * 0.3 } : p))
    expect(humanShape(squashed)).toBe(false)
  })

  it('全身が入ったとするのは、全身のコマが okHold 秒続いてから', () => {
    const v = new FramingVoice()
    feed(v, 0, FRAME_SAY.okHold - 0.5, base)
    expect(v.okNow).toBe(false)
    feed(v, FRAME_SAY.okHold - 0.5, FRAME_SAY.okHold + 0.2, base)
    expect(v.okNow).toBe(true)
    expect(v.stable).toBe('ok')
  })

  it('人が消えたコマ（骨格なし）では、すぐに全身ではなくなる（2026-11-06 19:35 に、消えたコマで「全身が入りました」と言った）', () => {
    const v = new FramingVoice()
    feed(v, 0, 3, base)
    expect(v.okNow).toBe(true)
    v.push(3, framing(null, H), null)
    expect(v.okNow).toBe(false)
  })

  it('足が画面のふちから出ていれば、全身とはしない', () => {
    const v = new FramingVoice()
    feed(v, 0, 5, feetCut)
    expect(v.okNow).toBe(false)
  })

  it('頭から足までの大きさが跳ねる（見間違いらしい）と、全身とはしない', () => {
    const v = new FramingVoice()
    const small = base.map((p) => ({ ...p, y: (p.y - H / 2) * 0.7 + H / 2, x: p.x * 0.7 }))
    for (let i = 0; i < 30; i++) v.push(i * 0.1, 'ok', i % 2 ? base : small)
    expect(v.okNow).toBe(false)
  })

  it('切れているのが hold 秒続いたら言い、短い揺れでは言わない', () => {
    const v = new FramingVoice()
    v.phase = 'wait'
    feed(v, 0, 3, base)
    expect(feed(v, 3, 3 + FRAME_SAY.hold - 0.5, feetCut)).toEqual([])
    expect(feed(v, 3 + FRAME_SAY.hold - 0.5, 8, base)).toEqual([]) // 戻った（切れていると言っていないので、全身が入ったとも言わない）
    expect(feed(v, 8, 8 + FRAME_SAY.hold + 0.2, feetCut)).toEqual(['feet'])
  })

  it('また全身が入ったら言う。同じことは repeat 秒あけて言い直し、声どうしは gap 秒あける', () => {
    const v = new FramingVoice()
    v.phase = 'wait'
    feed(v, 0, 3, base)
    expect(feed(v, 3, 7, null)).toEqual(['none'])
    const noneAt = v.lastSaid!.t
    // 2秒で全身を確かめても、前の声から gap 秒たつまでは待つ
    expect(feed(v, 7, 14, base)).toEqual(['ok'])
    expect(v.lastSaid!.t - noneAt).toBeGreaterThanOrEqual(FRAME_SAY.gap - 1e-6)
    // 戻ってすぐまた切れても、前の声から gap 秒あけて言い、同じまま repeat 秒たてば言い直す
    const said = feed(v, 14, 14 + FRAME_SAY.gap + FRAME_SAY.repeat + 1, feetCut)
    expect(said).toEqual(['feet', 'feet'])
  })

  it('走っている間は、切れているのが ABSENCE.lostSay 秒続いてから', () => {
    const v = new FramingVoice()
    v.phase = 'run'
    feed(v, 0, 3, base)
    expect(feed(v, 3, 3 + ABSENCE.lostSay - 0.5, feetCut)).toEqual([])
    expect(feed(v, 3 + ABSENCE.lostSay - 0.5, 3 + ABSENCE.lostSay + 0.5, feetCut)).toEqual(['feet'])
  })

  it('コマの間が maxGap 秒よりあくと、続いた時間を数え直す', () => {
    const v = new FramingVoice()
    v.phase = 'wait'
    feed(v, 0, 3, base)
    feed(v, 3, 5, feetCut)
    feed(v, 7, 9, feetCut) // 2秒あいた
    expect(v.stable).toBe('ok')
  })
})
