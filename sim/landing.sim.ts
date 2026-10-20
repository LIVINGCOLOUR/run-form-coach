// 仮想実験（着地が体より前か＝オーバーストライド）：研究データの走りを、毎秒13〜15コマの仮想のスマホで映し、
//   走りながらの骨格から測れる「足首が一番前に出た瞬間の、かかと・足首の前」などが、着地の本当の値（3次元の点と床反力）とどれだけ合うかを見る。
//   測り方は sim/landing.ts、研究データの読み込みと本当の値は sim/landing-data.ts、映し方は sim/landing-film.ts
//   ① 本当の値（着地の瞬間）と、ブレーキの力積との関係
//   ② 人と速さ・条件をまたいだ、見積もりと本当の値の相関（毎秒60・30・15・13コマ、実機の記録のコマの間隔、点のぶれ、なめらかにするか、左右の取り違え）
//   ③ 同じ人の中での変化（速さ、同じ速さでピッチを下げる・上げる、上体を倒す）を、見積もりが同じ向きに追うか
//   ④ 速さの目安（接地している足首が後ろへ動く速さ）と、速さを考えた決まった線
//   ⑤ 長い走り（10分）での、今日の基準からの増えの揺れ（誤った声）と、途中でピッチを下げた・速さを上げたときに線を越えるか
//   ⑥ 短いスロー撮影（毎秒30〜120コマ）で着地の瞬間を見つけて測る（アプリのスロー分析）のと比べて
// 動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… VH_CAD_DIR=… npx vitest run --config sim/vitest.config.ts sim/landing.sim.ts
//   VH_CAD_DIR は Van Hooren のピッチの条件（Sub_XX_lowfreq.c3d・highfreq.c3d、OSF 7qbxc の「0. C3D files」から取った）。
//   LANDING_CACHE=<json> を付けると、映した結果をためて、2回目からはまとめだけを書き直す（数分 → 1秒）
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRbdsLanding, loadRigletLanding, loadVhLanding, truthOfContacts, type LandingTrial, type ContactTruth } from './landing-data'
import { summarize, hipSway, speedOf, type Feature, type Peak } from './landing'
import { bodyAt, filmFrames, meterOf, runningSpan, type FilmOpts } from './landing-film'
import { LongRun } from './longrun'
import { analyzeRun } from '../src/modes/camera/slowmo'

const RBDS = process.env.RBDS_DIR
const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const VH_CAD = process.env.VH_CAD_DIR
const CACHE = process.env.LANDING_CACHE
const OUT = process.env.SIM_OUT ?? 'sim/result-landing.md'
const ANY = !!(RBDS || RIGLET || VH || VH_CAD)

// ---- 研究データを読む ----
function loadAll(): LandingTrial[] {
  const out: LandingTrial[] = []
  const tryPush = (fn: () => LandingTrial, what: string) => {
    try {
      const tr = fn()
      if (tr.contacts.length < 10) throw new Error(`接地が ${tr.contacts.length} 回しかありません`)
      out.push(tr)
    } catch (e) {
      console.log(`使えない：${what}：${(e as Error).message}`)
    }
  }
  if (RBDS) {
    const ids = [...new Set(readdirSync(RBDS).filter((f) => /^RBDS\d+static\.txt$/.test(f)).map((f) => f.slice(0, 7)))].sort()
    for (const id of ids) for (const sp of ['25', '35', '45']) if (existsSync(join(RBDS, `${id}runT${sp}forces.txt`))) tryPush(() => loadRbdsLanding(RBDS, id, sp), `${id} ${sp}`)
  }
  if (RIGLET) {
    for (const id of readdirSync(RIGLET).sort()) {
      for (const [pace, cond] of [['Comfortable', '楽'], ['Fast', '速い']]) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (existsSync(p)) tryPush(() => loadRigletLanding(p, id, cond), `${id} ${pace}`)
      }
    }
  }
  const vhFiles = (dir: string | undefined, re: RegExp, cond: string) => {
    if (!dir) return
    for (const f of readdirSync(dir).sort()) if (re.test(f)) tryPush(() => loadVhLanding(join(dir, f), f.slice(0, 6), cond), f)
  }
  vhFiles(VH, /^Sub_\d+_333(ms)?\.c3d$/i, '333')
  vhFiles(VH, /^Sub_\d+_trunklean\.c3d$/i, 'trunklean')
  vhFiles(VH_CAD, /^Sub_\d+_lowfreq\.c3d$/i, 'lowfreq')
  vhFiles(VH_CAD, /^Sub_\d+_highfreq\.c3d$/i, 'highfreq')
  return out
}

// ---- 1本ごとの記録（本当の値と、条件ごとの見積もり） ----
interface Est {
  med: Record<Feature, number>
  medAll: Record<Feature, number>
  medHi: Record<Feature, number>
  stepSec: number
  speedL: number // 速さの目安（接地している足首が後ろへ動く速さ、脚の長さ／秒）
  n: number
  nAll: number
  near: string
  strideSec: number
  fa: number
  vert: number
  win16: Record<Feature, number>[] // 16秒の窓（8秒ずつずらす）の中央値（手前の脚）
  win6: Record<Feature, number>[]
}
interface TrialRec {
  id: string
  subject: string
  dataset: string
  cond: string
  sec: number
  leg: number
  truthR: Record<string, number> // 右脚（仮想のスマホの手前）の着地の中央値
  truthAll: Record<string, number>
  truthFa: number // 腰の前後の揺れ（本当の点、1歩の周期の成分 ÷ 脚の長さ）
  truthVert: number
  cadence: number
  speed: number // ベルトの速さ（m/s）：接地の 30〜60% の間に、足首が後ろへ動く速さの中央値
  est: Record<string, Est>
  // アプリのスロー分析（slowmo.ts の analyzeRun）に、毎秒30・60・120コマのなめらかにしない点を通したときの、着地の瞬間の値
  ic: Record<string, { shank: number; ahead: number; n: number; seconds: number }>
}

