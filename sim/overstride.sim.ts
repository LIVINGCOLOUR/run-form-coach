// 仮想実験（走り出し、今日の基準ができる前のオーバーストライド）：決まった線で、はっきり足が前に着く走りに声をかけられるか。
//   ① 速さの目安（landing.ts の speedOf）は当てになるか：同じ人が速さを変えたとき・同じ速さでピッチを変えたときの、
//     本当のベルトの速さ・カメラの速さの目安・すねの振りの速さ（遊脚の、すねの角速度の山。足首のセンサーと同じもの）の変わり方を比べる。
//     自分の記録（2026-11-02）の「足首のセンサーの振り +22〜26% のところで、カメラの速さの目安 +50%」が、測り違いかを見る
//   ② 決まった線：研究データのふつうの走り（185本）を LongRun で10分にのばし、実機の記録のコマの間隔で仮想のスマホに映して、
//     16秒の窓の値（速さで補正したかかとの前・すねの角度・速さで補正したすねの角度）が線を越えた走りと回数を数える。
//     足が前に着く崩しは、データにないので、山の値に足して作る：脚を股関節から前へ α 度回した形（かかとの前 +α（ラジアン）× 脚の長さ、すね +α°）。
//     自分の記録（2026-11-02）のわざと前に着いた区間は、ふつうの区間より かかとの前 +0.15・すね +9° で、この形に合う
//     （速さの目安とピッチの外れは、その区間でふつうの揺れの中だった）
//   ③ ② で選んだ線（FORM.landing.max）と、着地の仮の基準（LANDING.early）を、アプリのコーチ（coach.ts）に通し、外れた声（10分あたり）と、
//     崩しに声が出た割合・声が出るまでの秒を数える。④（自分の記録）は、scripts/treadmill/replay.ts で通し直した値を手で書いたもの
// 動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… VH_CAD_DIR=… npx vitest run --config sim/vitest.config.ts sim/overstride.sim.ts
//   （結果は sim/result-overstride.md。OVERSTRIDE_CACHE=<json> を付けると、映した山をためて2回目から速くなる）
import { describe, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRbdsLanding, loadRigletLanding, loadVhLanding, legLengthOf, type LandingTrial } from './landing-data'
import { bodyAt as bodyAtTrial, filmFrames, runningSpan } from './landing-film'
import { LongRun } from './longrun'
import { LandingMeter, speedOf, landingOf, median, type Peak, type Track } from '../src/modes/camera/landing'
import { Coach } from '../src/modes/camera/coach'
import { MotionDetector } from '../src/modes/camera/motion'
import { measure } from '../src/modes/camera/geometry'
import { FORM, LANDING, LIMITS } from '../src/modes/camera/params'

const RBDS = process.env.RBDS_DIR
const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const VH_CAD = process.env.VH_CAD_DIR
const CACHE = process.env.OVERSTRIDE_CACHE
const OUT = process.env.SIM_OUT ?? 'sim/result-overstride.md'
const ANY = !!(RBDS || RIGLET || VH || VH_CAD)
const LONG = 600
// OVERSTRIDE_PART=lines なら ①②だけ、coach なら ③だけ。OVERSTRIDE_VARIANTS=0,2 で ③の走りを選ぶ（いくつかに分けて同時に動かすとき）
const PART = process.env.OVERSTRIDE_PART
const PICK = process.env.OVERSTRIDE_VARIANTS?.split(',').map(Number)
const COACH_RUNS = Number(process.env.OVERSTRIDE_COACH ?? 60) // ③ でコーチに通す本数（10分の走りを、ふつう・崩しで2回ずつ通すので重い）

