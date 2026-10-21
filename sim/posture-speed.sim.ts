// 仮想実験（姿勢の値と走る速さ）：同じ人が速さを変えたとき、アプリの姿勢の値（体全体・上体・首・頭の位置・腰の高さ）がどれだけ動くか
//   研究データの走りを、仮想のスマホ（pipeline.ts の BASE：真横・1.2m・高さ80cm・超広角、ぶれ1%）で毎秒15コマで映し、
//   アプリと同じ measure()（src/modes/camera/geometry.ts）で1コマずつ測り、1秒ごとの平均（3コマ以上）→ 走りの平均にする
//   （coach.ts の second() が1秒の平均を作り、form.ts が16秒の窓で平均するのと同じ。平均の平均なので、窓の長さは結果を変えない）
//   データ：
//     RBDS（Fukuchi 2017）：秒速2.5・3.5・4.5m。脚と骨盤の印だけ（上体・頭はない）。上体は camera.ts の仮のもの（骨盤から鉛直に7°前）なので、
//       体全体は「脚と骨盤の分」だけが動く値。腰の高さ・ピッチ・脚の長さはそのまま使える
//     Riglet 2024：楽なペースと速いペース（自分で選んだ速さ）。肩の関節の中心と頭の印がある。上体・体全体・首・頭の位置まで見られる
//     Van Hooren 2024：秒速3.33m だけ（同じ人の速さの比べはできない）。時速12km の人の散らばりを見るため（頭は作りものなので見ない）
//   ベルトの速さは、接地の 30〜60% の間に足首が後ろへ動く速さの中央値（landing.sim.ts と同じ）。速さの目安（アプリの値）は landing.ts の speedOf
// 動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… npx vitest run --config sim/vitest.config.ts sim/posture-speed.sim.ts
//   POSTURE_CACHE=<json> を付けると、映した結果をためて、2回目からはまとめだけを書き直す
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRbdsLanding, loadRigletLanding, loadVhLanding, legLengthOf, type LandingTrial } from './landing-data'
import { bodyAt, filmFrames, meterOf, runningSpan } from './landing-film'
import { speedOf } from './landing'
import { measure } from '../src/modes/camera/geometry'
import { FORM, GOOD } from '../src/modes/camera/params'

const RBDS = process.env.RBDS_DIR
const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const CACHE = process.env.POSTURE_CACHE
const OUT = process.env.SIM_OUT ?? 'sim/result-posture-speed.md'
const ANY = !!(RBDS || RIGLET || VH)

interface Rec {
  dataset: 'rbds' | 'riglet' | 'vh'
  subject: string
  cond: string
  sec: number
  speed: number // ベルトの速さ（m/s）
  leg: number // 脚の長さ（m、3次元の腰→膝→足首）
  sv: number // 速さの目安（アプリの値、脚の長さ／秒）
  cadence: number // 歩／分
  body: number
  trunk: number
  neck: number
  headLean: number
  hipRatio: number
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
}
const median = (xs: number[]) => quant(xs, 0.5)
function quant(xs: number[], p: number) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return NaN
  const x = p * (s.length - 1)
  const i = Math.floor(x)
  return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (x - i) : s[i]
}
// t 分布の 97.5% 点（自由度 df）
function t975(df: number) {
  const T = [12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]
  return df <= 30 ? T[df - 1] : 1.96 + 2.5 / df
}

