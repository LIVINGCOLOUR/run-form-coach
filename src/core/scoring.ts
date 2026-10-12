import type { Category } from './types'
import { SCORE } from './params'

// 点数から良い・ふつう・悪いに分ける（カメラ版の項目ごとの点数は src/modes/camera/scoring.ts）
export function category(score: number): Category {
  if (score >= SCORE.good) return 'good'
  if (score >= SCORE.mid) return 'mid'
  return 'bad'
}
