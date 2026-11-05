import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySpeedFit, fitSpeedA, fittedSpeedA, loadSpeedFits, saveSpeedFit } from './speedFit'
import { SPEED_FIT, STEP } from './params'
import { StepDetector } from './contact'

// localStorage の代わり（テストの中だけ）
const store = new Map<string, string>()
const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = fake
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  STEP.speedA = SPEED_FIT.base
})

// 作りものの1歩：本当の速さ kmh の人で、式の切片が trueA（その人の値）のときの振れ幅 ÷ 1歩き。ばらつきと、加減速の外れた1歩を混ぜる
function steps(kmh: number, trueA: number, n = 400) {
  const out = []
  for (let i = 0; i < n; i++) {
    const v = i % 25 === 0 ? kmh * 0.6 : kmh // 4% はベルトの加減速・歩きの1歩
    const ratio = (v / 3.6 - trueA) / STEP.speedB + 3 * Math.sin(i)
    out.push({ rom: ratio * 0.7, stride: 0.7 })
  }
  return out
}

describe('速さの式の人ごとの合わせ（speedFit.ts）', () => {
  it('新しい端末は RBDS の値のまま', () => {
    expect(applySpeedFit()).toBe(SPEED_FIT.base)
    expect(new StepDetector().p.speedA).toBe(SPEED_FIT.base)
  })

  it('ベルトの速さで走った1歩の中央値から、その人の切片を出す（外れた1歩に引きずられない）', () => {
    const f = fitSpeedA(steps(9, 0.1), 9)!
    expect(f.speedA).toBeCloseTo(0.1, 2)
    expect(f.n).toBe(400)
    expect(fitSpeedA(steps(9, 0.1, 50), 9)).toBeNull() // 1歩が足りない
    expect(fitSpeedA(steps(9, 0.1), Number.NaN)).toBeNull()
    expect(fitSpeedA(steps(9, 0.1), 40)).toBeNull() // 範囲の外
  })

  it('残して式に入れ、次の StepDetector からその値で見積もる。直近の中央値を使い、入れ間違いは RBDS の値からの幅で抑える', () => {
    const a = saveSpeedFit(fitSpeedA(steps(9, 0.1), 9))
    expect(a).toBeCloseTo(0.1, 2)
    expect(STEP.speedA).toBeCloseTo(0.1, 2)
    saveSpeedFit(fitSpeedA(steps(7, 0.12), 7))
    saveSpeedFit(fitSpeedA(steps(9, 0.1), 15)) // ベルトの速さの入れ間違い（本当は9）
    expect(loadSpeedFits()).toHaveLength(3)
    expect(fittedSpeedA()).toBeCloseTo(0.12, 1) // 3つの中央値
    expect(fittedSpeedA([{ speedA: 5, n: 400, kmh: 9, spread: 0, at: 0 }])).toBeCloseTo(SPEED_FIT.base + SPEED_FIT.maxOffset, 5)
    for (let i = 0; i < 10; i++) saveSpeedFit(fitSpeedA(steps(9, 0.1), 9))
    expect(loadSpeedFits()).toHaveLength(SPEED_FIT.keep)
  })

  it('合わせられない走り（null）は残さない', () => {
    expect(saveSpeedFit(null)).toBe(SPEED_FIT.base)
    expect(loadSpeedFits()).toHaveLength(0)
  })
})
