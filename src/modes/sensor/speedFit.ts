import { SPEED_FIT, STEP } from './params'
import type { Step } from './contact'

// 足首のセンサーの速さの式（contact.ts：速さ = speedA + speedB × すねの振れ幅 ÷ 1歩き）を、人ごとに合わせる（2026-11-06 本人の決め「固定の線より、人ごとの較正を基準にする」）。
//   RBDS（22人）の当てはめの speedA（−0.183）は、人によって ±0.30 m/s（±1.1 km/h）ずれる。自分の 2026-11-05（ベルト時速9.0km）は 8.1 km/h と低く出た。
//   そこで、ベルトの速さ（真）が分かっている走り（トレッドミルのカメラ版かセンサーランで、ベルトの速さを入れたもの）が終わるごとに、その走りの1歩ごとの
//   「ベルトの速さ − speedB × 振れ幅 ÷ 1歩き」の中央値をその人の speedA にする（fitSpeedA）。中央値なので、走り出し・歩き・ベルトの加減速の1歩に引きずられない。
//   端末（localStorage）に直近 SPEED_FIT.keep 回の走りの値を残し、その中央値を使う（1回のベルトの速さの入れ間違いにも引きずられにくい）。
//   使う値は RBDS の値から SPEED_FIT.maxOffset の内に収める（入れ間違い）。新しい端末・まだベルトの速さを入れていない人は RBDS の値のまま。
//   外の走り（センサーラン）には真の速さがないので、合わせた式でそのまま見積もる。GPS の速さ（runner.ts の onGps、gps.ts）が来たら、
//   ベルトの速さと同じく fitSpeedA に渡せば合わせられる（まだつないでいない：GPS の速さの精度を記録で確かめてから）
//   使い方：走り終わり（カメラ版の Live.tsx、センサーランの SensorLive.tsx）に saveSpeedFit(fitSpeedA(steps, beltKmh))。式に入れるのは applySpeedFit()（StepDetector を作るたびと、残したあと）

export interface SpeedFit {
  speedA: number // その走りで合わせた speedA（m/s）
  n: number // 使った1歩の数
  kmh: number // ベルトの速さ（時速 km）
  spread: number // 1歩ごとの値の散らばり（下から1割〜上から1割の幅、m/s）。走りの中で速さが変わっていると広い
  at: number // 走った日時（ms）
}

const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN
}
const quant = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}

// ベルトの速さ kmh（時速 km）で走った1歩たちから、その人の speedA を出す。1歩が SPEED_FIT.minSteps より少ない・速さが範囲の外なら null
export function fitSpeedA(steps: Pick<Step, 'rom' | 'stride'>[], kmh: number, at = Date.now(), o: typeof SPEED_FIT = SPEED_FIT): SpeedFit | null {
  if (!Number.isFinite(kmh) || kmh < o.kmhMin || kmh > o.kmhMax) return null
  const xs = steps.filter((s) => Number.isFinite(s.rom) && s.stride > 0).map((s) => kmh / 3.6 - (STEP.speedB * s.rom) / s.stride)
  if (xs.length < o.minSteps) return null
  return { speedA: Math.round(median(xs) * 1000) / 1000, n: xs.length, kmh, spread: Math.round((quant(xs, 0.9) - quant(xs, 0.1)) * 1000) / 1000, at }
}

// 端末に残した合わせ（新しい順）
export function loadSpeedFits(o: typeof SPEED_FIT = SPEED_FIT): SpeedFit[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(o.key) ?? 'null')
    return Array.isArray(v) ? (v as SpeedFit[]).filter((f) => Number.isFinite(f?.speedA)) : []
  } catch {
    return []
  }
}

// 合わせを残し、式に入れる。null（合わせられなかった）なら何もしない。返すのは、いま式に入っている speedA
export function saveSpeedFit(fit: SpeedFit | null, o: typeof SPEED_FIT = SPEED_FIT): number {
  if (fit) {
    try {
      globalThis.localStorage?.setItem(o.key, JSON.stringify([fit, ...loadSpeedFits(o)].slice(0, o.keep)))
    } catch {
      /* 保存できない環境では何もしない */
    }
  }
  return applySpeedFit(o)
}

// 残した合わせから、いま使う speedA：直近 keep 回の中央値（RBDS の値から maxOffset の内に収める）。残していなければ RBDS の値
export function fittedSpeedA(fits: SpeedFit[] = loadSpeedFits(), o: typeof SPEED_FIT = SPEED_FIT): number {
  if (!fits.length) return o.base
  const m = median(fits.slice(0, o.keep).map((f) => f.speedA))
  return Math.round(Math.min(o.base + o.maxOffset, Math.max(o.base - o.maxOffset, m)) * 1000) / 1000
}

// 式（params.ts の STEP）に、その人の speedA を入れる。contact.ts の StepDetector はこの値を1歩ごとに読む
export function applySpeedFit(o: typeof SPEED_FIT = SPEED_FIT): number {
  STEP.speedA = fittedSpeedA(loadSpeedFits(o), o)
  return STEP.speedA
}
