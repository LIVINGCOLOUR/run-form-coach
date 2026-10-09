// 仮想実験（頭）：立った姿勢と、トレッドミルを走る姿を、置き方を変えた仮想のスマホで映し、
// アプリの「頭が前に出た量」（走っているときの首の角度 − 立って測った基準）がどれだけずれるか、声かけが正しく出るかを測る
// 動かし方：RIGLET_DIR=<Riglet のデータ> npx vitest run --config sim/vitest.config.ts sim/head.sim.ts
// データ：<ID>/Session1/Calibration/Calibration.c3d（立った姿勢）と
//         <ID>/Session1/Treadmill_Run/Treadmill_Run_Comfortable/Post_Process/Treadmill_Run_Comfortable.c3d（楽なペース）
// 頭を前に出した走りはデータにないので、首の付け根を中心に頭（耳・鼻）を前に回して作る
import { it } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRiglet, placeLike, type Joint, type RigletTrial } from './riglet'
import { makeCamera, toFrame, rng, W, H, type Placement, type Noise, type Body } from './camera'
import { leanFromVertical, levelFrame, measure, rotateFrame, sideOffDeg, yawSign } from '../src/core/geometry'
import { LIMITS, BASELINE, HEAD_ABS } from '../src/core/params'
import type { V3 } from './rbds'

const DIR = process.env.RIGLET_DIR!
const FPS = 15
const REF = 25 // 走り始めの基準にする長さ（秒）
const EVAL = 30 // 判定を見る長さ（秒）。基準のあと
const TILT = 10 // 作りものの「頭を前に出した走り」で、頭を回す角度（度）
const BASE: Placement = { yaw: 0, dist: 1.2, height: 0.8, roll: 0, vfov: 106, k1: 0 }
const BASE_NOISE: Noise = { sigma: 0.01, collapse: 0.3, swapPerSec: 0.5 }
const CASES: { label: string; pl: Partial<Placement>; noise?: Partial<Noise> }[] = [
  { label: '基準（真横・1.2m・高さ80cm・ぶれ1%）', pl: {} },
  { label: '点のぶれなし', pl: {}, noise: { sigma: 0, collapse: 0, swapPerSec: 0 } },
  { label: '点のぶれ2%', pl: {}, noise: { sigma: 0.02 } },
  { label: '高さ50cm', pl: { height: 0.5 } },
  { label: '高さ120cm＋補正', pl: { height: 1.2, fix: true } },
  { label: '高さ160cm＋補正', pl: { height: 1.6, fix: true } },
  { label: '前側から15°', pl: { yaw: 15 } },
  { label: '前側から30°', pl: { yaw: 30 } },
  { label: '後ろ側から30°', pl: { yaw: -30 } },
  { label: '距離2.0m', pl: { dist: 2.0 } },
  { label: '傾き6°＋補正', pl: { roll: 6, fix: true } },
]

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]

// 頭を前に回す：首の付け根（両肩の真ん中から5cm上）を中心に、前後と上下の面で tilt 度
function tiltHead(b: Body, tilt: number): Body {
  if (!tilt) return b
  const sh = lerp3(b.shR!, b.shL!, 0.5)
  const o: V3 = [sh[0], sh[1] + 50, sh[2]]
  const r = (tilt * Math.PI) / 180
  const rot = (p: V3): V3 => {
    const x = p[0] - o[0]
    const y = p[1] - o[1]
    return [o[0] + x * Math.cos(r) + y * Math.sin(r), o[1] - x * Math.sin(r) + y * Math.cos(r), p[2]]
  }
  return { ...b, earR: rot(b.earR!), earL: rot(b.earL!), nose: rot(b.nose!) }
}

