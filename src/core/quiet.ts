import { HIP_REF, QUIET } from './params'

// 声なしで保てた時間（結果画面の主役）の書き方と、前回との差

// 秒を分と秒に分ける（端数の秒は四捨五入）
export function splitMinSec(sec: number): { min: number; sec: number } {
  const total = Math.max(0, Math.round(sec))
  return { min: Math.floor(total / 60), sec: total % 60 }
}

// 「12分30秒」「12分」「45秒」
export function fmtMinSec(sec: number): string {
  const p = splitMinSec(sec)
  if (p.min === 0) return `${p.sec}秒`
  return p.sec === 0 ? `${p.min}分` : `${p.min}分${p.sec}秒`
}

// 前回より何秒増えたか（前回がないときは null）
export function quietDelta(cur: number, prev: number | undefined): number | null {
  if (prev === undefined) return null
  return Math.round(cur) - Math.round(prev)
}

// 声なしの確認に一度も入らなかった走りに添える一言
export const QUIET_NONE = {
  title: '次は、声なしで確認する時間を目指しましょう',
  how: `走り始めの基準ができてから${QUIET.enterWindow / 60}分、声かけなしで良い姿勢が続くと入ります（早くて${(HIP_REF.to + QUIET.enterWindow) / 60}分から）`,
}
