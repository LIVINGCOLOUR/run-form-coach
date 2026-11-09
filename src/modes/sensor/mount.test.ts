import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMount, markMountAsked, mountForLog, mountLabel, saveMount } from './mount'
import { SensorRecorder } from './log'
import { MOUNT_KEY } from './params'

// localStorage の代わり（テストの中だけ）
const store = new Map<string, string>()
const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = fake
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('付ける場所（mount.ts）', () => {
  it('選んでいなければ、額と胸の真ん中', () => {
    expect(loadMount()).toEqual({ head: 'forehead', chest: 'sternum', set: false, asked: false })
  })

  it('決めた場所を覚えて、読み直せる', () => {
    saveMount({ head: 'back', chest: 'pit' })
    expect(loadMount()).toEqual({ head: 'back', chest: 'pit', set: true, asked: true })
    expect(mountLabel('head', 'back')).toBe('頭の後ろ')
    expect(mountLabel('chest', 'pit')).toBe('みぞおち')
  })

  it('自動で開いたことだけ覚える（場所は既定のまま、選んだことにはしない）', () => {
    markMountAsked()
    expect(loadMount()).toEqual({ head: 'forehead', chest: 'sternum', set: false, asked: true })
  })

  it('知らない値・壊れた値は既定に戻す', () => {
    store.set(MOUNT_KEY, JSON.stringify({ head: 'chin', chest: 'upper', set: true, asked: true }))
    expect(loadMount()).toEqual({ head: 'forehead', chest: 'upper', set: true, asked: true })
    store.set(MOUNT_KEY, '{壊れた')
    expect(loadMount()).toEqual({ head: 'forehead', chest: 'sternum', set: false, asked: false })
  })

  it('localStorage が使えない・投げる環境でも既定で動く', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(loadMount().head).toBe('forehead')
    expect(() => saveMount({ head: 'back', chest: 'upper' })).not.toThrow()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(loadMount()).toEqual({ head: 'forehead', chest: 'sternum', set: false, asked: false })
    expect(() => markMountAsked()).not.toThrow()
    expect(mountForLog()).toEqual({ head: 'forehead', chest: 'sternum', set: false })
  })

  it('センサーの記録（SensorLog）に場所が入る', () => {
    expect(new SensorRecorder([{ place: '胸', name: 'RFC-IMU-4' }]).log.mount).toEqual({ head: 'forehead', chest: 'sternum', set: false })
    saveMount({ head: 'back', chest: 'upper' })
    expect(new SensorRecorder([{ place: '胸', name: 'RFC-IMU-4' }]).log.mount).toEqual({ head: 'back', chest: 'upper', set: true })
  })
})
