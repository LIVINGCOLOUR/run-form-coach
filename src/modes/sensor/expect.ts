import { goodAt } from '../camera/params'
import { CHEST_EXPECT } from './params'

// 胸の、その速さで正しい前傾（b から猫背の向きに沿って、度。params.ts の CHEST_EXPECT）。
// kmh：その走りの速さ（時速 km）。分からなければ undefined（講師の速さ＝goodAt() の範囲）。by：速さをどこから取ったか（記録に残す）
export type SpeedBy = 'belt' | 'sensor' | 'none'
export type ExpectLean = { deg: number; trunk: number; kmh: number | null; by: SpeedBy }

export function expectedChest(kmh?: number, by: SpeedBy = kmh === undefined ? 'none' : 'sensor', o: typeof CHEST_EXPECT = CHEST_EXPECT): ExpectLean {
  const ok = kmh !== undefined && Number.isFinite(kmh)
  const trunk = goodAt(ok ? kmh : undefined).trunk.mid
  return { deg: Math.round((o.gain * trunk + o.k) * 10) / 10, trunk, kmh: ok ? kmh! : null, by: ok ? by : 'none' }
}
