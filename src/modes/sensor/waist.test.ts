import { describe, expect, it } from 'vitest'
import { WaistPhone } from './waist'
import { WAIST } from './params'
import type { MotionLike } from '../phone/sensor'

// 腰のスマホ（waist.ts）：動きのセンサーの値を胸と同じ見方で記録する。途切れは events に残す
describe('腰のスマホの向き（記録だけ）', () => {
  const make = () => {
    const events: [number, string][] = []
    let emit: (e: MotionLike) => void = () => {}
    let now = 0
    const w = new WaistPhone((t, text) => events.push([t, text]), (cb) => ((emit = cb), () => {}), () => now)
    // deg：前（x）へ傾けた向き。60回/秒で sec 秒
    const feed = (deg: number, from: number, sec: number) => {
      for (let k = 0; k < sec * 60; k++) {
        now = from + k / 60
        const r = (deg * Math.PI) / 180
        emit({ accelerationIncludingGravity: { x: 9.8 * Math.sin(r), y: 0, z: 9.8 * Math.cos(r) }, rotationRate: null })
        if (k % 6 === 0) w.tick(now)
      }
      return from + sec
    }
    return { w, events, feed, at: (t: number) => (now = t) }
  }

  it('2つの立ち方の a・b を測り、b からの前への傾きを1秒ごとに残す（値の数も）', () => {
    const { w, events, feed } = make()
    let t = feed(8, 0, 3)
    w.pose('a', t, 3)
    t = feed(0, t, 3)
    w.pose('b', t, 3)
    const log = w.calibrate(t)
    expect(log.mode).toBe('pose')
    expect(log.deg!).toBeCloseTo(8, 0)
    expect(events.map((e) => e[1])).toContain('waist: on')
    w.second(t)
    t = feed(5, t, 3)
    const s = w.second(t)
    expect(s.tilt!).toBeCloseTo(5, 0)
    expect(s.n).toBe(180)
    expect(s.g![2]).toBeGreaterThan(0.99)
  })

  it('差が poseMin より小さければ、b からの向きによらない角度（fallback）', () => {
    const { w, feed } = make()
    let t = feed(WAIST.poseMin - 1, 0, 3)
    w.pose('a', t, 3)
    t = feed(0, t, 3)
    w.pose('b', t, 3)
    expect(w.calibrate(t).mode).toBe('fallback')
  })

  it('値が gap 秒より来なければ waist:gap、また来たら waist:back（途切れを埋めない）。始めから来なければ waist: none', () => {
    const { w, events, feed, at } = make()
    let t = feed(0, 0, 2)
    at(t + WAIST.gap + 1)
    w.tick(t + WAIST.gap + 1)
    expect(w.second(t + WAIST.gap + 1).tilt).toBeNull()
    t = feed(0, t + 10, 1)
    expect(events.map((e) => e[1]).filter((x) => x.startsWith('waist:gap'))).toHaveLength(1)
    expect(events.find((e) => e[1].startsWith('waist:back'))![1]).toMatch(/^waist:back 1[01]\./)
    const none = make()
    none.w.tick(WAIST.none + 0.1)
    expect(none.events.map((e) => e[1])).toEqual(['waist: none'])
  })
})
