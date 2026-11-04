// 仮想実験（センサーのずれ）：胸・頭のセンサーの前への傾きを作って LeanDetector（src/modes/sensor/lean.ts）に流し、
// ずれの見張り（params.ts の slipSec・slipDecay）があるときとないときで、知らせた回数と「ずれとみなした」時刻を比べる
// 動かし方：npx vitest run --config sim/vitest.config.ts sim/lean-slip.sim.ts（研究データは使わない）
// 傾きの揺れは 2026-11-03 15:08 の走りの胸に合わせた：ならしたあとの傾きの揺れ（標準偏差）約 2.1〜2.7°、続く長さ 約0.2秒、5秒の真ん中の値の揺れ ±1〜2°
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { LeanDetector } from '../src/modes/sensor/lean'
import { HEAD, HUNCH, HUNCH_BY_LEVEL, type LeanParams } from '../src/modes/sensor/params'
import { LEVEL_LABEL, type Level } from '../src/core/level'
import type { Vec3 } from '../src/modes/sensor/parse'
import { rng } from './camera'

const HZ = 100
const END = 700 // 走る長さ（秒）
const SEEDS = 20
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']

const lean = (deg: number): Vec3 => {
  const r = Math.PI / 180
  return [Math.sin(deg * r), 0, Math.cos(deg * r)]
}

// 揺れ：一歩ごとの揺れ（1.4Hz）＋ 速い揺れ ＋ ゆっくりの揺れ（十数秒）。seed ごとに違う
function noise(seed: number, n: number): Float64Array {
  const g = rng(seed)
  const out = new Float64Array(n)
  let fast = 0
  let slow = 0
  const ph = g.u() * 2 * Math.PI
  for (let i = 0; i < n; i++) {
    const t = i / HZ
    fast += (-fast / 0.1) / HZ + 5 * Math.sqrt(2 / 0.1 / HZ) * g.gauss()
    slow += (-slow / 15) / HZ + 0.8 * Math.sqrt(2 / 15 / HZ) * g.gauss()
    out[i] = 8 * Math.sin(2 * Math.PI * 1.4 * t + ph) + fast + slow
  }
  return out
}

// 場面：t（走り出してからの秒）→ ふつうの傾きからの増え（度）。posture：わざと崩した間、slip：センサーがずれた分
type Scene = { label: string; posture: (t: number) => number; slip: (t: number) => number; bad: [number, number][] }
const step = (from: number, to: number, deg: number, ramp = 2) => (t: number) => (t < from || t >= to ? 0 : deg * Math.min(1, (t - from) / ramp))
const hold = (from: number, deg: number, ramp: number) => (t: number) => (t < from ? 0 : deg * Math.min(1, (t - from) / ramp))
const none = () => 0

function scenes(d: number): Scene[] {
  return [
    { label: 'ふつうに走る（10分あまり）', posture: none, slip: none, bad: [] },
    { label: `わざと崩す +${d}° を40秒`, posture: step(200, 240, d), slip: none, bad: [[200, 240]] },
    { label: `わざと崩す +${d}° を60秒`, posture: step(200, 260, d), slip: none, bad: [[200, 260]] },
    { label: `わざと崩す +${d}° を60秒 ×2（間60秒）`, posture: (t) => step(200, 260, d)(t) + step(320, 380, d)(t), slip: none, bad: [[200, 260], [320, 380]] },
    { label: `わざと崩す +${d}° を90秒（見張りが吸う）`, posture: step(200, 290, d), slip: none, bad: [[200, 290]] },
    { label: `ゆっくりずれる +${d}° を5分で`, posture: none, slip: hold(150, d, 300), bad: [] },
    { label: `ずれる +${d}° を30秒で`, posture: none, slip: hold(150, d, 30), bad: [] },
    { label: `急にずれる +${d}°（2秒で）`, posture: none, slip: hold(150, d, 2), bad: [] },
    { label: `急にずれる +${d}° のあと、わざと崩す +${d}° を40秒`, posture: step(450, 490, d), slip: hold(150, d, 2), bad: [[450, 490]] },
  ]
}

type Out = { cues: number[]; slips: number[] }
function run(p: LeanParams, base: number, sc: Scene, seed: number): Out {
  const d = new LeanDetector(p)
  const nz = noise(seed, (END + 10) * HZ)
  // 立つ（5秒）：揺れなし
  for (let i = 0; i < 5 * HZ; i++) {
    d.sample(i / HZ, lean(0))
    if (i % 10 === 0) d.update(i / HZ, false)
  }
  d.stand(5, 3)
  const cues: number[] = []
  const slips: number[] = []
  for (let i = 0; i < END * HZ; i++) {
    const t = i / HZ // 走り出してから
    d.sample(5 + t, lean(base + nz[i] + sc.posture(t) + sc.slip(t)))
    if (i % 10 === 0) {
      const r = d.update(5 + t, true)
      if (r.cue) cues.push(t)
      if (r.slip) slips.push(t)
    }
  }
  return { cues, slips }
}

const med = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const inside = (t: number, bad: [number, number][]) => bad.some(([a, b]) => t >= a && t < b + 3)
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '—')