function at(tr: RigletTrial, t: number, tilt = 0): Body {
  const x = t * tr.fps
  const i = Math.min(tr.frames - 2, Math.floor(x))
  const u = x - i
  const g = (k: Joint) => lerp3(tr.joints[k][i], tr.joints[k][i + 1], u)
  return tiltHead(
    {
      hipR: g('hipR'), hipL: g('hipL'), kneeR: g('kneeR'), kneeL: g('kneeL'), ankleR: g('ankleR'), ankleL: g('ankleL'),
      heelR: g('heelR'), heelL: g('heelL'), toeR: g('toeR'), toeL: g('toeL'), pelvis: g('pelvis'),
      shR: g('shR'), shL: g('shL'), earR: g('earR'), earL: g('earL'), nose: g('nose'),
    },
    tilt,
  )
}

// 本当の首の角度：アプリと同じ定義（手前＝右の、肩→耳の前傾 − 腰→肩の前傾）を、前後と上下の面でそのまま測る
function trueNeck(b: Body) {
  const p = (v: V3) => ({ x: v[0], y: -v[1], v: 1 })
  return leanFromVertical(p(b.shR!), p(b.earR!), 1) - leanFromVertical(p(b.hipR), p(b.shR!), 1)
}

// アプリと同じく、毎秒15コマで測って1秒ごとに平均する
function appNeck(tr: RigletTrial, cam: ReturnType<typeof makeCamera>, pl: Placement, noise: Noise, seed: number, from: number, sec: number, tilt = 0) {
  const r = rng(seed)
  const st = { ar: [] as number[], swap: 0 }
  const out: number[] = []
  let acc: number[] = []
  for (let i = 0; i < sec * FPS; i++) {
    let f = toFrame(at(tr, from + i / FPS, tilt), cam, noise, st, r, 1 / FPS)
    if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
    acc.push(measure(f).neck)
    if ((i + 1) % FPS === 0) {
      out.push(mean(acc))
      acc = []
    }
  }
  return out
}

// 6秒平均が声をかける線を越えた割合（アプリと同じく、1秒ごとの「頭が出た量」は0より下を0にしてから平均する）
function share(perSec: number[], ref: number) {
  const head = perSec.map((n) => Math.max(0, n - ref))
  let c = 0
  let n = 0
  for (let s = 0; s + 6 <= head.length; s++, n++) if (mean(head.slice(s, s + 6)) > LIMITS.head.cue) c++
  return c / n
}

// 立った記録は短い人が多い（1〜5秒）ので、測るのは最大でアプリと同じ3秒、短ければある分だけ（立ったままなので短くても値は変わらない）
const standSec = (t: RigletTrial) => Math.max(1, Math.min(BASELINE.collect, Math.floor(t.frames / t.fps)))

// 比べる案：6秒の平均を取ってから基準と比べる
function shareAvg(perSec: number[], ref: number) {
  let c = 0
  let n = 0
  for (let s = 0; s + 6 <= perSec.length; s++, n++) if (mean(perSec.slice(s, s + 6)) - ref > LIMITS.head.cue) c++
  return c / n
}

function load() {
  return readdirSync(DIR)
    .filter((id) => existsSync(join(DIR, id, 'Session1/Calibration/Calibration.c3d')))
    .flatMap((id) => {
      const run = join(DIR, id, 'Session1/Treadmill_Run/Treadmill_Run_Comfortable/Post_Process/Treadmill_Run_Comfortable.c3d')
      if (!existsSync(run)) return []
      try {
        const r = loadRiglet(run, id)
        const s = placeLike(loadRiglet(join(DIR, id, 'Session1/Calibration/Calibration.c3d'), id), r)
        if (s.frames / s.fps < 1 || r.frames / r.fps < REF + EVAL + 1) return []
        return [{ id, stand: s, run: r }]
      } catch {
        return []
      }
    })
}

