import { describe, expect, it } from 'vitest'
import { legacyCycle, strideCycle, type TimedFrame } from './stride'
import { demoStride, DEMO_FRAMES } from './ui/figure'
import { L } from './landmarks'
import type { Frame, Stride } from '../../core/types'

// 見本の走り（1周 DEMO_FRAMES コマを毎秒30コマ）を、時刻 t の形として取る（コマの間はまっすぐつなぐ）
const demo = demoStride()
const SEC = DEMO_FRAMES / 30
function at(t: number): Frame {
  const s = (((t / SEC) % 1) + 1) % 1 * DEMO_FRAMES
  const i = Math.floor(s) % DEMO_FRAMES
  const k = (i + 1) % DEMO_FRAMES
  const u = s - Math.floor(s)
  return demo[i].map((p, q) => ({ x: p.x + (demo[k][q].x - p.x) * u, y: p.y + (demo[k][q].y - p.y) * u, v: p.v }))
}
// 決まった乱数（テストが毎回同じになるように）
function rng(seed: number) {
  let x = seed
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}
const LEGS: [number, number][] = [
  [L.leftKnee, L.rightKnee],
  [L.leftAnkle, L.rightAnkle],
  [L.leftHeel, L.rightHeel],
  [L.leftFoot, L.rightFoot],
]
const swapLegs = (f: Frame, pairs = LEGS): Frame => {
  const o = f.slice()
  for (const [a, b] of pairs) [o[a], o[b]] = [f[b], f[a]]
  return o
}
const leg = 164
const dist = (a: Frame, b: Frame, q: number) => Math.hypot(a[q].x - b[q].x, a[q].y - b[q].y)
const LEG_POINTS = [L.leftKnee, L.leftAnkle, L.leftFoot, L.rightKnee, L.rightAnkle, L.rightFoot]
// 1周をくり返したときの、つなぎ目の跳び（脚の点の一番大きい動き）と、ふつうのコマの動きの一番大きいもの
function seam(fs: Frame[]) {
  const step = (a: Frame, b: Frame) => Math.max(...LEG_POINTS.map((q) => dist(a, b, q)))
  const steps = fs.slice(1).map((f, i) => step(fs[i], f))
  return { seam: step(fs[fs.length - 1], fs[0]), maxStep: Math.max(...steps) }
}

describe('走り姿の1周（stride.ts）', () => {
  // 実機に近い記録：毎秒13コマ前後（間隔がばらつく）、点に小さなぶれ、奥の脚は大きくぶれ、ときどき左右の名前が入れ替わる
  function recorded(sec: number, seed = 1): TimedFrame[] {
    const r = rng(seed)
    const out: TimedFrame[] = []
    for (let t = 0; t < sec; t += 0.06 + 0.03 * r()) {
      let f = at(t).map((p) => ({ x: p.x + (r() - 0.5) * 3, y: p.y + (r() - 0.5) * 3, v: p.v }))
      for (const q of [L.rightKnee, L.rightAnkle, L.rightFoot, L.rightElbow, L.rightWrist]) f[q] = { ...f[q], x: f[q].x + (r() - 0.5) * 30, y: f[q].y + (r() - 0.5) * 20 }
      if (r() < 0.08) f = swapLegs(f)
      else if (r() < 0.05) f = swapLegs(f, [[L.leftKnee, L.rightKnee]])
      out.push({ frame: f, t })
    }
    return out
  }

  it('ちょうど1周（毎秒30コマで実際の速さ）を作り、くり返してもつなぎ目で跳ばない', () => {
    const c = strideCycle(recorded(8), 1)!
    expect(c).not.toBeNull()
    expect(c.sec).toBeCloseTo(SEC, 1)
    expect(c.frames.length).toBe(DEMO_FRAMES)
    expect(c.cycles).toBeGreaterThanOrEqual(8)
    const s = seam(c.frames)
    expect(s.seam).toBeLessThan(s.maxStep * 1.2)
  })

  it('左右の取り違えと奥の脚のぶれがあっても、見本の形に近い（手前の足首・膝、奥の足首）', () => {
    const c = strideCycle(recorded(8, 7), 1)!
    expect(c.swapped).toBeGreaterThan(0)
    // 区切りは手前の足首が一番前の瞬間なので、見本もそこから始めて比べる
    const top = demo.reduce((b, f, i) => (f[L.leftAnkle].x > demo[b][L.leftAnkle].x ? i : b), 0)
    const ref = demo.slice(top).concat(demo.slice(0, top))
    const hip = (f: Frame) => ({ x: (f[L.leftHip].x + f[L.rightHip].x) / 2, y: (f[L.leftHip].y + f[L.rightHip].y) / 2 })
    let worst = 0
    let sum = 0
    let cnt = 0
    c.frames.forEach((f, j) => {
      const g = ref[j]
      for (const q of [L.leftAnkle, L.leftKnee, L.rightAnkle, L.rightKnee]) {
        const a = { x: f[q].x - hip(f).x, y: f[q].y - hip(f).y }
        const b = { x: g[q].x - hip(g).x, y: g[q].y - hip(g).y }
        const e = Math.hypot(a.x - b.x, a.y - b.y) / leg
        worst = Math.max(worst, e)
        sum += e
        cnt++
      }
    })
    // 区切りの位相のずれ（半コマ以内）となめらかにした分を見込む。脚の長さに対する割合
    expect(sum / cnt).toBeLessThan(0.04)
    expect(worst).toBeLessThan(0.12)
  })

  it('1周がはっきりしない（止まっている）区間からは作らない', () => {
    const still = Array.from({ length: 100 }, (_, i) => ({ frame: demo[0], t: i / 13 }))
    expect(strideCycle(still, 1)).toBeNull()
  })

  it('前の記録（1.2秒を36コマ、後半で手前の脚が崩れた）を、表示するときに1周に直す', () => {
    const frames = Array.from({ length: 36 }, (_, i) => at((1.2 * i) / 35))
    // 後半は、手前の足首・つま先・かかとが奥の脚に重なってしまった（実機の記録で見た崩れ）
    for (let i = 22; i < 36; i++) for (const [a, b] of LEGS.slice(1)) frames[i] = frames[i].map((p, q) => (q === a ? { ...frames[i][b] } : p))
    const s: Stride = { frames, dir: 1, score: 100, avg: { head: 0, trunk: 7, body: 9, hipDrop: 0 } }
    const before = seam(frames)
    const out = legacyCycle(s, SEC)
    expect(out.length).toBe(DEMO_FRAMES)
    const after = seam(out)
    expect(before.seam).toBeGreaterThan(after.seam * 3)
    expect(after.seam).toBeLessThan(after.maxStep * 1.2)
    // 1周の長さが分からなくても、手前の足首の動きから決める
    expect(legacyCycle({ ...s, frames: Array.from({ length: 36 }, (_, i) => at((1.2 * i) / 35)) }).length).toBe(DEMO_FRAMES)
  })
})
