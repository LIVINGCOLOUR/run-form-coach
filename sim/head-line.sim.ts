// 仮想実験（頭の正しいフォームの線 FORM.head）：線の高さを変えたとき、ふつうに走るだけで出る「頭が前に出ています」（誤った声）と、
//   胸を立てたまま頭だけ前に出した走り（頭を首の付け根で前に回す）に気づく割合がどう変わるかを出す。
//   研究データの頭の印は、アプリの点（MediaPipe の耳）より首の角度が小さく出る（真横で平均 11°。sim/result-form.md）ので、
//   線の高さそのものは研究データでは決められない。そこで、1本ごとに、ふつうに走ったときの値の真ん中を、自分の記録（2026-11-02 の
//   ふつうの区間の16秒平均の真ん中 首 42°・頭の位置 44°）にそろえてから映す。人による違い（線の位置）は消え、残るのは
//   1本の中の揺れ（研究データの揺れと、実機なみのゆっくりしたずれ）だけ。だから、ここで分かるのは「自分のふつうの値から
//   どれだけ上に線を置けば、揺れで誤った声が出ないか」と「どれだけ頭を前に出せば線を越えるか」
//   走り出しから、アプリと同じに通す（整える → 今日の基準 → 崩れ。間引きも同じ）。仮想のランナーは声を聞いても直さない。
//   頭の線で言った声（lead の head）だけを数える（今日の基準からの崩れの声 LIMITS.head は別。sim/result-coach.md）
// 動かし方：RIGLET_DIR=<Riglet のデータ> VH_DIR=<Van Hooren のデータ> npx vitest run --config sim/vitest.config.ts sim/head-line.sim.ts
//   （結果は sim/result-head-line.md）
import { it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRiglet } from './riglet'
import { loadUpper } from './vanhooren'
import { LongRun, distort, truthOf, legLengthMm, groundOf, type Source } from './longrun'
import { film, replay, BASE, BASE_NOISE, type Extra, type Stream } from './pipeline'
import type { Body } from './camera'
import { FORM } from '../src/modes/camera/params'

const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-head-line.md'
const it = itAll.skipIf(!RIGLET && !VH)

const SEC = 780 // 3分の基準 + 10分
const ONSET = 250 // 頭を前に出し始める（基準ができたあと）
const HOLD = 60
const RAMP = 2
const F = 11 // pipeline.ts の1コマの列の数
// 自分の記録（2026-11-02 の2本、ふつうに走った区間）の16秒平均の真ん中
const NORMAL = { neck: 42, headLean: 44 }
// sim/coach.sim.ts と同じ、実機なみのゆっくりしたずれ
const REAL_EXTRA: Extra = { neck: [1.8, 3], trunk: [0.35, 3], body: [0.4, 120] }
const LINES: [number, number][] = [
  [42, 46],
  [44, 48],
  [46, 50],
  [48, 52],
  [50, 54],
  [52, 56],
  [55, 59],
]
const SIZES = [4, 6, 10, 15] // 頭を前に出す量（本当の首の角度の増え、度）

interface Runner {
  id: string
  run: LongRun
  leg: number
  ground: number
  ratio: number // distort('head') の入力1あたりの、本当の首の角度の増え
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (x: number) => `${Math.round(x * 100)}%`

function prepare(id: string, src: Source, seed: number): Runner {
  const run = new LongRun()
  run.append(src, SEC, seed)
  const leg = legLengthMm(src)
  const ground = groundOf(src)
  const d: number[] = []
  for (let t = 0; t < 60; t += 0.2) {
    const b = run.at(t)
    d.push(truthOf(distort(b, 'head', 5, leg, ground)).neck - truthOf(b).neck)
  }
  return { id, run, leg, ground, ratio: mean(d) / 5 }
}

function bodyFn(r: Runner, size: number): (t: number) => Body {
  if (!size) return (t) => r.run.at(t)
  const input = size / r.ratio
  return (t) => {
    const b = r.run.at(t)
    const u = t < ONSET ? 0 : t < ONSET + RAMP ? (t - ONSET) / RAMP : t < ONSET + HOLD ? 1 : t < ONSET + HOLD + RAMP ? 1 - (t - ONSET - HOLD) / RAMP : 0
    return u ? distort(b, 'head', input * u, r.leg, r.ground) : b
  }
}

// 首の角度の6秒平均が20°を超えて動く記録は、肩の関節の中心の推定がおかしいとみて除く（sim/coach.sim.ts と同じ）
function neckRange(src: Source) {
  const per: number[] = []
  for (let s = 0; s + 1 <= src.frames / src.fps; s++) {
    const v: number[] = []
    for (let i = s * src.fps; i < (s + 1) * src.fps; i += 5) {
      const b = {} as Body
      for (const k of Object.keys(src.joints) as (keyof Body)[]) (b as unknown as Record<string, unknown>)[k] = src.joints[k]![Math.floor(i)]
      v.push(truthOf(b).neck)
    }
    per.push(mean(v))
  }
  const w = per.slice(0, -5).map((_, i) => mean(per.slice(i, i + 6)))
  return Math.max(...w) - Math.min(...w)
}

function loadRunners(): Runner[] {
  const out: Runner[] = []
  if (RIGLET)
    for (const id of readdirSync(RIGLET).sort())
      for (const pace of ['Comfortable', 'Fast']) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (!existsSync(p)) continue
        try {
          const src = loadRiglet(p, `${id}-${pace === 'Fast' ? '速い' : '楽'}`) as Source
          if (src.frames / src.fps < 20 || neckRange(src) > 20) continue
          out.push(prepare(src.id, src, out.length + 1))
        } catch {
          // 使えない記録は飛ばす
        }
      }
  if (VH) {
    const files = readdirSync(VH)
    for (const f of files.filter((x) => /^Sub_\d+_333(ms)?\.c3d$/i.test(x)).sort()) {
      try {
        const src = loadUpper(join(VH, f), `VH-${f.slice(0, 6)}`) as Source
        if (src.frames / src.fps < 20 || neckRange(src) > 20) continue
        out.push(prepare(src.id, src, out.length + 1))
      } catch {
        // 使えない記録は飛ばす
      }
    }
  }
  return out
}