const TRUTH_KEYS: (keyof ContactTruth)[] = ['heel', 'ankle', 'heelCom', 'shank', 'knee', 'kneeGap', 'legAng', 'reach', 'brakePeak', 'brakeImp', 'stance']
const medianOf = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

const CONDS: { key: string; label: string; o: Omit<FilmOpts, 'seed'>; mode?: 'lead' | 'label' }[] = [
  { key: 'f15', label: '毎秒15コマ・ぶれ1%（基準）', o: { timing: 15 } },
  { key: 'logLabel', label: '実機の間隔・左右の名前ごとに山を取る', o: { timing: 'log' }, mode: 'label' },
  { key: 'logSwap', label: '実機の間隔・左右の取り違え 毎秒2回', o: { timing: 'log', noise: { swapPerSec: 2 } } },
  { key: 'logSwapLabel', label: '実機の間隔・取り違え 毎秒2回・名前ごと', o: { timing: 'log', noise: { swapPerSec: 2 } }, mode: 'label' },
  { key: 'f13', label: '毎秒13コマ', o: { timing: 13 } },
  { key: 'log', label: '実機の記録のコマの間隔（平均12.5コマ、2割は1コマ抜け）', o: { timing: 'log' } },
  { key: 'log2', label: '実機の間隔・ぶれ2%', o: { timing: 'log', noise: { sigma: 0.02 } } },
  { key: 'logRaw', label: '実機の間隔・なめらかにしない', o: { timing: 'log', smooth: false } },
  { key: 'f30', label: '毎秒30コマ（参考）', o: { timing: 30 } },
  { key: 'f60', label: '毎秒60コマ（参考）', o: { timing: 60 } },
  { key: 'logLow', label: '実機の間隔・スマホが低い（50cm）', o: { timing: 'log', pl: { height: 0.5 } } },
]

function windows(peaks: Peak[], t0: number, t1: number, len: number, near: 'L' | 'R') {
  const out: Record<Feature, number>[] = []
  for (let s = t0; s + len <= t1; s += len / 2) {
    const w = summarize(peaks, s, s + len, near)
    if (w && w.n >= Math.max(3, Math.floor(len / 1.6))) out.push(w.med)
  }
  return out
}

function recordOf(tr: LandingTrial, k: number): TrialRec {
  const truth = truthOfContacts(tr)
  // 映す区間：接地が 0.2〜0.6 秒おきに続いている、いちばん長いところ（長い記録は、その最初の60秒まで）
  const [t0, t1] = runningSpan(tr)
  const inT = truth.filter((c) => c.t >= t0 && c.t <= t1)
  const agg = (cs: ContactTruth[]) => Object.fromEntries(TRUTH_KEYS.map((key) => [key, medianOf(cs.map((c) => c[key] as number))]))
  const R = inT.filter((c) => c.side === 'R')
  const strideR = medianOf(R.slice(1).map((c, i) => c.t - R[i].t))
  // 本当の腰の揺れ：3次元の腰の中心を、毎秒100コマで同じ式に通す
  const leg = (() => {
    const j = tr.joints
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const xs = j.hipR!.map((h, i) => d(h, j.kneeR![i]) + d(j.kneeR![i], j.ankleR![i]))
    return xs.reduce((a, b) => a + b, 0) / xs.length
  })()
  const track = []
  for (let t = t0; t < t1; t += 0.01) {
    const b = bodyAt(tr, t)
    const hx = (b.hipR[0] + b.hipL[0]) / 2
    const hy = (b.hipR[1] + b.hipL[1]) / 2
    track.push({ t, hx: hx / leg, hy: -hy / leg, sv: NaN })
  }
  const sway = hipSway(track, t0, t1, strideR)
  const speeds = inT.flatMap((c) => {
    const ct = tr.contacts.find((x) => x.on === c.t)
    if (!ct) return []
    const a = ct.on + 0.3 * (ct.off - ct.on)
    const b = ct.on + 0.6 * (ct.off - ct.on)
    const key = ct.side === 'R' ? 'ankleR' : 'ankleL'
    const pa = bodyAt(tr, a)[key]
    const pb = bodyAt(tr, b)[key]
    return [(pa[0] - pb[0]) / 1000 / (b - a)]
  })
  const est: Record<string, Est> = {}
  CONDS.forEach((c, ci) => {
    const frames = filmFrames((t) => bodyAt(tr, t), t0, t1 - t0, { ...c.o, seed: 1000 + 97 * k + ci })
    const m = meterOf(frames, c.mode)
    const s = summarize(m.peaks, t0, t1, 'R')
    const auto = summarize(m.peaks, t0, t1)
    if (!s) return
    const sw = hipSway(m.track, t0, t1, Number.isFinite(s.strideSec) ? s.strideSec : 2 * s.stepSec)
    est[c.key] = { med: s.med, medAll: s.medAll, medHi: s.medHi, stepSec: s.stepSec, speedL: speedOf(m.track, t0, t1), n: s.n, nAll: s.nAll, near: auto?.near ?? '-', strideSec: s.strideSec, fa: sw.fa, vert: sw.vert, win16: windows(m.peaks, t0, t1, 16, 'R'), win6: windows(m.peaks, t0, t1, 6, 'R') }
  })
  const ic: TrialRec['ic'] = {}
  for (const fps of [30, 60, 120]) {
    // 短い動画（10秒）を撮って分析する形。スロー分析は、着地を見つけた数が少ないと値が出ない
    const fr = filmFrames((t) => bodyAt(tr, t), t0, Math.min(10, t1 - t0), { timing: fps, smooth: false, seed: 3000 + 13 * k + fps })
    const rep = analyzeRun(fr, 1)
    ic[`slow${fps}`] = { shank: rep?.shankAtContact ?? NaN, ahead: rep?.footAheadAtContact ?? NaN, n: rep?.contacts.length ?? 0, seconds: Math.min(10, t1 - t0) }
  }
  return { id: tr.id, subject: tr.subject, dataset: tr.dataset, cond: tr.cond, sec: t1 - t0, leg, truthR: agg(R), truthAll: agg(inT), truthFa: sway.fa, truthVert: sway.vert, cadence: 120 / strideR, speed: medianOf(speeds), est, ic }
}

