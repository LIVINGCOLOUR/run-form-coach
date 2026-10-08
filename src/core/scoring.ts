import type { Category, ItemKey } from './types'
import { LIMITS, SCORE } from './params'

// 各項目の線（満点の範囲・0点になる値・声をかける線）は params.ts
export { LIMITS }

export function itemScore(key: ItemKey, value: number): number {
  const { full, zero } = LIMITS[key]
  if (value <= full) return 100
  if (value >= zero) return 0
  return Math.round((100 * (zero - value)) / (zero - full))
}

// その瞬間の姿勢スコア = いちばん崩れている項目の点数
export function postureScore(v: Record<ItemKey, number>): number {
  return Math.min(itemScore('head', v.head), itemScore('trunk', v.trunk), itemScore('body', v.body), itemScore('hip', v.hip))
}

export function category(score: number): Category {
  if (score >= SCORE.good) return 'good'
  if (score >= SCORE.mid) return 'mid'
  return 'bad'
}

// 声をかける基準を超えているか
export function overCue(key: ItemKey, value: number): boolean {
  return value > LIMITS[key].cue
}
