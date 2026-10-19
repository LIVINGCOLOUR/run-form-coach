import { ITEM_KEYS, type ItemKey } from '../../core/types'
import { LIMITS } from './params'

// 各項目の線（満点の範囲・0点になる値・声をかける線）は params.ts
export { LIMITS }

export function itemScore(key: ItemKey, value: number): number {
  const { full, zero } = LIMITS[key]
  if (value <= full) return 100
  if (value >= zero) return 0
  return Math.round((100 * (zero - value)) / (zero - full))
}

// その瞬間の姿勢スコア = いちばん崩れている項目の点数
// v にない項目（その秒に判定しなかった項目）は数えない
export function postureScore(v: Partial<Record<ItemKey, number>>): number {
  return Math.min(100, ...ITEM_KEYS.flatMap((k) => (v[k] === undefined ? [] : [itemScore(k, v[k]!)])))
}

// 声をかける基準を超えているか
export function overCue(key: ItemKey, value: number): boolean {
  return value > LIMITS[key].cue
}
