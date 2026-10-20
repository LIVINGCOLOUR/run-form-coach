// 仮想実験の道具：長い走りを仮想のスマホで映し、アプリと同じ順（なめらかにする → 全身が見えるか → 測る → 走っているか）で
// 1コマずつの測定を作り、今のコーチ（Coach）に通して声かけを数える
//   映すのは毎秒15コマ。骨格の点はアプリと同じ One Euro フィルターでなめらかにする
//   コーチに通すときは、アプリのふだんと同じく、安定して走れている間は骨格を取らない（10秒のうち3秒だけ見る）。
//   取らなかったコマは時間だけ進める（Live.tsx の onSkip と同じ）
import { makeCamera, toFrame, rng, W, H, type Placement, type Noise, type Body } from './camera'
import { OneEuro } from '../src/modes/camera/filter'
import { bodyVisible, MotionDetector } from '../src/modes/camera/motion'
import { levelFrame, measure, rotateFrame } from '../src/modes/camera/geometry'
import { Coach } from '../src/modes/camera/coach'
import type { CueRecord } from '../src/core/engine'
import type { ItemKey } from '../src/core/types'
import type { Frame } from '../src/core/types'

export const FPS = 15
export const BASE: Placement = { yaw: 0, dist: 1.2, height: 0.8, roll: 0, vfov: 106, k1: 0 }
export const BASE_NOISE: Noise = { sigma: 0.01, collapse: 0.3, swapPerSec: 0.5 }

// 1コマの記録：t, 見えたか, 走っているか, neck, headLean, yaw, trunk, body, hipRatio, dir, chin
const F = 11
export interface Stream {
  n: number
  d: Float32Array
}

// extra：測った値に足す、ゆっくり変わるずれ（[大きさ（度）, 続く長さ（秒）]）。実機の記録のばらつきに合わせるためのもの
//   （研究データの走りは1分ほどで、数分かけての揺れが入らない。骨格の推定の、服や光によるゆっくりしたずれも入らない）
export interface Extra {
  neck?: [number, number]
  trunk?: [number, number]
  body?: [number, number]
}
export interface FilmOpts {
  sec: number
  seed: number
  pl?: Placement
  noise?: Noise
  body: (t: number) => Body
  extra?: Extra
}

export function film(o: FilmOpts): Stream {
  const pl = o.pl ?? BASE
  const noise = o.noise ?? BASE_NOISE
  const cam = makeCamera(pl, o.body(0).pelvis)
  const r = rng(o.seed)
  const rs = rng(o.seed + 7919)
  const st = { ar: [] as number[], swap: 0 }
  const filters = Array.from({ length: 66 }, () => new OneEuro())
  const md = new MotionDetector()
  const n = Math.floor(o.sec * FPS)
  const d = new Float32Array(n * F)
  const ex = { neck: 0, trunk: 0, body: 0 }
  const keys = ['neck', 'trunk', 'body'] as const
  // 最初の値も、続いているときと同じ散らばりから取る
  for (const k of keys) if (o.extra?.[k]) ex[k] = o.extra[k]![0] * rs.gauss()
  for (let i = 0; i < n; i++) {
    const t = i / FPS
    const b = o.body(t)
    for (const k of keys) {
      const e = o.extra?.[k]
      if (!e) continue
      const a = Math.exp(-1 / FPS / e[1])
      ex[k] = a * ex[k] + Math.sqrt(1 - a * a) * e[0] * rs.gauss()
    }
    let f: Frame = toFrame(b, cam, noise, st, r, 1 / FPS)
    if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
    f = f.map((p, k) => ({ x: filters[k * 2].filter(p.x, t), y: filters[k * 2 + 1].filter(p.y, t), v: p.v }))
    const vis = bodyVisible(f, 0.5, H)
    const j = i * F
    d[j] = t
    d[j + 1] = vis ? 1 : 0
    if (vis) {
      const m = measure(f)
      d[j + 2] = md.update(f, t) ? 1 : 0
      d[j + 3] = m.neck + ex.neck
      d[j + 4] = m.headLean + ex.neck
      d[j + 5] = m.yaw
      d[j + 6] = m.trunk + ex.trunk
      d[j + 7] = m.body + ex.body
      d[j + 8] = m.hipRatio
      d[j + 9] = m.dir
      d[j + 10] = m.chin
    }
  }
  return { n, d }
}

