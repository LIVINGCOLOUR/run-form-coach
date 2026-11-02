// 仮想実験（走りの数字：ピッチ・上下動・腰の高さ・接地時間）：研究データの走りを、実機の記録のコマの間隔（平均毎秒12.5コマ）の
//   仮想のスマホ（真横・1.2m・高さ80cm・超広角）で映し、アプリの測り方（src/modes/camera/gait.ts。1歩の区切りは着地と同じ山）で測った値が、
//   本当の値（3次元の点と床反力の接地）とどれだけ合うか、同じ人の中の変化（速さ、同じ速さでピッチを下げる・上げる）を同じ向きに追うか、
//   ふつうの走りでどのくらいの値になるか（結果の画面の「研究データのふつうの走り」の範囲）を見る。
//   接地時間はアプリでは測っていない。骨格のコマから測れるかを確かめるため、ここだけで「足の一番低い点が床の高さにあるコマの割合
//   （接地の割合）× 1歩の長さ」を出して、本当の接地時間と比べる
//   腕は研究データに印がないので、ここでは見ない
// 動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… VH_CAD_DIR=… npx vitest run --config sim/vitest.config.ts sim/gait.sim.ts（結果は sim/result-gait.md）
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRbdsLanding, loadRigletLanding, loadVhLanding, legLengthOf, jointAt, type LandingTrial } from './landing-data'
import { bodyAt, filmFrames, runningSpan } from './landing-film'
import { LandingWatch } from '../src/modes/camera/landing'
import { GaitWatch } from '../src/modes/camera/gait'
import { legLength } from '../src/modes/camera/geometry'
import { L } from '../src/modes/camera/landmarks'
import type { Frame } from '../src/core/types'

const RBDS = process.env.RBDS_DIR
const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const VH_CAD = process.env.VH_CAD_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-gait.md'
const ANY = !!(RBDS || RIGLET || VH || VH_CAD)

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
  vhFiles(VH_CAD, /^Sub_\d+_lowfreq\.c3d$/i, 'lowfreq')
  vhFiles(VH_CAD, /^Sub_\d+_highfreq\.c3d$/i, 'highfreq')
  return out
}

const med = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const q = (xs: number[], p: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}
function corr(a: number[], b: number[]) {
  const ps = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  const n = ps.length
  if (n < 3) return NaN
  const ma = ps.reduce((s, p) => s + p[0], 0) / n
  const mb = ps.reduce((s, p) => s + p[1], 0) / n
  const sab = ps.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0)
  const saa = ps.reduce((s, p) => s + (p[0] - ma) ** 2, 0)
  const sbb = ps.reduce((s, p) => s + (p[1] - mb) ** 2, 0)
  return sab / Math.sqrt(saa * sbb)
}

interface Rec {
  id: string
  subject: string
  dataset: string
  cond: string
  truth: { cadence: number; vo: number; hip: number; stance: number }
  cam: { cadence: number; vo: number; hip: number; stance: Record<string, number>; steps: number }
  // 16秒の窓（4秒ずつずらす）の、最初の窓からの変化（上下動は脚の長さに対する割合、ピッチは %）。声にできるかを見るため
  winDev: { vo: number[]; cad: number[] }
}

const WIN = 16
function windowDevs(steps: { t: number; sec: number; vo: number }[]) {
  const out = { vo: [] as number[], cad: [] as number[] }
  if (!steps.length) return out
  const t0 = steps[0].t
  const t1 = steps[steps.length - 1].t
  const at = (a: number) => steps.filter((x) => x.t >= a && x.t < a + WIN)
  const base = at(t0)
  if (base.length < 20) return out
  const bVo = med(base.map((x) => x.vo))
  const bCad = 60 / med(base.map((x) => x.sec))
  for (let a = t0 + 4; a + WIN <= t1; a += 4) {
    const w = at(a)
    if (w.length < 20) continue
    out.vo.push(med(w.map((x) => x.vo)) - bVo)
    out.cad.push((60 / med(w.map((x) => x.sec)) / bCad - 1) * 100)
  }
  return out
}

const FLOOR = [0.02, 0.04, 0.06] // 接地の割合：足の一番低い点が、床（その走りの一番低いところ）からこの高さ（脚の長さに対する割合）以内

