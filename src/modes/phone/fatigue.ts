import { HIP_REF } from '../../core/params'
import { FATIGUE, PHONE_REF } from './params'

// 疲れの見分け（docs/phone-spec.md 機能5）と、上下動・ブレーキ・接地時間の変化（機能6）。走り終わった後に、1秒ごとの記録から出す。
// 走っている最中は声にしない（何をすれば直るかを言いにくく、接地時間は短いほど良いとも言えないため：Lussiana 2019）
// 数字（FATIGUE）と考え方は params.ts に書いた。決まった線での良し悪しは言わず、走り始めの自分からの変化だけを出す

export const FATIGUE_KEYS = ['regularity', 'apRegularity', 'ratioV', 'ratioAP', 'ratioML', 'contactMs'] as const
export type FatigueKey = (typeof FATIGUE_KEYS)[number]
export type FatigueFeatures = Record<FatigueKey, number>

// fatigueOf が読む1秒の記録（PhoneSample の一部）
export interface FatigueSec {
  t: number
  bounceCm: number | null
  brakingMs: number | null
  fat?: FatigueFeatures | null
  mount: unknown
  gate?: unknown
}

export interface FatigueBlock {
  t: number // 区間の始まり（秒）
  score: number | null // いつもと違う度合い。測れた秒が足りない区間は null
  dBounceCm: number | null // 走り始めからの上下動の変化（cm）
  dBrakingPct: number | null // 走り始めからのブレーキの変化（%）
  dContactMs: number | null // 走り始めからの有効接地時間の変化（ms）
}

export interface FatigueResult {
  base: 'later' | 'early' // 基準にした区間（later：5〜12分、early：30秒〜3分）
  baseFrom: number
  baseTo: number
  baseMean: FatigueFeatures & { bounceCm: number; brakingMs: number }
  baseSd: FatigueFeatures
  blocks: FatigueBlock[]
  onsetSec: number | null // 崩れ始め（秒）。見つからなければ null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))))
}

// 使える秒：測れていて、速さで止めておらず、付け方の問題が見つかる前
type Usable = FatigueSec & { fat: FatigueFeatures; bounceCm: number; brakingMs: number }
const usable = (s: FatigueSec): s is Usable => !!s.fat && s.bounceCm !== null && s.brakingMs !== null && !s.mount && !s.gate

export function fatigueOf(samples: FatigueSec[]): FatigueResult | null {
  const ok = samples.filter(usable)
  const inRange = (from: number, to: number) => ok.filter((s) => s.t >= from && s.t <= to)
  let base: FatigueResult['base'] = 'later'
  let [from, to] = [PHONE_REF.laterFrom, PHONE_REF.laterTo]
  const last = samples.length ? samples[samples.length - 1].t : 0
  let ref = inRange(from, to)
  // 5〜12分を走り切っていない・その区間を測れた秒が足りないときは、30秒〜3分を基準にする（PhoneAnalyzer の基準と同じ決まり）
  if (last <= to || ref.length < (to - from) * PHONE_REF.coverage) {
    base = 'early'
    ;[from, to] = [HIP_REF.from, HIP_REF.to]
    ref = inRange(from, to)
    if (ref.length < (to - from) * PHONE_REF.coverage) return null
  }
  const baseMean = {
    ...(Object.fromEntries(FATIGUE_KEYS.map((k) => [k, mean(ref.map((s) => s.fat[k]))])) as FatigueFeatures),
    bounceCm: mean(ref.map((s) => s.bounceCm)),
    brakingMs: mean(ref.map((s) => s.brakingMs)),
  }
  const baseSd = Object.fromEntries(FATIGUE_KEYS.map((k) => [k, sd(ref.map((s) => s.fat[k]))])) as FatigueFeatures

  const blocks: FatigueBlock[] = []
  for (let a = 0; a < last; a += FATIGUE.block) {
    const xs = ok.filter((s) => s.t >= a && s.t < a + FATIGUE.block)
    if (xs.length < FATIGUE.block * FATIGUE.minCover) {
      blocks.push({ t: a, score: null, dBounceCm: null, dBrakingPct: null, dContactMs: null })
      continue
    }
    const z = FATIGUE_KEYS.map((k) => (mean(xs.map((s) => s.fat[k])) - baseMean[k]) / Math.max(baseSd[k], FATIGUE.sdFloor[k]))
    blocks.push({
      t: a,
      score: Math.sqrt(mean(z.map((v) => v * v))),
      dBounceCm: mean(xs.map((s) => s.bounceCm)) - baseMean.bounceCm,
      dBrakingPct: baseMean.brakingMs > 0 ? ((mean(xs.map((s) => s.brakingMs)) - baseMean.brakingMs) / baseMean.brakingMs) * 100 : null,
      dContactMs: mean(xs.map((s) => s.fat.contactMs)) - baseMean.contactMs,
    })
  }

  // 崩れ始め：基準の区間より後で、度合いが線を超えた区間が FATIGUE.runs 続いた最初の区間の始まり。
  // 測れなかった区間は数えず、続きも切らない（信号待ちなどで止めた区間をはさんでも、崩れは続いているとみなす）
  let onsetSec: number | null = null
  let run: number[] = []
  for (const b of blocks) {
    if (b.t < to || b.score === null) continue
    if (b.score >= FATIGUE.line) {
      run.push(b.t)
      if (run.length >= FATIGUE.runs) {
        onsetSec = run[0]
        break
      }
    } else run = []
  }
  return { base, baseFrom: from, baseTo: to, baseMean, baseSd, blocks, onsetSec }
}
