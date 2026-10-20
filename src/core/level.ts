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

// 段階ごとに、新しく足す項目と、走り出す前に言うこと。最後の段階（STEPS.length）は「すべて」。
// ここで決めるのは、今日の基準（整えたあとの形）からの崩れで声をかける項目。カメラ版の、正しいフォームの線で整える声
// （src/modes/camera/form.ts）は、どの段階でもかける（フォームの土台なので。それでも一度に1つずつ）
// 基準からの起きすぎ（上体・体全体が後ろへ）は、腰の段階で足す。最初の段階は「背を高く」と言うので、小さな起きすぎまで言うと食い違う。
// 腰が落ちる走りは、腰の高さより上体が起きる形に出ることが多い（人の動画、form-videos/notes/判定テスト.md）
// 着地（足が体より前に着く）は、腰のあとに1つの段階として足す（腰と同じ段階にすると、腰を意識する走りで2つの直し方を言うことになる）。
// 頭より先にするのは、ふつうに走るだけで出る誤った声が頭（10分に約1.1回）より少なく（約0.1回、sim/result-landing.md）、
// 足が前に着く形は膝の痛みやブレーキの形として、講師も何度も取り上げる（3R の動画）ため。体が後ろに残る・腰が落ちると着地も前に出るので、
// それらを先に見る
export const STEPS: { add: ItemKey[]; title: string; focus: string; up?: string }[] = [
  { add: ['trunk', 'body'], title: '胸のライトで前を照らす', focus: PHRASES.focusUpright },
  { add: ['hip', 'trunkBack', 'bodyBack'], title: '腰を高く保つ', focus: PHRASES.focusHip, up: PHRASES.stepHip },
  { add: ['landing'], title: '体の真下に足を下ろす', focus: PHRASES.focusLanding, up: PHRASES.stepLanding },
  { add: ['head'], title: '耳を肩の真上に', focus: PHRASES.focusHead, up: PHRASES.stepHead },
]
export const ALL = STEPS.length

const START: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: ALL }

// 段階の並びの版。着地の段階を足した（2）。前の版（記録に v がない）は、腰 → 頭 → すべて の3段階だった
export const PROGRESS_VERSION = 2

export interface Progress {
  level: Level
  step: number // 0〜ALL。ALL はすべての項目を見る
  clean: number // いま足した項目で声がかからなかった走りが続いた回数
  justUp?: boolean // 前の走りで段階が上がった（次の走り出しで伝える）
  v?: number // 段階の並びの版（PROGRESS_VERSION）
}

export const startProgress = (level: Level): Progress => ({ level, step: START[level], clean: 0, v: PROGRESS_VERSION })

// 前の版の段階を、いまの並びに直す。頭の段階（2）にいた人は、新しく入った着地の段階から（頭より先に見る項目なので）。
// 「すべて」（3）にいた人と上級は、すべて
export function migrateProgress(p: Progress): Progress {
  if (p.v === PROGRESS_VERSION) return p
  const step = p.level === 'advanced' || p.step >= 3 ? ALL : p.step
  return { ...p, step, clean: step === p.step ? p.clean : 0, justUp: step === p.step ? p.justUp : false, v: PROGRESS_VERSION }
}

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