function recordOf(tr: LandingTrial, k: number): Rec | null {
  const [t0, t1] = runningSpan(tr)
  const leg = legLengthOf(tr)
  const j = tr.joints
  const hipC = (t: number) => {
    const a = jointAt(j.hipR!, tr.fps, t)
    const b = jointAt(j.hipL!, tr.fps, t)
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  }
  // 本当の値：接地（床反力）で1歩を区切る
  const cs = tr.contacts.filter((c) => c.on >= t0 && c.on < t1).sort((a, b) => a.on - b.on)
  const steps: number[] = []
  const vos: number[] = []
  for (let i = 1; i < cs.length; i++) {
    const sec = cs[i].on - cs[i - 1].on
    if (sec < 0.2 || sec > 0.6) continue
    steps.push(sec)
    let lo = Infinity
    let hi = -Infinity
    for (let t = cs[i - 1].on; t < cs[i].on; t += 1 / tr.fps) {
      const y = hipC(t)[1]
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    vos.push((hi - lo) / leg)
  }
  const hips: number[] = []
  for (let t = t0; t < t1; t += 1 / tr.fps) hips.push((hipC(t)[1] - Math.min(jointAt(j.ankleR!, tr.fps, t)[1], jointAt(j.ankleL!, tr.fps, t)[1])) / leg)
  const truth = {
    cadence: 60 / med(steps),
    vo: med(vos),
    hip: hips.reduce((a, b) => a + b, 0) / hips.length,
    stance: med(cs.map((c) => c.off - c.on)),
  }
  // 映す：実機の記録のコマの間隔。アプリと同じく、1秒ごとに山を振り分けて、走りの数字に渡す
  const frames = filmFrames((t) => bodyAt(tr, t), t0, t1 - t0, { timing: 'log', seed: 1000 + k })
  if (frames.length < 100) return null
  const lw = new LandingWatch()
  const gw = new GaitWatch()
  let next = Math.floor(frames[0].t) + 1
  for (const { t, f } of frames) {
    while (t >= next) {
      gw.second(lw.second(true).peaks)
      next++
    }
    lw.frame(f, t)
    gw.frame(f, t)
  }
  gw.second(lw.second(true).peaks)
  gw.second(lw.second(true).peaks)
  const g = gw.result()
  // 接地の割合（アプリでは測っていない。測れるかを見るためだけのもの）
  const lows = frames.map(({ f }) => lowest(f))
  const legs = frames.map(({ f }) => legLength(f))
  const legM = med(legs)
  const floor = q(lows, 0.95)
  const stance: Record<string, number> = {}
  for (const th of FLOOR) {
    const df = lows.filter((y) => y > floor - th * legM).length / lows.length
    // 1歩の長さ × 接地の割合 ＝ 1歩の接地時間（両脚が同時に着くことはない走りとして）
    stance[th] = df * (g.cadence ? 60 / g.cadence : NaN)
  }
  return {
    id: tr.id,
    subject: `${tr.dataset}-${tr.subject}`,
    dataset: tr.dataset,
    cond: tr.cond,
    truth,
    cam: { cadence: g.cadence ?? NaN, vo: g.vo ?? NaN, hip: g.hip ?? NaN, stance, steps: g.steps },
    winDev: windowDevs(gw.steps),
  }
}

// 足の一番低い点（画面の下が大きい。左右の足首・かかと・つま先のうち一番下）
const lowest = (f: Frame) => Math.max(...[L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel, L.leftFoot, L.rightFoot].map((i) => f[i].y))

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '-')
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')