// ふつうに走った流れの、走っている間の首の角度・頭の位置の真ん中
function middleOf(s: Stream) {
  const neck: number[] = []
  const lean: number[] = []
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    if (s.d[j + 1] !== 1 || s.d[j] < 30) continue
    neck.push(s.d[j + 3])
    lean.push(s.d[j + 4])
  }
  return { neck: median(neck), headLean: median(lean) }
}

// 首の角度と頭の位置に、同じ人のふつうの値の真ん中が NORMAL になるだけ足す
function shifted(s: Stream, by: { neck: number; headLean: number }): Stream {
  const d = Float32Array.from(s.d)
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    if (d[j + 1] !== 1) continue
    d[j + 3] += by.neck
    d[j + 4] += by.headLean
  }
  return { ...s, d }
}

const headLead = (r: ReturnType<typeof replay>) => r.cues.filter((c) => c.lead && c.item === 'head')

it('頭の線の高さと、誤った声・気づく割合', () => {
  const runners = loadRunners()
  const saved = { neck: FORM.head.neck, headLean: FORM.head.headLean }
  // 流れ（ふつう・頭を前に出した走り）を1本ずつ映して、そろえる
  const streams = runners.map((r, k) => {
    const normal = film({ sec: SEC, seed: k * 1009 + 1, pl: BASE, noise: BASE_NOISE, extra: REAL_EXTRA, body: bodyFn(r, 0) })
    const m = middleOf(normal)
    const by = { neck: NORMAL.neck - m.neck, headLean: NORMAL.headLean - m.headLean }
    const drills = SIZES.map((sz) => shifted(film({ sec: SEC, seed: k * 1009 + 1, pl: BASE, noise: BASE_NOISE, extra: REAL_EXTRA, body: bodyFn(r, sz) }), by))
    return { normal: shifted(normal, by), drills, by }
  })
  // ふつうの走りの16秒平均（走っていた秒）の揺れ：上から1%・最大（真ん中を NORMAL にそろえたあと）
  const win16: { neck: number[]; lean: number[]; maxN: number[]; maxL: number[] } = { neck: [], lean: [], maxN: [], maxL: [] }
  for (const s of streams) {
    const secN: number[] = []
    const secL: number[] = []
    for (let sec = 30; sec < SEC; sec++) {
      const n: number[] = []
      const l: number[] = []
      for (let i = sec * 15; i < (sec + 1) * 15 && i < s.normal.n; i++) {
        const j = i * F
        if (s.normal.d[j + 1] === 1) {
          n.push(s.normal.d[j + 3])
          l.push(s.normal.d[j + 4])
        }
      }
      if (n.length >= 3) {
        secN.push(mean(n))
        secL.push(mean(l))
      }
    }
    let mxN = -Infinity
    let mxL = -Infinity
    for (let i = 16; i <= secN.length; i++) {
      const a = mean(secN.slice(i - 16, i))
      const b = mean(secL.slice(i - 16, i))
      win16.neck.push(a)
      win16.lean.push(b)
      mxN = Math.max(mxN, a)
      mxL = Math.max(mxL, b)
    }
    win16.maxN.push(mxN)
    win16.maxL.push(mxL)
  }
  const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.round(p * (xs.length - 1)))]

  const rows: string[] = []
  for (const [neck, lean] of LINES) {
    FORM.head.neck = neck
    FORM.head.headLean = lean
    let falseN = 0
    let falseRuns = 0
    let minutes = 0
    const found = SIZES.map(() => 0)
    const lat: number[][] = SIZES.map(() => [])
    for (const s of streams) {
      const r = replay(s.normal)
      const from = r.runFrom + FORM.from
      minutes += (SEC - from) / 60
      const cs = headLead(r)
      falseN += cs.length
      if (cs.length) falseRuns++
      s.drills.forEach((d, k) => {
        const rd = replay(d)
        // 頭を前に出していた間（と、戻るまでの数秒）に、頭の線で声が出たか。ふつうの走りでもう出ていた声は数えない
        const hit = headLead(rd).filter((c) => c.t >= ONSET && c.t <= ONSET + HOLD + 5)
        if (hit.length) {
          found[k]++
          lat[k].push(hit[0].t - ONSET)
        }
      })
    }
    const n = streams.length
    rows.push(
      `| ${neck}°・${lean}°${neck === saved.neck && lean === saved.headLean ? '（今）' : ''} | +${neck - NORMAL.neck}°・+${lean - NORMAL.headLean}° | ${((falseN / minutes) * 10).toFixed(2)} | ${falseRuns} / ${n} | ${SIZES.map((_, k) => `${pct(found[k] / n)}（${lat[k].length ? Math.round(median(lat[k])) + '秒' : '—'}）`).join(' | ')} |`,
    )
  }
  FORM.head.neck = saved.neck
  FORM.head.headLean = saved.headLean

  // 頭を前に出したとき、アプリの点の値（16秒平均）がどれだけ増えたか（本当の首の角度の増え1°あたり）
  const gain = SIZES.map((sz, k) => {
    const g: number[] = []
    const gl: number[] = []
    for (const s of streams) {
      const at = (st: Stream, col: number) => {
        const xs: number[] = []
        for (let i = (ONSET + 10) * 15; i < (ONSET + HOLD) * 15; i++) if (st.d[i * F + 1] === 1) xs.push(st.d[i * F + col])
        return mean(xs)
      }
      g.push(at(s.drills[k], 3) - at(s.normal, 3))
      gl.push(at(s.drills[k], 4) - at(s.normal, 4))
    }
    return `+${sz}°：首 +${median(g).toFixed(1)}°・頭の位置 +${median(gl).toFixed(1)}°`
  })

  const text =
    `# 頭の正しいフォームの線の高さ（仮想実験）\n\n` +
    `研究データのふつうの走り ${runners.length}本（Riglet の楽・速い、Van Hooren の時速12km）を10分あまり（${SEC}秒）にのばし、` +
    `実機なみのゆっくりしたずれ（${JSON.stringify(REAL_EXTRA)}）を足して、真横・1.2m・高さ80cm の仮想のスマホで映し、アプリのコーチ（上級、間引きあり）に通した。\n\n` +
    `研究データの頭の印は、アプリの点（MediaPipe の耳）より首の角度が小さく出るので、1本ごとに、ふつうに走った値の真ん中を自分の記録` +
    `（2026-11-02 のふつうの区間の16秒平均の真ん中、首 ${NORMAL.neck}°・頭の位置 ${NORMAL.headLean}°）にそろえた（足した量の真ん中 首 +${median(streams.map((s) => s.by.neck)).toFixed(0)}°・頭の位置 +${median(streams.map((s) => s.by.headLean)).toFixed(0)}°）。` +
    `人による線の位置の違いは消え、残るのは1本の中の揺れだけ。だから、この表は「自分のふつうの値から、線をどれだけ上に置けばよいか」を見るためのもの。\n\n` +
    `ふつうの走りの16秒平均（そろえたあと）：首 上から1% ${q(win16.neck, 0.99).toFixed(1)}°・1本ごとの最大の真ん中 ${median(win16.maxN).toFixed(1)}°・いちばん大きい ${Math.max(...win16.maxN).toFixed(1)}°、` +
    `頭の位置 上から1% ${q(win16.lean, 0.99).toFixed(1)}°・最大の真ん中 ${median(win16.maxL).toFixed(1)}°・いちばん大きい ${Math.max(...win16.maxL).toFixed(1)}°\n\n` +
    `頭を前に出したとき（走り出して ${ONSET}秒から ${HOLD}秒、胸はそのまま、首の付け根で頭を前に回す）の、アプリの点の値の増え（真ん中）：${gain.join('、')}\n\n` +
    `誤った声は、ふつうの走りで頭の線で言った「頭が前に出ています」（走り出して ${FORM.from}秒から終わりまで）。気づいた割合は、頭を前に出していた間（と戻って5秒）に、頭の線で声が出た走りの割合（かっこは、出し始めから声までの秒の真ん中）。` +
    `線は首の角度と頭の位置の両方を越えたときだけ言う（16秒平均）。1回の走りで ${FORM.tries}回まで、そのあとは ${FORM.later}秒に1回。\n\n` +
    `| 線（首・頭の位置） | ふつうの値からの高さ | 誤った声（10分あたり） | 誤った声が出た走り | ${SIZES.map((s) => `頭を +${s}° 前に`).join(' | ')} |\n` +
    `|---|---|---|---|${SIZES.map(() => '---').join('|')}|\n` +
    rows.join('\n') +
    '\n'
  writeFileSync(OUT, text)
  console.log(text)
})