it('頭が前に出た量の判定のずれ', () => {
  const people = load()
  // 本当の値
  const truth = people.map((p) => {
    const stand = mean(Array.from({ length: standSec(p.stand) * FPS }, (_, i) => trueNeck(at(p.stand, i / FPS))))
    const runAt = (from: number, sec: number, tilt = 0) => mean(Array.from({ length: sec * FPS }, (_, i) => trueNeck(at(p.run, from + i / FPS, tilt))))
    return { stand, early: runAt(0, REF), later: runAt(REF, EVAL), tilted: runAt(REF, EVAL, TILT) }
  })
  const d = truth.map((t) => t.later - t.stand)
  const fmt = (xs: number[]) => `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(1)}°（±${mean(xs.map(Math.abs)).toFixed(1)}）`
  const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
  const head =
    `本当の値（${people.length}人）：首の角度は、立った姿勢から走ると平均 ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(1)}°（人によるばらつき ±${sd(d).toFixed(1)}°、` +
    `いちばん小さい人 ${Math.min(...d).toFixed(1)}°・大きい人 ${Math.max(...d).toFixed(1)}°）。` +
    `声をかける線（${LIMITS.head.cue}°）を越える人は ${d.filter((x) => x > LIMITS.head.cue).length}人。\n` +
    `走り始めの${REF}秒とそのあとの${EVAL}秒の差：平均 ${fmt(truth.map((t) => t.later - t.early))}。` +
    `頭を${TILT}°前に回すと、首の角度は平均 ${fmt(truth.map((t) => t.tilted - t.later))} 増える。\n\n` +
    `| 置き方 | 立った基準のずれ | 走りのずれ | 立った基準と比べる：ふつう | 立った基準と比べる：頭を前に | 走り始めと比べる：ふつう | 走り始めと比べる：頭を前に | 平均してから比べる：ふつう | 平均してから比べる：頭を前に |\n|---|---|---|---|---|---|---|---|---|`
  const rows = CASES.map((c) => {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const r = people.map((p, k) => {
      // スマホは走りの最初の腰の位置に向けて置き、立った基準も同じスマホで測る
      const cam = makeCamera(pl, at(p.run, 0).pelvis)
      const stand = median(appNeck(p.stand, cam, pl, noise, 10 + k, 0, standSec(p.stand)))
      const early = appNeck(p.run, cam, pl, noise, 20 + k, 0, REF)
      const later = appNeck(p.run, cam, pl, noise, 30 + k, REF, EVAL)
      const tilted = appNeck(p.run, cam, pl, noise, 40 + k, REF, EVAL, TILT)
      const ref = mean(early)
      return {
        errStand: stand - truth[k].stand,
        errRun: mean(later) - truth[k].later,
        sN: share(later, stand),
        sT: share(tilted, stand),
        rN: share(later, ref),
        rT: share(tilted, ref),
        aN: shareAvg(later, ref),
        aT: shareAvg(tilted, ref),
      }
    })
    const pc = (xs: number[]) => `${Math.round(mean(xs) * 100)}%`
    return `| ${c.label} | ${fmt(r.map((x) => x.errStand))} | ${fmt(r.map((x) => x.errRun))} | ${pc(r.map((x) => x.sN))} | ${pc(r.map((x) => x.sT))} | ${pc(r.map((x) => x.rN))} | ${pc(r.map((x) => x.rT))} | ${pc(r.map((x) => x.aN))} | ${pc(r.map((x) => x.aT))} |`
  })
  const per = people.map((p, k) => `| ${p.id} | ${truth[k].stand.toFixed(1)}° | ${truth[k].later.toFixed(1)}° | ${(truth[k].later - truth[k].stand).toFixed(1)}° |`)
  const intro =
    `# 頭が前に出た量の判定のずれ（仮想実験）\n\n` +
    `研究データ（Riglet ら 2024、CC0、https://doi.org/10.6084/m9.figshare.c.7056797.v1）の${people.length}人の、立った姿勢と、トレッドミルを楽なペースで走った記録を、` +
    `仮想のスマホで置き方を変えて毎秒15コマで映した。頭の印（耳の後ろ）と肩・股関節の中心が測られている。立った記録が1秒より短い人は除いた。\n` +
    `首の角度＝手前側の「肩→耳の前傾 − 腰→肩の前傾」（アプリと同じ定義）。ずれは「アプリ − 本当の値」の平均（カッコ内はずれの大きさの平均）。\n` +
    `声かけの割合は、6秒平均が線（${LIMITS.head.cue}°）を越えた割合。「立った基準と比べる」が今のアプリ、「走り始めと比べる」は最初の${REF}秒を基準にした案、` +
    `「平均してから比べる」は1秒ごとに0で切らず、6秒平均を取ってから基準と比べる案。` +
    `「頭を前に」は、首の付け根を中心に頭を${TILT}°前に回して作った走り（データに頭を前に出した条件はない）。\n` +
    `動かし方：RIGLET_DIR=<データ> npx vitest run --config sim/vitest.config.ts sim/head.sim.ts\n\n`
  const text = `${intro}${head}\n${rows.join('\n')}\n\n| 人 | 立った姿勢の首の角度 | 走っているときの首の角度 | 差 |\n|---|---|---|---|\n${per.join('\n')}`
  console.log(text)
  writeFileSync(process.env.SIM_OUT ?? 'sim/result-head.md', text + '\n')
})