function loadAll(): LandingTrial[] {
  const out: LandingTrial[] = []
  const tryPush = (fn: () => LandingTrial) => {
    try {
      const tr = fn()
      if (tr.contacts.length >= 10) out.push(tr)
    } catch {
      /* 使えない記録は飛ばす */
    }
  }
  if (RBDS) {
    const ids = [...new Set(readdirSync(RBDS).filter((f) => /^RBDS\d+static\.txt$/.test(f)).map((f) => f.slice(0, 7)))].sort()
    for (const id of ids) for (const sp of ['25', '35', '45']) if (existsSync(join(RBDS, `${id}runT${sp}forces.txt`))) tryPush(() => loadRbdsLanding(RBDS, id, sp))
  }
  if (RIGLET) {
    for (const id of readdirSync(RIGLET).sort()) {
      for (const [pace, cond] of [['Comfortable', '楽'], ['Fast', '速い']]) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (existsSync(p)) tryPush(() => loadRigletLanding(p, id, cond))
      }
    }
  }
  const vhFiles = (dir: string | undefined, re: RegExp, cond: string) => {
    if (!dir) return
    for (const f of readdirSync(dir).sort()) if (re.test(f)) tryPush(() => loadVhLanding(join(dir, f), f.slice(0, 6), cond))
  }
  vhFiles(VH, /^Sub_\d+_333(ms)?\.c3d$/i, '333')
  vhFiles(VH, /^Sub_\d+_trunklean\.c3d$/i, 'trunklean')
  vhFiles(VH_CAD, /^Sub_\d+_lowfreq\.c3d$/i, 'lowfreq')
  vhFiles(VH_CAD, /^Sub_\d+_highfreq\.c3d$/i, 'highfreq')
  return out
}

// ---- ① 速さの目安・ベルトの速さ・すねの振り ----
interface SpeedRec {
  id: string
  subject: string
  dataset: string
  cond: string
  belt: number // ベルトの速さ（m/s）：接地の 30〜60% の間に足首が後ろへ動く速さの中央値
  cam: number // カメラの速さの目安（脚の長さ／秒）
  swing: number // 右のすねの角速度の、1歩きごとの山の中央値（度／秒）
  cadence: number
  leg: number
}

function speedRec(tr: LandingTrial, k: number): SpeedRec | null {
  const [t0, t1] = runningSpan(tr)
  if (t1 - t0 < 15) return null
  const j = tr.joints
  const fps = tr.fps
  const belts: number[] = []
  for (const c of tr.contacts) {
    if (c.on < t0 || c.off > t1) continue
    const key = c.side === 'R' ? 'ankleR' : 'ankleL'
    const ps = j[key]!
    const a = Math.round((c.on + 0.3 * (c.off - c.on)) * fps)
    const b = Math.round((c.on + 0.6 * (c.off - c.on)) * fps)
    if (b > a && ps[a] && ps[b]) belts.push((ps[a][0] - ps[b][0]) / 1000 / ((b - a) / fps))
  }
  // すねの角度（前後と上下の面）を5コマでならして微分し、右脚の1歩き（右の接地から次の右の接地）ごとの山
  const kn = j.kneeR!
  const an = j.ankleR!
  const ang = kn.map((p, i) => Math.atan2(an[i][0] - p[0], p[1] - an[i][1]) * (180 / Math.PI))
  const sm = ang.map((_, i) => {
    const xs = ang.slice(Math.max(0, i - 2), i + 3).filter(Number.isFinite)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
  })
  const om = sm.map((_, i) => (i > 0 && i < sm.length - 1 ? ((sm[i + 1] - sm[i - 1]) * fps) / 2 : NaN))
  const rc = tr.contacts.filter((c) => c.side === 'R' && c.on >= t0 && c.on <= t1)
  const swings: number[] = []
  for (let i = 1; i < rc.length; i++) {
    const a = Math.round(rc[i - 1].on * fps)
    const b = Math.round(rc[i].on * fps)
    let m = -Infinity
    for (let f = a; f < b; f++) if (Number.isFinite(om[f])) m = Math.max(m, Math.abs(om[f]))
    if (m > 0) swings.push(m)
  }
  const frames = filmFrames((t) => bodyAtTrial(tr, t), t0, t1 - t0, { timing: 'log', seed: 4040 + k })
  const m = new LandingMeter('lead')
  for (const { t, f } of frames) m.update(f, t)
  const strides = rc.slice(1).map((c, i) => c.on - rc[i].on)
  return { id: tr.id, subject: tr.subject, dataset: tr.dataset, cond: tr.cond, belt: median(belts), cam: speedOf(m.track, t0, t1), swing: median(swings), cadence: 120 / median(strides), leg: legLengthOf(tr) }
}


