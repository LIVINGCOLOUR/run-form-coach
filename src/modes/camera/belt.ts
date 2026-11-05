import type { Session } from '../../core/types'
import { GOOD_SPEED } from './params'
import { SPEED_FIT } from '../sensor/params'

// ベルトの速さ（トレッドミルのカメラ版）。走る前に「ベルトの速さ（時速 km）」として入れてもらう（Live.tsx の置き方の画面。空欄なら使わない）。
// 前回の値を端末（localStorage）に覚えておく。使い道：
//   ・よい例の範囲を、その速さのものにする（params.ts の goodAt。結果の画面・次の一歩・今日の意識）
//   ・走っている間の、速さで動く線（params.ts の applySpeed：体全体の下の線）
//   ・足首のセンサーの速さの式の、人ごとの合わせ（sensor/speedFit.ts）。真の速さが分かる走りだけで合わせる
//   ・記録（events の belt:kmh）と、走りの結果（Session.speedKmh・speedSource）
// 入れなかった走りは、足首のセンサーの見積もり（人ごとに合わせたもの）、それもなければカメラの速さの目安（置き方で ±10% ほどずれる）で、結果の画面のよい例の速さを決める
export const BELT_KEY = 'rfc.beltKmh'

// 入力の文字 → 時速 km。空欄・数字でない・受け付ける範囲（SPEED_FIT.kmhMin〜kmhMax）の外は undefined（使わない）
export function parseKmh(text: string): number | undefined {
  const t = text.trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace('．', '.')
  if (!t) return undefined
  const v = Number(t)
  if (!Number.isFinite(v) || v < SPEED_FIT.kmhMin || v > SPEED_FIT.kmhMax) return undefined
  return Math.round(v * 10) / 10
}

export function loadBeltText(): string {
  try {
    return globalThis.localStorage?.getItem(BELT_KEY) ?? ''
  } catch {
    return ''
  }
}

// 入れた文字をそのまま覚える（空欄にしたら空欄を覚える：次も使わない）
export function saveBeltText(text: string) {
  try {
    if (text.trim()) globalThis.localStorage?.setItem(BELT_KEY, text.trim())
    else globalThis.localStorage?.removeItem(BELT_KEY)
  } catch {
    /* 保存できない環境では何もしない */
  }
}

export type RunSpeed = { kmh: number; source: NonNullable<Session['speedSource']> }

const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN
}

// その走りの速さ（時速 km）を1つ決める：ベルトの速さ（真）→ 足首のセンサーの1歩ごとの見積もり（km/h）の中央値（1歩が SPEED_FIT.minSteps 以上あるとき）→
// カメラの速さの目安（脚の長さ／秒 × GOOD_SPEED.kmhPerSv）。どれもなければ undefined（講師の速さの範囲で比べる）
export function runSpeedOf(o: { belt?: number; sensorV?: number[]; camSv?: number }): RunSpeed | undefined {
  if (o.belt !== undefined && Number.isFinite(o.belt)) return { kmh: o.belt, source: 'belt' }
  const vs = (o.sensorV ?? []).filter((v) => Number.isFinite(v) && v >= SPEED_FIT.kmhMin && v <= SPEED_FIT.kmhMax)
  if (vs.length >= SPEED_FIT.minSteps) return { kmh: Math.round(median(vs) * 10) / 10, source: 'sensor' }
  if (o.camSv !== undefined && Number.isFinite(o.camSv) && o.camSv > 0) {
    const kmh = Math.round(o.camSv * GOOD_SPEED.kmhPerSv * 10) / 10
    if (kmh >= SPEED_FIT.kmhMin && kmh <= SPEED_FIT.kmhMax) return { kmh, source: 'camera' }
  }
  return undefined
}
