// 仮想実験（直立の確かめ）：まっすぐ立った3秒（カメラ版の直立の基準）で、猫背かどうかを決まった線で見分けられるか
//   ① 研究データ（Riglet ら 2024、CC0）の立った姿勢を、アプリと同じ置き方の仮想のスマホで映し、アプリと同じ値（頭＝首の角度＋上体、上体＝腰の中心→肩の中心の前傾）の3秒の真ん中を出す
//   ② 同じ立ち姿勢を、背中を丸めた形にして映す（上体の真ん中＝腰と肩の中間を中心に、肩から上を前へ θ 度回す。頭も肩といっしょに前に出る）。
//      θ 10° で、上体 約+5°・頭 約+10°。自分の 2026-11-03 のわざとの猫背（走りながら）の増え 上体 +4.8°・頭の位置 +11.7° と同じくらい
//   ③ 自分の記録（カメラ版の直立の基準を取った3秒。RFC_RUNS_DIR の rfc-*.json）の値
// を並べ、線（頭・上体）ごとに、まっすぐ立った人が通る割合と、猫背が通らない割合を出す
// 動かし方：RIGLET_DIR=<Riglet のデータ> [RFC_RUNS_DIR=<記録の置き場所>] npx vitest run --config sim/vitest.config.ts sim/standing.sim.ts
//   結果は sim/result-standing.md（記録そのものは書かない。値の真ん中と範囲だけ）
// 限り：研究データの耳は「耳の後ろの印から2cm前」（sim/riglet.ts）で、アプリの骨格の推定の耳とは少し違う。研究データの立った姿勢は、腕を広げた形の人もいる
import { it as itAll } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadRiglet, placeLike, type Joint, type RigletTrial } from './riglet'
import { makeCamera, toFrame, rng, type Placement, type Noise, type Body } from './camera'
import { measure } from '../src/modes/camera/geometry'
import { BASELINE } from '../src/modes/camera/params'
import { standingIssue, STANDING_LIMITS } from '../src/modes/camera/standing'
import type { V3 } from './rbds'

const DIR = process.env.RIGLET_DIR ?? join(homedir(), 'Developer/research-data/riglet')
const RUNS = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const OUT = process.env.SIM_OUT ?? 'sim/result-standing.md'
const it = itAll.skipIf(!existsSync(DIR))
const FPS = 15
const BASE: Placement = { yaw: 0, dist: 1.2, height: 0.8, roll: 0, vfov: 106, k1: 0 }
const NOISE: Noise = { sigma: 0.01, collapse: 0.3, swapPerSec: 0.5 }
const HUNCHES = [5, 10, 15]
const HEAD_LINES = [18, 20, 22, 24, 26]
const TRUNK_LINES = [-2, 0, 2, 4, 6]

const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const pc = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-')

// 背中を丸める：腰の中心と肩の中心の中間を中心に、肩・耳・鼻を前へ θ 度回す（前後と上下の面。X 前・Y 上）
function slump(b: Body, deg: number): Body {
  if (!deg) return b
  const hip = lerp3(b.hipR, b.hipL, 0.5)
  const sh = lerp3(b.shR!, b.shL!, 0.5)
  const o = lerp3(hip, sh, 0.5)
  const r = (deg * Math.PI) / 180
  const rot = (p: V3): V3 => {
    const x = p[0] - o[0]
    const y = p[1] - o[1]
    return [o[0] + x * Math.cos(r) + y * Math.sin(r), o[1] - x * Math.sin(r) + y * Math.cos(r), p[2]]
  }
  return { ...b, shR: rot(b.shR!), shL: rot(b.shL!), earR: rot(b.earR!), earL: rot(b.earL!), nose: rot(b.nose!) }
}

function at(tr: RigletTrial, t: number): Body {
  const x = t * tr.fps
  const i = Math.min(tr.frames - 2, Math.floor(x))
  const u = x - i
  const g = (k: Joint) => lerp3(tr.joints[k][i], tr.joints[k][i + 1], u)
  return {
    hipR: g('hipR'), hipL: g('hipL'), kneeR: g('kneeR'), kneeL: g('kneeL'), ankleR: g('ankleR'), ankleL: g('ankleL'),
    heelR: g('heelR'), heelL: g('heelL'), toeR: g('toeR'), toeL: g('toeL'), pelvis: g('pelvis'),
    shR: g('shR'), shL: g('shL'), earR: g('earR'), earL: g('earL'), nose: g('nose'),
  }
}

// アプリと同じく、3秒（記録が短ければある分）のコマの値の真ん中。頭＝首の角度＋上体（Live.tsx の直立の基準と同じ）
function standValues(tr: RigletTrial, cam: ReturnType<typeof makeCamera>, seed: number, deg: number) {
  const r = rng(seed)
  const st = { ar: [] as number[], swap: 0 }
  const sec = Math.max(1, Math.min(BASELINE.collect, Math.floor(tr.frames / tr.fps)))
  const head: number[] = []
  const trunk: number[] = []
  for (let i = 0; i < sec * FPS; i++) {
    const m = measure(toFrame(slump(at(tr, i / FPS), deg), cam, NOISE, st, r, 1 / FPS))
    head.push(m.neck + m.trunk)
    trunk.push(m.trunk)
  }
  return { head: median(head), trunk: median(trunk) }
}