// ---- ② 10分の走りの山 ----
interface LongRec {
  id: string
  dataset: string
  cond: string
  peaks: Pick<Peak, 't' | 'side' | 'vis' | 'heel' | 'shank'>[]
  track: Pick<Track, 't' | 'sv'>[]
}

function longRec(tr: LandingTrial, k: number): LongRec | null {
  const run = new LongRun()
  try {
    run.append(tr, LONG, 4242 + k)
  } catch {
    return null
  }
  const frames = filmFrames((t) => run.at(t), 0, LONG, { timing: 'log', seed: 777 + k })
  const m = new LandingMeter('lead')
  for (const { t, f } of frames) m.update(f, t)
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  return {
    id: tr.id,
    dataset: tr.dataset,
    cond: tr.cond,
    peaks: m.peaks.map((p) => ({ t: r3(p.t), side: p.side, vis: r3(p.vis), heel: r3(p.heel), shank: Math.round(p.shank * 10) / 10 })),
    track: m.track.filter((x) => Number.isFinite(x.sv)).map((x) => ({ t: r3(x.t), sv: r3(x.sv) })),
  }
}

// 窓の値：速さで補正したかかとの前（アプリと同じ landingOf）と、同じ手前の脚の山のすねの角度の中央値
type Win = { t: number; res: number; shank: number; speed: number }
const SHANK_FIT = { a: -0.5, b: 3.6 } // sim/result-landing.md の ④：すね（見積もり）＝ −0.5 ＋ 3.6 × 速さの目安
function windowsOf(r: LongRec, add?: (t: number) => number): Win[] {
  const out: Win[] = []
  const ps = r.peaks.map((p) => {
    const a = add ? add(p.t) : 0
    return { ...p, heel: p.heel + (a * Math.PI) / 180, shank: p.shank + a } as Peak
  })
  for (let t = 30; t <= LONG; t += 1) {
    const inW = ps.filter((p) => p.t > t - LANDING.window && p.t <= t)
    const lw = landingOf(
      inW,
      r.track.filter((x) => x.t > t - LANDING.window && x.t <= t).map((x) => x.sv),
    )
    if (!lw) continue
    const sh = median(inW.filter((p) => p.side === lw.near).map((p) => p.shank))
    out.push({ t, res: lw.res, shank: sh, speed: lw.speed })
  }
  return out
}

