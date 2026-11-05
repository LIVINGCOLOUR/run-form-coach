// 仮想実験（走り出しから頭が前に出ている人を、整える間に知らせる線 FORM.head）：
//   線をよい例（params.ts の GOOD.head。講師のよい例9本、首 22〜30.9°・頭の位置 29.9〜37.8°）の上の端の近くに置いたとき、
//   ① よい例の真ん中で走る人（首 GOOD.head.neck.mid・頭の位置 GOOD.head.headLean.mid）に出る「頭が前に出ています」（誤った声。10分あたり）
//   ② よい例の上の端で走る人（GOOD.head の max）に出る声（参考：線をよい例の端のすぐ外に置けば、半分ほどは出る）
//   ③ 自分のいつもの頭（2026-11-03〜05 の16秒平均の真ん中、首 33°・頭の位置 37°）で走り出して直さない人に、
//      整える間（走り出して FORM.from + 120秒まで）に頭の線の声が出た割合と、走り出しから声までの秒、10分あたりの頭の声の回数（線の声と、今日の基準・仮の基準からの崩れの声）
//   ④ いつもの頭で走り出し → 声のあと直す（よい例の真ん中へ。走り出して FIX秒）→ BACK秒でいつもの頭へ戻る人に、
//      直ったと伝えた（「いいですね。その形です。」）割合と、戻ってから声が出た割合・秒
//   を出す。頭の値の作り方は sim/head-line.sim.ts と同じ：研究データのふつうの走りを10分あまりにのばし、実機なみのゆっくりしたずれを足して
//   仮想のスマホで映し、1本ごとに、走っている間の首の角度・頭の位置の真ん中を目当ての値にそろえる（人による違いは消え、1本の中の揺れだけが残る）。
//   ほかの項目の線は上級（STRICT.advanced）。間引きはアプリと同じ。仮想のランナーは声を聞いても直さない（④は決まった時刻に動かす）
// 限り：揺れは研究データ＋足したずれの分だけ。自分の記録の8秒平均の揺れ（2026-11-04・05、2分の真ん中から 首 約3°・頭の位置 約3°）より小さいかもしれない。
//   スマホの向き（前側から撮ると頭が大きく出る）は真横に固定
// 動かし方：RIGLET_DIR=<Riglet のデータ> VH_DIR=<Van Hooren のデータ> npx vitest run --config sim/vitest.config.ts sim/head-start.sim.ts
//   （結果は sim/result-head-start.md）
import { it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRiglet } from './riglet'
import { loadUpper } from './vanhooren'
import { LongRun, truthOf, type Source } from './longrun'
import { film, replay, BASE, BASE_NOISE, type Extra, type Stream } from './pipeline'
import type { Body } from './camera'
import { applyStrictness, DEFAULT_STRICT, FORM, GOOD, STRICT } from '../src/modes/camera/params'
import { FORM_SAY } from '../src/core/phrases'

const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-head-start.md'
const it = itAll.skipIf(!RIGLET && !VH)

const SEC = 780
const F = 11
const REAL_EXTRA: Extra = { neck: [1.8, 3], trunk: [0.35, 3], body: [0.4, 120] }
const GOOD_MID = { neck: GOOD.head.neck.mid, headLean: GOOD.head.headLean.mid }
const GOOD_MAX = { neck: GOOD.head.neck.max, headLean: GOOD.head.headLean.max }
const HABIT = { neck: 33, headLean: 37 } // 自分の 2026-11-03〜05 の16秒平均の真ん中（11-03 33.0°/37.1°、11-04 34.8°/37.8°、11-05 32.0°/36.0°）
const START = 120 // 整える間とみなす長さ（走り出して FORM.from 秒から）
const FIX = 70 // ④：走り出してこの秒に直す
const BACK = 420 // ④：走り出してこの秒に、いつもの頭へ戻る（今日の基準ができたあと）
const LINES: [number, number][] = [
  [30, 35],
  [31, 35],
  [31, 36],
  [32, 36],
  [32, 37],
  [33, 37],
  [31, 38],
  [34, 38],
  [34, 41],
  [38, 42],
  [46, 50],
  [48, 52],
]

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (x: number) => `${Math.round(x * 100)}%`

