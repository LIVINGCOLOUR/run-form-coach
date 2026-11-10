import { goodAt } from '../camera/params'
import { CHEST_EXPECT } from './params'

// 胸の、その速さで正しい前傾（b から猫背の向きに沿って、度。params.ts の CHEST_EXPECT）。
// kmh：その走りの速さ（時速 km）。分からなければ undefined（講師の速さ＝goodAt() の範囲）。by：速さをどこから取ったか（記録に残す）
// lo・hi：よい例の上体の範囲（goodAt(速さ).trunk の min〜max）を、同じ式で胸の値に直したもの。人ごとの基準（lean.ts の settle）をこの内に収める
export type SpeedBy = 'belt' | 'sensor' | 'none'
export type ExpectLean = { deg: number; trunk: number; kmh: number | null; by: SpeedBy; lo?: number; hi?: number }

export function expectedChest(kmh?: number, by: SpeedBy = kmh === undefined ? 'none' : 'sensor', o: typeof CHEST_EXPECT = CHEST_EXPECT): ExpectLean {
  const ok = kmh !== undefined && Number.isFinite(kmh)
  const t = goodAt(ok ? kmh : undefined).trunk
  const chest = (x: number) => Math.round((o.gain * x + o.k) * 10) / 10
  return { deg: chest(t.mid), trunk: t.mid, kmh: ok ? kmh! : null, by: ok ? by : 'none', lo: chest(t.min), hi: chest(t.max) }
}