function people() {
  return readdirSync(DIR)
    .filter((id) => existsSync(join(DIR, id, 'Session1/Calibration/Calibration.c3d')))
    .flatMap((id) => {
      const run = join(DIR, id, 'Session1/Treadmill_Run/Treadmill_Run_Comfortable/Post_Process/Treadmill_Run_Comfortable.c3d')
      if (!existsSync(run)) return []
      try {
        const r = loadRiglet(run, id)
        const s = placeLike(loadRiglet(join(DIR, id, 'Session1/Calibration/Calibration.c3d'), id), r)
        if (s.frames / s.fps < 1) return []
        return [{ id, stand: s, cam: makeCamera(BASE, at(r, 0).pelvis) }]
      } catch {
        return []
      }
    })
}

// 自分の記録の直立の基準：段階 baseline の、止まっていた3秒の窓（1秒ずらし）の真ん中。基準を取った（phase:run の直前の）3秒は別に出す
type Row = { t: number; phase: string; neck: number; trunk: number; moving: boolean }
function ownStands() {
  if (!existsSync(RUNS)) return []
  return readdirSync(RUNS)
    .filter((f) => /^rfc-2026\d{4}-\d{4}_log-\d+\.json$/.test(f))
    .sort()
    .flatMap((f) => {
      const { log } = JSON.parse(readFileSync(join(RUNS, f), 'utf8'))
      const col = (n: string) => log.columns.indexOf(n)
      const rows: Row[] = log.rows.map((r: number[]) => ({ t: r[col('t')], phase: log.phases[r[col('phase')]], neck: r[col('neck')], trunk: r[col('trunk')], moving: r[col('moving')] === 1 }))
      const base = rows.filter((r) => r.phase === 'baseline' && r.neck !== -999 && r.trunk !== -999)
      const runAt = log.events.find((e: [number, string]) => e[1] === 'phase:run')?.[0]
      if (!base.length || runAt === undefined) return []
      const take = (a: number, b: number) => {
        const w = base.filter((r) => r.t > a && r.t <= b)
        return w.length > 10 ? { head: median(w.map((r) => r.neck + r.trunk)), trunk: median(w.map((r) => r.trunk)) } : null
      }
      const final = take(runAt - BASELINE.collect, runAt)
      // 直す声のあとに取り直した試し：直す声（3秒止まってください、で終わる言葉）の直前の3秒
      const retries = log.events
        .filter((e: [number, string]) => e[0] < runAt && /そのまま3秒止まってください/.test(e[1]))
        .map((e: [number, string]) => ({ said: e[1].slice(0, 12), v: take(e[0] - BASELINE.collect, e[0]) }))
      return final ? [{ file: f.slice(4, 17), final, retries }] : []
    })
}