// 首の角度の6秒平均が20°を超えて動く記録は、肩の関節の中心の推定がおかしいとみて除く（sim/head-line.sim.ts と同じ）
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

function loadRuns(): LongRun[] {
  const out: LongRun[] = []
  const add = (src: Source) => {
    if (src.frames / src.fps < 20 || neckRange(src) > 20) return
    const run = new LongRun()
    run.append(src, SEC, out.length + 1)
    out.push(run)
  }
  if (RIGLET)
    for (const id of readdirSync(RIGLET).sort())
      for (const pace of ['Comfortable', 'Fast']) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (!existsSync(p)) continue
        try {
          add(loadRiglet(p, `${id}-${pace}`) as Source)
        } catch {
          // 使えない記録は飛ばす
        }
      }
  if (VH)
    for (const f of readdirSync(VH).filter((x) => /^Sub_\d+_333(ms)?\.c3d$/i.test(x)).sort()) {
      try {
        add(loadUpper(join(VH, f), `VH-${f.slice(0, 6)}`) as Source)
      } catch {
        // 使えない記録は飛ばす
      }
    }
  return out
}

// 走っている間の首の角度・頭の位置の真ん中
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

type Target = { neck: number; headLean: number }
// 首の角度と頭の位置を、時刻ごとの目当て（target(t)）に、真ん中がそろうだけ足す
function shifted(s: Stream, mid: Target, target: (t: number) => Target): Stream {
  const d = Float32Array.from(s.d)
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    if (d[j + 1] !== 1) continue
    const g = target(d[j])
    d[j + 3] += g.neck - mid.neck
    d[j + 4] += g.headLean - mid.headLean
  }
  return { ...s, d }
}

type R = ReturnType<typeof replay>
const headCues = (r: R) => r.cues.filter((c) => c.item === 'head')

