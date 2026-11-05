// 実機の記録で試す（走り出しの頭の線）：トレッドミルで走った自分の記録（カメラ版）を、いまのコーチに上級で通し直し、
// 頭の声（「頭が前に出ています」）が、いつ・何回出るかを、頭の線ごとに出す。
//   整える間：走り出しの「整える」（form.ts）が終わるまでに、頭の線で言った声
//   あと（線）：整え終わったあと、頭の線で言った声（線を越えたままなら FORM.later 秒に1回）
//   あと（崩れ）：今日の基準・仮の基準からの崩れの声（LIMITS.head）
//   今日の基準の頭：基準にした首の角度・頭の位置（走り出しの頭が線を越えていたら、線の内側にいた秒か、線そのものになる）
// 動かし方は sim/strictness.sim.ts と同じ（記録を Coach に通す。骨格を取らなかったコマは時間だけ進める）。
//   RFC_RUNS_DIR=<記録の置き場所（既定 ~/Developer/research-data/runs）> npx vitest run --config sim/vitest.config.ts sim/head-runs.sim.ts
//   結果は sim/result-head-runs.md（記録そのものは書かない。回数と秒数と基準の値だけ）
// 限り：記録はアプリが間引いて撮ったもの。ランナーは声を聞いて直していない（記録のまま。直していれば、整える間の声は減り、ほめる声が出る）。
//   11-02・11-03 には、わざと頭を前に出した区間・猫背の区間がある（声が出てよい区間）
import { it as itAll } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Coach } from '../src/modes/camera/coach'
import * as P from '../src/modes/camera/params'
import { CUE as CUE_TEXT } from '../src/core/phrases'
import type { Frame, ItemKey, RunLog } from '../src/core/types'

const DIR = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const OUT = process.env.SIM_OUT ?? 'sim/result-head-runs.md'
const RUNS = [
  { label: '2026-11-02 18:43（頭を前に出す区間あり）', file: 'rfc-20261102-1843_log-1793612634838.json' },
  { label: '2026-11-02 20:23（頭を前に出す区間あり）', file: 'rfc-20261102-2023_log-1793618622849.json' },
  { label: '2026-11-03 15:08（猫背・頭だけ前の区間あり）', file: 'rfc-20261103-1508_log-1793686084534.json' },
  { label: '2026-11-04 20:05', file: 'rfc-20261104-2005_log-1793790318421.json' },
  { label: '2026-11-05 19:07', file: 'rfc-20261105-1907_log-1793873270939.json' },
].filter((r) => existsSync(join(DIR, r.file)))
const it = itAll.skipIf(!RUNS.length)

const ALL_ITEMS = Object.keys(CUE_TEXT) as ItemKey[]
const BY_TEXT = new Map(Object.entries(CUE_TEXT).map(([k, v]) => [v, k as ItemKey]))

interface Out {
  cues: { t: number; item: ItemKey; lead: boolean; start: boolean }[]
  runFrom: number | null
  doneAt: number | null
  end: number
  ref: { neck: number; headLean: number } | null
}