export interface Replay {
  cues: CueRecord<ItemKey>[] // t は絶対の時刻（秒）に直したもの。lead は正しいフォームの線で言った声（整える・直った・整った）
  runFrom: number // 走り始め（コーチが走っているとみなした時刻）
  refAt: number | null // 今日の基準（整えたあとの形）ができた時刻
  formAt: number | null // 整え終わった時刻
  ref: Coach['leanRef'] // 今日の基準の値
  quietSec: [number, number][] // 声なしで見守っていた時間（絶対の時刻）
  // 1秒ごとの判定の値（今日の基準からの崩れ。基準ができるまでの trunk・body は傾きそのもの）と、傾きそのもの（raw…）
  values: { t: number; head?: number; trunk?: number; body?: number; hip?: number; trunkBack?: number; bodyBack?: number; chin?: number; rawTrunk: number; rawBody: number }[]
}

// thin：アプリのふだんの間引き（false なら全コマ記録 ?full=1 と同じ）
// mute：items のほかの項目は、大きく崩れても声をかけない（データに頭や上体がなく、作りものの点で測る項目を外すとき）
export function replay(s: Stream, opts: { items?: ItemKey[]; thin?: boolean; mute?: boolean } = {}): Replay {
  // Coach は受け取った設定をそのまま声かけのしくみ（CueEngine）に渡す。muteOthers は Coach の型にないので広げて渡す
  const coach = new Coach({ pause: false, items: opts.items, ...(opts.mute ? { muteOthers: true } : {}) } as ConstructorParameters<typeof Coach>[0])
  const thin = opts.thin ?? true
  let lastPresent = true
  let lastMoving = false
  let runFrom = -1
  let refAt: number | null = null
  let formAt: number | null = null
  const quietSec: [number, number][] = []
  let quietFrom = -1
  const values: Replay['values'] = []
  let nSamples = 0
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    const t = s.d[j]
    if (thin && coach.state === 'running' && lastPresent && !coach.wantsDetail()) {
      coach.update({ t, present: lastPresent, moving: lastMoving })
    } else {
      const present = s.d[j + 1] === 1
      const moving = present && s.d[j + 2] === 1
      const m = present
        ? { neck: s.d[j + 3], headLean: s.d[j + 4], yaw: s.d[j + 5], trunk: s.d[j + 6], body: s.d[j + 7], hipRatio: s.d[j + 8], dir: (s.d[j + 9] >= 0 ? 1 : -1) as 1 | -1, chin: s.d[j + 10] }
        : undefined
      coach.update({ t, present, moving, m })
      lastPresent = present
      lastMoving = moving
    }
    if (runFrom < 0 && coach.state === 'running') runFrom = t - coach.active
    if (refAt === null && coach.leanRef) refAt = t
    if (formAt === null && coach.formDone) formAt = t
    if (coach.quiet && quietFrom < 0) quietFrom = t
    if (!coach.quiet && quietFrom >= 0) {
      quietSec.push([quietFrom, t])
      quietFrom = -1
    }
    if (coach.samples.length > nSamples) {
      nSamples = coach.samples.length
      const sm = coach.samples[nSamples - 1]
      const tt = runFrom + sm.t
      values.push({ t: tt, head: coach.leanRef ? sm.head : undefined, trunk: sm.judge?.trunk ?? sm.trunk, body: sm.judge?.body ?? sm.body, hip: sm.hipDrop, trunkBack: sm.back?.trunk, bodyBack: sm.back?.body, chin: sm.chin, rawTrunk: sm.trunk, rawBody: sm.body })
    }
  }
  if (quietFrom >= 0) quietSec.push([quietFrom, s.d[(s.n - 1) * F]])
  return { cues: coach.cues.map((c) => ({ ...c, t: runFrom + c.t })), runFrom, refAt, formAt, ref: coach.leanRef, quietSec, values }
}

// 1秒ごとの値の生の数字（頭・上体・体全体・腰の高さ）を、1秒平均で出す（ばらつきを実機と比べるため）
export function perSecond(s: Stream, from: number, to: number) {
  const out: { neck: number; trunk: number; body: number; hipRatio: number }[] = []
  let acc: number[][] = []
  let sec = Math.floor(from)
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    const t = s.d[j]
    if (t < from || t >= to) continue
    if (Math.floor(t) !== sec) {
      if (acc.length >= 3) out.push({ neck: avg(acc, 0), trunk: avg(acc, 1), body: avg(acc, 2), hipRatio: avg(acc, 3) })
      acc = []
      sec = Math.floor(t)
    }
    if (s.d[j + 1] === 1) acc.push([s.d[j + 3], s.d[j + 6], s.d[j + 7], s.d[j + 8]])
  }
  return out
}
const avg = (a: number[][], k: number) => a.reduce((s, x) => s + x[k], 0) / a.length