// ---- 長い走り（10分）での揺れと、ピッチを下げたとき ----
// 1本の記録から LongRun で10分の走りを作り、実機の記録のコマの間隔で映して、走り始め 30〜180 秒の中央値を今日の基準にし、
// そのあとの窓（6秒・16秒、2秒ずつずらす）の中央値の、基準からの増えを残す（声をかける線を決めるため）
const LONG_SEC = 600
const DRIFT_KEYS = ['heel', 'reach', 'shank'] as const
type DriftKey = (typeof DRIFT_KEYS)[number]
interface Drift {
  id: string
  dataset: string
  cond: string
  d16: Record<DriftKey, number[]>
  d6: Record<DriftKey, number[]>
  speed16: number[] // 窓の速さの目安 ÷ 基準の速さの目安 − 1
}
function driftOf(peaks: Peak[], track: ReturnType<typeof meterOf>['track'], from: number, to: number, ref: Record<DriftKey, number>, refSpeed: number) {
  const d16 = { heel: [] as number[], reach: [] as number[], shank: [] as number[] }
  const d6 = { heel: [] as number[], reach: [] as number[], shank: [] as number[] }
  const speed16: number[] = []
  for (let a = from; a + 16 <= to; a += 2) {
    const w = summarize(peaks, a, a + 16, 'R')
    if (w && w.n >= 5) for (const k of DRIFT_KEYS) d16[k].push(w.med[k] - ref[k])
    speed16.push(speedOf(track, a, a + 16) / refSpeed - 1)
    const w6 = summarize(peaks, a + 10, a + 16, 'R')
    if (w6 && w6.n >= 3) for (const k of DRIFT_KEYS) d6[k].push(w6.med[k] - ref[k])
  }
  return { d16, d6, speed16 }
}
function longOf(tr: LandingTrial, k: number): Drift | null {
  const run = new LongRun()
  try {
    run.append(tr, LONG_SEC, 4242 + k)
  } catch {
    return null
  }
  const frames = filmFrames((t) => run.at(t), 0, LONG_SEC, { timing: 'log', seed: 777 + k })
  const m = meterOf(frames)
  const r0 = summarize(m.peaks, 30, 180, 'R')
  if (!r0) return null
  const ref = { heel: r0.med.heel, reach: r0.med.reach, shank: r0.med.shank }
  return { id: tr.id, dataset: tr.dataset, cond: tr.cond, ...driftOf(m.peaks, m.track, 180, LONG_SEC, ref, speedOf(m.track, 30, 180)) }
}
// 同じ人の a の走り 300 秒のあとに b の走りを 120 秒つなぐ（VH：ピッチを上げた走り → 下げた走り。RBDS：秒速2.5m → 3.5m）
interface Switch {
  id: string
  kind: string
  truth: number // b − a の本当のかかとの前（着地の瞬間、右脚の中央値）
  est: number // 長い走りの、つなぐ前 120 秒とあと 100 秒の見積もりの差
  before: number[] // つなぐ前（180〜300秒）の16秒窓の増え（かかと）
  after: number[] // つないだ 20 秒後からの16秒窓の増え
  speedAfter: number // つないだあとの速さの目安の変化（割合）
}
function switchOf(a: LandingTrial, b: LandingTrial, kind: string, k: number): Switch | null {
  const run = new LongRun()
  try {
    run.append(a, 300, 5151 + k)
    run.append(b, 120, 6161 + k)
  } catch {
    return null
  }
  const frames = filmFrames((t) => run.at(t), 0, 420, { timing: 'log', seed: 919 + k })
  const m = meterOf(frames)
  const r0 = summarize(m.peaks, 30, 180, 'R')
  if (!r0) return null
  const ref = { heel: r0.med.heel, reach: r0.med.reach, shank: r0.med.shank }
  const refSpeed = speedOf(m.track, 30, 180)
  const pre = driftOf(m.peaks, m.track, 180, 300, ref, refSpeed)
  const post = driftOf(m.peaks, m.track, 320, 420, ref, refSpeed)
  const ta = medianOf(truthOfContacts(a).filter((c) => c.side === 'R').map((c) => c.heel))
  const tb = medianOf(truthOfContacts(b).filter((c) => c.side === 'R').map((c) => c.heel))
  const ea = summarize(m.peaks, 180, 300, 'R')
  const eb = summarize(m.peaks, 320, 420, 'R')
  return { id: a.subject, kind, truth: tb - ta, est: (eb?.med.heel ?? NaN) - (ea?.med.heel ?? NaN), before: pre.d16.heel, after: post.d16.heel, speedAfter: medianOf(post.speed16) }
}

// ---- 数え方 ----
const fin = (...v: (number | undefined | null)[]) => v.every((x) => typeof x === 'number' && Number.isFinite(x))
function pearson(x: number[], y: number[]) {
  const p = x.map((a, i) => [a, y[i]]).filter(([a, b]) => fin(a, b))
  if (p.length < 4) return NaN
  const mx = p.reduce((s, [a]) => s + a, 0) / p.length
  const my = p.reduce((s, [, b]) => s + b, 0) / p.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [a, b] of p) {
    sxy += (a - mx) * (b - my)
    sxx += (a - mx) ** 2
    syy += (b - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}
const meanOf = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN
}
const sdOf = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  const m = meanOf(s)
  return s.length > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)) : NaN
}
const qOf = (xs: number[], p: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN
}
function fit(x: number[], y: number[]) {
  const p = x.map((a, i) => [a, y[i]]).filter(([a, b]) => fin(a, b))
  const mx = meanOf(p.map(([a]) => a))
  const my = meanOf(p.map(([, b]) => b))
  const b = p.reduce((s, [a, c]) => s + (a - mx) * (c - my), 0) / p.reduce((s, [a]) => s + (a - mx) ** 2, 0)
  const a = my - b * mx
  return { a, b, res: x.map((v, i) => y[i] - (a + b * v)) }
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—')
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—')
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—')
const sg3 = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(3)}` : '—')
const sg1 = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}` : '—')
const pc = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—')

