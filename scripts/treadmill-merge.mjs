// トレッドミルの突き合わせ：Mac の区間の指示（npm run drill の drill-….json）と、横のスマホのカメラ版の記録（rfc-….json）と、
// 腰のスマホのセンサーランの記録（rfc-sensor-….json。胸・頭・足首のセンサーと、腰のスマホの向き）を、それぞれの端末の時計で並べ、
// 区間ごとに「カメラの上体・首・頭の位置・体全体」「胸・頭のセンサー」「腰のスマホ」の値（真ん中）と、出た声・振動を1つの表にする。
// モデル（胸の正しい前傾の直し方 params.ts の CHEST_EXPECT、腰のスマホの使い道）を合わせ直す材料。手順は docs/validation-plan.md の「センサーとカメラを別々のスマホで」
//
// 使い方: npm run merge -- <drill-….json> <カメラ版.json> [<センサーラン.json>] [--camera-offset 秒] [--sensor-offset 秒] [--out ファイル]
//   ファイル名だけなら RFC_RUNS_DIR（既定 ~/Developer/research-data/runs/）から読む。カメラ版とセンサーランは中身で見分ける（順番は問わない）
//   センサーランがなく、カメラ版の記録にセンサーの値があれば（同じスマホでカメラとセンサーを使った前の走り）、それを使う（時計は同じ）
//   --camera-offset / --sensor-offset：その端末の時計 − Mac の時計（秒）を手で決める（ジャンプで決めたものより優先）
//   --out：Markdown をファイルにも書く（リポジトリの中には書かない）
// 時計の合わせ方：どの端末も、記録の clock（同じ瞬間の performance.now() と Date.now()）で、ふつうの時刻（ms）に直す。
//   端末の時計（ネットの時刻に合わせたもの）がずれていないかは、ジャンプの「はい」（Mac）と、それぞれの記録で大きく動き始めた時刻
//   （カメラ：腰の点の高さ。センサー：胸（なければ頭・足首）の加速度の大きさ）で確かめる（scripts/treadmill/merge.mjs の clockOffset）。
//   どちらの記録も同じジャンプを見ているので、カメラとセンサーの間の残りのずれ（下の表の「カメラ − センサー」）は、跳ぶまでの遅れによらない
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import { clock, STEPS } from './treadmill/plan.mjs'
import * as M from './treadmill/merge.mjs'
import * as S from './sensor-camera.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const num = (v) => (v === undefined ? undefined : Number(v))
const camManual = num(opt('--camera-offset'))
const senManual = num(opt('--sensor-offset'))
const outFile = opt('--out')
const [drillPath, ...logPaths] = args
if (!drillPath || !logPaths.length || logPaths.length > 2) {
  console.error('使い方: npm run merge -- <drill-….json> <カメラ版.json> [<センサーラン.json>] [--camera-offset 秒] [--sensor-offset 秒] [--out ファイル]')
  process.exit(1)
}