it('走り出しから頭が前に出ている人を、整える間に知らせる線', () => {
  applyStrictness('advanced')
  const runs = loadRuns()
  const saved = { neck: FORM.head.neck, headLean: FORM.head.headLean }
  // 走り始め（コーチが走っているとみなした時刻）は、ふつうの流れを一度通して決める（線によらない）
  const base = runs.map((run, k) => {
    const s = film({ sec: SEC, seed: k * 1009 + 1, pl: BASE, noise: BASE_NOISE, extra: REAL_EXTRA, body: (t) => run.at(t) })
    return { s, mid: middleOf(s), runFrom: replay(s).runFrom }
  })
  const streams = base.map((b) => ({
    runFrom: b.runFrom,
    good: shifted(b.s, b.mid, () => GOOD_MID),
    edge: shifted(b.s, b.mid, () => GOOD_MAX),
    habit: shifted(b.s, b.mid, () => HABIT),
    back: shifted(b.s, b.mid, (t) => (t < b.runFrom + FIX || t >= b.runFrom + BACK ? HABIT : GOOD_MID)),
  }))
  const n = streams.length
  const rows: string[] = []
  for (const [neck, lean] of LINES) {
    FORM.head.neck = neck
    FORM.head.headLean = lean
    let goodN = 0
    let goodRel = 0
    let goodStart = 0
    let edgeN = 0
    let minutes = 0
    let habitHit = 0
    const habitLat: number[] = []
    let habitLead = 0
    let habitRel = 0
    let fixed = 0
    let backHit = 0
    const backLat: number[] = []
    for (const s of streams) {
      const from = s.runFrom + FORM.from
      minutes += (SEC - from) / 60
      const g = headCues(replay(s.good))
      goodN += g.filter((c) => c.lead).length
      goodRel += g.filter((c) => !c.lead).length
      if (g.some((c) => c.lead && c.t < from + START)) goodStart++
      edgeN += headCues(replay(s.edge)).filter((c) => c.lead).length
      const h = headCues(replay(s.habit))
      habitLead += h.filter((c) => c.lead).length
      habitRel += h.filter((c) => !c.lead).length
      const first = h.find((c) => c.lead && c.t < from + START)
      if (first) {
        habitHit++
        habitLat.push(first.t - s.runFrom)
      }
      const rb = replay(s.back)
      if (rb.cues.some((c) => c.text === FORM_SAY.ok && c.t >= s.runFrom + FIX && c.t < s.runFrom + BACK)) fixed++
      const bh = headCues(rb).find((c) => c.t >= s.runFrom + BACK)
      if (bh) {
        backHit++
        backLat.push(bh.t - s.runFrom - BACK)
      }
    }
    const per10 = (x: number) => ((x / minutes) * 10).toFixed(2)
    const now = Object.entries(STRICT).filter(([, v]) => v.form.neck === neck && v.form.headLean === lean).map(([k]) => k)
    rows.push(
      `| ${neck}°・${lean}°${now.length ? `（${now.join('・')}）` : ''} | ${per10(goodN)}（走り出し ${goodStart}/${n}）・${per10(goodRel)} | ${per10(edgeN)} | ${pct(habitHit / n)}（${habitLat.length ? Math.round(median(habitLat)) + '秒' : '—'}） | ${per10(habitLead)}・${per10(habitRel)} | ${pct(fixed / n)} | ${pct(backHit / n)}（${backLat.length ? Math.round(median(backLat)) + '秒' : '—'}） |`,
    )
  }
  FORM.head.neck = saved.neck
  FORM.head.headLean = saved.headLean
  applyStrictness(DEFAULT_STRICT)

  const text =
    `# 走り出しから頭が前に出ている人を、整える間に知らせる線（仮想実験）\n\n` +
    `動かし方と限りは sim/head-start.sim.ts の先頭。研究データのふつうの走り ${n}本を ${SEC}秒にのばし、1本ごとに首の角度・頭の位置の真ん中を目当ての値にそろえて、アプリのコーチ（上級、間引きあり）に通した。` +
    `線は首の角度と頭の位置の両方を越えたときだけ言う（${FORM.window}秒平均）。整える間は ${FORM.tries}回まで（${30}秒あけて）、そのあとは ${FORM.later}秒に1回。\n\n` +
    `- よい例の真ん中：首 ${GOOD_MID.neck}°・頭の位置 ${GOOD_MID.headLean}°。よい例の上の端：首 ${GOOD_MAX.neck}°・頭の位置 ${GOOD_MAX.headLean}°。いつもの頭：首 ${HABIT.neck}°・頭の位置 ${HABIT.headLean}°\n` +
    `- 「線の声」は頭の線で言った声、「崩れの声」は今日の基準・仮の基準からの頭の崩れの声（上級 +${STRICT.advanced.head.cue}°。線によらず、ふつうの走りの揺れで10分あたり約4回出る：sim/result-coach-strict.md）。直った声・ほめる声は数えない\n` +
    `- 整える間に気づいた：走り出して ${FORM.from}秒から ${START}秒の間に、頭の線の声が出た走りの割合（かっこは走り出しから声までの秒の真ん中）\n` +
    `- 直して戻る：いつもの頭で走り出し、${FIX}秒によい例の真ん中へ直し、${BACK}秒にいつもの頭へ戻す。直った：${FIX}〜${BACK}秒に「${FORM_SAY.ok}」と言った割合。戻って気づいた：${BACK}秒より後に頭の声が出た割合\n\n` +
    `| 線（首・頭の位置） | よい例の真ん中で走る人：線の声（10分あたり。走り出しに出た走り）・崩れの声 | よい例の上の端で走る人：線の声（10分あたり） | いつもの頭：整える間に気づいた | いつもの頭：線の声・崩れの声（10分あたり） | 直して戻る：直った | 直して戻る：戻って気づいた |\n` +
    `|---|---|---|---|---|---|---|\n` +
    rows.join('\n') +
    '\n'
  writeFileSync(OUT, text)
  console.log(text)
})