// 最初から頭が前に出ている人を、決まった線で見つけられるか：走っているときの「肩→耳の前傾」（鉛直から。上体の傾きを引かない）を、
// 人ごとの違いと、置き方によるずれの大きさで比べる
it('頭の位置そのもの（肩→耳の前傾）', () => {
  const people = load()
  const p2 = (v: V3) => ({ x: v[0], y: -v[1], v: 1 })
  const trueA = (b: Body) => leanFromVertical(p2(b.shR!), p2(b.earR!), 1)
  const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
  const run = people.map((p) => mean(Array.from({ length: REF * FPS }, (_, i) => trueA(at(p.run, i / FPS)))))
  const stand = people.map((p) => mean(Array.from({ length: standSec(p.stand) * FPS }, (_, i) => trueA(at(p.stand, i / FPS)))))
  const mr = mean(run)
  const ms = mean(stand)
  const corr = mean(run.map((r, k) => (r - mr) * (stand[k] - ms))) / (sd(run) * sd(stand))
  const sorted = [...run].sort((a, b) => a - b)
  let text =
    `## 頭の位置そのもの（肩→耳の前傾、鉛直から）\n\n` +
    `走り始め${REF}秒の本当の値（${people.length}人）：平均 ${mr.toFixed(1)}°、人によるばらつき ±${sd(run).toFixed(1)}°、` +
    `小さい順 ${sorted.map((x) => x.toFixed(0)).join(' ')}\n` +
    `立った姿勢：平均 ${ms.toFixed(1)}°（±${sd(stand).toFixed(1)}°）。立った姿勢と走っているときの相関 ${corr.toFixed(2)}\n\n` +
    `| 置き方 | ずれの平均 | 人によるずれのばらつき |\n|---|---|---|\n`
  for (const c of CASES) {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const err = people.map((p, k) => {
      const cam = makeCamera(pl, at(p.run, 0).pelvis)
      const r = rng(60 + k)
      const st = { ar: [] as number[], swap: 0 }
      const xs: number[] = []
      for (let i = 0; i < REF * FPS; i++) {
        let f = toFrame(at(p.run, i / FPS), cam, noise, st, r, 1 / FPS)
        if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
        xs.push(leanFromVertical(f[12], f[8], measure(f).dir))
      }
      return mean(xs) - run[k]
    })
    text += `| ${c.label} | ${mean(err) >= 0 ? '+' : ''}${mean(err).toFixed(1)}° | ±${sd(err).toFixed(1)}° |\n`
  }
  console.log(text)
  writeFileSync((process.env.SIM_OUT ?? 'sim/result-head.md').replace(/\.md$/, '-abs.md'), text)
})

