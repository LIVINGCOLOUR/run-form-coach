// 人の動画で今のカメラ版の判定を試す（2）：landmarks.mjs の点を、アプリと同じ順（なめらかにする → 全身が見えるか → 測る →
// 走っているか）で1コマずつ測り、1秒ごとの値と、区間（悪い例・よい例）ごとのまとめを出す。run.mjs から rolldown で読む。
// アプリ本体（src/）は読むだけで変えない
//
// 短い動画（1つの例が数秒〜20秒）では、走り始め（30秒〜3分）の基準ができないので、2つのやり方で見る
//   compare()：よい例を走り始めの基準とみなして、悪い例との差を、今の声をかける線と比べる（線の値は params.ts から読む）
//   coachSim()：区間のコマをくり返して長い走りを作り、今のコーチ（Coach）にそのまま通す。
//     good→bad：よい例を240秒（その間に基準ができる）→ 悪い例を60秒。bad only：悪い例だけを240秒（決まった線と HEAD_ABS）
//     くり返しのつなぎ目で骨格がとぶので、走っているかは「走っている」とみなして渡す（1コマずつの歩数の判定は別に数える）
// 測るだけの値（判定には使っていない）：
//   顎：手前側の耳→鼻の線の、水平からの上向き（度。geometry の measure の chin）。鼻が耳より下なら負。
//     アプリが記録する顎の値は、走り始めからの変化に上体の変化を足したもの（compare の chinAdj と同じ）
//   着地：アプリのスロー分析（slowmo.ts の analyzeRun）にそのまま通した、着地の瞬間の足首の前（÷ 脚の長さ）とすねの角度
//     （足首が膝より前に出て着くほど正）。なめらかにしない点を使う（スロー分析と同じ）。毎秒30コマ以上で取った点で見る。
//     スローの倍率も analyzeRun が足のリズムから決める（1 でなければ、その区間はスロー再生）
import { OneEuro } from '../../src/modes/camera/filter'
import { bodyVisible, MotionDetector } from '../../src/modes/camera/motion'
import { measure } from '../../src/modes/camera/geometry'
import { L } from '../../src/modes/camera/landmarks'
import { Coach, headForward } from '../../src/modes/camera/coach'
import { HEAD_ABS, LIMITS, REL_LIMITS } from '../../src/modes/camera/params'
import { CUE } from '../../src/core/params'
import { analyzeRun, type TimedFrame } from '../../src/modes/camera/slowmo'
import type { Frame } from '../../src/core/types'
import type { Measure } from '../../src/modes/camera/types'

export interface LandmarkClip {
  id: string
  fps: number
  width: number
  height: number
  frames: { t: number; p: [number, number, number][] | null }[]
}

export interface Tick {
  t: number
  detected: boolean
  visible: boolean
  moving: boolean // MotionDetector の1コマずつの判定
  cadence: number | null
  m?: Measure
  chin?: number
  feetCut: boolean // 足（かかと・つま先）が画面の下の端にかかっている
  keyVis: number // 腰・膝・足首の確からしさの平均
}

// アプリの runPose → onTick と同じ順で1コマずつ測る
export function track(c: LandmarkClip): Tick[] {
  const filters = Array.from({ length: 66 }, () => new OneEuro())
  const md = new MotionDetector()
  const out: Tick[] = []
  for (const fr of c.frames) {
    const t = fr.t
    if (!fr.p) {
      out.push({ t, detected: false, visible: false, moving: false, cadence: null, feetCut: false, keyVis: 0 })
      continue
    }
    const f: Frame = fr.p.map(([x, y, v], i) => ({ x: filters[i * 2].filter(x * c.width, t), y: filters[i * 2 + 1].filter(y * c.height, t), v }))
    const visible = bodyVisible(f, 0.5, c.height)
    const tick: Tick = { t, detected: true, visible, moving: false, cadence: null, feetCut: false, keyVis: 0 }
    const keys = [L.leftHip, L.rightHip, L.leftKnee, L.rightKnee, L.leftAnkle, L.rightAnkle]
    tick.keyVis = keys.reduce((s, k) => s + f[k].v, 0) / keys.length
    const footY = Math.max(...[L.leftHeel, L.rightHeel, L.leftAnkle, L.rightAnkle, 31, 32].map((k) => f[k].y))
    tick.feetCut = footY > c.height * 0.985
    if (visible) {
      const m = measure(f)
      tick.m = m
      tick.moving = md.update(f, t)
      tick.cadence = md.cadence
      tick.chin = m.chin
    }
    out.push(tick)
  }
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs: number[]) => {
  const m = mean(xs)
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : NaN
}
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