const DS_JA: Record<string, string> = { rbds: 'RBDS', riglet: 'Riglet', vh: 'Van Hooren' }
const COND_JA: Record<string, string> = { '25': '秒速2.5m', '35': '秒速3.5m', '45': '秒速4.5m', 楽: '楽なペース', 速い: '速いペース', '333': '秒速3.33m', lowfreq: 'ピッチを下げる', highfreq: 'ピッチを上げる', trunklean: '上体を前に倒す' }

interface Cache {
  recs: TrialRec[]
  drifts: Drift[]
  switches: Switch[]
}

describe.skipIf(!ANY)('着地：本当の値と、毎秒13〜15コマの見積もり', () => {
  itAll('映して測り、まとめを書く', () => {
    let cache: Cache
    if (CACHE && existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, 'utf8'))
    else {
      const trials = loadAll()
      console.log(`使う走り：${trials.length}`)
      const recs: TrialRec[] = []
      const drifts: Drift[] = []
      trials.forEach((tr, k) => {
        recs.push(recordOf(tr, k))
        const d = longOf(tr, k)
        if (d) drifts.push(d)
        if (k % 10 === 0) console.log(`${k + 1}/${trials.length} ${tr.id}`)
      })
      const switches: Switch[] = []
      const by = new Map(trials.map((t) => [`${t.dataset}|${t.subject}|${t.cond}`, t]))
      let k = 0
      for (const t of trials) {
        const pairs: [string, string][] = t.dataset === 'vh' && t.cond === 'highfreq' ? [['lowfreq', 'VH ピッチを上げる→下げる']] : t.dataset === 'rbds' && t.cond === '25' ? [['35', 'RBDS 秒速2.5m→3.5m']] : []
        for (const [c, kind] of pairs) {
          const b = by.get(`${t.dataset}|${t.subject}|${c}`)
          if (!b) continue
          const sw = switchOf(t, b, kind, k++)
          if (sw) switches.push(sw)
        }
      }
      cache = { recs, drifts, switches }
      if (CACHE) writeFileSync(CACHE, JSON.stringify(cache))
    }
    writeFileSync(OUT, report(cache))
    console.log(`書いた：${OUT}`)
  })
})