it('直立の確かめ：決まった線で猫背を見分ける', () => {
  const ps = people()
  const up = ps.map((p, k) => standValues(p.stand, p.cam, 100 + k, 0))
  const hunched = HUNCHES.map((d) => ps.map((p, k) => standValues(p.stand, p.cam, 100 + k, d)))
  const own = ownStands()
  const lines: string[] = []
  const p = (s = '') => lines.push(s)
  p('# 直立の確かめ：決まった線で猫背を見分ける（仮想実験と自分の記録）')
  p()
  p('動かし方と限りは sim/standing.sim.ts の先頭。値は鉛直からの前傾（度）。頭＝肩→耳の前傾（アプリの「首の角度＋上体」）、上体＝腰の中心→肩の中心の前傾。')
  p(`研究データ（Riglet 2024）の${ps.length}人の立った姿勢を、真横・1.2m・高さ80cm・超広角の仮想のスマホで映し、アプリと同じく3秒のコマの真ん中を取った。`)
  p('「猫背 θ°」は、上体の真ん中（腰と肩の中間）を中心に、肩から上を前へ θ° 回した形（頭も肩といっしょに前に出る）。')
  p()
  p('## 値の散らばり')
  p()
  p('| 姿勢 | 頭：いちばん小さい・下から1割・真ん中・上から1割・いちばん大きい | 上体：同じ |')
  p('|---|---|---|')
  const spread = (xs: number[]) => `${f1(Math.min(...xs))}・${f1(q(xs, 0.1))}・${f1(median(xs))}・${f1(q(xs, 0.9))}・${f1(Math.max(...xs))}`
  p(`| まっすぐ立つ（${ps.length}人） | ${spread(up.map((x) => x.head))} | ${spread(up.map((x) => x.trunk))} |`)
  HUNCHES.forEach((d, i) => {
    const h = hunched[i]
    const dh = median(h.map((x, k) => x.head - up[k].head))
    const dt = median(h.map((x, k) => x.trunk - up[k].trunk))
    p(`| 猫背 ${d}°（増えの真ん中 頭 +${f1(dh)}°・上体 +${f1(dt)}°） | ${spread(h.map((x) => x.head))} | ${spread(h.map((x) => x.trunk))} |`)
  })
  p()
  if (own.length) {
    p(`## 自分の記録（カメラ版の直立の基準、${own.length}本）`)
    p()
    p('| 走り | 基準にした3秒：頭・上体 | 直す声の前の3秒（言った言葉）：頭・上体 |')
    p('|---|---|---|')
    for (const o of own) p(`| ${o.file} | ${f1(o.final.head)}°・${f1(o.final.trunk)}° | ${o.retries.map((r) => (r.v ? `${f1(r.v.head)}°・${f1(r.v.trunk)}°（${r.said}…）` : `-（${r.said}…）`)).join(' ') || '-'} |`)
    p()
  }
  p('## 線ごとの見分け（研究データ）')
  p()
  p('「通る」はまっすぐ立った人のうち線の内側（頭 ≦ 線 かつ 上体 ≦ 線）だった割合。「止める」は猫背の形が線を越えた割合。自分の記録は、基準にした3秒が通った本数。')
  p()
  p('| 頭の線 | 上体の線 | まっすぐ立つ：通る | ' + HUNCHES.map((d) => `猫背 ${d}°：止める`).join(' | ') + ' | 自分の記録：通る |')
  p('|---|---|---|' + HUNCHES.map(() => '---').join('|') + '|---|')
  const passes = (x: { head: number; trunk: number }, h: number, t: number) => x.head <= h && x.trunk <= t
  for (const h of HEAD_LINES)
    for (const t of TRUNK_LINES) {
      const cells = hunched.map((hs) => pc(hs.filter((x) => !passes(x, h, t)).length, hs.length))
      p(`| ${h}° | ${t}° | ${pc(up.filter((x) => passes(x, h, t)).length, up.length)} | ${cells.join(' | ')} | ${own.filter((o) => passes(o.final, h, t)).length} / ${own.length} |`)
    }
  p()
  // 1つの値で見たとき：まっすぐ立った人の 95% が通る線と、そのとき猫背を止める割合（AUC は、まっすぐ立った人と猫背の人を1組ずつ比べて、猫背のほうが大きい割合）
  p('## 1つの値で見たとき（研究データ）')
  p()
  p('| 値 | まっすぐ立つ人の95%が通る線 | ' + HUNCHES.map((d) => `猫背 ${d}°：止める・AUC`).join(' | ') + ' |')
  p('|---|---|' + HUNCHES.map(() => '---').join('|') + '|')
  const FEATS: { name: string; v: (x: { head: number; trunk: number }) => number }[] = [
    { name: '頭', v: (x) => x.head },
    { name: '上体', v: (x) => x.trunk },
    { name: '首の角度（頭 − 上体）', v: (x) => x.head - x.trunk },
    { name: '頭 + 上体', v: (x) => x.head + x.trunk },
    { name: '頭 + 上体 × 2', v: (x) => x.head + 2 * x.trunk },
  ]
  for (const ft of FEATS) {
    const u = up.map(ft.v)
    const line = q(u, 0.95)
    const cells = hunched.map((hs) => {
      const h = hs.map(ft.v)
      let auc = 0
      for (const a of u) for (const b of h) auc += b > a ? 1 : b === a ? 0.5 : 0
      return `${pc(h.filter((x) => x > line).length, h.length)}・${(auc / (u.length * h.length)).toFixed(2)}`
    })
    p(`| ${ft.name} | ${f1(line)}° | ${cells.join(' | ')} |`)
  }
  p()
  // いまの線（params.ts の BASELINE）での結果。頭だけ・上体だけで止めた割合も出す
  p(`## いまの線（頭 ${STANDING_LIMITS.head}°・上体 ${STANDING_LIMITS.trunk}°。standing.ts の standingIssue）`)
  p()
  p('| 見るもの | まっすぐ立つ：通る | ' + HUNCHES.map((d) => `猫背 ${d}°：止める`).join(' | ') + ' | 自分の記録：通る |')
  p('|---|---|' + HUNCHES.map(() => '---').join('|') + '|---|')
  const by: { name: string; ok: (x: { head: number; trunk: number }) => boolean }[] = [
    { name: '両方（アプリ）', ok: (x) => standingIssue(x) === null },
    { name: '上体だけ', ok: (x) => x.trunk <= STANDING_LIMITS.trunk },
    { name: '頭だけ', ok: (x) => x.head <= STANDING_LIMITS.head },
  ]
  for (const b of by) {
    const n = (xs: { head: number; trunk: number }[]) => xs.filter(b.ok).length
    p(`| ${b.name} | ${pc(n(up), up.length)} | ${hunched.map((h) => pc(h.length - n(h), h.length)).join(' | ')} | ${own.length ? `${n(own.map((o) => o.final))} / ${own.length}` : '-'} |`)
  }
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
})