it('ずれの見張り：わざとの崩れ（60秒まで）は知らせ続け、ずれたセンサーは置き直して黙る', () => {
  const kinds = [
    ...LEVELS.map((lv) => ({ name: `胸（猫背・${LEVEL_LABEL[lv]}）`, p: HUNCH_BY_LEVEL[lv], base: 18, d: 13 })),
    { name: '頭（前に出る）', p: HEAD, base: 6, d: 22 },
  ]
  const lines: string[] = [
    '# センサーのずれの見張り（仮想実験）',
    '',
    `sim/lean-slip.sim.ts。前への傾きを作って LeanDetector に流した（${SEEDS}通りの揺れ、走り出して${END}秒）。揺れは 2026-11-03 15:08 の走りの胸に合わせた（ならしたあとの標準偏差 約2.5°）。`,
    `見張りあり：slipSec ${HUNCH.slipSec}秒・slipDecay ${HUNCH.slipDecay}（線を越えていた時間を数え、線の下では ${HUNCH.slipDecay} 倍の速さで減らす）と、slipDrift（寄せた基準が走る前傾から前へ動いた量。胸 ${HUNCH.slipDrift}°・頭 ${HEAD.slipDrift}°）。なし：slipSec 0・slipDrift 0。`,
    '回数は真ん中の値（かっこは最小〜最大）。「崩れの間」はわざと崩した間（と戻って3秒）に知らせた回数、「ほか」はそれ以外。ずれとみなした時刻は走り出してからの秒（真ん中）。',
    '',
  ]
  const checks: (() => void)[] = []
  for (const k of kinds) {
    lines.push(`## ${k.name}：ふつう ${k.base}°・margin ${k.p.margin}°・崩れとずれは +${k.d}°`, '')
    lines.push('| 場面 | 崩れの間（なし → あり） | ほか（なし → あり） | ずれとみなした（あり） |', '|---|---|---|---|')
    for (const sc of scenes(k.d)) {
      const res = Array.from({ length: SEEDS }, (_, s) => ({
        off: run({ ...k.p, slipSec: 0, slipDrift: 0 }, k.base, sc, 1000 + s),
        on: run(k.p, k.base, sc, 1000 + s),
      }))
      const count = (o: Out, inBad: boolean) => o.cues.filter((t) => inside(t, sc.bad) === inBad).length
      const cell = (xs: number[]) => `${f0(med(xs))}（${f0(Math.min(...xs))}〜${f0(Math.max(...xs))}）`
      const inOff = res.map((r) => count(r.off, true))
      const inOn = res.map((r) => count(r.on, true))
      const outOff = res.map((r) => count(r.off, false))
      const outOn = res.map((r) => count(r.on, false))
      const slipN = res.filter((r) => r.on.slips.length > 0).length
      const slipT = med(res.flatMap((r) => r.on.slips.slice(0, 1)))
      lines.push(
        `| ${sc.label} | ${sc.bad.length ? `${cell(inOff)} → ${cell(inOn)}` : '—'} | ${cell(outOff)} → ${cell(outOn)} | ${slipN} / ${SEEDS}${slipN ? `（${f0(slipT)}秒）` : ''} |`,
      )
      // 確かめること（表を書いてから確かめる）
      const label = sc.label
      checks.push(() => {
        if (label.startsWith('ふつう')) expect(slipN, label).toBe(0)
        if (label.startsWith('わざと') && !label.includes('90秒')) {
          expect(slipN, label).toBe(0) // 60秒までの崩れ（2回でも）は、ずれとみなさない
          res.forEach((_, i) => expect(inOn[i], label).toBe(inOff[i])) // 見張りがあっても、知らせる回数は同じ
          for (const x of inOn) expect(x, label).toBeGreaterThanOrEqual(3 * sc.bad.length) // 崩した間に、くり返し知らせる
        }
        if (label.startsWith('ゆっくり')) expect(slipN, label).toBe(SEEDS) // 寄せた基準が動いたので、ずれとみなす
        if (label.startsWith('急にずれる')) {
          expect(slipN, label).toBe(SEEDS)
          // 置き直したあと、ずれのせいではほとんど鳴らない。あとのわざとの崩れは知らせる
          for (const r of res) expect(r.on.cues.filter((t) => t > r.on.slips[0] && !inside(t, sc.bad)).length, label).toBeLessThanOrEqual(1)
          if (sc.bad.length) expect(med(inOn), label).toBeGreaterThanOrEqual(6)
          if (med(outOff) >= 30) expect(med(outOn), label).toBeLessThan(med(outOff) / 3) // 鳴り続けていたもの（胸）は、1/3 未満に減る
        }
      })
    }
    lines.push('')
  }
  lines.push(
    '読み方：見張りなしだと、急にずれた胸のセンサーは線を越えたままになり、基準も寄らない（線の下にいる間しか寄せない）ので、走り終わるまで4秒ごとに鳴る。',
    '頭は margin が広く（18°）、+22° のずれでは線のすぐ上を出入りするので、もともと鳴り続けはしない（線の下にいる間に基準が寄る）。',
    `見張りありでは、線を越えていた時間が ${HUNCH.slipSec}秒に達したところで基準を置き直し、それからは鳴らない。わざと崩した60秒（2回続けても）は置き直さず、4秒ごとに知らせ続ける。`,
    `その代わり、${HUNCH.slipSec}秒より長く崩れたままだと、ずれとみなして黙る（90秒の行）。ゆっくりのずれは、もともと基準を寄せて吸い（follow ${HUNCH.follow}秒）、基準が slipDrift より前へ動いたところで、ずれとみなす（知らせる回数は変わらない）。`,
  )
  writeFileSync(process.env.SIM_OUT ?? 'sim/result-lean-slip.md', lines.join('\n') + '\n')
  for (const c of checks) c()
})
