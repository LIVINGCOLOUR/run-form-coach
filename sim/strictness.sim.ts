// 実機の記録で試す（厳しさ）：トレッドミルで走った自分の記録を、いまのコーチ（src/modes/camera/coach.ts）にレベルごとの線（params.ts の STRICT）で通し直し、
//   ① ふつうに走った区間の声の回数（10分あたり。正しいフォームの線の声も、基準からの崩れの声も数える）
//   ② わざと崩した区間に、崩し始めから15秒以内・区間の中で声が出たか（出た声の項目と秒数）
//   ③ 良い姿勢の割合（結果の画面の数字。点数が SCORE.good 以上だった時間の割合）
// を出す。見る項目はすべて（上級の最後の段階と同じ）。区切りは記録の外の台本（崩しの指示を読み上げた時刻）から作る：
//   2026-11-03 15:08：センサーの台本 hardware/sensor/records/drill-20261103-150914.csv（記録の時刻 = 台本の時刻 + 104.6秒。胸のセンサーで確かめた）
//   2026-10-19 15:12：treadmill-drill の台本 drill-20261019-1514.json（記録と同じ時計。区切りごとの読み上げの始まりと終わり）
// 限り：記録はアプリが間引いて撮ったもの（安定して走っている間は10秒のうち3秒）なので、線を変えて「もっと細かく見たはず」の秒は足せない。
//   ランナーは声を聞いて直していない（記録のまま）。10-19 の記録には顎の列がない（声はかけないので判定は変わらない）
// 動かし方：RFC_RUNS_DIR=<記録の置き場所（既定 ~/Developer/research-data/runs）> npx vitest run --config sim/vitest.config.ts sim/strictness.sim.ts
//   結果は sim/result-strictness.md（記録そのものは書かない。区間ごとの回数と秒数だけ）
import { it as itAll } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Coach } from '../src/modes/camera/coach'
import * as P from '../src/modes/camera/params'
import { CUE as CUE_TEXT } from '../src/core/phrases'
import { LEVEL_LABEL, type Level } from '../src/core/level'
import type { Frame, ItemKey, RunLog } from '../src/core/types'

const DIR = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const OUT = process.env.SIM_OUT ?? 'sim/result-strictness.md'
const RUN_1103 = 'rfc-20261103-1508_log-1793686084534.json'
const RUN_1019 = 'rfc-20261019-1512_log-1792390374454.json'
const DRILL_1019 = 'drill-20261019-1514.json'
const it = itAll.skipIf(!existsSync(join(DIR, RUN_1103)))

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']
const ALL_ITEMS = Object.keys(CUE_TEXT) as ItemKey[]
const BY_TEXT = new Map(Object.entries(CUE_TEXT).map(([k, v]) => [v, k as ItemKey]))
const WITHIN = 15 // 崩し始めから、この秒数以内に声が出たら「気づいた」

// 区間（記録の時刻、秒）。kind：normal（ふつう）、drill（わざとの崩し。ok はその崩しに合う声の項目）、skip（数えない）
type Seg = { name: string; from: number; to: number; kind: 'normal' | 'drill' | 'skip'; ok?: ItemKey[] }

// 11-03：台本の区切り（秒）に 104.6 を足す。1〜3分 ふつう、3〜4分 足を前に（本人「できていなかった」ので数えない）、4〜5分 ふつう、
// 5〜6分 猫背、6〜7分 胸を張る（直し方の練習なので数えない）、7〜8分 頭だけ前、8〜9分 ふつう、そのあと走り終わりまで ふつう
function segs1103(): Seg[] {
  const o = 104.6
  return [
    { name: 'ふつう（1〜3分）', from: o + 60, to: o + 180, kind: 'normal' },
    { name: '足を前に（数えない）', from: o + 180, to: o + 240, kind: 'skip' },
    { name: 'ふつう（4〜5分）', from: o + 240, to: o + 300, kind: 'normal' },
    { name: '猫背', from: o + 300, to: o + 360, kind: 'drill', ok: ['hunch', 'trunk', 'head'] },
    { name: '胸を張る（数えない）', from: o + 360, to: o + 420, kind: 'skip' },
    { name: '頭だけ前', from: o + 420, to: o + 480, kind: 'drill', ok: ['head'] },
    { name: 'ふつう（8分〜終わり）', from: o + 480, to: 1e9, kind: 'normal' },
  ]
}