function recordOf(tr: LandingTrial, dataset: Rec['dataset'], k: number): Rec | null {
  const [t0, t1] = runningSpan(tr)
  if (t1 - t0 < 10) return null
  const leg = legLengthOf(tr) / 1000
  const cs = tr.contacts.filter((c) => c.on >= t0 && c.on <= t1)
  const speeds = cs.map((c) => {
    const key = c.side === 'R' ? 'ankleR' : 'ankleL'
    const a = c.on + 0.3 * (c.off - c.on)
    const b = c.on + 0.6 * (c.off - c.on)
    return (bodyAt(tr, a)[key][0] - bodyAt(tr, b)[key][0]) / 1000 / (b - a)
  })
  const steps = cs.slice(1).map((c, i) => c.on - cs[i].on).filter((d) => d >= 0.2 && d <= 0.6)
  const frames = filmFrames((t) => bodyAt(tr, t), t0, t1 - t0, { timing: 15, seed: 500 + 31 * k })
  // 1秒ごとの平均（3コマ以上）→ 走りの平均
  const bySec = new Map<number, ReturnType<typeof measure>[]>()
  for (const { t, f } of frames) {
    const s = Math.floor(t)
    if (!bySec.has(s)) bySec.set(s, [])
    bySec.get(s)!.push(measure(f))
  }
  const secs = [...bySec.values()].filter((ms) => ms.length >= 3)
  const avg = (key: 'body' | 'trunk' | 'neck' | 'headLean' | 'hipRatio') => mean(secs.map((ms) => mean(ms.map((m) => m[key]))))
  const meter = meterOf(frames)
  return {
    dataset,
    subject: tr.subject,
    cond: tr.cond,
    sec: t1 - t0,
    speed: median(speeds),
    leg,
    sv: speedOf(meter.track, t0, t1),
    cadence: 60 / median(steps),
    body: avg('body'),
    trunk: avg('trunk'),
    neck: avg('neck'),
    headLean: avg('headLean'),
    hipRatio: avg('hipRatio'),
  }
}

function loadAll(): Rec[] {
  const out: Rec[] = []
  let k = 0
  const tryPush = (fn: () => LandingTrial, ds: Rec['dataset'], what: string) => {
    try {
      const tr = fn()
      if (tr.contacts.length < 10) throw new Error(`接地が ${tr.contacts.length} 回しかありません`)
      const r = recordOf(tr, ds, k++)
      if (r) out.push(r)
    } catch (e) {
      console.log(`使えない：${what}：${(e as Error).message}`)
    }
  }
  if (RBDS) {
    const ids = [...new Set(readdirSync(RBDS).filter((f) => /^RBDS\d+static\.txt$/.test(f)).map((f) => f.slice(0, 7)))].sort()
    for (const id of ids) for (const sp of ['25', '35', '45']) if (existsSync(join(RBDS, `${id}runT${sp}forces.txt`))) tryPush(() => loadRbdsLanding(RBDS, id, sp), 'rbds', `${id} ${sp}`)
  }
  if (RIGLET) {
    for (const id of readdirSync(RIGLET).sort()) {
      for (const [pace, cond] of [['Comfortable', '楽'], ['Fast', '速い']]) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (existsSync(p)) tryPush(() => loadRigletLanding(p, id, cond), 'riglet', `${id} ${pace}`)
      }
    }
  }
  if (VH) for (const f of readdirSync(VH).sort()) if (/^Sub_\d+_333(ms)?\.c3d$/i.test(f)) tryPush(() => loadVhLanding(join(VH, f), f.slice(0, 6), '333'), 'vh', f)
  return out
}

type Key = 'body' | 'trunk' | 'neck' | 'headLean' | 'hipRatio' | 'cadence' | 'sv' | 'speedLeg'
const val = (r: Rec, key: Key) => (key === 'speedLeg' ? r.speed / r.leg : r[key])
const LABEL: Record<Key, string> = { body: '体全体（°）', trunk: '上体（°）', neck: '首の角度（°）', headLean: '頭の位置（°）', hipRatio: '腰の高さ（脚の長さ比）', cadence: 'ピッチ（歩/分）', sv: '速さの目安（アプリ、脚/秒）', speedLeg: 'ベルトの速さ ÷ 脚の長さ（脚/秒）' }
const DIG: Record<Key, number> = { body: 2, trunk: 2, neck: 2, headLean: 2, hipRatio: 4, cadence: 1, sv: 3, speedLeg: 3 }

// 人ごとの傾き（最小二乗。その人の速さが2つ以上）。x は km/h・脚/秒（本当）・速さの目安
function slopes(recs: Rec[], key: Key, xOf: (r: Rec) => number) {
  const bySub = new Map<string, Rec[]>()
  for (const r of recs) (bySub.get(r.subject) ?? bySub.set(r.subject, []).get(r.subject)!).push(r)
  const out: number[] = []
  for (const rs of bySub.values()) {
    if (rs.length < 2) continue
    const xs = rs.map(xOf)
    const ys = rs.map((r) => val(r, key))
    const mx = mean(xs)
    const my = mean(ys)
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    if (sxx <= 0) continue
    out.push(xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx)
  }
  return out
}
function summary(xs: number[]) {
  const m = mean(xs)
  const s = sd(xs)
  const h = (t975(xs.length - 1) * s) / Math.sqrt(xs.length)
  return { n: xs.length, m, s, lo: m - h, hi: m + h, up: xs.filter((x) => x > 0).length }
}

