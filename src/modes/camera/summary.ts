import { ITEM_KEYS, type ItemKey, type Session } from '../../core/types'
import { SUMMARY } from './params'

// 結果の画面のいちばん上の、走りのひとこと。
//   姿勢を判定した秒がない：そう言う
//   崩れ始めが見つかった：その時刻と、声のたびに戻せたか
//   良い・悪いの割合と声の回数が SUMMARY の線の内側（崩れの少ない走り）：大きく崩れずに走れた
//   それ以外（走り出しから崩れていた・崩れの多い走り）：良い・悪いの割合をそのまま言い、次に意識することへつなぐ
export function runSummary(s: Pick<Session, 'breakdownMin' | 'cues' | 'share' | 'durationSec'>): string {
  const cues = s.cues.filter((c) => ITEM_KEYS.includes(c.item as ItemKey))
  const recovers = s.cues.filter((c) => c.item === 'recover').length
  // 姿勢を1秒も判定しなかった走り（短い・基準ができる前に終えた）は、割合で何も言えない
  if (s.share.good + s.share.mid + s.share.bad === 0) return '姿勢を判定できた時間がありませんでした。'
  if (s.breakdownMin !== undefined) return `${s.breakdownMin}分から崩れ始めました。${recovers ? '声をかけるたびに戻せています。' : '後半こそ、今日の意識を思い出しましょう。'}`
  if (calmRun(s, cues.length)) return cues.length ? '大きく崩れずに走れました。声をかけた所は、すぐに戻せています。' : '最後まで、大きく崩れずに走れました。'
  const pct = (x: number) => Math.round(x * 100)
  return `良い姿勢は${pct(s.share.good)}%、悪い姿勢は${pct(s.share.bad)}%でした。${cues.length ? '声をかけた所を、次の走りで意識しましょう。' : '次の一歩を意識して走りましょう。'}`
}

// 崩れの少ない走りか（SUMMARY）
export function calmRun(s: Pick<Session, 'share' | 'durationSec'>, cues: number): boolean {
  const min = Math.max(1, s.durationSec / 60)
  return s.share.good >= SUMMARY.goodMin && s.share.bad <= SUMMARY.badMax && cues / min <= SUMMARY.cuesPerMinMax
}
