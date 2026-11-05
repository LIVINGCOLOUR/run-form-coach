// 仮想実験（速さごとのよい例）：params.ts の goodAt（講師のよい例を、研究データの速さでの変わり方でずらした範囲）と、
// 速さで動く線（applyStrictness の kmh）を、研究データのふつうの走りを仮想のスマホで映した値と並べる。
//   ① 速さごとのよい例の範囲の表（goodAt。研究データがなくても書く）
//   ② 研究データの走り（posture-speed.sim.ts と同じ映し方・測り方）の、走りの平均が「その走りの速さのよい例の範囲」「講師の速さの範囲（GOOD）」に入った割合。
//      研究データはよい例ではない（ふつうの人）ので、入る割合は目安。見たいのは、遅い走りほど GOOD の下に外れる偏りが、速さごとの範囲で減るか
//   ③ 速さで動かした線（体全体の下の線、中級・上級の上の線）を、走りの平均が越えた本数（その走りのベルトの速さを入れたとき）と、いまの線（速さなし）
// データ：RBDS（上体・頭はないので ② ③ は体全体の脚の分だけの参考。使わない）、Riglet 楽・速い（上体・頭あり）、Van Hooren 3.33m/s（頭は作りもの）
// 動かし方：RIGLET_DIR=… VH_DIR=… npx vitest run --config sim/vitest.config.ts sim/good-speed.sim.ts（結果は sim/result-good-speed.md）
import { it } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRigletLanding, loadVhLanding, type LandingTrial } from './landing-data'
import { bodyAt, filmFrames, runningSpan } from './landing-film'
import { measure } from '../src/modes/camera/geometry'
import { applyStrictness, FORM, GOOD, GOOD_SPEED, goodAt } from '../src/modes/camera/params'
import type { Level } from '../src/core/level'

const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-good-speed.md'

interface Rec { ds: string; cond: string; kmh: number; body: number; trunk: number; neck: number; headLean: number }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

function recOf(tr: LandingTrial, ds: string, k: number): Rec | null {
  const [t0, t1] = runningSpan(tr)
  if (t1 - t0 < 10) return null
  const cs = tr.contacts.filter((c) => c.on >= t0 && c.on <= t1)
  const v = median(cs.map((c) => {
    const key = c.side === 'R' ? 'ankleR' : 'ankleL'
    const a = c.on + 0.3 * (c.off - c.on)
    const b = c.on + 0.6 * (c.off - c.on)
    return (bodyAt(tr, a)[key][0] - bodyAt(tr, b)[key][0]) / 1000 / (b - a)
  }))
  const frames = filmFrames((t) => bodyAt(tr, t), t0, t1 - t0, { timing: 15, seed: 500 + 31 * k })
  const bySec = new Map<number, ReturnType<typeof measure>[]>()
  for (const { t, f } of frames) (bySec.get(Math.floor(t)) ?? bySec.set(Math.floor(t), []).get(Math.floor(t))!).push(measure(f))
  const secs = [...bySec.values()].filter((m) => m.length >= 3)
  const avg = (key: 'body' | 'trunk' | 'neck' | 'headLean') => mean(secs.map((ms) => mean(ms.map((m) => m[key]))))
  return { ds, cond: tr.cond, kmh: v * 3.6, body: avg('body'), trunk: avg('trunk'), neck: avg('neck'), headLean: avg('headLean') }
}

function load(): Rec[] {
  const out: Rec[] = []
  let k = 0
  const push = (fn: () => LandingTrial, ds: string) => {
    try {
      const r = recOf(fn(), ds, k++)
      if (r) out.push(r)
    } catch {
      /* 使えない記録 */
    }
  }
  if (RIGLET)
    for (const id of readdirSync(RIGLET).sort())
      for (const [pace, cond] of [['Comfortable', '楽'], ['Fast', '速い']]) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (existsSync(p)) push(() => loadRigletLanding(p, id, cond), 'Riglet')
      }
  if (VH) for (const f of readdirSync(VH).sort()) if (/^Sub_\d+_333(ms)?\.c3d$/i.test(f)) push(() => loadVhLanding(join(VH, f), f.slice(0, 6), '333'), 'Van Hooren')
  return out
}

const f1 = (x: number) => (Math.round(x * 10) / 10).toString()