const XS: [string, (r: Rec) => number][] = [
  ['+1 km/h', (r) => r.speed * 3.6],
  ['+1 脚/秒（本当）', (r) => r.speed / r.leg],
  ['+1 速さの目安', (r) => r.sv],
]

function report(recs: Rec[]) {
  const L: string[] = []
  const p = (s = '') => L.push(s)
  const f = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 && d > 0 ? '+' : '') + x.toFixed(d) : '—')
  const g = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')
  p('# 姿勢の値と走る速さ（仮想実験 sim/posture-speed.sim.ts）')
  p()
  p('研究データの走りを、真横・1.2m・高さ80cm・超広角・ぶれ1% の仮想のスマホで毎秒15コマで映し、アプリの measure() で測った値（1秒平均の、走りの平均）。')
  p('RBDS には上体・頭の印がないので、上体は仮のもの（7°で固定）。RBDS の体全体は「脚と骨盤の分」だけ、首・頭の位置は意味がない。')
  p()
  const groups: [string, Rec['dataset'], string][] = [
    ['RBDS 秒速2.5m', 'rbds', '25'],
    ['RBDS 秒速3.5m', 'rbds', '35'],
    ['RBDS 秒速4.5m', 'rbds', '45'],
    ['Riglet 楽', 'riglet', '楽'],
    ['Riglet 速い', 'riglet', '速い'],
    ['Van Hooren 3.33m/s', 'vh', '333'],
  ]
  p('## ① 条件ごとの人の散らばり（中央値 [下から1/4〜上から1/4]（下から1割〜上から1割））')
  p()
  const keys: Key[] = ['body', 'trunk', 'neck', 'headLean', 'hipRatio', 'cadence', 'sv', 'speedLeg']
  p(`| 条件 | 本数 | 速さ（km/h） | 脚の長さ（m） | ${keys.map((k) => LABEL[k]).join(' | ')} |`)
  p(`|---|---|---|---|${keys.map(() => '---').join('|')}|`)
  for (const [name, ds, cond] of groups) {
    const rs = recs.filter((r) => r.dataset === ds && r.cond === cond)
    if (!rs.length) continue
    const cell = (xs: number[], d: number) => `${g(median(xs), d)} [${g(quant(xs, 0.25), d)}〜${g(quant(xs, 0.75), d)}]（${g(quant(xs, 0.1), d)}〜${g(quant(xs, 0.9), d)}）`
    p(`| ${name} | ${rs.length} | ${cell(rs.map((r) => r.speed * 3.6), 1)} | ${g(median(rs.map((r) => r.leg)), 3)} | ${keys.map((k) => cell(rs.map((r) => val(r, k)), k === 'hipRatio' ? 3 : k === 'cadence' ? 0 : k === 'sv' || k === 'speedLeg' ? 2 : 1)).join(' | ')} |`)
  }
  p()
  p('## ② 同じ人の中での変化（人ごとの傾きの、平均 ± 標準偏差 [95%信頼区間]、増えた人／人数）')
  p()
  const sets: [string, Rec[], Key[]][] = [
    ['RBDS（2.5・3.5・4.5m/s、人ごとの最小二乗）', recs.filter((r) => r.dataset === 'rbds'), ['body', 'hipRatio', 'cadence', 'sv']],
    ['RBDS 2.5→3.5m/s だけ', recs.filter((r) => r.dataset === 'rbds' && r.cond !== '45'), ['body', 'hipRatio', 'cadence', 'sv']],
    ['RBDS 3.5→4.5m/s だけ', recs.filter((r) => r.dataset === 'rbds' && r.cond !== '25'), ['body', 'hipRatio', 'cadence', 'sv']],
    ['Riglet（楽→速い）', recs.filter((r) => r.dataset === 'riglet'), ['body', 'trunk', 'neck', 'headLean', 'hipRatio', 'cadence', 'sv']],
  ]
  for (const [name, rs, ks] of sets) {
    p(`### ${name}`)
    p()
    p(`| 値 | ${XS.map((x) => x[0]).join(' | ')} |`)
    p(`|---|${XS.map(() => '---').join('|')}|`)
    for (const k of ks) {
      const cells = XS.map(([, xOf]) => {
        const s = summary(slopes(rs, k, xOf))
        const d = DIG[k]
        return `${f(s.m, d)} ± ${g(s.s, d)} [${f(s.lo, d)}〜${f(s.hi, d)}]、${s.up}/${s.n}`
      })
      p(`| ${LABEL[k]} | ${cells.join(' | ')} |`)
    }
    p()
  }
  // 速さの目安と本当の速さの関係（アプリの値の換算）
  const all = recs.filter((r) => Number.isFinite(r.sv))
  const ratio = all.map((r) => r.sv / (r.speed / r.leg))
  p(`速さの目安 ÷（ベルトの速さ ÷ 脚の長さ）：中央値 ${g(median(ratio), 3)}（下から1割 ${g(quant(ratio, 0.1), 3)}・上から1割 ${g(quant(ratio, 0.9), 3)}、${all.length}本）`)
  p()
  // 速さで散らばりを説明できるか：人をまたいだ、速さに対する傾き（Riglet・VH・RBDS の体全体）
  p('## ③ 今の線とよい例の範囲')
  p()
  p(`FORM：体全体 ${FORM.body.min}〜${FORM.body.max}°、上体 ${FORM.trunk.min}〜${FORM.trunk.max}°。GOOD：体全体 ${GOOD.body.min}〜${GOOD.body.max}°、上体 ${GOOD.trunk.min}〜${GOOD.trunk.max}°（講師、時速${GOOD.kmh.min}〜${GOOD.kmh.max}km）`)
  p()
  p('| 条件 | 本数 | 体全体が FORM の下より小さい | GOOD の中 | GOOD より上 | 上体が GOOD の中 | GOOD より下 |')
  p('|---|---|---|---|---|---|---|')
  for (const [name, ds, cond] of groups) {
    const rs = recs.filter((r) => r.dataset === ds && r.cond === cond)
    if (!rs.length || ds === 'rbds') continue
    const c = (pred: (r: Rec) => boolean) => `${rs.filter(pred).length}`
    p(`| ${name} | ${rs.length} | ${c((r) => r.body < FORM.body.min)} | ${c((r) => r.body >= GOOD.body.min && r.body <= GOOD.body.max)} | ${c((r) => r.body > GOOD.body.max)} | ${c((r) => r.trunk >= GOOD.trunk.min && r.trunk <= GOOD.trunk.max)} | ${c((r) => r.trunk < GOOD.trunk.min)} |`)
  }
  p()
  p('## ④ 1本ごとの値')
  p()
  p('| データ | 人 | 条件 | 秒 | 速さ（m/s） | 脚（m） | 速さの目安 | ピッチ | 体全体 | 上体 | 首 | 頭の位置 | 腰の高さ |')
  p('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of recs) p(`| ${r.dataset} | ${r.subject} | ${r.cond} | ${r.sec.toFixed(0)} | ${r.speed.toFixed(2)} | ${r.leg.toFixed(3)} | ${g(r.sv, 2)} | ${r.cadence.toFixed(0)} | ${r.body.toFixed(1)} | ${r.trunk.toFixed(1)} | ${r.neck.toFixed(1)} | ${r.headLean.toFixed(1)} | ${r.hipRatio.toFixed(3)} |`)
  return L.join('\n') + '\n'
}

describe.skipIf(!ANY)('姿勢の値と走る速さ', () => {
  itAll('研究データを映して測る', () => {
    let recs: Rec[]
    if (CACHE && existsSync(CACHE)) recs = JSON.parse(readFileSync(CACHE, 'utf8'))
    else {
      recs = loadAll()
      if (CACHE) writeFileSync(CACHE, JSON.stringify(recs))
    }
    writeFileSync(OUT, report(recs))
  })
})