// 真横からのずれを、画面の骨格からどれだけ見分けられるか（立った姿勢＝置き方を決めるとき、走り＝走り始めの3分）
it('真横からのずれの見分け', () => {
  const people = load()
  const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
  let text = `## 真横からのずれの見分け\n\n左右の腰と肩の見え方から出す値（yawSign、前側で正）と、見えている幅から出す角度（sideOffDeg）。人による平均（±人によるばらつき）。立った姿勢は2秒、走りは${REF}秒の平均\n\n| スマホの向き | 立った姿勢：yawSign | 走り：yawSign | 立った姿勢：sideOffDeg |\n|---|---|---|---|\n`
  for (const yaw of [-30, -20, -10, -5, 0, 5, 10, 15, 20, 30]) {
    const pl = { ...BASE, yaw }
    const v = people.map((p, k) => {
      const cam = makeCamera(pl, at(p.run, 0).pelvis)
      const go = (tr: RigletTrial, sec: number, seed: number) => {
        const r = rng(seed)
        const st = { ar: [] as number[], swap: 0 }
        const ys: number[] = []
        const ss: number[] = []
        for (let i = 0; i < sec * FPS; i++) {
          const f = toFrame(at(tr, i / FPS), cam, BASE_NOISE, st, r, 1 / FPS)
          ys.push(yawSign(f))
          ss.push(sideOffDeg(f))
        }
        return { y: mean(ys), s: mean(ss) }
      }
      const a = go(p.stand, Math.min(2, standSec(p.stand)), 100 + k)
      const b = go(p.run, REF, 200 + k)
      return { ys: a.y, yr: b.y, ss: a.s }
    })
    const f = (xs: number[], d = 3) => `${mean(xs).toFixed(d)}（±${sd(xs).toFixed(d)}）`
    text += `| ${yaw > 0 ? '前側' : yaw < 0 ? '後ろ側' : '真横'}${yaw ? Math.abs(yaw) + '°' : ''} | ${f(v.map((x) => x.ys))} | ${f(v.map((x) => x.yr))} | ${f(v.map((x) => x.ss), 1)} |\n`
  }
  console.log(text)
  writeFileSync((process.env.SIM_OUT ?? 'sim/result-head.md').replace(/\.md$/, '-yaw.md'), text)
})

// 3分の時点の一度だけの確認（頭の位置そのものを HEAD_ABS.line と比べる）が、置き方によってどう働くか
it('最初から頭が前に出ている人の確認', () => {
  const people = load()
  const p2 = (v: V3) => ({ x: v[0], y: -v[1], v: 1 })
  const trueA = people.map((p) => mean(Array.from({ length: REF * FPS }, (_, i) => leanFromVertical(p2(at(p.run, i / FPS).shR!), p2(at(p.run, i / FPS).earR!), 1))))
  let text =
    `## 最初から頭が前に出ている人の確認（線 ${HEAD_ABS.line}°、真横から ±${HEAD_ABS.yawMax} 以内のときだけ）\n\n` +
    `本当の頭の位置（肩→耳の前傾）：${[...trueA].sort((a, b) => a - b).map((x) => x.toFixed(0)).join(' ')}\n\n` +
    `| 置き方 | 確認できた人 | 声がかかった人（本当の頭の位置） | 頭を${TILT}°前に回すと声がかかった人 |\n|---|---|---|---|\n`
  for (const c of CASES) {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const r = people.map((p, k) => {
      const cam = makeCamera(pl, at(p.run, 0).pelvis)
      const go = (tilt: number) => {
        const rr = rng(300 + k)
        const st = { ar: [] as number[], swap: 0 }
        const hl: number[] = []
        const yw: number[] = []
        for (let i = 0; i < REF * FPS; i++) {
          let f = toFrame(at(p.run, i / FPS, tilt), cam, noise, st, rr, 1 / FPS)
          if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), cam.pitch, pl.vfov, W, H)
          const m = measure(f)
          hl.push(m.headLean)
          yw.push(m.yaw)
        }
        const ok = Math.abs(mean(yw)) <= HEAD_ABS.yawMax
        return { ok, cue: ok && mean(hl) > HEAD_ABS.line }
      }
      return { a: go(0), b: go(TILT), truth: trueA[k] }
    })
    const flagged = r.filter((x) => x.a.cue).map((x) => x.truth.toFixed(0))
    text += `| ${c.label} | ${r.filter((x) => x.a.ok).length}/${r.length} | ${flagged.length}人（${flagged.join(' ') || 'なし'}） | ${r.filter((x) => x.b.cue).length}人 |\n`
  }
  console.log(text)
  writeFileSync((process.env.SIM_OUT ?? 'sim/result-head.md').replace(/\.md$/, '-once.md'), text)
})
