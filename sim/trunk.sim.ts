// 仮想実験（上体）：ふつうに走る条件と、上体を前に倒して走る条件を、置き方を変えた仮想のスマホで映し、
// アプリの「上体の傾き」「体全体の傾き」がどれだけずれるか、前かがみの声かけが正しく出るかを測る
// 動かし方：VH_DIR=<Van Hooren のデータ> npx vitest run --config sim/vitest.config.ts sim/trunk.sim.ts
// データ：https://osf.io/7qbxc/ の Sub_XX_trunklean.c3d と Sub_XX_333ms.c3d（秒速3.33m）
import { it as itAll } from 'vitest'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadUpper, type UpperTrial } from './vanhooren'
import { makeCamera, toFrame, rng, W, H, type Placement, type Noise, type Body } from './camera'
import { levelFrame, measure, rotateFrame } from '../src/modes/camera/geometry'
import { LIMITS, REL_LIMITS } from '../src/modes/camera/params'
import type { V3 } from './rbds'

const DIR = process.env.VH_DIR!
// データの置き場所がないときは動かさない（空のまま結果のファイルを書き換えないため）
const it = itAll.skipIf(!DIR)
const T0 = 20
const SEC = 30
const FPS = 15
const BASE: Placement = { yaw: 0, dist: 1.2, height: 0.8, roll: 0, vfov: 106, k1: 0 }
const BASE_NOISE: Noise = { sigma: 0.01, collapse: 0.3, swapPerSec: 0.5 }
const CASES: { label: string; pl: Partial<Placement>; noise?: Partial<Noise> }[] = [
  { label: '基準（真横・1.2m・高さ80cm・ぶれ1%）', pl: {} },
  { label: '点のぶれなし', pl: {}, noise: { sigma: 0, collapse: 0, swapPerSec: 0 } },
  { label: '点のぶれ2%', pl: {}, noise: { sigma: 0.02 } },
  { label: '高さ20cm', pl: { height: 0.2 } },
  { label: '高さ50cm', pl: { height: 0.5 } },
  { label: '高さ120cm', pl: { height: 1.2 } },
  { label: '高さ120cm＋補正', pl: { height: 1.2, fix: true } },
  { label: '高さ160cm', pl: { height: 1.6 } },
  { label: '高さ160cm＋補正', pl: { height: 1.6, fix: true } },
  { label: '前側から15°', pl: { yaw: 15 } },
  { label: '前側から30°', pl: { yaw: 30 } },
  { label: '後ろ側から30°', pl: { yaw: -30 } },
  { label: '距離2.0m', pl: { dist: 2.0 } },
  { label: '距離3.0m', pl: { dist: 3.0 } },
  { label: '傾き6°（直さない）', pl: { roll: 6 } },
  { label: '傾き6°＋補正', pl: { roll: 6, fix: true } },
]