export interface Second {
  t: number
  n: number
  neck: number
  headLean: number
  yaw: number
  trunk: number
  body: number
  hipRatio: number
  chin: number
}

// CameraAnalyzer.second と同じく、見えたコマが3つ以上ある秒の平均
export function perSecond(ticks: Tick[], from: number, to: number): Second[] {
  const out: Second[] = []
  for (let s = Math.floor(from); s < to; s++) {
    const b = ticks.filter((k) => k.m && k.t >= Math.max(s, from) && k.t < Math.min(s + 1, to))
    if (b.length < 3) continue
    const g = (f: (m: Measure, k: Tick) => number) => mean(b.map((k) => f(k.m!, k)))
    out.push({ t: s, n: b.length, neck: g((m) => m.neck), headLean: g((m) => m.headLean), yaw: g((m) => m.yaw), trunk: g((m) => m.trunk), body: g((m) => m.body), hipRatio: g((m) => m.hipRatio), chin: g((_, k) => k.chin!) })
  }
  return out
}

// 着地：アプリのスロー分析にそのまま通す（なめらかにしない点。見えていないコマは除く）
export function contacts(c: LandmarkClip, from: number, to: number) {
  const frames: TimedFrame[] = c.frames
    .filter((fr) => fr.p && fr.t >= from && fr.t < to)
    .map((fr) => ({ t: fr.t, f: fr.p!.map(([x, y, v]) => ({ x: x * c.width, y: y * c.height, v })) }))
    .filter(({ f }) => bodyVisible(f, 0.5, c.height))
  const r = analyzeRun(frames, 1) // 人の動画はスローではない（倍率を足のリズムから決めさせると、毎秒30コマでは 4〜16倍と読み違えた）
  return r && { slow: r.slow, n: r.contacts.length, footAhead: r.footAheadAtContact, shank: r.shankAtContact, contactMs: r.contactMs, cadence: r.cadence }
}

export interface WindowStat {
  from: number
  to: number
  frames: number
  visibleRatio: number
  movingRatio: number
  feetCutRatio: number
  keyVis: number
  dir: number // 進む向き（平均。±1 に近いほど安定）
  seconds: number
  cadence: number
  neck: number
  neckSd: number
  headLean: number
  yaw: number
  trunk: number
  trunkSd: number
  body: number
  bodySd: number
  hipRatio: number
  hipSd: number
  chin: number
  chinSd: number
}

export function windowStat(ticks: Tick[], from: number, to: number): WindowStat {
  const w = ticks.filter((k) => k.t >= from && k.t < to)
  const vis = w.filter((k) => k.m)
  const secs = perSecond(ticks, from, to)
  const col = (k: keyof Second) => secs.map((s) => s[k] as number)
  return {
    from,
    to,
    frames: w.length,
    visibleRatio: vis.length / Math.max(1, w.length),
    movingRatio: vis.filter((k) => k.moving).length / Math.max(1, vis.length),
    feetCutRatio: w.filter((k) => k.feetCut).length / Math.max(1, w.length),
    keyVis: mean(w.filter((k) => k.detected).map((k) => k.keyVis)),
    dir: mean(vis.map((k) => k.m!.dir)),
    seconds: secs.length,
    cadence: median(vis.map((k) => k.cadence).filter((x): x is number => x !== null)),
    neck: mean(col('neck')),
    neckSd: sd(col('neck')),
    headLean: mean(col('headLean')),
    yaw: mean(col('yaw')),
    trunk: mean(col('trunk')),
    trunkSd: sd(col('trunk')),
    body: mean(col('body')),
    bodySd: sd(col('body')),
    hipRatio: mean(col('hipRatio')),
    hipSd: sd(col('hipRatio')),
    chin: mean(col('chin')),
    chinSd: sd(col('chin')),
  }
}

