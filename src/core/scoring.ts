import type { Category, ItemKey } from './types'

// 各項目の「満点の範囲」と「0点になる値」（度。腰は %）。仕様書の仮置きの値
export const LIMITS: Record<ItemKey, { full: number; zero: number; cue: number }> = {
  head: { full: 5, zero: 15, cue: 5 }, // 直立との差
  trunk: { full: 10, zero: 20, cue: 15 }, // 体幹の前傾
  body: { full: 5, zero: 12, cue: 8 }, // 体全体の前傾
  hip: { full: 3, zero: 10, cue: 6 }, // 序盤の自分からの腰の下がり
}

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
  if (score >= 80) return 'good'
  if (score >= 50) return 'mid'
  return 'bad'
}

// 声をかける基準を超えているか
export function overCue(key: ItemKey, value: number): boolean {
  return value > LIMITS[key].cue
}
