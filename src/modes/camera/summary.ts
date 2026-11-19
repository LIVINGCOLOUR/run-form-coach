import { ITEM_KEYS, type ItemKey, type Sample, type Session } from '../../core/types'
import { SCORE } from '../../core/params'
import { BAD_CAUSE, SUMMARY } from './params'
import { itemScore } from './scoring'
import { withRunLines } from './nextStep'

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

// 悪い姿勢の秒の、いちばん多かった理由（結果の画面で、割合の下に1行で添える）。
//   1秒の点数は、いちばん崩れている項目の点数（coach.ts。今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう）なので、
//   悪い秒（SCORE.mid 未満）ごとに、いちばん点数の低い項目を数える。点数の目盛りは、その走りのレベルの線（withRunLines）。
//   上級の頭の線（首32°・頭の位置36°）はよい例の上の端より厳しいので、よい例と比べるとほぼ同じでも、悪い秒が多くなることがある。
//   どのときに言うかは params.ts の BAD_CAUSE
export type CauseGroup = 'head' | 'hunch' | 'trunk' | 'body' | 'hip' | 'landing'
export const CAUSE_LABEL: Record<CauseGroup, string> = { head: '頭の位置', hunch: '背中の丸まり', trunk: '上体の前傾', body: '体全体の前傾', hip: '腰の高さ', landing: '着地の位置' }
const GROUP_OF: Record<ItemKey, CauseGroup> = { head: 'head', hunch: 'hunch', trunk: 'trunk', trunkBack: 'trunk', body: 'body', bodyBack: 'body', hip: 'hip', landing: 'landing' }

// 1秒の、項目ごとの点数のもとの値（今日の基準からの崩れと、正しいフォームの線の外れの、悪いほう）
function secondValues(x: Sample): Partial<Record<ItemKey, number>> {
  const v: Partial<Record<ItemKey, number>> = {}
  const put = (k: ItemKey, a: number | undefined) => {
    if (a === undefined || !Number.isFinite(a)) return
    v[k] = Math.max(v[k] ?? -Infinity, a)
  }
  if (x.judge) {
    put('head', x.head)
    put('trunk', x.judge.trunk)
    put('body', x.judge.body)
    if (x.hipMid) put('hip', x.hipDrop)
  }
  if (x.back) {
    put('trunkBack', x.back.trunk)
    put('bodyBack', x.back.body)
  }
  put('hunch', x.hunch)
  for (const [k, a] of Object.entries(x.form ?? {}) as [ItemKey, number][]) put(k, a)
  return v
}

export function badCause(s: Pick<Session, 'samples' | 'share' | 'focus' | 'speedKmh' | 'speedSource'>): { group: CauseGroup; part: number } | null {
  if (s.share.bad < BAD_CAUSE.minShare) return null
  return withRunLines(s, () => {
    const count: Partial<Record<CauseGroup, number>> = {}
    let n = 0
    for (const x of s.samples) {
      if (x.paused || x.score >= SCORE.mid) continue
      const v = secondValues(x)
      let worst: ItemKey | null = null
      let low = Infinity
      for (const k of ITEM_KEYS) {
        if (v[k] === undefined) continue
        const sc = itemScore(k, v[k]!)
        if (sc < low) [low, worst] = [sc, k]
      }
      if (!worst) continue
      n++
      count[GROUP_OF[worst]] = (count[GROUP_OF[worst]] ?? 0) + 1
    }
    if (!n) return null
    const [group, c] = (Object.entries(count) as [CauseGroup, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))
    return c / n >= BAD_CAUSE.minPart ? { group, part: c / n } : null
  })
}
