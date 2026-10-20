// 着地の仮想実験の道具：研究データの走りを、仮想のスマホで映して骨格のコマにする（sim/landing.sim.ts と、確かめの道具で使う）
//   pipeline.ts の film() は1コマずつの判定の値しか残さないので、ここでは骨格の点そのものを残す
//   コマの間隔は、毎秒のコマ数か、実機の記録の間隔（LOG_DT）。点のぶれ・奥の脚の寄り・左右の取り違えは camera.ts の toFrame と同じ。
//   なめらかにするのはアプリと同じ One Euro（骨格を取ったあと、判定の前）
import { makeCamera, toFrame, rng, H, type Placement, type Noise, type Body } from './camera'
import { BASE, BASE_NOISE } from './pipeline'
import { OneEuro } from '../src/modes/camera/filter'
import { bodyVisible } from '../src/modes/camera/motion'
import { jointAt, type LandingTrial } from './landing-data'
import { LandingMeter } from './landing'
import type { Source } from './longrun'
import type { Frame } from '../src/core/types'

// 実機の記録（2026-10-19 のトレッドミル、ふつう2 の9分、iPhone 12 mini）のコマの間隔（秒）と割合。平均で毎秒12.5コマ、2割ほどは1コマ抜ける
export const LOG_DT: [number, number][] = [
  [0.06, 0.273], [0.07, 0.494], [0.08, 0.037], [0.09, 0.001], [0.11, 0.002], [0.12, 0.02], [0.13, 0.117], [0.14, 0.054], [0.15, 0.002],
]
const logDt = (u: number) => {
  let acc = 0
  const tot = LOG_DT.reduce((a, x) => a + x[1], 0)
  for (const [d, p] of LOG_DT) {
    acc += p / tot
    if (u <= acc) return d
  }
  return 0.07
}

const KEYS = ['hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL', 'heelR', 'heelL', 'toeR', 'toeL', 'pelvis', 'shR', 'shL', 'ear', 'nose', 'earR', 'earL'] as const
export function bodyAt(src: Source, t: number): Body {
  const b: Partial<Record<(typeof KEYS)[number], unknown>> = {}
  for (const k of KEYS) {
    const js = src.joints[k as keyof Source['joints']]
    if (js) b[k] = jointAt(js, src.fps, t)
  }
  return b as Body
}

export interface FilmOpts {
  timing: number | 'log' // 毎秒のコマ数か、実機の記録の間隔
  pl?: Partial<Placement>
  noise?: Partial<Noise>
  smooth?: boolean // アプリと同じ One Euro でなめらかにする（ふつうは true）
  seed: number
}

// 映す：見えたコマだけを返す（アプリは見えないコマを判定に使わない）
export function filmFrames(body: (t: number) => Body, t0: number, sec: number, o: FilmOpts): { t: number; f: Frame }[] {
  const pl = { ...BASE, ...o.pl }
  const noise = { ...BASE_NOISE, ...o.noise }
  const cam = makeCamera(pl, body(t0).pelvis)
  const r = rng(o.seed)
  const rt = rng(o.seed + 31337)
  const st = { ar: [] as number[], swap: 0 }
  const filters = Array.from({ length: 66 }, () => new OneEuro())
  const out: { t: number; f: Frame }[] = []
  for (let t = t0; t < t0 + sec; ) {
    const dt = o.timing === 'log' ? logDt(rt.u()) : 1 / o.timing
    let f = toFrame(body(t), cam, noise, st, r, dt)
    if (o.smooth !== false) f = f.map((p, k) => ({ x: filters[k * 2].filter(p.x, t), y: filters[k * 2 + 1].filter(p.y, t), v: p.v }))
    if (bodyVisible(f, 0.5, H)) out.push({ t, f })
    t += dt
  }
  return out
}

export function meterOf(frames: { t: number; f: Frame }[], mode: 'lead' | 'label' = 'lead') {
  const m = new LandingMeter(mode)
  for (const { t, f } of frames) m.update(f, t)
  return m
}

export function runningSpan(tr: LandingTrial, maxSec = 60): [number, number] {
  const cs = tr.contacts
  let best = [0, 0]
  for (let i = 0, s = 0; i < cs.length; i++) {
    const ok = i > 0 && cs[i].on - cs[i - 1].on >= 0.2 && cs[i].on - cs[i - 1].on <= 0.6
    if (!ok) s = i
    if (i - s > best[1] - best[0]) best = [s, i]
  }
  const t0 = cs[best[0]].on + 0.5
  return [t0, Math.min(cs[best[1]].on - 0.5, t0 + maxSec)]
}

