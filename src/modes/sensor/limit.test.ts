import { describe, expect, it } from 'vitest'
import { LIMIT } from '../../core/params'
import { LeanDetector, type LeanStep } from './lean'
import { HUNCH } from './params'
import type { Vec3 } from './parse'

// 胸・頭の知らせの、1時間の上限（lean.ts。数字は core/params.ts の LIMIT。接地のしくみ側は core/engine.test.ts）

// 胸の向き：立った姿勢（重力が z）から、前（x）へ deg 度傾けた加速度（g）
const lean = (deg: number): Vec3 => {
  const r = Math.PI / 180
  return [Math.sin(deg * r), 0, Math.cos(deg * r)]
}

// 100Hz で胸の値を流し、0.1秒ごとに判定する
function play(d: LeanDetector, from: number, to: number, tiltAt: (t: number) => number, running = true) {
  const out: ({ t: number } & LeanStep)[] = []
  for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
    const t = i / 100
    d.sample(t, lean(tiltAt(t)))
    if (i % 10 === 0) out.push({ t, ...d.update(t, running) })
  }
  return out
}

describe('胸・頭の知らせの1時間の上限（LIMIT.perHour）', () => {
  const A = 15 // いつもの楽な立ち方（a）の猫背
  const BODY = 8 // 走る体ごとの前傾
  // 2つの立ち方（0〜3秒 a、3〜6秒 b）で覚える。猫背のまま走り続けても、ずれとはみなさない形
  const setup = () => {
    const d = new LeanDetector(HUNCH)
    play(d, 0, 3, () => A, false)
    const da = d.dirOver(3, 3)!
    play(d, 3, 6, () => 0, false)
    const db = d.dirOver(6, 3)!
    expect(d.setPoses(da, db)).toBe(true)
    return d
  }

  it('猫背のまま2時間走ると、1時間の枠ごとに perHour 回まで震え、残りは震えない。達した知らせに capped を付ける', () => {
    const d = setup()
    const out = play(d, 6, 6 + 7190, () => A + BODY) // 走った時間は 6秒から数える：枠の境は約 3606秒（0.1秒の足し算の誤差ぶん手前）
    const cues = out.filter((o) => o.cue)
    const hour0 = cues.filter((o) => o.t < 3605)
    const hour1 = cues.filter((o) => o.t >= 3605)
    expect(hour0.length).toBe(LIMIT.perHour) // 4秒 → 15秒ごとなら1時間に約240回のところ
    expect(hour1.length).toBe(LIMIT.perHour)
    expect(hour0[hour0.length - 1].t).toBeLessThan(400) // 上限には走って数分で達し、そのあと約55分は震えない
    expect(out.filter((o) => o.capped).map((o) => o.t)).toEqual([hour0[hour0.length - 1].t, hour1[hour1.length - 1].t])
    // 震えない間も、傾きは見ていて、ずれとはみなさない
    expect(out.filter((o) => o.t > 1000 && o.t < 3600).every((o) => o.tilt !== null && o.tilt > 20)).toBe(true)
    expect(out.some((o) => o.slip)).toBe(false)
  })

  it('上限に達する前に直れば、ふだんどおり（上限は知らせた回数だけで数え、戻った回数では減らない）', () => {
    const d = setup()
    // 猫背 30秒 → 戻す 30秒 を4回：1回あたり 5回ほど知らせる（4秒ごと）。合わせて perHour に届かない
    const out = play(d, 6, 6 + 240, (t) => (Math.floor((t - 6) / 30) % 2 === 0 ? A + BODY : BODY))
    const cues = out.filter((o) => o.cue)
    expect(cues.length).toBeGreaterThan(10)
    expect(cues.length).toBeLessThan(LIMIT.perHour)
    expect(out.some((o) => o.capped)).toBe(false)
    expect(cues[cues.length - 1].t).toBeGreaterThan(6 + 180) // 最後の猫背の区間でも知らせている
  })
})