// よい例を走り始めの基準とみなしたときの、悪い例の判定の値と、今の線（声をかける線）
export const LINES = {
  head: LIMITS.head.cue,
  trunkRel: REL_LIMITS.trunk.cue,
  bodyRel: REL_LIMITS.body.cue,
  trunkBackRel: REL_LIMITS.trunkBack.cue,
  bodyBackRel: REL_LIMITS.bodyBack.cue,
  hip: LIMITS.hip.cue,
  trunkAbs: LIMITS.trunk.cue,
  bodyAbs: LIMITS.body.cue,
  headAbs: HEAD_ABS.line,
  headAbsOn: HEAD_ABS.on,
  headAbsYaw: HEAD_ABS.yawMax,
  window: CUE.window,
}
// head：アプリが頭に使う値（首の角度の増えと、頭の位置そのものの増えの小さいほう）。neck・headLean はそれぞれの増え
export function compare(bad: WindowStat, good: WindowStat) {
  const neck = bad.neck - good.neck
  const headLean = bad.headLean - good.headLean
  const head = headForward(neck, headLean)
  const trunk = bad.trunk - good.trunk
  const body = bad.body - good.body
  const hip = ((good.hipRatio - bad.hipRatio) / good.hipRatio) * 100 // 腰の下がり（%）。上がったときは負
  const chin = bad.chin - good.chin
  return {
    head,
    neck,
    headLean,
    trunk,
    body,
    hip,
    chin,
    chinAdj: chin + trunk, // 上体が起きた分（頭も上体といっしょに回る）を差し引いた顎
    cues: {
      head: head >= LINES.head,
      trunk: trunk >= LINES.trunkRel,
      trunkBack: -trunk >= LINES.trunkBackRel,
      body: body >= LINES.bodyRel,
      bodyBack: -body >= LINES.bodyBackRel,
      hip: hip >= LINES.hip,
    },
  }
}

// 区間のコマをくり返して長い走りにし、今のコーチに通す（pipeline.ts の replay と同じく、ふだんの間引きをする）
export function coachSim(ticks: Tick[], parts: { from: number; to: number; sec: number }[]) {
  const fps = 15
  const coach = new Coach({ pause: false })
  const seq: { m?: Measure; present: boolean }[][] = parts.map((p) => ticks.filter((k) => k.t >= p.from && k.t < p.to).map((k) => ({ m: k.m, present: !!k.m })))
  let t = 0
  const switchAt: number[] = []
  let lastPresent = true
  let refAt: number | null = null
  for (let pi = 0; pi < parts.length; pi++) {
    switchAt.push(t)
    const s = seq[pi]
    const n = Math.round(parts[pi].sec * fps)
    for (let i = 0; i < n; i++, t += 1 / fps) {
      const k = s[i % s.length]
      if (coach.state === 'running' && lastPresent && !coach.wantsDetail()) {
        coach.update({ t, present: lastPresent, moving: true })
        if (refAt === null && coach.leanRef) refAt = t
        continue
      }
      coach.update({ t, present: k.present, moving: k.present, m: k.m })
      lastPresent = k.present
      if (refAt === null && coach.leanRef) refAt = t
    }
  }
  const runFrom = t - coach.active
  const ref = coach.leanRef
  return {
    switchAt,
    ref,
    refAt,
    // 基準ができたときの「最初から頭が前に出ている」（HEAD_ABS）の声は headAbs として分ける
    cues: coach.cues.map((c) => {
      const tt = runFrom + c.t
      const item = c.item === 'head' && refAt !== null && Math.abs(tt - refAt) < 1.5 ? 'headAbs' : c.item
      return { t: +tt.toFixed(1), item }
    }),
  }
}
