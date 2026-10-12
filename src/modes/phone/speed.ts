import { SPEED } from './params'

// GPS の速さ（docs/phone-spec.md 機能4）。外で走るときに、速さが走り始めの基準から外れた秒を「判定しない秒」にするために使う
//   位置が届くたびに：track.fix(f)  （f.t は performance.now() の秒。センサーの値と同じ時計）
//   1秒ごとに：track.at(今) → ならした速さ（m/s）。GPS が取れていなければ null
// 速さは、ブラウザが出す速さ（coords.speed）があればそれを使い、なければ前の点からの距離 ÷ 時間で出す。
// どちらも1秒ごとのゆれが大きいので、1次のフィルタ（時定数 SPEED.tau）でならしてから使う（Biernacki 2023）

// 位置の1点（GeolocationPosition のうち使うところだけ。テストで作りやすいように）
export interface GpsFix {
  t: number // 秒（performance.now）
  lat: number
  lon: number
  accuracy: number // 横の誤差（m）
  speed: number | null // m/s。取れないときは null（負の値も取れていないとみなす）
  altitude: number | null // m。記録にだけ残す（坂は見ない。params.ts の SPEED の説明）
  altitudeAccuracy: number | null
}

// 1点を受け取ったときの中身（記録に残す）
export interface FixOut {
  used: boolean // 速さに使った（誤差が大きい点は使わない）
  stepM: number | null // 前に使った点からの距離（m）。位置そのものは記録に残さない（家の場所が分かるため）
  raw: number | null // この点の速さ（m/s、ならす前）
  speed: number | null // ならしたあとの速さ（m/s）
}

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export class SpeedTrack {
  private prev: GpsFix | null = null // 前に使った点
  private v: number | null = null // ならした速さ
  private lastAt: number | null = null // 最後に速さを足した時刻

  fix(f: GpsFix): FixOut {
    const ok = Number.isFinite(f.lat) && Number.isFinite(f.lon) && f.accuracy <= SPEED.maxAccuracy
    if (!ok) return { used: false, stepM: null, raw: null, speed: this.v }
    const p = this.prev
    const dt = p ? f.t - p.t : 0
    const near = p !== null && dt > 0 && dt <= SPEED.stale
    const stepM = p ? distanceM(p, f) : null
    let raw: number | null = f.speed !== null && Number.isFinite(f.speed) && f.speed >= 0 ? f.speed : null
    if (raw === null && near) raw = stepM! / dt
    if (p === null || f.t > p.t) this.prev = f
    if (raw === null) return { used: false, stepM, raw: null, speed: this.v }
    // 間があいたら、ならし直す
    if (this.v === null || this.lastAt === null || f.t - this.lastAt > SPEED.stale) this.v = raw
    else this.v += (1 - Math.exp(-Math.max(0, f.t - this.lastAt) / SPEED.tau)) * (raw - this.v)
    this.lastAt = f.t
    return { used: true, stepM, raw, speed: this.v }
  }

  // t の時点のならした速さ。最後に使えた点から SPEED.stale 秒より経っていれば null（GPS が取れない）
  at(t: number): number | null {
    if (this.v === null || this.lastAt === null || t - this.lastAt > SPEED.stale) return null
    return this.v
  }
}

// 判定を止めた理由。null なら判定する
//   noGps：GPS の速さが取れない。noBase：基準の速さを作れなかった（基準の区間に GPS が足りなかった）
//   slow・fast：基準の速さから SPEED.band を外れている（範囲に戻ってから SPEED.hold 秒も、同じ理由で止める）
export type SpeedGate = 'noGps' | 'noBase' | 'slow' | 'fast'
export const SPEED_GATES = [null, 'noGps', 'noBase', 'slow', 'fast'] as const

export function speedGate(v: number | null, base: number | null): SpeedGate | null {
  if (base === null || !(base > 0)) return 'noBase'
  if (v === null) return 'noGps'
  const d = (v - base) / base
  if (d < -SPEED.band) return 'slow'
  if (d > SPEED.band) return 'fast'
  return null
}
