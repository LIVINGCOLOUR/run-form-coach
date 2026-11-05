import { afterEach, describe, expect, it, vi } from 'vitest'
import { GpsLatest, watchGps, type GpsFix, type GpsStatus } from './gps'

// 位置情報（センサーラン）：速さと高さを1秒ごとのまとめに残すための受け口

describe('位置情報（gps.ts）', () => {
  it('いちばん新しい点を、速さ（km/h）・誤差・高さにする。古い点は使わず、stale 秒より古ければ null', () => {
    const g = new GpsLatest(10)
    const none = { v: null, acc: null, alt: null, altAcc: null }
    expect(g.at(0)).toEqual(none)
    g.fix({ t: 100, speed: 2.5, accuracy: 8, altitude: 120.4, altitudeAccuracy: 6 })
    expect(g.at(101)).toEqual({ v: 9, acc: 8, alt: 120.4, altAcc: 6 })
    // 端末が速さと高さを出さない点（Wi-Fi で決めた位置など）
    g.fix({ t: 102, speed: null, accuracy: 30, altitude: null, altitudeAccuracy: null })
    expect(g.at(103)).toEqual({ v: null, acc: 30, alt: null, altAcc: null })
    // 前の点より古い点は無視。負の速さは取れていない
    g.fix({ t: 101, speed: 1, accuracy: 5, altitude: 100, altitudeAccuracy: 3 })
    expect(g.at(103).acc).toBe(30)
    g.fix({ t: 104, speed: -1, accuracy: 5, altitude: 100, altitudeAccuracy: 3 })
    expect(g.at(105)).toEqual({ v: null, acc: 5, alt: 100, altAcc: 3 })
    expect(g.at(114.1)).toEqual(none) // 10秒より古い
  })

  describe('ブラウザの位置情報', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('位置情報のないブラウザでは none を返して、何もしない', () => {
      vi.stubGlobal('navigator', {})
      const st: GpsStatus[] = []
      const off = watchGps(() => {}, (s) => st.push(s))
      expect(st).toEqual(['none'])
      off()
    })

    it('最初の点で on、点は使うところだけ（緯度・経度は渡さない）、許可されていなければ denied、止めると clearWatch', () => {
      let success: ((p: unknown) => void) | null = null
      let error: ((e: unknown) => void) | null = null
      let cleared: number | null = null
      let opts: unknown = null
      vi.stubGlobal('navigator', {
        geolocation: {
          watchPosition: (ok: (p: unknown) => void, err: (e: unknown) => void, o: unknown) => {
            success = ok
            error = err
            opts = o
            return 7
          },
          clearWatch: (id: number) => (cleared = id),
        },
      })
      const fixes: GpsFix[] = []
      const st: [GpsStatus, number | undefined][] = []
      const off = watchGps((f) => fixes.push(f), (s, code) => st.push([s, code]), { highAccuracy: false, maximumAge: 5000, timeout: 30000, stale: 10 })
      expect(opts).toEqual({ enableHighAccuracy: false, maximumAge: 5000, timeout: 30000 })
      const coords = { latitude: 36.3, longitude: 140.3, speed: 3, accuracy: 12, altitude: 55, altitudeAccuracy: 8 }
      success!({ coords })
      success!({ coords: { ...coords, speed: null, altitude: null, altitudeAccuracy: null } })
      expect(st).toEqual([['on', undefined]])
      expect(fixes).toHaveLength(2)
      expect(fixes[0]).toMatchObject({ speed: 3, accuracy: 12, altitude: 55, altitudeAccuracy: 8 })
      expect(fixes[0]).not.toHaveProperty('lat')
      expect(fixes[1]).toMatchObject({ speed: null, altitude: null })
      error!({ code: 1, PERMISSION_DENIED: 1 })
      error!({ code: 3, PERMISSION_DENIED: 1 })
      expect(st.slice(1)).toEqual([['denied', 1], ['error', 3]])
      off()
      expect(cleared).toBe(7)
    })
  })
})
