import type { ItemKey, Session } from './types'
import { LEVEL } from './params'
import { PHRASES } from './phrases'

// ランナーのレベルと、注意する項目の段階。初心者は前かがみ → 腰 → 頭と1つずつ足し、上級者は最初から全部見る
export type Level = 'beginner' | 'intermediate' | 'advanced'

export const LEVEL_LABEL: Record<Level, string> = { beginner: '初心者', intermediate: '中級', advanced: '上級' }
export const LEVEL_NOTE: Record<Level, string> = {
  beginner: '注意することを1つずつ増やします',
  intermediate: '前かがみと腰の高さから始めます',
  advanced: '最初からすべての項目を見ます',
}

// 段階ごとに、新しく足す項目と、走り出す前に言うこと。最後の段階（STEPS.length）は「すべて」
export const STEPS: { add: ItemKey[]; title: string; focus: string; up?: string }[] = [
  { add: ['trunk', 'body'], title: '胸のライトで前を照らす', focus: PHRASES.focusUpright },
  { add: ['hip'], title: '腰を高く保つ', focus: PHRASES.focusHip, up: PHRASES.stepHip },
  { add: ['head'], title: '耳を肩の真上に', focus: PHRASES.focusHead, up: PHRASES.stepHead },
]
export const ALL = STEPS.length

const START: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: ALL }

export interface Progress {
  level: Level
  step: number // 0〜ALL。ALL はすべての項目を見る
  clean: number // いま足した項目で声がかからなかった走りが続いた回数
  justUp?: boolean // 前の走りで段階が上がった（次の走り出しで伝える）
}

export const startProgress = (level: Level): Progress => ({ level, step: START[level], clean: 0 })

// 声をかける項目（それ以外は大きく崩れたときだけ）
export function activeItems(step: number): ItemKey[] {
  return STEPS.slice(0, Math.min(step + 1, ALL)).flatMap((s) => s.add)
}

// 走り出す前に言うこと
export function startPhrase(p: Progress): string {
  if (p.step >= ALL) return p.justUp ? PHRASES.stepAll : PHRASES.focusAll
  const s = STEPS[p.step]
  return p.justUp && s.up ? s.up : s.focus
}

// 走り終わったら、いま足した項目で声がかからなかったかを数え、続いたら次の段階へ
export function afterRun(p: Progress, s: Session): Progress {
  if (p.step >= ALL || s.provisionalBaseline || s.durationSec < LEVEL.minRunSec) return { ...p, justUp: false }
  const added = STEPS[p.step].add
  const cued = s.cues.some((c) => (added as string[]).includes(c.item))
  const clean = cued ? 0 : p.clean + 1
  if (clean >= LEVEL.advanceAfter) return { ...p, step: p.step + 1, clean: 0, justUp: true }
  return { ...p, clean, justUp: false }
}