describe.skipIf(!ANY || PART === 'coach')('走り出しのオーバーストライド（決まった線）', () => {
  it('速さの目安と、決まった線', () => {
    const trials = loadAll()
    console.log(`記録 ${trials.length}本`)
    // ① 速さ
    const sp: SpeedRec[] = []
    trials.forEach((tr, k) => {
      const r = speedRec(tr, k)
      if (r) sp.push(r)
    })
    // ② 山（ためておけば読む）
    let longs: LongRec[] = []
    if (CACHE && existsSync(CACHE)) longs = JSON.parse(readFileSync(CACHE, 'utf8'))
    else {
      trials.forEach((tr, k) => {
        const r = longRec(tr, k)
        if (r) longs.push(r)
      })
      if (CACHE) writeFileSync(CACHE, JSON.stringify(longs))
    }
    const L: string[] = []
    const p = (s = '') => L.push(s)
    const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—')
    const f3 = (x: number) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—')
    const pc = (x: number) => `${Math.round(x * 100)}%`
    const q = (xs: number[], u: number) => {
      const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
      return s.length ? s[Math.min(s.length - 1, Math.floor(u * s.length))] : NaN
    }
    p('# 走り出しのオーバーストライドを決まった線で見る（仮想実験 sim/overstride.sim.ts）')
    p()
    p(`研究データ ${trials.length}本（RBDS・Riglet・Van Hooren）。仮想のスマホ（真横・1.2m・高さ80cm・超広角）、実機の記録のコマの間隔。`)
    p()

    // ---- ① ----
    p('## ① 速さの目安は当てになるか（同じ人の中での変わり方）')
    p()
    p('ベルトの速さ（本当の値）、カメラの速さの目安（landing.ts の speedOf）、すねの振りの速さ（遊脚のすねの角速度の山、足首のセンサーで測るもの）の、条件を変えたときの比。')
    p()
    p('| 比べたもの | 人数 | ベルトの速さ | カメラの速さの目安 | すねの振りの速さ | ピッチ | 目安の比 ÷ ベルトの比（中央、下から1割〜上から1割） |')
    p('|---|---|---|---|---|---|---|')
    const PAIRS: [string, string, string, string][] = [
      ['rbds', '25', '35', 'RBDS 秒速2.5m → 3.5m'],
      ['rbds', '35', '45', 'RBDS 秒速3.5m → 4.5m'],
      ['riglet', '楽', '速い', 'Riglet 楽なペース → 速いペース'],
      ['vh', 'highfreq', 'lowfreq', 'VH 同じ速さでピッチ 上げる → 下げる'],
      ['vh', '333', 'lowfreq', 'VH 同じ速さで ふつう → ピッチを下げる'],
    ]
    const ratioRows: { label: string; belt: number; cam: number; swing: number }[] = []
    for (const [ds, a, b, label] of PAIRS) {
      const xs = sp.filter((r) => r.dataset === ds && r.cond === a)
      const rs = xs.flatMap((x) => {
        const y = sp.find((r) => r.dataset === ds && r.cond === b && r.subject === x.subject)
        return y ? [{ belt: y.belt / x.belt - 1, cam: y.cam / x.cam - 1, swing: y.swing / x.swing - 1, cad: y.cadence / x.cadence - 1, rel: y.cam / x.cam / (y.belt / x.belt) }] : []
      })
      if (!rs.length) continue
      const md = (k: 'belt' | 'cam' | 'swing' | 'cad') => median(rs.map((r) => r[k]))
      ratioRows.push({ label, belt: md('belt'), cam: md('cam'), swing: md('swing') })
      p(`| ${label} | ${rs.length} | ${pc(md('belt'))} | ${pc(md('cam'))} | ${pc(md('swing'))} | ${pc(md('cad'))} | ${f2(median(rs.map((r) => r.rel)))}（${f2(q(rs.map((r) => r.rel), 0.1))}〜${f2(q(rs.map((r) => r.rel), 0.9))}） |`)
    }
    p()
    // すねの振りの比から見込む、ベルトの速さの比（速さを変えた組の当てはめ）
    const sw = sp.filter((r) => Number.isFinite(r.swing) && Number.isFinite(r.belt))
    {
      // 人ごとに、速さを変えた組（RBDS・Riglet）で「振りの比 → ベルトの比」の傾き
      const xs: number[] = []
      const ys: number[] = []
      for (const [ds, a, b] of PAIRS.slice(0, 3)) {
        for (const x of sw.filter((r) => r.dataset === ds && r.cond === a)) {
          const y = sw.find((r) => r.dataset === ds && r.cond === b && r.subject === x.subject)
          if (y) {
            xs.push(Math.log(y.swing / x.swing))
            ys.push(Math.log(y.belt / x.belt))
          }
        }
      }
      const k = xs.reduce((a, x, i) => a + x * ys[i], 0) / xs.reduce((a, x) => a + x * x, 0)
      const camK = (() => {
        const cx: number[] = []
        const cy: number[] = []
        for (const [ds, a, b] of PAIRS.slice(0, 3)) {
          for (const x of sp.filter((r) => r.dataset === ds && r.cond === a)) {
            const y = sp.find((r) => r.dataset === ds && r.cond === b && r.subject === x.subject)
            if (y && Number.isFinite(y.swing / x.swing) && Number.isFinite(y.cam / x.cam)) {
              cx.push(Math.log(y.swing / x.swing))
              cy.push(Math.log(y.cam / x.cam))
            }
          }
        }
        return cx.reduce((a, x, i) => a + x * cy[i], 0) / cx.reduce((a, x) => a + x * x, 0)
      })()
      const at = (s: number, kk: number) => Math.exp(kk * Math.log(1 + s)) - 1
      p(`速さを変えた組（${xs.length}組）で、すねの振りの速さが 1% 増えると、ベルトの速さは約 ${f2(k)}%、カメラの速さの目安は約 ${f2(camK)}% 増える（比の対数の、原点を通る当てはめ）。`)
      p(`自分の記録（2026-11-02 18:43）の、足首のセンサーの振り +22〜26% は、この当てはめではベルトの速さ ${pc(at(0.22, k))}〜${pc(at(0.26, k))}、カメラの速さの目安 ${pc(at(0.22, camK))}〜${pc(at(0.26, camK))} にあたる。`)
      p()
      ;(globalThis as Record<string, unknown>).__swingK = { k, camK }
    }

    // ---- ② ----
    const normal = longs.filter((r) => r.cond !== 'lowfreq')
    const W = normal.map((r) => windowsOf(r))
    p('## ② 決まった線と、ふつうの走り（10分 × ' + normal.length + '本。VH のピッチを下げた走りは除く）')
    p()
    const shankFit = (w: Win) => w.shank - (SHANK_FIT.a + SHANK_FIT.b * w.speed)
    const resAll = W.flatMap((ws) => ws.map((w) => w.res))
    const shAll = W.flatMap((ws) => ws.map((w) => w.shank))
    const shrAll = W.flatMap((ws) => ws.map(shankFit))
    p(`16秒の窓の値（1秒ずつずらす）の散らばり：速さで補正したかかとの前 中央 ${f3(q(resAll, 0.5))}・上から5% ${f3(q(resAll, 0.95))}・上から1% ${f3(q(resAll, 0.99))}。すねの角度 中央 ${q(shAll, 0.5).toFixed(1)}°・上から5% ${q(shAll, 0.95).toFixed(1)}°・上から1% ${q(shAll, 0.99).toFixed(1)}°。速さで補正したすね 上から5% ${q(shrAll, 0.95).toFixed(1)}°・上から1% ${q(shrAll, 0.99).toFixed(1)}°`)
    p()
    // 線ごとに：越えた走り（一度でも）、越えた窓の割合、崩しに気づいた割合
    type Rule = { label: string; over: (w: Win) => boolean }
    const rules: Rule[] = []
    for (const l of [0.08, 0.1, 0.12, 0.14, 0.16]) rules.push({ label: `かかとの前 > ${f3(l)}`, over: (w) => w.res > l })
    for (const s of [10, 12, 14, 16]) rules.push({ label: `すね > ${s}°`, over: (w) => w.shank > s })
    for (const s of [6, 8, 10]) rules.push({ label: `速さで補正したすね > ${s}°`, over: (w) => shankFit(w) > s })
    for (const [l, s] of [[0.08, 6], [0.1, 6], [0.1, 8], [0.12, 6], [0.12, 8]] as const) rules.push({ label: `かかとの前 > ${f3(l)} かつ 速さで補正したすね > ${s}°`, over: (w) => w.res > l && shankFit(w) > s })
    // 崩し：走り出して 60秒から D 秒、脚を α 度前へ回す
    const OS: [number, number][] = [[4, 60], [6, 60], [9, 60], [9, 10], [9, 20]]
    const osW = OS.map(([a, d]) => normal.map((r) => windowsOf(r, (t) => (t >= 60 && t < 60 + d ? a : 0))))
    p('| 線（16秒の窓） | ふつうの走りで一度でも越えた走り | 越えた窓 | ' + OS.map(([a, d]) => `前へ ${a}°・${d}秒に気づいた`).join(' | ') + ' |')
    p('|---|---|---|' + OS.map(() => '---').join('|') + '|')
    for (const ru of rules) {
      const runs = W.filter((ws) => ws.some(ru.over)).length
      const wins = W.reduce((a, ws) => a + ws.filter(ru.over).length, 0) / W.reduce((a, ws) => a + ws.length, 0)
      const det = OS.map(([, d], i) => {
        // 気づいた：崩しの間〜終わって8秒のうちに越えた窓があり、崩しの前（30〜60秒）には越えていない走り
        const hit = osW[i].filter((ws) => ws.some((w) => w.t >= 60 && w.t < 60 + d + 8 && ru.over(w)) && !ws.some((w) => w.t < 60 && ru.over(w))).length
        return pc(hit / normal.length)
      })
      p(`| ${ru.label} | ${runs} / ${W.length} | ${(wins * 100).toFixed(2)}% | ${det.join(' | ')} |`)
    }
    p()
    p('崩しの大きさの目安：自分の記録（2026-11-02 20:23）のわざと前に着いた2区間は、ふつうの区間より かかとの前 +0.15〜+0.27・すね +8〜+15°（前へ 9° 以上）。前へ 4° は かかとの前 +0.07・すね +4°。')
    p()
    writeFileSync(OUT, L.join('\n') + '\n')
    console.log(L.join('\n'))
  })
})