describe.skipIf(!ANY)('走りの数字（ピッチ・上下動・腰の高さ・接地時間）', () => {
  itAll('研究データを実機の間隔で映して、本当の値と比べる', () => {
    const trials = loadAll()
    const recs = trials.map((tr, k) => recordOf(tr, k)).filter((r): r is Rec => r !== null && r.cam.steps >= 20)
    const lines: string[] = []
    lines.push('# 走りの数字：ピッチ・上下動・腰の高さ・接地時間（仮想実験 sim/gait.sim.ts）', '')
    lines.push(
      '研究データ（RBDS：時速9・12.6・16.2km、Riglet：楽・速い、Van Hooren：秒速3.33m と、同じ速さでピッチを下げる・上げる）の走りの最初の60秒までを、実機の記録のコマの間隔（平均毎秒12.5コマ、2割は1コマ抜け）の仮想のスマホ（真横・1.2m・高さ80cm・超広角、点のぶれ1%）で映し、アプリの測り方（src/modes/camera/gait.ts）に通した。本当の値は3次元の点（左右の股関節の真ん中・足首）と床反力の接地から出した。上下動・腰の高さは脚の長さ（股関節→膝→足首）に対する割合。',
      '',
    )
    lines.push(`使えた走り：${recs.length}本（${[...new Set(recs.map((r) => r.subject))].length}人）`, '')
    // ① 合い方
    lines.push('## ① アプリの値と本当の値（走りごと）', '')
    lines.push('| 値 | 相関 | アプリ − 本当（中央値） | 差の散らばり（下から1割〜上から1割） |', '|---|---|---|---|')
    const row = (name: string, a: number[], b: number[], fmt: (x: number) => string) => {
      const d = a.map((x, i) => x - b[i])
      lines.push(`| ${name} | ${f2(corr(a, b))} | ${fmt(med(d))} | ${fmt(q(d, 0.1))}〜${fmt(q(d, 0.9))} |`)
    }
    row('ピッチ（歩／分）', recs.map((r) => r.cam.cadence), recs.map((r) => r.truth.cadence), f1)
    row('上下動', recs.map((r) => r.cam.vo), recs.map((r) => r.truth.vo), f3)
    row('腰の高さ', recs.map((r) => r.cam.hip), recs.map((r) => r.truth.hip), f3)
    for (const th of FLOOR) row(`接地時間（秒。床から脚の長さの${th * 100}%以内）`, recs.map((r) => r.cam.stance[th]), recs.map((r) => r.truth.stance), f3)
    lines.push('')
    // ② 同じ人の中の変化
    lines.push('## ② 同じ人の中の変化を、同じ向きに追うか', '')
    lines.push('同じ人の2つの走りの差（あとの走り − 前の走り）。「同じ向き」は、本当の値とアプリの値の差の符号が合った人の数。', '')
    lines.push('| 比べ | 人数 | 値 | 本当の差（中央値） | アプリの差（中央値） | 同じ向き | 差どうしの相関 |', '|---|---|---|---|---|---|---|')
    const pairs: [string, string, string, string][] = [
      ['RBDS 時速9 → 12.6km', 'rbds', '25', '35'],
      ['RBDS 時速12.6 → 16.2km', 'rbds', '35', '45'],
      ['Riglet 楽 → 速い', 'riglet', '楽', '速い'],
      ['Van Hooren 同じ速さでピッチを下げる', 'vh', '333', 'lowfreq'],
      ['Van Hooren 同じ速さでピッチを上げる', 'vh', '333', 'highfreq'],
    ]
    for (const [label, ds, a, b] of pairs) {
      const ps: [Rec, Rec][] = []
      for (const r of recs.filter((x) => x.dataset === ds && x.cond === a)) {
        const s = recs.find((x) => x.subject === r.subject && x.cond === b)
        if (s) ps.push([r, s])
      }
      if (!ps.length) continue
      const items: [string, (r: Rec) => number, (r: Rec) => number, (x: number) => string][] = [
        ['ピッチ', (r) => r.truth.cadence, (r) => r.cam.cadence, f1],
        ['上下動', (r) => r.truth.vo, (r) => r.cam.vo, f3],
        ['腰の高さ', (r) => r.truth.hip, (r) => r.cam.hip, f3],
        ['接地時間（4%）', (r) => r.truth.stance, (r) => r.cam.stance[0.04], f3],
      ]
      for (const [name, tv, cv, fmt] of items) {
        const dt = ps.map(([x, y]) => tv(y) - tv(x))
        const dc = ps.map(([x, y]) => cv(y) - cv(x))
        const same = dt.filter((d, i) => Number.isFinite(dc[i]) && Math.sign(d) === Math.sign(dc[i])).length
        lines.push(`| ${label} | ${ps.length} | ${name} | ${fmt(med(dt))} | ${fmt(med(dc))} | ${same} / ${ps.length} | ${f2(corr(dt, dc))} |`)
      }
    }
    lines.push('')
    // ③ ふつうの走りの値（アプリの測り方）
    lines.push('## ③ ふつうの走りで、アプリの測り方の値（結果の画面の「研究データのふつうの走り」）', '')
    lines.push('| 走り | 本数 | 上下動 下から1割 | 真ん中 | 上から1割 | 腰の高さ 下から1割 | 真ん中 | 上から1割 | ピッチの真ん中 |', '|---|---|---|---|---|---|---|---|---|')
    const groups: [string, (r: Rec) => boolean][] = [
      ['RBDS 時速9km', (r) => r.dataset === 'rbds' && r.cond === '25'],
      ['Riglet 楽（約時速9km）', (r) => r.dataset === 'riglet' && r.cond === '楽'],
      ['RBDS 時速12.6km', (r) => r.dataset === 'rbds' && r.cond === '35'],
      ['Van Hooren 秒速3.33m（時速12km）', (r) => r.dataset === 'vh' && r.cond === '333'],
      ['Riglet 速い', (r) => r.dataset === 'riglet' && r.cond === '速い'],
      ['RBDS 時速16.2km', (r) => r.dataset === 'rbds' && r.cond === '45'],
      ['時速12km 前後まで（RBDS 9・12.6km、Riglet 楽、Van Hooren 3.33m）', (r) => (r.dataset === 'rbds' && (r.cond === '25' || r.cond === '35')) || (r.dataset === 'riglet' && r.cond === '楽') || (r.dataset === 'vh' && r.cond === '333')],
    ]
    for (const [label, fn] of groups) {
      const g = recs.filter(fn)
      if (!g.length) continue
      const vo = g.map((r) => r.cam.vo)
      const hip = g.map((r) => r.cam.hip)
      lines.push(`| ${label} | ${g.length} | ${f3(q(vo, 0.1))} | ${f3(med(vo))} | ${f3(q(vo, 0.9))} | ${f3(q(hip, 0.1))} | ${f3(med(hip))} | ${f3(q(hip, 0.9))} | ${f1(med(g.map((r) => r.cam.cadence)))} |`)
    }
    lines.push('')
    // ④ 声にできるか：同じ走りの中の、16秒の窓の揺れ（ふつうに走っているだけ）と、同じ速さでピッチを変えたときの変化
    lines.push('## ④ 声にできるか：ふつうに走っているだけの16秒の窓の揺れと、同じ速さでピッチを変えたときの変化', '')
    lines.push('ふつうの走り（時速12km 前後まで）の中で、最初の16秒の窓からの変化を、4秒ずつずらした窓で見た（研究データの走りは1分ほどなので、何分もかけてのずれは入らない。揺れは実際より小さく出る）。', '')
    const normal = recs.filter(groups[groups.length - 1][1])
    const absVo = normal.flatMap((r) => r.winDev.vo.map(Math.abs))
    const absCad = normal.flatMap((r) => r.winDev.cad.map(Math.abs))
    lines.push('| 値 | 窓の数 | 揺れ（絶対値）の真ん中 | 上から5% | 一番大きい |', '|---|---|---|---|---|')
    lines.push(`| 上下動 | ${absVo.length} | ${f3(med(absVo))} | ${f3(q(absVo, 0.95))} | ${f3(Math.max(...absVo))} |`)
    lines.push(`| ピッチ（%） | ${absCad.length} | ${f1(med(absCad))} | ${f1(q(absCad, 0.95))} | ${f1(Math.max(...absCad))} |`)
    lines.push('')
    for (const [label, cond] of [['ピッチを下げる', 'lowfreq'], ['ピッチを上げる', 'highfreq']] as const) {
      const ps = recs.filter((x) => x.dataset === 'vh' && x.cond === '333').flatMap((r) => {
        const o = recs.find((x) => x.subject === r.subject && x.cond === cond)
        return o ? [[r, o] as const] : []
      })
      const dVo = ps.map(([a, b]) => b.cam.vo - a.cam.vo)
      const dCad = ps.map(([a, b]) => (b.cam.cadence / a.cam.cadence - 1) * 100)
      const thVo = q(absVo, 0.95)
      const thCad = q(absCad, 0.95)
      lines.push(`- Van Hooren 同じ速さで${label}（${ps.length}人）：上下動の変化 真ん中 ${f3(med(dVo))}（揺れの上から5% ${f3(thVo)} を越えた人 ${dVo.filter((d) => Math.abs(d) > thVo).length}人）、ピッチの変化 真ん中 ${f1(med(dCad))}%（揺れの上から5% ${f1(thCad)}% を越えた人 ${dCad.filter((d) => Math.abs(d) > thCad).length}人）`)
    }
    lines.push('')
    writeFileSync(OUT, lines.join('\n'))
    console.log(lines.join('\n'))
  })
})
