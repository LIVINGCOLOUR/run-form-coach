// 仮想実験（2つの立ち方）：胸のセンサーの前への傾きを作って LeanDetector（src/modes/sensor/lean.ts）に流し、
// 2つの立ち方で見る（setPoses）のと、今までの見方（立った姿勢 → 走り出しの前傾 + margin。差が小さいときの fallback と同じ）で、知らせた回数を比べる
// 動かし方：npx vitest run --config sim/vitest.config.ts sim/pose.sim.ts（研究データは使わない）。結果は sim/result-pose.md
// 体の形（すべて仮定。確かめ走の記録で置き換える）：
//   胸を開いた立ち方 b を 0°、いつもの楽な立ち方 a を前へ θ°（2つの差）。走ると体ごと L° 前に傾く。
//   走っている胸の傾き ＝ L + 猫背の割合 × θ + 揺れ。猫背の割合は、胸を開いて走る 0、いつもの猫背で走る 1
//   揺れは sim/lean-slip.sim.ts と同じ形（2026-11-03 15:08 の走りの胸に合わせた。ならしたあと約2.5°）。
//   立ち方の測り違い：a・b の向きに、それぞれ前後 1°（標準偏差）の誤差を足す（記録の立った3秒の、1秒ずつの揺れ 0.8〜3.1° から）
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { LeanDetector } from '../src/modes/sensor/lean'
import { HUNCH, type LeanParams } from '../src/modes/sensor/params'
import type { Vec3 } from '../src/modes/sensor/parse'
import { rng } from './camera'

const HZ = 100
const END = 600 // 走る長さ（秒）
const SEEDS = 10
const THETAS = [6, 10, 15, 20]
const BODY = [4, 8, 12]

const lean = (deg: number, side = 0): Vec3 => {
  const r = Math.PI / 180
  return [Math.sin(deg * r) * Math.cos(side * r), Math.sin(side * r), Math.cos(deg * r) * Math.cos(side * r)]
}

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

// 場面：走り出してからの秒 → 猫背の割合。bad：猫背の間（知らせてよい間）
type Scene = { label: string; frac: (t: number) => number; bad: [number, number][] }
const SCENES: Scene[] = [
  { label: '胸を開いたまま走る', frac: () => 0, bad: [] },
  { label: '猫背のまま走り出し、そのまま', frac: () => 1, bad: [[0, END]] },
  { label: '猫背のまま走り出し、300秒で胸を開く', frac: (t) => (t < 300 ? 1 : 0), bad: [[0, 300]] },
  { label: '胸を開いて走り出し、200〜240秒と320〜380秒だけ猫背', frac: (t) => ((t >= 200 && t < 240) || (t >= 320 && t < 380) ? 1 : 0), bad: [[200, 240], [320, 380]] },
  { label: 'ずっと半分の猫背（割合 0.5）', frac: () => 0.5, bad: [] },
]