// ---- ③ アプリのコーチに通す ----
// 足が前に着く崩しは、着地の山の値に足す（LandingMeter の山を作るところを包む。速さの目安とピッチはそのまま）
let addDeg: (t: number) => number = () => 0
{
  const proto = LandingMeter.prototype as unknown as { peakAt: (...a: unknown[]) => Peak | null }
  const orig = proto.peakAt
  proto.peakAt = function (this: unknown, ...a: unknown[]) {
    const pk = orig.apply(this, a)
    if (pk) {
      const d = addDeg(pk.t)
      if (d) {
        pk.heel += (d * Math.PI) / 180
        pk.toe += (d * Math.PI) / 180
        pk.reach += (d * Math.PI) / 180
        pk.shank += d
      }
    }
    return pk
  }
}

interface CoachOut {
  fixed: number[] // 決まった線の着地の声（走り出してからの秒）
  drift: number[] // 基準からの増えの着地の声（仮の基準・今日の基準）
  refAt: number | null // 今日の基準ができた（走り出してからの秒）
  earlyAt: number | null // 着地の仮の基準ができた
  span: number // 走った秒
}

function coachRun(frames: { t: number; f: import('../src/core/types').Frame }[]): CoachOut {
  const coach = new Coach({ pause: false })
  const md = new MotionDetector()
  let lastMoving = false
  let runFrom = -1
  let refAt: number | null = null
  let earlyAt: number | null = null
  const an = (coach as unknown as { analyzer: { early: { ref: unknown } } }).analyzer
  for (const { t, f } of frames) {
    if (coach.state === 'running' && !coach.wantsDetail()) coach.update({ t, present: true, moving: lastMoving })
    else {
      lastMoving = md.update(f, t)
      coach.update({ t, present: true, moving: lastMoving, m: measure(f), frame: f })
    }
    if (runFrom < 0 && coach.state === 'running') runFrom = t - coach.active
    if (refAt === null && coach.leanRef) refAt = t - runFrom
    if (earlyAt === null && an.early.ref) earlyAt = t - runFrom
  }
  const s = coach.finish()
  const land = s.cues.filter((c) => c.item === 'landing')
  return { fixed: land.filter((c) => c.lead).map((c) => c.t), drift: land.filter((c) => !c.lead).map((c) => c.t), refAt, earlyAt, span: frames[frames.length - 1].t - runFrom }
}