// ---- まとめ ----
function report(c: Cache): string {
  // ピッチが 130〜230 歩／分に入らない記録は、印の名前の取り違えなどで使えないとみて除く（VH の Sub_18 ピッチを上げる：354）
  const bad = c.recs.filter((r) => !(r.cadence >= 130 && r.cadence <= 230)).map((r) => r.id)
  const recs = c.recs.filter((r) => r.cadence >= 130 && r.cadence <= 230)
  const drifts = c.drifts.filter((d) => !bad.includes(d.id))
  // ためた結果（JSON）では NaN が null になるので、NaN に戻す
  const T = (r: TrialRec, k: string) => r.truthR[k] ?? NaN
  const E = (r: TrialRec, cond: string, f: Feature, w: 'med' | 'medAll' = 'med') => r.est[cond]?.[w][f] ?? NaN
  const L: string[] = []
  const p = (s = '') => L.push(s)
  const speedL = (r: TrialRec) => r.speed / (r.leg / 1000)
  const people = new Set(recs.map((r) => `${r.dataset}|${r.subject}`)).size

  // ① 本当の値
  const groups = [...new Set(recs.map((r) => `${r.dataset}|${r.cond}`))]
  const order = ['rbds|25', 'rbds|35', 'rbds|45', 'riglet|楽', 'riglet|速い', 'vh|highfreq', 'vh|333', 'vh|lowfreq', 'vh|trunklean']
  groups.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const brk = recs.filter((r) => r.dataset !== 'riglet')

  // ② 相関
  const corr = (cond: string, f: Feature, tk: string, w: 'med' | 'medAll' = 'med') => pearson(recs.map((r) => E(r, cond, f, w)), recs.map((r) => T(r, tk)))
  const CONDS_SHOWN = ['f60', 'f30', 'f15', 'f13', 'log', 'log2', 'logRaw', 'logLow', 'logSwap', 'logLabel', 'logSwapLabel']

  // ③ 同じ人の中
  const by = new Map(recs.map((r) => [`${r.dataset}|${r.subject}|${r.cond}`, r]))
  const PAIRS: [string, string, string, string][] = [
    ['rbds', '25', '35', '速さ +1m/s'],
    ['rbds', '35', '45', '速さ +1m/s'],
    ['riglet', '楽', '速い', '速さ +0.5m/s'],
    ['vh', 'highfreq', 'lowfreq', '同じ速さでピッチ −10%'],
    ['vh', '333', 'trunklean', '上体を前に倒す'],
  ]
  const pairRows = PAIRS.map(([ds, a, b, what]) => {
    const subs = [...new Set(recs.filter((r) => r.dataset === ds).map((r) => r.subject))]
    const P = subs.map((s) => [by.get(`${ds}|${s}|${a}`), by.get(`${ds}|${s}|${b}`)]).filter((x): x is [TrialRec, TrialRec] => !!x[0] && !!x[1])
    const d = (fn: (r: TrialRec) => number) => P.map(([x, y]) => fn(y) - fn(x))
    const th = d((r) => T(r, 'heel'))
    const eh = d((r) => E(r, 'log', 'heel'))
    const ts = d((r) => T(r, 'shank'))
    const es = d((r) => E(r, 'log', 'shank'))
    const tb = d((r) => T(r, 'brakeImp'))
    const agree = th.filter((x, i) => fin(x, eh[i]) && x > 0 === eh[i] > 0).length / th.filter((x, i) => fin(x, eh[i])).length
    return { ds, a, b, what, n: P.length, dSpeed: meanOf(d((r) => r.speed)), dCad: meanOf(d((r) => r.cadence)), th, eh, ts, es, tb, agree }
  })

  // ④ 速さ
  const sp = recs.map((r) => r.est.log?.speedL ?? NaN)
  const ratio = recs.map((r, i) => sp[i] / speedL(r))
  const hf = fit(sp, recs.map((r) => E(r, 'log', 'heel')))
  const sf = fit(sp, recs.map((r) => E(r, 'log', 'shank')))
  const tf = fit(recs.map(speedL), recs.map((r) => T(r, 'heel')))
  const resCorr = pearson(hf.res, tf.res)

  // ⑤ 揺れ（長い走り）
  const LINES_H = [0.03, 0.04, 0.05, 0.06, 0.08]
  const LINES_S = [3, 4, 5, 6, 8]
  const per10 = (ds: number[][], line: number) => {
    // 2秒ずつの窓。越えたら声、そのあと 30 秒は数えない
    let n = 0
    let minutes = 0
    for (const d of ds) {
      minutes += (d.length * 2) / 60
      let last = -1e9
      d.forEach((v, i) => {
        if (v > line && i * 2 - last >= 30) {
          n++
          last = i * 2
        }
      })
    }
    return minutes ? (n / minutes) * 10 : NaN
  }
  const runsOver = (ds: number[][], line: number) => ds.filter((d) => d.some((v) => v > line)).length

  p(`# 着地が体より前か（オーバーストライド）を、走りながらの骨格（毎秒13〜15コマ）で測れるか（仮想実験）`)
  p()
  p(
    `研究データ ${people}人・${recs.length}本（RBDS：Fukuchi 2017、秒速2.5・3.5・4.5m、床反力つき。Riglet 2024：楽なペースと速いペース、重心と接地のイベントつき。` +
      `Van Hooren 2024：秒速3.33m のふつう・ピッチを上げる・下げる・上体を前に倒す、床反力つき）の走りを、仮想のスマホ（真横・1.2m・高さ80cm・超広角、` +
      `点のぶれ1%・奥の脚の寄り・左右の取り違え、アプリと同じ One Euro）で映した。コマの間隔は、毎秒15・13コマと、実機の記録（2026-10-19、iPhone 12 mini）の間隔` +
      `（平均12.5コマ、2割は1コマ抜け）。ピッチが 130〜230 歩／分に入らない記録（${bad.join('・') || 'なし'}）は除いた。`,
  )
  p()
  p(
    `測り方（sim/landing.ts）：着地の瞬間のコマは決めない。左右の名前によらず「その瞬間に前にあるほうの足首」の位置（腰＝左右の股関節の真ん中から、脚の長さで割る）の山を1歩ずつ取り、` +
      `となりのコマで放物線をあてて一番前に出た量（足首の前）を出す。その山のコマの、かかとの前・すねの角度（足首が膝より前で正）・脚の角度・両膝の前後の開きも取る。` +
      `手前の脚の山の中央値を使う。本当の値は、3次元の点で、床反力（Riglet はイベント）の着地の瞬間の、かかと・足首と腰の前後の距離、すねの角度など（sim/landing-data.ts）。`,
  )
  p()
  p(`動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… VH_CAD_DIR=… npx vitest run --config sim/vitest.config.ts sim/landing.sim.ts`)
  p()
  const sub0 = (ds: string, cond: string) => recs.filter((r) => r.dataset === ds && r.cond === cond)
  p(`## まとめ`)
  p()
  const cAll = (cond: string) => corr(cond, 'heel', 'heel')
  const vh = pairRows.find((x) => x.ds === 'vh' && x.a === 'highfreq')!
  const rb = pairRows.find((x) => x.ds === 'rbds' && x.a === '25')!
  const w16 = drifts.map((d) => sdOf(d.d16.heel))
  p(`- **毎秒13〜15コマで足りる。** 足首が一番前に出た量は、毎秒60コマと同じだけ本当の値（一番前に出た量）に合う（相関 60コマ ${f2(corr('f60', 'reach', 'reach'))}、15コマ ${f2(corr('f15', 'reach', 'reach'))}、13コマ ${f2(corr('f13', 'reach', 'reach'))}、実機の間隔 ${f2(corr('log', 'reach', 'reach'))}）。コマ数が足りないのではない`)
  p(`- **着地の瞬間とは少しずれる。** 一番前に出たあと、足は少し引き戻されてから着く（引き戻しの量は人による）。山のコマのかかとの前と、着地の瞬間のかかとの前の相関は、人と速さをまたいで ${f2(cAll('log'))}（60コマでも ${f2(cAll('f60'))}）。すねの角度は ${f2(corr('log', 'shank', 'shank'))}`)
  p(`- **速さで大きく変わる。** 同じ人で秒速 +1m（時速 +3.6km）にすると、かかとの前の見積もりは ${sg3(meanOf(rb.eh))}（本当の値 ${sg3(meanOf(rb.th))}）。人による違いも大きい（同じ速さの目安でのばらつき ±${f3(sdOf(hf.res))}）。速さを知らずに、決まった線で「前で着地」と言うことはできない`)
  p(`- **同じ人の中の変化は追える。** 同じ速さでピッチを約10%下げると、本当のかかとの前は ${sg3(meanOf(vh.th))}、見積もりは ${sg3(meanOf(vh.eh))}（向きが合った人 ${pc(vh.agree)}）。ただしこの大きさは、16秒の窓の揺れ（1本の中の標準偏差 中央 ${f3(qOf(w16, 0.5))}）の2〜3倍しかなく、1回の窓では見分けにくい`)
  const brkSub = [sub0('rbds', '25'), sub0('rbds', '35'), sub0('vh', '333')].map((rs) => pearson(rs.map((r) => T(r, 'heel')), rs.map((r) => T(r, 'brakeImp'))))
  p(`- **ブレーキの力との関係は弱い。** ふつうの走りの範囲では、着地の瞬間のかかとの前とブレーキの力積の相関は、同じ速さの中で ${f2(Math.min(...brkSub))}〜${f2(Math.max(...brkSub))}（同じ人でピッチを下げたときの増えどうしは ${f2(pearson(vh.th, vh.tb))}）。測れるのは「足が体より前に着く形」で、ブレーキの力そのものではない`)
  const d16 = drifts.map((d) => d.d16.heel)
  const vhs = c.switches.filter((x) => x.kind.startsWith('VH'))
  const rbs = c.switches.filter((x) => x.kind.startsWith('RBDS'))
  p(`- **今日の基準からの増えなら声にできる。** かかとの前の16秒の中央値が基準より +0.05 を越えたら声をかける、とすると、ふつうに走る10分あたりの誤った声は ${f2(per10(d16, 0.05))}回（${d16.length}本のうち ${runsOver(d16, 0.05)}本）。同じ速さでピッチを約10%下げた人（本当の増え ${sg3(meanOf(vhs.map((x) => x.truth)))}）には ${pc(vhs.filter((x) => x.after.some((v) => v > 0.05)).length / vhs.length)} で声が出る。6秒の窓では誤った声が10分に ${f2(per10(drifts.map((d) => d.d6.heel), 0.05))}回で、使えない`)
  p(`- **速さを変えたら比べない。** 速さの目安（接地している足首が後ろへ動く速さ）は、本当の速さ ÷ 脚の長さと相関 ${f2(pearson(recs.map((r) => r.est.log?.speedL ?? NaN), recs.map(speedL)))}。秒速 +1m で目安は ${pc(meanOf(rbs.map((x) => x.speedAfter)))} 増え、かかとの前は ${sg3(meanOf(rbs.map((x) => x.est)))} 増えるので、目安が基準から大きく変わったときは比べない（基準を作り直す）`)
  p(`- **腰の前後の揺れ（ブレーキで体が減速する動き）は使えない。** 見積もりは本当の腰の動きに合う（相関 ${f2(pearson(recs.map((r) => r.est.log?.fa ?? NaN), recs.map((r) => r.truthFa)))}）が、本当の腰の動きそのものがブレーキの力積と合わない（${f2(pearson(brk.map((r) => r.truthFa), brk.map((r) => T(r, 'brakeImp'))))}）`)
  {
    const madOf = (xs: number[]) => medianOf(xs.map((x) => Math.abs(x - medianOf(xs))))
    const s60 = recs.filter((r) => r.ic?.slow60 && Number.isFinite(r.ic.slow60.shank)).map((r) => r.ic.slow60.shank - T(r, 'shank'))
    const live = recs.map((r) => E(r, 'log', 'shank') - T(r, 'shank')).filter(Number.isFinite)
    p(`- **短い高速撮影を足しても良くならない。** 着地の瞬間を見つけて測るアプリのスロー分析に、毎秒60コマの10秒を通すと、すねの角度のずれは中央から ${f1(madOf(s60))}°・大外れ（20°超）${pc(s60.filter((d) => Math.abs(d) > 20).length / s60.length)}。走りながらの山のコマは ${f1(madOf(live))}°・大外れ 0%（⑥）`)
  }
  p()

  p(`## ① 本当の値（着地の瞬間、右脚の中央値。脚の長さに対する割合）`)
  p()
  p(`| データ | 条件 | 本数 | 速さ（m/s） | ピッチ | かかとの前 | 足首の前 | すね（°） | 一番前に出た足首 | 重心より前のかかと | ブレーキの力積（体重×秒） | ブレーキの山（体重倍） |`)
  p(`|---|---|---|---|---|---|---|---|---|---|---|---|`)
  for (const g of groups) {
    const [ds, cond] = g.split('|')
    const rs = recs.filter((r) => r.dataset === ds && r.cond === cond)
    const m = (fn: (r: TrialRec) => number, d = 3) => {
      const v = rs.map(fn).filter(Number.isFinite)
      return v.length ? `${medianOf(v).toFixed(d)}（${qOf(v, 0.1).toFixed(d)}〜${qOf(v, 0.9).toFixed(d)}）` : '—'
    }
    p(`| ${DS_JA[ds]} | ${COND_JA[cond] ?? cond} | ${rs.length} | ${m((r) => r.speed, 2)} | ${m((r) => r.cadence, 0)} | ${m((r) => T(r, 'heel'))} | ${m((r) => T(r, 'ankle'))} | ${m((r) => T(r, 'shank'), 1)} | ${m((r) => T(r, 'reach'))} | ${m((r) => T(r, 'heelCom'))} | ${m((r) => T(r, 'brakeImp'), 4)} | ${m((r) => T(r, 'brakePeak'), 2)} |`)
  }
  p()
  p(`中央値（下から1割〜上から1割）。ブレーキは Riglet にない（力の板の値が記録されていない）。`)
  p()
  p(`本当の値どうしの相関（RBDS と Van Hooren の ${brk.length}本。同じ速さの中は RBDS 秒速2.5m・3.5m、VH 秒速3.33m）：`)
  p()
  p(`| | ブレーキの力積（全部） | ブレーキの山（全部） | 力積（RBDS 2.5m） | 力積（RBDS 3.5m） | 力積（VH 3.33m） |`)
  p(`|---|---|---|---|---|---|`)
  const sub = (ds: string, cond: string) => recs.filter((r) => r.dataset === ds && r.cond === cond)
  for (const [k, ja] of [['heel', 'かかとの前'], ['ankle', '足首の前'], ['shank', 'すねの角度'], ['reach', '一番前に出た足首'], ['kneeGap', '両膝の前後の開き'], ['stance', '接地時間']] as const) {
    const c1 = (rs: TrialRec[], b: string) => f2(pearson(rs.map((r) => T(r, k)), rs.map((r) => T(r, b))))
    p(`| ${ja} | ${c1(brk, 'brakeImp')} | ${c1(brk, 'brakePeak')} | ${c1(sub('rbds', '25'), 'brakeImp')} | ${c1(sub('rbds', '35'), 'brakeImp')} | ${c1(sub('vh', '333'), 'brakeImp')} |`)
  }
  p()

  p(`## ② 毎秒13〜15コマの見積もりと本当の値の相関（${recs.length}本、人と速さ・条件をまたいで）`)
  p()
  p(`見積もりは、手前の脚の山の1本ぶん（30〜60秒）の中央値。「両脚」は奥の脚の山も入れたもの（仮想のスマホは、奥の脚の点を手前に3割寄せるので、奥の脚の山は小さく出る）。`)
  p()
  p(`| 映し方 | 足首の前 ↔ 一番前に出た足首 | 足首の前 ↔ 着地のかかと | かかとの前 ↔ 着地のかかと | かかとの前 ↔ 着地の足首 | すね ↔ 着地のすね | 脚の角度 ↔ 着地の脚の角度 | 両膝の開き ↔ 着地の両膝の開き | 両脚：かかとの前 ↔ 着地のかかと |`)
  p(`|---|---|---|---|---|---|---|---|---|`)
  for (const cond of CONDS_SHOWN) {
    const lab = CONDS.find((x) => x.key === cond)?.label ?? cond
    p(`| ${lab} | ${f2(corr(cond, 'reach', 'reach'))} | ${f2(corr(cond, 'reach', 'heel'))} | ${f2(corr(cond, 'heel', 'heel'))} | ${f2(corr(cond, 'heel', 'ankle'))} | ${f2(corr(cond, 'shank', 'shank'))} | ${f2(corr(cond, 'legAng', 'legAng'))} | ${f2(corr(cond, 'kneeGap', 'kneeGap'))} | ${f2(corr(cond, 'heel', 'heel', 'medAll'))} |`)
  }
  p()
  p(`- 左右の名前ごとに山を取ると、取り違えが毎秒2回あるとき かかとの前の相関が ${f2(corr('logSwapLabel', 'heel', 'heel'))} に下がる。前にあるほうの足首で取れば ${f2(corr('logSwap', 'heel', 'heel'))}（人の動画では、脚が交差するたびに名前が入れ替わることがあった）`)
  p(`- 見積もりと本当の値の差（実機の間隔、手前の脚）：足首の前は平均 ${sg3(meanOf(recs.map((r) => E(r, 'log', 'reach') - T(r, 'reach'))))}（60コマとの差 ${sg3(meanOf(recs.map((r) => E(r, 'log', 'reach') - E(r, 'f60', 'reach'))))}）。かかとの前は、着地の瞬間より ${sg3(meanOf(recs.map((r) => E(r, 'log', 'heel') - T(r, 'heel'))))} 大きい（一番前のコマで測るため）`)
  p()

  p(`## ③ 同じ人の中での変化（実機の間隔、手前の脚、1本ぶんの中央値）`)
  p()
  p(`| 比べたもの | 人数 | 速さの変化（m/s） | ピッチの変化 | 本当のかかとの前 | 見積もりのかかとの前 | 向きが合った人 | 本当のすね（°） | 見積もりのすね（°） | ブレーキの力積 |`)
  p(`|---|---|---|---|---|---|---|---|---|---|`)
  for (const r of pairRows) {
    const ms = (xs: number[], fn: (x: number) => string) => `${fn(meanOf(xs))}±${Number.isFinite(sdOf(xs)) ? sdOf(xs).toFixed(3) : '—'}`
    p(`| ${DS_JA[r.ds]} ${COND_JA[r.a]}→${COND_JA[r.b]}（${r.what}） | ${r.n} | ${sg1(r.dSpeed)} | ${sg1(r.dCad)} | ${ms(r.th, sg3)} | ${ms(r.eh, sg3)} | ${pc(r.agree)} | ${sg1(meanOf(r.ts))} | ${sg1(meanOf(r.es))} | ${Number.isFinite(meanOf(r.tb)) ? `${meanOf(r.tb) >= 0 ? '+' : ''}${meanOf(r.tb).toFixed(4)}` : '—'} |`)
  }
  p()
  p(`- 同じ人の中の変化どうしの相関（本当 ↔ 見積もり、かかとの前）：${pairRows.map((r) => `${COND_JA[r.a]}→${COND_JA[r.b]} ${f2(pearson(r.th, r.eh))}`).join('、')}`)
  p(`- ピッチを下げたときの、本当のかかとの前の増えとブレーキの力積の増えの相関（VH）：${f2(pearson(vh.th, vh.tb))}。見積もりの増えとは ${f2(pearson(vh.eh, vh.tb))}`)
  p()

  p(`## ④ 速さの目安と、速さを考えた線`)
  p()
  p(`速さの目安（sim/landing.ts の speedOf）：画面で低いほうの足首が、続く2コマで後ろへ動く速さ（脚の長さ／秒）の中央値。トレッドミルでは、ベルトの速さ ÷ 脚の長さに比例する。`)
  p()
  p(`- 本当の値（ベルトの速さ ÷ 脚の長さ）との相関 ${f2(pearson(sp, recs.map(speedL)))}。目安は本当の値のおよそ ${f2(qOf(ratio, 0.5))} 倍（下から1割 ${f2(qOf(ratio, 0.1))}、上から1割 ${f2(qOf(ratio, 0.9))}）`)
  p(`- かかとの前（見積もり）＝ ${f3(hf.a)} ＋ ${f3(hf.b)} × 速さの目安。ふつうの走りの人ごとのばらつき（残り）の標準偏差 ${f3(sdOf(hf.res))}、上から1割 ${sg3(qOf(hf.res, 0.9))}・上から5% ${sg3(qOf(hf.res, 0.95))}・一番大きい ${sg3(qOf(hf.res, 1))}`)
  p(`- 本当の値でも、速さを考えたあとの人ごとのばらつきは ${f3(sdOf(tf.res))}。見積もりの残りと本当の値の残りの相関 ${f2(resCorr)}（人ごとの「着地が前寄りか」は、速さを考えれば ${f2(resCorr)} の確かさで並べられる）`)
  p(`- すねの角度（見積もり）＝ ${f1(sf.a)} ＋ ${f1(sf.b)} × 速さの目安、残りの標準偏差 ${f1(sdOf(sf.res))}°`)
  p(
    `- 速さを考えた線を越えたふつうの走り（${recs.length}本）：` +
      [0.06, 0.08, 0.09, 0.1, 0.12].map((x) => `+${x} で ${hf.res.filter((v) => v > x).length}本`).join('、'),
  )
  p()

  p(`## ⑤ 今日の基準からの増え（長い走り、実機の間隔）`)
  p()
  p(`1本ずつ LongRun で10分の走りを作り（${drifts.length}本）、走り始め 30〜180秒の中央値を基準に、そのあとの窓の中央値の増えを見た。数分かけての揺れ（疲れ・服や光のずれ）は入らないので、実機の記録（2026-10-19）の値も並べる（form-videos/notes/判定テスト.md の 7）。`)
  p()
  p(`| 値 | 窓 | 1本の中の揺れ（標準偏差の中央・上から1割） | ${LINES_H.map((x) => `線 +${x}`).join(' | ')} |`)
  p(`|---|---|---|${LINES_H.map(() => '---').join('|')}|`)
  for (const k of DRIFT_KEYS) {
    for (const [lab, get] of [['16秒', (d: Drift) => d.d16[k]], ['6秒', (d: Drift) => d.d6[k]]] as const) {
      const ds = drifts.map(get)
      const sds = ds.map(sdOf)
      const lines = k === 'shank' ? LINES_S : LINES_H
      p(`| ${k === 'heel' ? 'かかとの前' : k === 'reach' ? '足首の前' : 'すね（°）'} | ${lab} | ${k === 'shank' ? `${f1(qOf(sds, 0.5))}°・${f1(qOf(sds, 0.9))}°` : `${f3(qOf(sds, 0.5))}・${f3(qOf(sds, 0.9))}`} | ${lines.map((x) => `${f2(per10(ds, x))}回（${runsOver(ds, x)}本）`).join(' | ')} |`)
    }
  }
  p()
  p(`線の値（すねは ${LINES_S.join('・')}°）を越えた回数の、10分あたり（声の間30秒をあけて数える）と、一度でも越えた走りの数。`)
  p()
  const kinds = [...new Set(c.switches.map((x) => x.kind))]
  for (const kind of kinds) {
    const ss = c.switches.filter((x) => x.kind === kind)
    p(`### ${kind}（${ss.length}人）`)
    p()
    p(`前の走り 300秒（基準は 30〜180秒）のあとに、あとの走りを 120秒つなぎ、つないだ 20秒後からの 16秒の窓で、増えが線を越えた人の割合（「つなぐ前」は、同じ線をつなぐ前の 180〜300秒で越えた人）。`)
    p()
    p(`| | 本当のかかとの前の変化 | 見積もりの変化 | 速さの目安の変化 | ${LINES_H.map((x) => `線 +${x}：あと／つなぐ前`).join(' | ')} |`)
    p(`|---|---|---|---|${LINES_H.map(() => '---').join('|')}|`)
    p(`| 平均 | ${sg3(meanOf(ss.map((x) => x.truth)))} | ${sg3(meanOf(ss.map((x) => x.est)))} | ${pc(meanOf(ss.map((x) => x.speedAfter)))} | ${LINES_H.map((x) => `${pc(ss.filter((s) => s.after.some((v) => v > x)).length / ss.length)}／${pc(ss.filter((s) => s.before.some((v) => v > x)).length / ss.length)}`).join(' | ')} |`)
    p()
  }
  p(`## ⑥ 着地の瞬間を見つけて測るなら（短いスロー撮影、なめらかにしない点、10秒）`)
  p()
  p(`アプリのスロー分析（src/modes/camera/slowmo.ts の analyzeRun。足ごとに地面の線を引き、足の一番低い点が地面に着いた瞬間を着地とする）に、毎秒30・60・120コマで撮った10秒を通した。` + `差は 見積もり − 本当の値（着地の瞬間）。「大外れ」は差が20°を越えた本（着地でない瞬間を拾ったもの）。比べとして、走りながらの測り方（実機の間隔、山のコマ）の値も並べる（こちらは一番前に出たコマなので、着地の瞬間より大きく出る。ずれの量そのものより、ばらつきを見る）。`)
  p()
  p(`| 測り方 | 値が出た本数 | すねの差：中央値（中央からのずれの中央値） | ±5°に入った本 | 大外れ | 大外れを除いた相関（すね） | 足首の前の差：中央値（ずれの中央値） |`)
  p(`|---|---|---|---|---|---|---|`)
  const mad = (xs: number[]) => {
    const m = medianOf(xs)
    return medianOf(xs.map((x) => Math.abs(x - m)))
  }
  for (const k of ['slow30', 'slow60', 'slow120', 'live']) {
    const rs = k === 'live' ? recs.filter((r) => Number.isFinite(E(r, 'log', 'shank'))) : recs.filter((r) => r.ic?.[k] && Number.isFinite(r.ic[k].shank))
    const sv = (r: TrialRec) => (k === 'live' ? E(r, 'log', 'shank') : r.ic[k].shank)
    const av = (r: TrialRec) => (k === 'live' ? E(r, 'log', 'reach') : r.ic[k].ahead)
    const ds = rs.map((r) => sv(r) - T(r, 'shank'))
    const da = rs.map((r) => av(r) - T(r, 'ankle'))
    const m0 = medianOf(ds)
    const ok = rs.filter((_, i) => Math.abs(ds[i]) <= 20)
    const lab = k === 'live' ? '走りながら（毎秒12.5コマ、山のコマ）' : `スロー分析 毎秒${k.replace('slow', '')}コマ`
    p(`| ${lab} | ${rs.length} / ${recs.length} | ${sg1(m0)}°（${f1(mad(ds))}°） | ${pc(ds.filter((d) => Math.abs(d - (k === 'live' ? m0 : 0)) <= 5).length / ds.length)} | ${pc(ds.filter((d) => Math.abs(d) > 20).length / ds.length)} | ${f2(pearson(ok.map(sv), ok.map((r) => T(r, 'shank'))))} | ${sg3(medianOf(da))}（${f3(mad(da))}） |`)
  }
  p()
  p(`走りながらの測り方の「±5°」は、ずれの中央値を引いたあとで数えた（一番前のコマと着地のずれは、ほぼ一定なので引ける）。`)
  p()
  return L.join('\n') + '\n'
}