it('速さごとのよい例', () => {
  const L: string[] = []
  const p = (s = '') => L.push(s)
  p('# 速さごとのよい例（仮想実験 sim/good-speed.sim.ts）')
  p()
  p(`講師のよい例（GOOD、時速${GOOD_SPEED.anchor}km を土台）を、時速1km あたり 体全体・上体 ${GOOD_SPEED.slope}°（首は逆向きに同じ量、頭の位置・着地は動かさない）ずらし、`)
  p(`講師の速さから離れるほど上下に ${GOOD_SPEED.widen}°/km 広げた範囲（params.ts の GOOD_SPEED・goodAt。根拠はそこの説明）。時速${GOOD_SPEED.trusted.min}〜${GOOD_SPEED.trusted.max}km の外は仮。`)
  p()
  p('## ① 範囲の表')
  p()
  p('| 時速 | 体全体（真ん中） | 上体（真ん中） | 首の上の端 | 頭の位置の上の端 | 着地の上の端 | 仮 |')
  p('|---|---|---|---|---|---|---|')
  for (const kmh of [7, 8, 9, 10, 11, 12, 13, 15]) {
    const g = goodAt(kmh)
    p(`| ${kmh} | ${f1(g.body.min)}〜${f1(g.body.max)}（${f1(g.body.mid)}） | ${f1(g.trunk.min)}〜${f1(g.trunk.max)}（${f1(g.trunk.mid)}） | ${f1(g.head.neck.max)} | ${f1(g.head.headLean.max)} | +${Math.round(g.landing.max * 100)}% | ${g.provisional ? '仮' : ''} |`)
  }
  p()
  const recs = load()
  if (!recs.length) {
    p('（RIGLET_DIR・VH_DIR がないので ② ③ は飛ばした）')
    writeFileSync(OUT, L.join('\n') + '\n')
    return
  }
  p('## ② 研究データのふつうの走り（走りの平均）が、よい例の範囲に入った本数')
  p()
  p('研究データはよい例ではないので、入る割合は目安。遅い走りが GOOD の下に外れる偏りが、速さごとの範囲で減るかを見る。')
  p()
  p('| 条件 | 本数 | 時速（真ん中） | 体全体：GOOD の中 / 下 / 上 | 体全体：速さの範囲の中 / 下 / 上 | 上体：GOOD の中 / 下 / 上 | 上体：速さの範囲の中 / 下 / 上 |')
  p('|---|---|---|---|---|---|---|')
  const cnt = (rs: Rec[], key: 'body' | 'trunk', at: (r: Rec) => { min: number; max: number }) =>
    `${rs.filter((r) => r[key] >= at(r).min && r[key] <= at(r).max).length} / ${rs.filter((r) => r[key] < at(r).min).length} / ${rs.filter((r) => r[key] > at(r).max).length}`
  for (const [ds, cond] of [['Riglet', '楽'], ['Riglet', '速い'], ['Van Hooren', '333']]) {
    const rs = recs.filter((r) => r.ds === ds && r.cond === cond)
    if (!rs.length) continue
    p(`| ${ds} ${cond} | ${rs.length} | ${f1(median(rs.map((r) => r.kmh)))} | ${cnt(rs, 'body', () => GOOD.body)} | ${cnt(rs, 'body', (r) => goodAt(r.kmh).body)} | ${cnt(rs, 'trunk', () => GOOD.trunk)} | ${cnt(rs, 'trunk', (r) => goodAt(r.kmh).trunk)} |`)
  }
  p()
  p('## ③ 速さで動かした線を、走りの平均が越えた本数（その走りの速さを入れたとき / 速さなし）')
  p()
  p('| レベル | 本数 | 体全体の下の線（起きすぎ） | 体全体の上の線 | 上体の上の線 |')
  p('|---|---|---|---|---|')
  const rs = recs
  for (const lv of ['beginner', 'intermediate', 'advanced'] as Level[]) {
    const over = (kmh: number | undefined) => {
      let lo = 0
      let hiB = 0
      let hiT = 0
      for (const r of rs) {
        applyStrictness(lv, kmh === undefined ? undefined : r.kmh)
        if (r.body < FORM.body.min) lo++
        if (r.body > FORM.body.max) hiB++
        if (r.trunk > FORM.trunk.max) hiT++
      }
      return [lo, hiB, hiT]
    }
    const a = over(1)
    const b = over(undefined)
    p(`| ${lv} | ${rs.length} | ${a[0]} / ${b[0]} | ${a[1]} / ${b[1]} | ${a[2]} / ${b[2]} |`)
  }
  applyStrictness('intermediate', undefined)
  p()
  p('限り：研究データの印の点とアプリの点はずれるので、値そのものの比べは目安（傾きのほうが信用できる）。時速8km より遅い研究データは少ない（Riglet 楽の下から1割が 6.9km）。')
  writeFileSync(OUT, L.join('\n') + '\n')
  console.log(L.join('\n'))
})
