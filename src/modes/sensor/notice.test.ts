import { describe, expect, it } from 'vitest'
import { PHRASES } from '../../core/phrases'
import { noticeText, SensorWatch } from './notice'
import { SENSOR_NOTICE, SENSOR_STALL, SLOTS } from './params'

// 付けているセンサーの途切れを見張る（notice.ts の SensorWatch）。センサーランは声で知らせ、結果の画面に回数と秒を出す
const views = (on: string[]) => SLOTS.map((s) => ({ place: s.place, name: s.name, status: (on.includes(s.place) ? 'connected' : s.name ? 'idle' : 'none') as 'connected' | 'idle' | 'none' }))
const at = (place: string) => SLOTS.findIndex((s) => s.place === place)

describe('センサーの途切れを見張る（SensorWatch）', () => {
  it('場所ごとの言葉は、前もって音声を作った文（core/phrases.ts）。付けていない枠は数えない', () => {
    expect(noticeText('頭', 'missing')).toBe(PHRASES.sensorMissingHead)
    expect(noticeText('右足首', 'lost')).toBe(PHRASES.sensorLostAnkleR)
    expect(noticeText('胸', 'back')).toBe('胸のセンサーが戻りました。')
    const w = new SensorWatch(views(['胸']), 0)
    // 名前のある枠のうち、つながっていないもの（右手首は付けていない）
    expect(w.missingAtStart).toEqual(SLOTS.filter((s) => s.name && s.place !== '胸').map((s) => s.place))
  })

  it('値が SENSOR_NOTICE.after 秒来なければ「切れました」を1回、また来たら「戻りました」を1回。すぐ戻った途切れは言わず、回数と秒に数える', () => {
    const w = new SensorWatch(views(['胸', '頭']), 0)
    const said: [number, string][] = []
    const step = (from: number, to: number, places: string[]) => {
      for (let t = from; t < to - 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
        for (const p of places) {
          const back = w.packet(at(p), t)
          if (back) said.push([t, back])
        }
        for (const x of w.tick(t)) said.push([t, x])
      }
      return to
    }
    let t = step(0, 30, ['胸', '頭'])
    // 頭が5秒だけ途切れる（見張り番でやり直して、すぐ戻った）：言わない
    t = step(t, 35, ['胸'])
    t = step(t, 40, ['胸', '頭'])
    expect(said).toEqual([])
    // 頭が30秒途切れる
    const off = t
    t = step(t, 70, ['胸'])
    expect(said.map((x) => x[1])).toEqual([PHRASES.sensorLostHead])
    expect(said[0][0] - off).toBeGreaterThanOrEqual(SENSOR_NOTICE.after - 0.15)
    expect(said[0][0] - off).toBeLessThan(SENSOR_NOTICE.after + 0.2)
    t = step(t, 80, ['胸', '頭'])
    expect(said.map((x) => x[1])).toEqual([PHRASES.sensorLostHead, PHRASES.sensorBackHead])
    expect(said[1][0]).toBeCloseTo(70, 5)
    const s = w.summary(t)
    expect(s.missing).toEqual(SLOTS.filter((x) => x.name && x.place !== '胸' && x.place !== '頭').map((x) => x.place))
    expect(s.drops).toHaveLength(1)
    expect(s.drops[0]).toMatchObject({ place: '頭', n: 2 })
    expect(s.drops[0].sec).toBeGreaterThanOrEqual(35 - SENSOR_STALL.sec)
    expect(s.drops[0].sec).toBeLessThanOrEqual(36)
  })

  it('アプリが止まっていた間（画面が消えた）は、センサーの途切れに数えない。いま途切れている分は、終わりまでを数える', () => {
    const w = new SensorWatch(views(['胸']), 0)
    w.packet(at('胸'), 1)
    w.appGap(40) // 1〜40秒はアプリが止まっていた
    expect(w.tick(40.1)).toEqual([])
    w.packet(at('胸'), 40.2)
    expect(w.summary(41).drops).toEqual([])
    // 41秒から来ない：走り終わり（60秒）の時点で、途切れたまま
    w.tick(45)
    expect(w.tick(52)).toEqual([PHRASES.sensorLostChest])
    expect(w.summary(60).drops).toEqual([{ place: '胸', n: 1, sec: 20 }])
  })
})