// 10-19：台本の区切りの読み上げの始まり〜終わり（Mac の時計 → 記録の時計）。崩しのあとの30秒（gap）は戻す間なので数えない
function segs1019(log: RunLog): Seg[] {
  const d = JSON.parse(readFileSync(join(DIR, DRILL_1019), 'utf8')) as { sections: { key: string; kind: string; start: number; end: number }[] }
  const c = log.clock!
  const lt = (ms: number) => (ms - c.epochMs + c.perfMs) / 1000
  const OK: Record<string, ItemKey[]> = {
    head: ['head', 'hunch'],
    down: ['head', 'trunk', 'hunch'],
    hunch: ['hunch', 'trunk', 'head'],
    lean: ['trunk', 'body', 'hunch'],
    sit: ['hip', 'trunkBack', 'bodyBack', 'body'],
    slow: ['landing'],
  }
  return d.sections.flatMap((s): Seg[] => {
    if (s.kind === 'normal') return [{ name: s.key, from: lt(s.start), to: lt(s.end), kind: 'normal' }]
    if (s.kind === 'drill' && OK[s.key]) return [{ name: s.key, from: lt(s.start), to: lt(s.end), kind: 'drill', ok: OK[s.key] }]
    return []
  })
}

interface Out {
  cues: { t: number; item: ItemKey; lead: boolean }[]
  refAt: number | null
  good: number // 良い姿勢の割合（結果の画面と同じ Session.share.good）
}

// 記録を Coach に通す（scripts/treadmill/replay.ts と同じ通し方。骨格を取らなかったコマは時間だけ進める）
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
  const out: Out = { cues: [], refAt: null, good: NaN }
  let seenCue = 0
  const handle = (t: number) => {
    for (; seenCue < coach.cues.length; seenCue++) {
      const c = coach.cues[seenCue]
      const item = BY_TEXT.get(c.text)
      if (item) out.cues.push({ t, item, lead: !!c.lead })
    }
    if (out.refAt === null && coach.leanRef) out.refAt = t
  }
  const SKIP = 1 / 15
  let lastT: number | null = null
  let lastP = true
  let lastM = false
  for (const r of rows) {
    const t = r[it_]
    if (lastT !== null && !log.full) for (let u = lastT + SKIP; u < t - SKIP / 2; u += SKIP) (coach.update({ t: u, present: lastP, moving: lastM }), handle(u))
    const visible = r[iv] === 1
    const moving = r[imov] === 1
    const m = visible && r[ineck] !== -999 ? { neck: r[ineck], trunk: r[itrunk], body: r[ibody], hipRatio: r[ihip], yaw: r[iyaw], headLean: r[ilean], chin: ichin < 0 ? 0 : r[ichin], dir: 1 as const } : undefined
    coach.update({ t, present: visible, moving, m, frame: m ? frameOf(r) : undefined })
    handle(t)
    lastT = t
    lastP = visible
    lastM = moving
  }
  out.good = coach.finish().share.good
  return out
}

const JA: Record<ItemKey, string> = { hunch: '猫背', head: '頭', trunk: '上体', trunkBack: '上体の起きすぎ', body: '体全体', bodyBack: '体全体の起きすぎ', hip: '腰', landing: '着地' }
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')