describe.skipIf(!ANY || PART === 'lines')('走り出しのオーバーストライド（アプリのコーチ）', () => {
  it('ふつうの走りの外れた声と、崩しに気づく割合', () => {
    const trials = loadAll().filter((tr) => tr.cond !== 'lowfreq')
    const L: string[] = []
    const p = (s = '') => L.push(s)
    const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—')
    const pc = (x: number) => `${Math.round(x * 100)}%`
    const med = (xs: number[]) => median(xs)
    const saved = { early: LANDING.early }
    // 走り出して OS_FROM 秒から、脚を前へ回す（今日の基準ができる前）
    const OS_FROM = 90
    const VARIANTS: { label: string; early: boolean; deg: number; sec: number; runs: number }[] = [
      { label: 'ふつう（仮の基準あり）', early: true, deg: 0, sec: 0, runs: trials.length },
      { label: 'ふつう（仮の基準なし）', early: false, deg: 0, sec: 0, runs: trials.length },
      { label: '前へ 9°・60秒（仮の基準あり）', early: true, deg: 9, sec: 60, runs: COACH_RUNS },
      { label: '前へ 9°・60秒（仮の基準なし）', early: false, deg: 9, sec: 60, runs: COACH_RUNS },
      { label: '前へ 6°・60秒（仮の基準あり）', early: true, deg: 6, sec: 60, runs: COACH_RUNS },
      { label: '前へ 4°・60秒（仮の基準あり）', early: true, deg: 4, sec: 60, runs: COACH_RUNS },
      { label: '前へ 9°・15秒（仮の基準あり）', early: true, deg: 9, sec: 15, runs: COACH_RUNS },
    ]
    p('## ③ アプリのコーチに通す（決まった線を声にし、今日の基準ができるまでは着地の仮の基準と比べる）')
    p()
    p(
      `ふつうの走り ${trials.length}本（VH のピッチを下げた走りは除く）を LongRun で10分にのばし、実機の記録のコマの間隔で映して、アプリと同じ間引きでコーチに通した。` +
        `決まった線（FORM.landing.max ${FORM.landing.max}、say ${FORM.landing.say}）と、着地の仮の基準（走り出して ${FORM.from}秒から、速さの変わらない ${LANDING.earlyCollect}秒の山）からの増え +${LIMITS.landing.cue}。` +
        `崩しは、走り出して ${OS_FROM}秒から、脚を股関節から前へ回した形を山の値に足した（${COACH_RUNS}本）。仮想のランナーは声を聞いても直さない。`,
    )
    p()
    p('| 走り | 本数 | 決まった線の声（10分あたり） | 基準からの増えの声（10分あたり） | どちらかの声が出た走り | 崩しに声が出た走り（崩しの間〜20秒あと） | 崩しから声までの秒（中央） | 仮の基準ができた（走り出してからの秒、中央） | 今日の基準ができた（中央） |')
    p('|---|---|---|---|---|---|---|---|---|')
    for (const v of VARIANTS.filter((_, i) => !PICK || PICK.includes(i))) {
      ;(LANDING as { early: boolean }).early = v.early
      const outs: CoachOut[] = []
      trials.slice(0, v.runs).forEach((tr, k) => {
        const run = new LongRun()
        try {
          run.append(tr, LONG, 4242 + k)
        } catch {
          return
        }
        const frames = filmFrames((t) => run.at(t), 0, LONG, { timing: 'log', seed: 777 + k })
        // 崩しの時刻は走り出しから数えるので、先に走り出しを見つける（ふつうの走りでは、最初のコマから数秒で走り出す）
        addDeg = () => 0
        if (v.deg) {
          const probe = new Coach({ pause: false })
          const md = new MotionDetector()
          let start = 0
          for (const { t, f } of frames) {
            probe.update({ t, present: true, moving: md.update(f, t), m: measure(f), frame: f })
            if (probe.state === 'running') {
              start = t - probe.active
              break
            }
          }
          addDeg = (t) => (t >= start + OS_FROM && t < start + OS_FROM + v.sec ? v.deg : 0)
        }
        outs.push(coachRun(frames))
      })
      addDeg = () => 0
      const n = outs.length
      const per10 = (xs: number[][]) => (xs.reduce((a, x) => a + x.length, 0) / outs.reduce((a, o) => a + o.span, 0)) * 600
      const anyCue = outs.filter((o) => o.fixed.length + o.drift.length > 0).length
      const hits = v.deg ? outs.map((o) => [...o.fixed, ...o.drift].filter((t) => t >= OS_FROM && t < OS_FROM + v.sec + 20).sort((a, b) => a - b)[0]) : []
      const hit = hits.filter((x) => x !== undefined)
      p(
        `| ${v.label} | ${n} | ${f2(per10(outs.map((o) => o.fixed)))} | ${f2(per10(outs.map((o) => o.drift)))} | ${anyCue} / ${n} | ${v.deg ? `${hit.length} / ${n}（${pc(hit.length / n)}）` : '—'} | ${v.deg && hit.length ? Math.round(med(hit.map((x) => x - OS_FROM))) : '—'} | ${Math.round(med(outs.map((o) => o.earlyAt ?? NaN)))} | ${Math.round(med(outs.map((o) => o.refAt ?? NaN)))} |`,
      )
      console.log(L[L.length - 1])
    }
    ;(LANDING as { early: boolean }).early = saved.early
    p()
    p('「ふつう」の声はすべて外れた声。崩しの走りは、崩しの前（走り出し〜' + OS_FROM + '秒）にも声が出ることがある（ふつうの走りと同じ割合）。')
    const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n## ③')[0].trimEnd() : ''
    writeFileSync(OUT, (prev ? prev + '\n\n' : '') + L.join('\n') + '\n')
  })
})
