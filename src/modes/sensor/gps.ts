import { GPS } from './params'

// 位置情報（センサーランだけ）。GPS の速さと高さを、1秒ごとのまとめに残すためだけに受け取る（知らせには使わない。数字は params.ts の GPS）。
// 坂で知らせを変えるかは、この記録を見てあとで決める。使えないブラウザでは何もしない（呼ぶ側が events に gps: none と残す）。
// 走り終わったら、返された関数で止める（電池）

// 位置の1点（GeolocationPosition のうち使うところだけ。緯度・経度は残さない：家の場所が分かるため）
export interface GpsFix {
  t: number // 受け取った時刻（performance.now() の秒。センサーの値と同じ時計）
  speed: number | null // 端末が出した速さ（m/s）。出さないときは null
  accuracy: number // 横の誤差（m）
  altitude: number | null // 高さ（m）。付かないときは null
  altitudeAccuracy: number | null // 高さの誤差（m）
}

// none：位置情報のないブラウザ。on：取れた（最初の1点）。denied：許可されていない。error：取れなかった（code 2）・時間切れ（code 3）
export type GpsStatus = 'none' | 'on' | 'denied' | 'error'

// 1秒ごとのまとめに入れる値（速さは km/h）。最後の点が GPS.stale 秒より古ければ、どれも null
export type GpsSec = { v: number | null; acc: number | null; alt: number | null; altAcc: number | null }

// 位置を受け取り始める。止めるための関数を返す
export function watchGps(onFix: (f: GpsFix) => void, onStatus: (s: GpsStatus, code?: number) => void, opts: typeof GPS = GPS): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onStatus('none')
    return () => {}
  }
  let got = false
  const id = navigator.geolocation.watchPosition(
    (p) => {
      const c = p.coords
      if (!got) {
        got = true
        onStatus('on')
      }
      onFix({ t: performance.now() / 1000, speed: c.speed, accuracy: c.accuracy, altitude: c.altitude, altitudeAccuracy: c.altitudeAccuracy })
    },
    (e) => onStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'error', e.code),
    { enableHighAccuracy: opts.highAccuracy, maximumAge: opts.maximumAge, timeout: opts.timeout },
  )
  return () => navigator.geolocation.clearWatch(id)
}

// いちばん新しい点を持ち、1秒ごとのまとめの値にする
export class GpsLatest {
  private last: GpsFix | null = null
  readonly stale: number

  constructor(stale = GPS.stale) {
    this.stale = stale
  }

  fix(f: GpsFix) {
    if (!this.last || f.t >= this.last.t) this.last = f
  }

  at(t: number): GpsSec {
    const f = this.last
    if (!f || t - f.t > this.stale) return { v: null, acc: null, alt: null, altAcc: null }
    const ok = (x: number | null) => (x !== null && Number.isFinite(x) ? x : null)
    const v = ok(f.speed)
    return { v: v !== null && v >= 0 ? v * 3.6 : null, acc: ok(f.accuracy), alt: ok(f.altitude), altAcc: ok(f.altitudeAccuracy) }
  }
}