function replay(log: RunLog): Out {
  const col = (n: string) => log.columns.indexOf(n)
  const [it_, ip, iv, imov, ineck, itrunk, ibody, ihip, iyaw, ilean, ichin] = ['t', 'phase', 'visible', 'moving', 'neck', 'trunk', 'body', 'hipRatio', 'yaw', 'headLean', 'chin'].map(col)
  const coach = new Coach({ pause: false, items: ALL_ITEMS })
  const off = log.columns.length - 1
  const npts = log.points.length
  const frameOf = (r: number[]): Frame | undefined => {
    if (r.length < off + npts * 3) return undefined
    const f: Frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
    log.points.forEach((pi, k) => (f[pi] = { x: r[off + k * 3], y: r[off + k * 3 + 1], v: r[off + k * 3 + 2] }))
    return f
  }
  const run = log.phases.indexOf('run')
  const rows = log.rows.filter((r) => r[ip] === run).sort((a, b) => a[it_] - b[it_])
  const out: Out = { cues: [], runFrom: null, doneAt: null, end: rows.length ? rows[rows.length - 1][it_] : 0, ref: null }
  let seen = 0
  const handle = (t: number) => {
    for (; seen < coach.cues.length; seen++) {
      const c = coach.cues[seen]
      const item = BY_TEXT.get(c.text)
      if (item) out.cues.push({ t, item, lead: !!c.lead, start: !coach.formDone })
    }
    if (out.runFrom === null && coach.state === 'running') out.runFrom = t - coach.active
    if (out.doneAt === null && coach.formDone) out.doneAt = t
    if (!out.ref && coach.leanRef) out.ref = { neck: coach.leanRef.neck, headLean: coach.leanRef.headLean }
  }
  const SKIP = 1 / 15
  let lastT: number | null = null
  let lastP = true
  let lastM = false
  for (const r of rows) {
    const t = r[it_]
    if (lastT !== null && !log.full)
      for (let u = lastT + SKIP; u < t - SKIP / 2; u += SKIP) {
        coach.update({ t: u, present: lastP, moving: lastM })
        handle(u)
      }
    const visible = r[iv] === 1
    const moving = r[imov] === 1
    const m = visible && r[ineck] !== -999 ? { neck: r[ineck], trunk: r[itrunk], body: r[ibody], hipRatio: r[ihip], yaw: r[iyaw], headLean: r[ilean], chin: ichin < 0 ? 0 : r[ichin], dir: 1 as const } : undefined
    coach.update({ t, present: visible, moving, m, frame: m ? frameOf(r) : undefined })
    handle(t)
    lastT = t
    lastP = visible
    lastM = moving
  }
  coach.finish()
  return out
}

const f0 = (x: number) => Math.round(x).toString()
const f1 = (x: number) => x.toFixed(1)

it('記録した走りの頭の声（頭の線ごと）', () => {
  const lines = (process.env.HEAD_LINES ?? '38/42,' + `${P.STRICT.advanced.form.neck}/${P.STRICT.advanced.form.headLean}`).split(',').map((s) => s.split('/').map(Number) as [number, number])
  const lines_: string[] = []
  const p = (s = '') => lines_.push(s)
  p('# 記録した走りの頭の声（上級、頭の線ごと）')
  p()
  p('動かし方と限りは sim/head-runs.sim.ts の先頭。時刻は走り出し（コーチが走っているとみなした時刻）からの秒。ランナーは声を聞いて直していない（記録のまま）。')
  p('「整える間」は走り出しの整えるが終わるまでに頭の線で言った声、「あと（線）」はそのあと頭の線で言った声、「あと（崩れ）」は今日の基準・仮の基準からの頭の崩れの声。')
  p()
  p('| 記録 | 線（首・頭の位置） | 整える間 | あと（線） | あと（崩れ） | 整え終わり | 今日の基準の頭（首・頭の位置） | 走った長さ |')
  p('|---|---|---|---|---|---|---|---|')
  for (const r of RUNS) {
    const { log } = JSON.parse(readFileSync(join(DIR, r.file), 'utf8')) as { log: RunLog }
    for (const [neck, lean] of lines) {
      P.applyStrictness('advanced')
      P.FORM.head.neck = neck
      P.FORM.head.headLean = lean
      const o = replay(log)
      const rf = o.runFrom ?? 0
      const head = o.cues.filter((c) => c.item === 'head')
      const at = (xs: typeof head) => (xs.length ? `${xs.length}回（${xs.map((c) => f0(c.t - rf)).join('・')}秒）` : '0回')
      p(
        `| ${r.label} | ${neck}°・${lean}° | ${at(head.filter((c) => c.lead && c.start))} | ${at(head.filter((c) => c.lead && !c.start))} | ${at(head.filter((c) => !c.lead))} | ${o.doneAt === null ? '—' : `${f0(o.doneAt - rf)}秒`} | ${o.ref ? `${f1(o.ref.neck)}°・${f1(o.ref.headLean)}°` : 'できなかった'} | ${f1((o.end - rf) / 60)}分 |`,
      )
    }
  }
  P.applyStrictness(P.DEFAULT_STRICT)
  writeFileSync(OUT, lines_.join('\n') + '\n')
  console.log(lines_.join('\n'))
})