const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
function at(tr: UpperTrial, t: number): Body {
  const x = t * tr.fps
  const i = Math.min(tr.frames - 2, Math.floor(x))
  const u = x - i
  const g = (k: keyof UpperTrial['joints']) => lerp3(tr.joints[k][i], tr.joints[k][i + 1], u)
  return {
    hipR: g('hipR'), hipL: g('hipL'), kneeR: g('kneeR'), kneeL: g('kneeL'), ankleR: g('ankleR'), ankleL: g('ankleL'),
    heelR: g('heelR'), heelL: g('heelL'), toeR: g('toeR'), toeL: g('toeL'), pelvis: g('pelvis'),
    shR: g('shR'), shL: g('shL'), ear: g('ear'), nose: g('nose'),
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const lean = (lo: V3, hi: V3) => (Math.atan2(hi[0] - lo[0], hi[1] - lo[1]) * 180) / Math.PI

// 本当の値：上体＝腰の中心→肩の中心、体全体＝足首の中心→肩の中心（前後と上下の面での、鉛直からの前傾）
function truth(tr: UpperTrial) {
  const trunk: number[] = []
  const body: number[] = []
  for (let t = T0; t < T0 + SEC; t += 1 / FPS) {
    const b = at(tr, t)
    const sh = lerp3(b.shR!, b.shL!, 0.5)
    trunk.push(lean(b.pelvis, sh))
    body.push(lean(lerp3(b.ankleR, b.ankleL, 0.5), sh))
  }
  return { trunk: mean(trunk), body: mean(body) }
}

// アプリの値：毎秒15コマで、1秒ごとの平均を出し、6秒平均が声をかける線を越えた割合も数える
function app(tr: UpperTrial, pl: Placement, noise: Noise, seed: number) {
  const center = at(tr, T0).pelvis
  const cam = makeCamera(pl, center)
  const r = rng(seed)
  const st = { ar: [] as number[], swap: 0 }
  const per: { trunk: number; body: number }[] = []
  let sec: { trunk: number[]; body: number[] } = { trunk: [], body: [] }
  for (let i = 0; i < SEC * FPS; i++) {
    let f = toFrame(at(tr, T0 + i / FPS), cam, noise, st, r, 1 / FPS)
    if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
    const m = measure(f)
    sec.trunk.push(m.trunk)
    sec.body.push(m.body)
    if ((i + 1) % FPS === 0) {
      per.push({ trunk: mean(sec.trunk), body: mean(sec.body) })
      sec = { trunk: [], body: [] }
    }
  }
  let cue = 0
  let n = 0
  for (let s = 0; s + 6 <= per.length; s++, n++) {
    const w = per.slice(s, s + 6)
    if (mean(w.map((x) => x.trunk)) > LIMITS.trunk.cue || mean(w.map((x) => x.body)) > LIMITS.body.cue) cue++
  }
  return { trunk: mean(per.map((x) => x.trunk)), body: mean(per.map((x) => x.body)), cueShare: cue / n }
}

it('上体の傾きの判定のずれ', () => {
  const files = readdirSync(DIR)
  const subjects = [...new Set(files.filter((f) => /^Sub_\d+_trunklean\.c3d$/i.test(f)).map((f) => f.slice(0, 6)))]
  const pairs = subjects.flatMap((s) => {
    const lean = files.find((f) => f.toLowerCase() === `${s.toLowerCase()}_trunklean.c3d`)
    const norm = files.find((f) => f === `${s}_333ms.c3d` || f === `${s}_333.c3d`)
    if (!lean || !norm) return []
    // 印が足りない人（Sub_18 は胸骨の印 JN がない）は除く
    try {
      return [{ s, lean: loadUpper(join(DIR, lean), s), norm: loadUpper(join(DIR, norm), s) }]
    } catch (e) {
      console.log(`使えない：${(e as Error).message}`)
      return []
    }
  })
  const tN = pairs.map((p) => truth(p.norm))
  const tL = pairs.map((p) => truth(p.lean))
  const head =
    `本当の値（${pairs.length}人の平均）：上体 ふつう ${mean(tN.map((x) => x.trunk)).toFixed(1)}° → 前に倒す ${mean(tL.map((x) => x.trunk)).toFixed(1)}°、` +
    `体全体 ふつう ${mean(tN.map((x) => x.body)).toFixed(1)}° → 前に倒す ${mean(tL.map((x) => x.body)).toFixed(1)}°（声をかける線：上体 ${LIMITS.trunk.cue}°・体全体 ${LIMITS.body.cue}°）\n\n` +
    `| 置き方 | 上体のずれ（ふつう） | 上体のずれ（前に倒す） | 体全体のずれ（ふつう） | 体全体のずれ（前に倒す） | 声かけ：ふつう | 声かけ：前に倒す |\n|---|---|---|---|---|---|---|`
  const fmt = (xs: number[]) => `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(1)}°（±${mean(xs.map(Math.abs)).toFixed(1)}）`
  const rows = CASES.map((c) => {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const aN = pairs.map((p, k) => app(p.norm, pl, noise, 10 + k))
    const aL = pairs.map((p, k) => app(p.lean, pl, noise, 50 + k))
    return `| ${c.label} | ${fmt(aN.map((a, k) => a.trunk - tN[k].trunk))} | ${fmt(aL.map((a, k) => a.trunk - tL[k].trunk))} | ${fmt(aN.map((a, k) => a.body - tN[k].body))} | ${fmt(aL.map((a, k) => a.body - tL[k].body))} | ${Math.round(mean(aN.map((a) => a.cueShare)) * 100)}% | ${Math.round(mean(aL.map((a) => a.cueShare)) * 100)}% |`
  })
  const text = `${head}\n${rows.join('\n')}`
  console.log(text)
  writeFileSync(process.env.SIM_OUT ?? 'sim/result-trunk.md', text + '\n')
})

// 走り始めの自分との比べ：ふつうに走った最初の60秒を基準にし、そのあとの60秒（ふつう）と、前に倒して走った30秒で、
// 6秒平均が声をかける線を越えた割合を、決まった線と比べる
function perSecond(tr: UpperTrial, pl: Placement, noise: Noise, seed: number, from: number, sec: number) {
  const cam = makeCamera(pl, at(tr, from).pelvis)
  const r = rng(seed)
  const st = { ar: [] as number[], swap: 0 }
  const out: { trunk: number; body: number }[] = []
  let acc: { trunk: number[]; body: number[] } = { trunk: [], body: [] }
  for (let i = 0; i < sec * FPS; i++) {
    let f = toFrame(at(tr, from + i / FPS), cam, noise, st, r, 1 / FPS)
    if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
    const m = measure(f)
    acc.trunk.push(m.trunk)
    acc.body.push(m.body)
    if ((i + 1) % FPS === 0) {
      out.push({ trunk: mean(acc.trunk), body: mean(acc.body) })
      acc = { trunk: [], body: [] }
    }
  }
  return out
}
function share(per: { trunk: number; body: number }[], over: (w: { trunk: number; body: number }) => boolean) {
  let n = 0
  let c = 0
  for (let s = 0; s + 6 <= per.length; s++, n++) {
    const w = { trunk: mean(per.slice(s, s + 6).map((x) => x.trunk)), body: mean(per.slice(s, s + 6).map((x) => x.body)) }
    if (over(w)) c++
  }
  return c / n
}

it('走り始めの自分との比べ', () => {
  const files = readdirSync(DIR)
  const subjects = [...new Set(files.filter((f) => /^Sub_\d+_trunklean\.c3d$/i.test(f)).map((f) => f.slice(0, 6)))]
  const pairs = subjects.flatMap((s) => {
    const lean = files.find((f) => f.toLowerCase() === `${s.toLowerCase()}_trunklean.c3d`)
    const norm = files.find((f) => f === `${s}_333ms.c3d` || f === `${s}_333.c3d`)
    if (!lean || !norm) return []
    try {
      return [{ lean: loadUpper(join(DIR, lean), s), norm: loadUpper(join(DIR, norm), s) }]
    } catch {
      return []
    }
  })
  const rows = CASES.map((c) => {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const r = pairs.map((p, k) => {
      const ref = perSecond(p.norm, pl, noise, 70 + k, 20, 60)
      const later = perSecond(p.norm, pl, noise, 80 + k, 80, 60)
      const lean = perSecond(p.lean, pl, noise, 90 + k, 5, 30)
      const rt = mean(ref.map((x) => x.trunk))
      const rb = mean(ref.map((x) => x.body))
      const abs = (w: { trunk: number; body: number }) => w.trunk > LIMITS.trunk.cue || w.body > LIMITS.body.cue
      const rel = (w: { trunk: number; body: number }) => w.trunk - rt > REL_LIMITS.trunk.cue || w.body - rb > REL_LIMITS.body.cue
      return { absN: share(later, abs), absL: share(lean, abs), relN: share(later, rel), relL: share(lean, rel) }
    })
    const pc = (xs: number[]) => `${Math.round(mean(xs) * 100)}%`
    return `| ${c.label} | ${pc(r.map((x) => x.absN))} | ${pc(r.map((x) => x.absL))} | ${pc(r.map((x) => x.relN))} | ${pc(r.map((x) => x.relL))} |`
  })
  const text = `| 置き方 | 決まった線：ふつう | 決まった線：前に倒す | 自分と比べる：ふつう | 自分と比べる：前に倒す |\n|---|---|---|---|---|\n${rows.join('\n')}`
  console.log(text)
  writeFileSync((process.env.SIM_OUT ?? 'sim/result-trunk.md').replace(/\.md$/, '-rel.md'), text + '\n')
})