type Out = { cues: number[]; slips: number[] }
function run(p: LeanParams, theta: number, body: number, sc: Scene, seed: number, pose: boolean): Out {
  const d = new LeanDetector(p)
  const g = rng(seed + 7)
  const nz = noise(seed, (END + 10) * HZ)
  // 立つ：0〜3秒 a、3〜6秒 b（揺れなし。測り違いは向きに足す）
  for (let i = 0; i < 6 * HZ; i++) d.sample(i / HZ, lean(i < 3 * HZ ? theta : 0))
  const a = lean(theta + g.gauss())
  const b = lean(g.gauss())
  // 測り違いで差が poseMin を切ったら、アプリと同じく今までの見方にする（測り直しは入れていない）
  if (!pose || !d.setPoses(a, b)) d.standDir(b)
  const cues: number[] = []
  const slips: number[] = []
  for (let i = 0; i < END * HZ; i++) {
    const t = i / HZ
    d.sample(6 + t, lean(body + sc.frac(t) * theta + nz[i]))
    if (i % 10 === 0) {
      const r = d.update(6 + t, true)
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

it('2つの立ち方：猫背のまま走り出しても知らせ、胸を開いたままなら知らせない（体ごとの前傾が poseCap + 線の幅の内なら）', () => {
  const p = HUNCH
  const lines: string[] = [
    '# 2つの立ち方で猫背を見る（仮想実験）',
    '',
    `sim/pose.sim.ts。胸の前への傾きを作って LeanDetector に流した（${SEEDS}通りの揺れ、走り出して${END}秒、中級）。体の形は仮定（ファイルの頭の説明）。`,
    `2つの立ち方：poseCap ${p.poseCap}°・線の幅 ${p.poseLine > 0 ? `${p.poseLine}°（決まった度数 poseLine）` : `max(margin ${p.margin}°, poseFrac ${p.poseFrac} × 差)`}。今まで：b を立った姿勢にして、走り出しの前傾 + margin ${p.margin}°（差が小さいときの fallback と同じ）。`,
    '回数は真ん中の値（かっこは最小〜最大）。「猫背の間」は猫背の割合 1 の間（と戻って3秒）、「ほか」はそれ以外。走り出しの40秒（前傾を覚える間）は、どちらも知らせない。',
    `ずれの見張り：今までの見方は slipSec ${p.slipSec}秒のまま。2つの立ち方では、線を越えた向きが猫背としてありうる（b→a に沿った傾きが min(${p.poseIdxMin} × 差, 線の幅)〜${p.poseSlipIdx} × 差・横の傾きが小さい）間は数えない。知らせ直す間隔は、続けて${p.poseBackoffAfter}回のあと ${p.poseBackoffEvery}秒ごと。`,
    `猫背のまま走り出して知らせる条件：差 + 体ごとの前傾 > min(差 + 体ごと, poseCap) + 線の幅。差 6°、差 10° で体ごと 4°、差 15° で体ごと 4° はこれを満たさないか、ぎりぎり（揺れしだい）。`,
    '',
  ]
  const checks: (() => void)[] = []
  // 線の幅（lean.ts の setPoses と同じ）
  const widthOf = (theta: number) => (p.poseLine > 0 ? p.poseLine : Math.max(p.margin, p.poseFrac * theta))
  for (const theta of THETAS) {
    lines.push(`## 2つの立ち方の差 ${theta}°（線の幅 ${widthOf(theta).toFixed(1)}°）`, '')
    lines.push('| 体ごとの前傾 | 場面 | 猫背の間（今まで → 2つ） | ほか（今まで → 2つ） | ずれ（今まで → 2つ） |', '|---|---|---|---|---|')
    for (const body of BODY) {
      for (const sc of SCENES) {
        const res = Array.from({ length: SEEDS }, (_, s) => ({ old: run(p, theta, body, sc, 2000 + s, false), neu: run(p, theta, body, sc, 2000 + s, true) }))
        const count = (o: Out, inBad: boolean) => o.cues.filter((t) => inside(t, sc.bad) === inBad).length
        const cell = (xs: number[]) => `${f0(med(xs))}（${f0(Math.min(...xs))}〜${f0(Math.max(...xs))}）`
        const inOld = res.map((r) => count(r.old, true))
        const inNew = res.map((r) => count(r.neu, true))
        const outOld = res.map((r) => count(r.old, false))
        const outNew = res.map((r) => count(r.neu, false))
        const slip = (k: 'old' | 'neu') => res.filter((r) => r[k].slips.length > 0).length
        lines.push(`| ${body}° | ${sc.label} | ${sc.bad.length ? `${cell(inOld)} → ${cell(inNew)}` : '—'} | ${cell(outOld)} → ${cell(outNew)} | ${slip('old')} → ${slip('neu')} / ${SEEDS} |`)
        const label = `${theta}° ${body}° ${sc.label}`
        // 確かめること：線から 3° 以上離れているときだけ（揺れで線をまたぐ場合は見ない）
        //   猫背のまま走り出したときの、線より上の分 ＝ 差 + 体ごと −（min(差 + 体ごと, poseCap) + 線の幅）
        const width = widthOf(theta)
        const over = theta + body - (Math.min(theta + body, p.poseCap) + width)
        checks.push(() => {
          if (sc.label === '胸を開いたまま走る' && body <= p.poseCap) expect(med(outNew), label).toBe(0)
          if (sc.label.startsWith('猫背のまま走り出し')) {
            expect(med(inOld), label).toBe(0) // 今までは、猫背を基準にして知らせない
            if (over >= 3) expect(med(inNew), label).toBeGreaterThanOrEqual(10) // 2つの立ち方なら知らせる
            if (over >= 3 && sc.label.endsWith('そのまま')) expect(slip('neu'), label).toBe(0) // 猫背のまま走り続けても、ずれとみなさない
          }
          if (sc.label.startsWith('胸を開いて走り出し') && width <= theta - 3) expect(med(inNew), label).toBeGreaterThanOrEqual(10)
        })
      }
    }
    lines.push('')
  }
  writeFileSync(new URL('./result-pose.md', import.meta.url), lines.join('\n'))
  for (const c of checks) c()
})