const root = new URL('..', import.meta.url).pathname
const tmp = join(root, 'node_modules/.tmp')
mkdirSync(tmp, { recursive: true })
const entry = join(tmp, 'treadmill-merge-entry.ts')
writeFileSync(
  entry,
  [
    `export { findJump, classify } from '${join(root, 'scripts/treadmill/replay.ts')}'`,
    `export { decodeBlock } from '${join(root, 'src/modes/sensor/log.ts')}'`,
    `export { expectedChest } from '${join(root, 'src/modes/sensor/expect.ts')}'`,
    `export { CHEST_EXPECT, HUNCH } from '${join(root, 'src/modes/sensor/params.ts')}'`,
  ].join('\n'),
)
const bundle = join(tmp, 'treadmill-merge.mjs')
mkdirSync(dirname(bundle), { recursive: true })
await build({ input: entry, platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const R = await import(pathToFileURL(bundle).href)

const runsDir = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const read = (p) => JSON.parse(readFileSync(existsSync(p) ? p : join(runsDir, p), 'utf8'))
const drill = read(drillPath)
if (drill.kind !== 'treadmill-drill') {
  console.error(`${drillPath} は npm run drill の記録ではありません`)
  process.exit(1)
}
const files = logPaths.map((p) => ({ path: p, data: read(p) }))
const logOf = (f) => f.data.log ?? f.data
const senFile = files.find((f) => logOf(f).mode === 'sensor')
const camFile = files.find((f) => logOf(f).mode !== 'sensor' && logOf(f).mode !== 'phone' && (logOf(f).rows ?? []).length)
if (files.some((f) => logOf(f).mode === 'phone')) {
  console.error('スマホ版（腰スマホ）の記録は npm run grade で見てください（ここではカメラ版とセンサーランを並べます）')
  process.exit(1)
}
if (!camFile && !senFile) {
  console.error('カメラ版かセンサーランの記録を渡してください')
  process.exit(1)
}
// センサーの記録：センサーラン、なければカメラ版の中のセンサー（同じ時計）
const senSrc = senFile ?? (camFile && logOf(camFile).sensors ? camFile : null)

const out = []
const p = (s = '') => out.push(s)
const f1 = (x, d = 1) => (M.finite(x) ? x.toFixed(d) : '—')
const pc = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—')
const epoch = (log) => (t) => log.clock.epochMs + t * 1000 - log.clock.perfMs

p(`# トレッドミルの突き合わせ（${clock(drill.startedAt)} に始めた記録）`)
p()
p(`- 区間の記録: \`${drillPath}\`${drill.done ? '' : '（途中で止めた記録）'}`)
if (camFile) p(`- カメラ版: \`${camFile.path}\``)
if (senFile) p(`- センサーラン（腰のスマホ）: \`${senFile.path}\``)
else if (senSrc) p('- センサー：カメラ版の記録の中のもの（同じスマホ・同じ時計）')
p()

// ---- 時計 ----
const hai = drill.jumpAt ?? null
const camLog = camFile ? logOf(camFile) : null
const senLog = senSrc ? logOf(senSrc) : null
const camJump = camFile && hai !== null ? R.findJump(camFile.data, hai) : null
let senJump = null
let senLag = null
if (senLog && hai !== null) {
  const nodes = S.decodeNodes(senLog.sensors, R.decodeBlock)
  const pick = ['胸', '頭', '左足首', '右足首'].map((pl) => nodes.find((n) => n.place === pl && n.samples.length)).find(Boolean)
  if (pick) {
    const toT = epoch(senLog)
    senJump = M.findAccJump(pick.samples.map((s) => ({ T: toT(s.tt), a: s.a })), hai)
    senLag = { place: pick.place, lag: pick.lag }
  }
}
const camOff = camFile ? M.clockOffset(camJump, hai, camManual) : null
const senOff = senSrc ? (senSrc === camFile ? { ...camOff, how: 'same' } : M.clockOffset(senJump, hai, senManual)) : null
const HOW = { manual: '手で決めた', jump: 'ジャンプにそろえた', clock: '端末の時計のまま（ジャンプが見つからない・目立たない）', same: 'カメラ版と同じ時計' }
p('## 時計')
p()
if (hai === null) p('ジャンプの合図がない記録です。端末の時計のまま並べます（`--camera-offset` / `--sensor-offset` で直せます）')
p('| 記録 | 動いた時刻 −「はい」 | 目立ち | 使ったずれ（端末 − Mac） | 決め方 |')
p('|---|---|---|---|---|')
if (camOff) p(`| カメラ版（腰の点の高さ） | ${camJump ? `${f1((camJump.T - hai) / 1000, 2)}秒` : '見つからない'} | ${camJump ? f1(camJump.strength) : '—'} | ${f1(camOff.off / 1000, 2)}秒 | ${HOW[camOff.how]} |`)
if (senOff) p(`| センサー（${senLag?.place ?? '—'}の加速度） | ${senJump ? `${f1((senJump.T - hai) / 1000, 2)}秒` : '見つからない'} | ${senJump ? f1(senJump.strength) : '—'} | ${f1(senOff.off / 1000, 2)}秒 | ${HOW[senOff.how]} |`)
p()
if (camJump && senJump) {
  const d = (camJump.T - camOff.off - (senJump.T - senOff.off)) / 1000
  const how = senOff.how === 'same' ? '同じ時計なので、この差が、動き始めを見つける細かさの確かめになる' : camOff.how === 'jump' && senOff.how === 'jump' ? 'どちらもジャンプにそろえたので 0' : '端末の時計のままの端末を含むので、この差が2台の間の残りのずれ'
  p(`カメラ − センサー（同じジャンプを見た時刻の差、ずれを直したあと）：${f1(d, 2)}秒（${how}）`)
  p()
}
p(`合わせ方：ジャンプが目立つ（ばらつきの ${M.STRONG} 倍以上）端末は、「動いた時刻 −（はい + ${M.REACT}秒）」をその端末の時計のずれとして引き、同じジャンプにそろえる。` +
  `端末どうしの合わせの確かさは、動き始めを見つける細かさ（カメラは骨格を取ったコマの間隔 ${f1(1 / 15, 2)}〜${f1(1 / 5, 2)}秒、センサーは25〜50回/秒の値を Bluetooth の遅れ（真ん中 ${f1(senLag?.lag, 3)}秒）を直して並べたもの）で、0.1〜0.2秒ほど。` +
  `Mac の区間とは、跳ぶまでの遅れ（ふつう 0.3〜0.8秒）の揺れの分だけ粗い（±0.3秒ほど）。区間の値は十数秒〜数分の真ん中なので、この大きさのずれは表にほとんど効かない（区間の境の1秒ほどが入れ替わるだけ）`)
p()

// ---- 値を Mac の時計にそろえる ----
const sections = drill.sections
  .filter((s) => s.start !== null)
  .map((s) => ({ ...s, end: s.end ?? drill.stoppedAt ?? drill.endedAt ?? s.start + s.plannedSec * 1000 }))
const cam = []
const voices = []
if (camLog) {
  const toT = epoch(camLog)
  const ci = (n) => camLog.columns.indexOf(n)
  const [iv, ineck, itrunk, ibody, ihl] = ['visible', 'neck', 'trunk', 'body', 'headLean'].map(ci)
  for (const r of camLog.rows) {
    if (r[iv] !== 1 || !M.finite(r[ineck])) continue
    cam.push({ T: toT(r[0]) - camOff.off, trunk: r[itrunk], neck: r[ineck], headLean: r[ihl], body: r[ibody] })
  }
  for (const [t, text] of camLog.events) {
    const said = R.classify(text)
    if (said && (said.kind === 'cue' || said.kind === 'mount')) voices.push({ T: toT(t) - camOff.off, item: said.item })
  }
}
const sec = []
const buzz = []
let waistEv = []
const sitEv = []
// 腰落ち（センサーランの腰のスマホ。記録だけ。src/modes/sensor/waistSit.ts）の1秒ごとの欄
const WSIT = [
  { key: 'wCad', name: 'ピッチ', d: 0 },
  { key: 'wBounce', name: '上下動 cm', d: 1 },
  { key: 'wCt', name: '有効接地 ms', d: 0 },
  { key: 'wDuty', name: '接地の割合', d: 3 },
  { key: 'wPeak', name: '山 g', d: 2 },
  { key: 'wDutyPct', name: '割合の増え %', d: 1 },
  { key: 'wPeakPct', name: '山の変わり %', d: 1 },
  { key: 'wSitIdx', name: '見分けの値', d: 2 },
]
let belt
if (senLog) {
  const toT = epoch(senLog)
  const sc = senLog.sensors?.secCols ?? []
  const col = (n) => sc.indexOf(n)
  const ix = Object.fromEntries(['run', 'chest', 'chestRef', 'head', 'waist', 'wHz', 'v', 'wSit', 'wSkip', ...WSIT.map((c) => c.key)].map((n) => [n, col(n)]))
  for (const r of senLog.sensors?.sec ?? []) {
    const g = (n) => (ix[n] < 0 ? null : r[ix[n]])
    sec.push({ T: toT(r[0]) - senOff.off, run: g('run') === 1, chest: g('chest'), chestRef: g('chestRef'), head: g('head'), waist: g('waist'), wHz: g('wHz'), v: g('v'), wSit: g('wSit'), wSkip: g('wSkip'), ...Object.fromEntries(WSIT.map((c) => [c.key, g(c.key)])) })
  }
  for (const [t, text] of senLog.events) {
    const item = M.buzzItem(text)
    if (item) buzz.push({ T: toT(t) - senOff.off, item })
    // 腰落ちの出来事（waist:ref・waist:sit・waist:sitOk）は、下の腰落ちの表に区間ごとに出す
    if (/^waist:(sit|ref)/.test(text)) sitEv.push({ T: toT(t) - senOff.off, text })
    else if (/^waist[: ]/.test(text)) waistEv.push(`${clock(toT(t) - senOff.off)} ${text}`)
  }
  const b = [...senLog.events, ...(camLog?.events ?? [])].find((e) => /^belt:kmh /.test(e[1]))
  if (b) belt = Number(b[1].split(' ')[1])
}

const rows = M.sectionRows(sections, { cam, sec, voices, buzz })
const line = senLog?.sensors?.pose?.line ?? R.HUNCH.poseLine
const KIND = { prep: '立つ', poses: '2つの立ち方', walk: '歩く', stop: '止める', jump: 'ジャンプ', speedup: '速さを上げる', normal: 'ふつう', drill: '崩し', gap: '戻し', speed: '速さを変える', move: 'スマホを動かす', moved: '動かしたあと', cool: '歩く' }
const nameOf = (s) => (s.kind === 'gap' ? `戻し（${STEPS[s.after]?.name ?? s.after ?? ''}のあと）` : s.kind === 'drill' ? (STEPS[s.key]?.name ?? s.key) : s.name ?? s.key)
const list = (xs) => {
  const m = new Map()
  for (const x of xs) m.set(x.item, (m.get(x.item) ?? 0) + 1)
  return [...m].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('・')
}

// ---- 区間ごと ----
p('## 区間ごと（値は区間の中の真ん中。時刻は Mac の時計）')
p()
const pose = senLog?.sensors?.pose
const rl = senLog?.sensors?.runLean
p(`胸・頭のセンサーは b（胸を開いた立ち方）からの前への傾き（度）。胸の2つの立ち方：${pose ? `${pose.mode}・差 ${f1(pose.deg)}°` : 'なし'}。` +
  `アプリが走り出しで決めた胸の基準：${rl ? `${f1(rl.offset ?? rl.deg)}°（${rl.by ?? '走る前傾'}${rl.by === 'speed' ? `・時速 ${rl.kmh ?? '—'}km（${rl.speedBy}）` : ''}）` : 'なし'}。` +
  `「正しい胸の線」は、いまの params.ts の CHEST_EXPECT（k ${R.CHEST_EXPECT.k}°・gain ${R.CHEST_EXPECT.gain}）で、その区間の速さ（ベルト${belt !== undefined ? ` 時速${belt}km` : 'なし'}、なければ足首の見積もり）の正しい胸 + 線の幅 ${line}°`)
p('腰：腰のスマホの b からの傾き（度。2つの立ち方の差が小さければ向きによらない角度）と、値があった秒の割合・1秒に届いた値の数。胸 − 腰：同じ1秒の胸と腰の差（体全体の前傾を引いた、背中の丸まりの見当。判定にはまだ使っていない）')
p()
p('| 区間 | 種類 | 始まり | 長さ | カメラ コマ | 上体 | 首 | 頭の位置 | 体全体 | 胸 | 胸の基準 | 正しい胸の線 | 胸 − 上体 | 頭のセンサー | 腰 | 胸 − 腰 | 腰の値（割合・回/秒） | 速さ | カメラの声 | センサーの振動 |')
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  const s = r.s
  const kmh = belt ?? (M.finite(r.v) ? r.v : undefined)
  const exp = senLog ? R.expectedChest(kmh).deg + line : NaN
  p(`| ${nameOf(s)} | ${KIND[s.kind] ?? s.kind} | ${clock(s.start)} | ${f1((s.end - s.start) / 1000, 0)}秒 | ${r.camN} | ${f1(r.trunk)} | ${f1(r.neck)} | ${f1(r.headLean)} | ${f1(r.body)} | ${f1(r.chest)} | ${f1(r.chestRef)} | ${f1(exp)} | ${r.pairN ? `${f1(r.pair)}（${r.pairN}秒）` : '—'} | ${f1(r.head)} | ${f1(r.waist)} | ${r.cwN ? `${f1(r.cw)}（${r.cwN}秒）` : '—'} | ${r.waistShare ? `${pc(r.waistShare)}・${f1(r.wHz, 0)}` : '—'} | ${f1(r.v)} | ${list(r.voices)} | ${list(r.buzz)} |`)
}
p()

// ---- 胸の直し方（CHEST_EXPECT.k）----
p('## 胸の正しい前傾の直し方（params.ts の CHEST_EXPECT.k）')
p()
const open = rows.filter((r) => r.s.kind === 'drill' && r.s.key === 'open')
const normal = rows.filter((r) => r.s.kind === 'normal')
const all = (rs) => rs.flatMap((r) => r.pairs)
const kOpen = M.median(all(open))
if (!cam.length || !sec.length) p('カメラとセンサーの両方の値がないので、出せません')
else {
  p(`- 胸を開く区間（${open.length}回）の「胸 − カメラの上体」：${f1(kOpen)}°（${all(open).length}秒）← この走りの k。params.ts の CHEST_EXPECT.k はいま ${R.CHEST_EXPECT.k}°（何本か集まったら、その真ん中を入れる）`)
  p(`- 参考：ふつうの区間 ${f1(M.median(all(normal)))}°（${all(normal).length}秒。いつもの走りの猫背も入る）・猫背の区間 ${f1(M.median(all(rows.filter((r) => r.s.key === 'hunch' && r.s.kind === 'drill'))))}°`)
  p('- 胸を開く区間がない走りでは k は出せない（`npm run drill:pose` の並びには入っている）。カメラは安定して走っている間 10秒のうち3秒だけ骨格を取るので、組にできる秒は区間の長さより少ない')
}
p()

// ---- 腰のスマホ ----
if (senFile) {
  p('## 腰のスマホ')
  p()
  const w = senLog.sensors?.waist
  p(`- 2つの立ち方：${w ? `${w.mode}・差 ${f1(w.deg)}°` : '記録なし'}`)
  p(`- 値の様子（events）：${waistEv.length ? waistEv.join('／') : 'なし'}`)
  const runSecs = sec.filter((q) => q.run)
  // 胸 − 腰で猫背を見分けられるか（判定に使うかは、何本か集めて決める。速さを変えても、ふつうと猫背が分かれるか）
  const cwOf = (rs) => rs.flatMap((r) => r.cws)
  const hunch = rows.filter((r) => r.s.kind === 'drill' && r.s.key === 'hunch')
  const fmt = (rs) => { const xs = cwOf(rs); return xs.length ? `${f1(M.median(xs))}°（${xs.length}秒）` : '—' }
  p(`- 胸 − 腰（区間の種類ごとの真ん中）：ふつう ${fmt(normal)}・猫背 ${fmt(hunch)}・胸を開く ${fmt(open)}。猫背とふつうの差が、速さや付け直しでも保たれるかを走るたびに見る`)
  p(`- 走っていた ${runSecs.length} 秒のうち、腰の値があった秒 ${runSecs.filter((q) => M.finite(q.waist)).length}（画面が消えた・裏に回った間は値が来ない。埋めていない）`)
  p()
  if (sec.some((q) => M.finite(q.wDuty))) {
    p('### 腰落ち（腰のスマホ。記録だけ・開発中）')
    p()
    p('1秒ごとの値は直近6秒の窓から出すので、崩しの区間は始め6秒を除いた秒の真ん中（崩しの区間の「見分けの値」の最大も同じ秒から）。' +
      '割合の増え・山の変わりは、同じ速さのふつうの走り（基準。events の waist:ref）から。見分けの値 =（接地の割合の z − 山の z）÷ ふつうの走りでのそのばらつき。' +
      '「決まり」の秒：見分けの値 ≥ 3、または 割合 +8% 以上かつ山 −9% 以下（params.ts の WAIST_SIT）。胸が猫背の線を越えた秒は判定しない')
    p()
    p(`| 区間 | 種類 | 秒 | ${WSIT.map((c) => c.name).join(' | ')} | 見分けの値の最大 | 決まりの秒 | 胸で止めた秒 | 出来事 |`)
    p(`|---|---|---|${WSIT.map(() => '---').join('|')}|---|---|---|---|`)
    for (const s of sections) {
      if (!['normal', 'drill', 'gap', 'speed'].includes(s.kind)) continue
      const from = s.start + (s.kind === 'drill' ? 6000 : 0)
      const qs = sec.filter((q) => q.T >= from && q.T < s.end && q.run)
      const ev = sitEv.filter((e) => e.T >= s.start && e.T < s.end + 6000).map((e) => e.text.replace(/ duty .*$/, '')).join('・')
      const idx = qs.map((q) => q.wSitIdx).filter(M.finite)
      p(`| ${nameOf(s)} | ${KIND[s.kind] ?? s.kind} | ${qs.length} | ${WSIT.map((c) => f1(M.median(qs.map((q) => q[c.key]).filter(M.finite)), c.d)).join(' | ')} | ${idx.length ? f1(Math.max(...idx), 2) : '—'} | ${qs.filter((q) => q.wSit === 1).length} | ${qs.filter((q) => q.wSkip === 5).length} | ${ev || '—'} |`)
    }
    p()
    p(`基準：${sitEv.filter((e) => e.text.startsWith('waist:ref')).map((e) => `${clock(e.T)} ${e.text.replace('waist:ref ', '')}`).join('／') || 'まだない'}`)
    p()
  }
}

const md = out.join('\n')
console.log(md)
if (outFile) {
  writeFileSync(outFile, md + '\n')
  console.log(`\n→ ${outFile}`)
}