it('記録した走りに、レベルごとの線で通し直す', () => {
  const files = [
    { label: '2026-11-03 15:08（上級で走った。胸・頭のセンサー付き）', file: RUN_1103, segs: (_: RunLog) => segs1103() },
    ...(existsSync(join(DIR, RUN_1019)) && existsSync(join(DIR, DRILL_1019)) ? [{ label: '2026-10-19 15:12（崩しの台本つき）', file: RUN_1019, segs: segs1019 }] : []),
  ]
  const lines: string[] = []
  const p = (s = '') => lines.push(s)
  p('# 厳しさ（レベルごとの線）を、記録した走りに通した結果')
  p()
  p('動かし方と限りは sim/strictness.sim.ts の先頭。見る項目はすべて。「声」は崩れの声（正しいフォームの線の声と、今日の基準・仮の基準からの崩れの声）で、ほめる声・直った声は数えない。')
  p(`「気づいた」は、わざと崩した区間の始まり（指示の読み上げ）から ${WITHIN}秒以内・区間の中に、その崩しに合う項目の声が出たこと。カッコ内は始まりから声までの秒数。`)
  p()
  const sum: Record<Level, { normalSec: number; normalCues: number; hit: number; drills: number }> = Object.fromEntries(LEVELS.map((l) => [l, { normalSec: 0, normalCues: 0, hit: 0, drills: 0 }])) as never
  for (const f of files) {
    const { log } = JSON.parse(readFileSync(join(DIR, f.file), 'utf8')) as { log: RunLog }
    const segs = f.segs(log)
    p(`## ${f.label}`)
    p()
    p('| 線 | ふつうの区間の声（10分あたり） | 声の項目 | ' + segs.filter((s) => s.kind === 'drill').map((s) => s.name).join(' | ') + ' | 良い姿勢 | 今日の基準ができた時刻 |')
    p('|---|---|---|' + segs.filter((s) => s.kind === 'drill').map(() => '---').join('|') + '|---|---|')
    for (const lv of LEVELS) {
      P.applyStrictness(lv)
      const o = replay(log)
      const end = log.rows[log.rows.length - 1][0]
      const normal = segs.filter((s) => s.kind === 'normal')
      const normalSec = normal.reduce((a, s) => a + Math.max(0, Math.min(s.to, end) - s.from), 0)
      const inNormal = o.cues.filter((c) => normal.some((s) => c.t >= s.from && c.t < s.to))
      const items = new Map<string, number>()
      for (const c of inNormal) items.set(JA[c.item], (items.get(JA[c.item]) ?? 0) + 1)
      const drillCells = segs
        .filter((s) => s.kind === 'drill')
        .map((s) => {
          const c = o.cues.find((x) => x.t >= s.from && x.t < Math.min(s.to, s.from + WITHIN) && s.ok!.includes(x.item))
          const any = o.cues.filter((x) => x.t >= s.from && x.t < s.to)
          sum[lv].drills++
          if (c) sum[lv].hit++
          return c ? `○ ${JA[c.item]}（${f1(c.t - s.from)}秒）` : any.length ? `× 区間の中：${any.map((x) => `${JA[x.item]} ${f1(x.t - s.from)}秒`).join('・')}` : '× 声なし'
        })
      const good = o.good
      sum[lv].normalSec += normalSec
      sum[lv].normalCues += inNormal.length
      p(`| ${LEVEL_LABEL[lv]}（${lineText(lv)}） | ${f1((inNormal.length / normalSec) * 600)}（${inNormal.length}回 / ${f1(normalSec / 60)}分） | ${[...items].map(([k, n]) => `${k} ${n}`).join('・') || '-'} | ${drillCells.join(' | ')} | ${Math.round(good * 100)}% | ${o.refAt === null ? 'できなかった' : `${f1(o.refAt)}秒`} |`)
    }
    p()
  }
  p('## まとめ（2本の合計）')
  p()
  p('| レベル | ふつうの区間の声（10分あたり） | わざとの崩しに15秒以内に気づいた |')
  p('|---|---|---|')
  for (const lv of LEVELS) p(`| ${LEVEL_LABEL[lv]} | ${f1((sum[lv].normalCues / sum[lv].normalSec) * 600)} | ${sum[lv].hit} / ${sum[lv].drills} |`)
  p()
  p('読み方（記録を見て確かめたこと）：')
  p('- 11-03 の「頭だけ前」は、頭のセンサーで見ると前に出たり戻ったりをくり返していた。そのうえ、ベルトの速さは変えていないのに、着地の速さの目安が ±15〜20% 揺れて、')
  p('  速さが外れたとみた秒（姿勢を比べない秒）が、今日の基準ができたあとの 45% あった（頭だけ前の区間では 547〜560秒）。間引いて撮った秒（10秒のうち3秒）は足せない。')
  p('- 10-19 の hunch・lean・sit・slow は、画面から外れて走りが止まったとみられ、走り出しの整え直し（正しいフォームの線だけで見る間）に入っていた。')
  p('  今日の基準からの崩れを見ていない間なので、線の高さでは変わらない。この記録はほかに、歩き・ジャンプ・速さの変化を含む')
  p('- ふつうの区間の声は、ほとんどが頭と腰。11-03 の頭の声のとき、頭のセンサーは最初のふつうの2分より 3〜8° 前だった（外れた声とは言い切れない）')
  P.applyStrictness(P.DEFAULT_STRICT)
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
})

function lineText(lv: Level): string {
  const s = P.STRICT[lv]
  return `猫背 ${s.hunch.cue}°・頭 ${s.head.cue}°・上体 ${s.rel.trunk.cue}°・体全体 ${s.rel.body.cue}°・腰 ${s.hip.cue}%｜線 上体 ${s.form.trunkMax}°・首 ${s.form.neck}°/${s.form.headLean}°`
}
