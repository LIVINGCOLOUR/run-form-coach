// トレッドミルの検証の採点。Mac の声で区間を指示した記録（npm run drill の drill-….json）と、
// 同じ時間に撮ったカメラ版・スマホ版の記録（npm run logs で取ってきた rfc-….json / rfc-phone-….json）を時計で合わせ、
// 区間ごとに「その崩しを見つけたか・区間の始まりから最初の声までの秒数・ふつうの区間で出た誤った声・戻しの区間で声が止まったか」を表にする。
//
// 使い方: npm run grade -- <drill-….json> <カメラ版.json> [<スマホ版.json>] [オプション]
//   （カメラ版・スマホ版はどちらか1つでもよく、順番も問わない。中身で見分ける）
//   --set 名前=値          線を上書きして、記録をもう一度判定に通す（何回でも）。例 --set head=7 --set trunkRel=4
//                          短い名前：head・trunk・body・hip（LIMITS の cue）、trunkRel・bodyRel（REL_LIMITS の cue）、headAbs、window、
//                          cadence・bounce・braking（スマホ）。ほかは LIMITS.head.full のように場所で
//   --grace 秒             崩しの区間が終わってから、この秒数までに出た声は、その崩しを見つけたと数える（既定 10）
//   --camera-offset 秒     カメラ版の時計 − Mac の時計（既定 0。ジャンプの表で大きくずれていたら入れる）
//   --phone-offset 秒      スマホ版の時計 − Mac の時計（既定 0）
//   --items all            カメラ版で、撮ったときの「注意した項目」（ランナーのレベル）ではなく、すべての項目で声をかけるとして通す
//   --no-replay            判定に通し直さず、記録にある声だけで採点する
//   --thin                 カメラ版の全コマ記録（?full=1 で撮ったもの）を、ふだんの間引き（安定して走っている間は10秒のうち3秒）に
//                          通し直す。同じ走りで、間引いたときに声が遅れる・抜けるかを比べるため
//   --replay-from jog|start  通し直すのを、ジョグの前の「速さを上げる」からにする（既定 jog）か、記録の始めからにするか。
//                          歩きを「走っている」と見ていたら、走り始めの自分の基準が歩きでできてしまうので、既定ではジョグから作り直す
//   --out ファイル         Markdown をファイルにも書く
//
// 判定に通し直すところ（scripts/treadmill/replay.ts）は src/ の判定のコードをそのまま使う（rolldown で1つにまとめて読む）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import { clock, STEPS } from './treadmill/plan.mjs'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return false
  args.splice(i, 1)
  return true
}
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const sets = []
for (let v; (v = opt('--set')) !== undefined; ) sets.push(v)
const grace = Number(opt('--grace') ?? 10)
const camOff = Number(opt('--camera-offset') ?? 0) * 1000
const phoneOff = Number(opt('--phone-offset') ?? 0) * 1000
const itemsAll = opt('--items') === 'all'
const noReplay = flag('--no-replay')
const thin = flag('--thin')
const replayFrom = opt('--replay-from') ?? 'jog'
const outFile = opt('--out')
const [drillPath, ...logPaths] = args
if (!drillPath || !logPaths.length || logPaths.length > 2) {
  console.error('使い方: npm run grade -- <drill-….json> <カメラ版.json> [<スマホ版.json>] [--set 名前=値] [--grace 秒] [--camera-offset 秒] [--phone-offset 秒] [--items all] [--no-replay] [--thin] [--out ファイル]')
  process.exit(1)
}

const root = new URL('..', import.meta.url).pathname
const bundle = join(root, 'node_modules/.tmp/treadmill-replay.mjs')
mkdirSync(dirname(bundle), { recursive: true })
await build({ input: join(root, 'scripts/treadmill/replay.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const R = await import(pathToFileURL(bundle).href)

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const drill = read(drillPath)
if (drill.kind !== 'treadmill-drill') {
  console.error(`${drillPath} は npm run drill の記録ではありません`)
  process.exit(1)
}
const files = logPaths.map((p) => ({ path: p, data: read(p) }))
const cam = files.find((f) => !R.isPhone(f.data))
const phone = files.find((f) => R.isPhone(f.data))
if (files.length === 2 && (!cam || !phone)) {
  console.error('カメラ版とスマホ版を1つずつ渡してください（同じ種類が2つあります）')
  process.exit(1)
}

// 区間（Mac の時計）。閉じていない区間（途中で止めた）は止めた時刻で閉じる
const sections = drill.sections
  .filter((s) => s.start !== null)
  .map((s) => ({ ...s, end: s.end ?? drill.stoppedAt ?? drill.endedAt ?? s.start + s.plannedSec * 1000 }))
// 通し直しの始め（Mac の時計）：ジョグの前の「速さを上げる」を言い始めた時刻
const speedup = sections.find((s) => s.kind === 'speedup')
const jogFrom = speedup ? speedup.announceAt : null
if (!['jog', 'start'].includes(replayFrom)) {
  console.error('--replay-from は jog か start です')
  process.exit(1)
}


const fmt = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d))
const out = []
const p = (s = '') => out.push(s)

p(`# トレッドミルの検証の採点（${clock(drill.startedAt)} に始めた記録）`)
p()
p(`- 区間の記録: \`${drillPath}\`${drill.done ? '' : '（途中で止めた記録）'}${drill.note ? `。メモ: ${drill.note}` : ''}`)
if (cam) p(`- カメラ版: \`${cam.path}\``)
if (phone) p(`- スマホ版: \`${phone.path}\``)
p(`- 崩しの区間が終わってから ${grace} 秒までに出た声は、その崩しを見つけたと数える（\`--grace\`）`)
if (sets.length) p(`- 線の上書き: ${sets.map((s) => `\`${s}\``).join('、')}`)
if (!noReplay) p(replayFrom === 'jog' && jogFrom !== null ? `- 通し直しは、ジョグの前の「速さを上げる」（${clock(jogFrom)}）から（歩いている間の値は通さず、走り始めの自分の基準をジョグで作る）。記録の始めから通すときは \`--replay-from start\`` : '- 通し直しは、記録の始めから')
p()

// ---- 声の集め方 ----
// 話した言葉を項目に直す。声かけ（cue）・メトロノーム（tone）・付け方の確認（mount）は「声」。直った（recover）・ほめる（praise）は別に数える
function cuesOf(events, offMs) {
  return events
    .map((e) => ({ T: e.T - offMs, text: e.text, said: R.classify(e.text) }))
    .filter((e) => e.said)
    .map((e) => ({ T: e.T, item: e.said.item, kind: e.said.kind, text: e.text }))
    .sort((a, b) => a.T - b.T)
}

// 1台分：記録の中身・ジャンプ・声の出どころ（そのとき／いまの線／上書き）
const devices = []
function prepare(f, kind) {
  if (!f) return
  const inv = R.inventory(f.data)
  const off = kind === 'camera' ? camOff : phoneOff
  const sources = [{ name: 'そのとき', cues: cuesOf(R.loggedEvents(f.data).events, off) }]
  const warnings = []
  const fromMs = replayFrom === 'jog' && jogFrom !== null ? jogFrom + off : undefined
  const replay = kind === 'camera' ? (d) => R.replayCamera(d, { items: itemsAll ? 'all' : 'logged', fromMs, thin }) : (d) => R.replayPhone(d, { fromMs })
  const canReplay = kind === 'camera' ? inv.measures > 0 : inv.frames > 0
  if (!noReplay && canReplay) {
    const r = replay(f.data)
    warnings.push(...r.warnings)
    sources.push({ name: 'いまの線', cues: cuesOf(r.events, off), items: r.items })
  }
  devices.push({ kind, f, inv, off, sources, warnings, replay: !noReplay && canReplay ? replay : null })
}
prepare(cam, 'camera')
prepare(phone, 'phone')
// 上書きは、いまの線で通したあとに入れ物を書き換えて、もう一度通す
if (sets.length && devices.some((d) => d.replay)) {
  let changed
  try {
    changed = sets.map((s) => R.setParam(s))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  p(`線を書き換えた: ${changed.map((c) => `${c.path} ${c.before} → ${c.after}`).join('、')}`)
  p()
  for (const d of devices) if (d.replay) d.sources.push({ name: '上書き', cues: cuesOf(d.replay(d.f.data).events, d.off) })
}

// ---- 記録の中身 ----
p('## 記録に、判定をやり直せるだけの値があるか')
p()
p('| 記録 | 1コマごとの行 | 判定に使う値のある行 | 骨格の点のある行 | 時計の対応 | 長さ | やり直し |')
p('|---|---|---|---|---|---|---|')
for (const d of devices) {
  const i = d.inv
  const what = d.kind === 'camera' ? 'カメラ版（首・上体・体全体・腰の高さ・向き、19点の x/y/確からしさ）' : 'スマホ版（生の加速度・角速度、届いたコマすべて）'
  p(`| ${what} | ${i.frames} | ${d.kind === 'camera' ? i.measures : `${i.measures}（1秒ごと）`} | ${d.kind === 'camera' ? i.points : '—'} | ${i.clock ? 'あり' : 'なし'} | ${fmt(i.spanSec / 60)}分 | ${d.replay ? 'できる' : noReplay ? 'しない（--no-replay）' : 'できない'} |`)
}
p()
for (const d of devices) for (const w of d.warnings) p(`- 注意（${d.kind === 'camera' ? 'カメラ版' : 'スマホ版'}）: ${w}`)
for (const d of devices.filter((x) => x.kind === 'camera' && x.replay)) {
  if (!d.inv.full) p('- カメラ版は、撮ったときに骨格を取ったコマ（安定して走っている間は10秒のうち3秒）だけが記録にある。線を変えて「もっと細かく見たはず」になった秒の値は足せない')
  else if (thin) p('- カメラ版は全コマ記録。--thin で、ふだんの間引き（安定して走っている間は10秒のうち3秒だけ見る）に通し直した')
  else p('- カメラ版は全コマ記録（走っている間の毎コマがある）。いまの線・上書きは毎コマで通した。ふだんの間引きでの結果は --thin で見られる')
}
p()

// ---- 時計 ----
p('## 時計（ジャンプの「はい」と、記録で大きく動き始めた時刻）')
p()
if (!drill.jumpAt) p('ジャンプの合図がない記録です（--no-jump か、その前に止めた）。')
else {
  p('| 記録 | 動いた時刻 − 「はい」 | 目立ち（ばらつきの何倍） |')
  p('|---|---|---|')
  for (const d of devices) {
    const j = R.findJump(d.f.data, drill.jumpAt + d.off)
    p(`| ${d.kind === 'camera' ? 'カメラ版' : 'スマホ版'} | ${j ? `${fmt((j.T - d.off - drill.jumpAt) / 1000, 2)}秒` : '見つからない'} | ${j ? fmt(j.strength) : '—'} |`)
  }
  p()
  p('「はい」を聞いてから跳ぶまで 0.3〜0.8 秒ほどかかる。それより大きくずれていて目立ちが大きい（10倍以上）なら、時計がずれている。`--camera-offset` / `--phone-offset` に（ずれ − 0.5）秒を入れて採点し直す')
}
p()

// ---- 区間ごとの採点 ----
const inSec = (cues, a, b) => cues.filter((c) => c.T >= a && c.T < b)
const voiced = (c) => c.kind === 'cue' || c.kind === 'tone' || c.kind === 'mount'
const sec = (ms) => ms / 1000
const label = (c, s) => `${c.item} ${fmt(sec(c.T - s.start))}秒`

function grade(cues, kind) {
  const rows = []
  const sum = { judged: 0, hit: 0, lat: [], falseNormal: [], normalSec: 0, gapVoices: 0, gapCount: 0, gapStopped: 0, mount: 0 }
  for (const s of sections) {
    const expect = s.kind === 'drill' ? (STEPS[s.key]?.[kind] ?? []) : []
    const all = inSec(cues, s.start, s.end)
    const v = all.filter(voiced)
    const rec = all.some((c) => c.kind === 'recover')
    sum.mount += v.filter((c) => c.kind === 'mount').length
    let cell
    if (s.kind === 'drill') {
      const window = inSec(cues, s.start, s.end + grace * 1000).filter(voiced)
      if (expect.length) {
        sum.judged++
        const hit = window.find((c) => expect.includes(c.item))
        const other = v.filter((c) => !expect.includes(c.item))
        if (hit) {
          sum.hit++
          sum.lat.push(sec(hit.T - s.start))
        }
        cell = `${hit ? `○ ${label(hit, s)}${hit.T >= s.end ? '（終わってから）' : ''}` : '×'}${other.length ? `／ほか ${other.map((c) => label(c, s)).join('、')}` : ''}`
      } else cell = `（判定しない崩し）${v.length ? `声 ${v.map((c) => label(c, s)).join('、')}` : '声なし'}`
    } else if (s.kind === 'normal') {
      const runSec = sec(s.end - s.start)
      sum.normalSec += runSec
      sum.falseNormal.push(...v)
      cell = v.length ? `誤り ${v.length}：${v.map((c) => label(c, s)).join('、')}` : '誤り 0'
    } else if (s.kind === 'gap') {
      sum.gapCount++
      sum.gapVoices += v.length
      if (!v.length) sum.gapStopped++
      cell = `${v.length ? `続いた声 ${v.map((c) => label(c, s)).join('、')}` : '声が止まった'}${rec ? '・直ったとほめた' : ''}`
    } else cell = v.length ? `声 ${v.map((c) => label(c, s)).join('、')}` : ''
    if (rec && s.kind !== 'gap') cell += '・直ったとほめた'
    rows.push({ s, expect, cell })
  }
  return { rows, sum }
}

const KIND_NAME = { prep: '立つ', walk: '歩く', stop: '止める', jump: 'ジャンプ', speedup: '速さを上げる', normal: 'ふつう', drill: '崩し', gap: '戻し', cool: '歩く' }
for (const d of devices) {
  const name = d.kind === 'camera' ? 'カメラ版' : 'スマホ版'
  const graded = d.sources.map((src) => ({ src, ...grade(src.cues, d.kind) }))
  p(`## 区間ごと（${name}）`)
  p()
  if (d.kind === 'camera') {
    p('出てほしい項目：head＝頭が前、trunk＝上体の前傾、body＝体全体の前傾、hip＝腰が落ちた。最初のふつうの3分は、頭と腰をまだ判定しない（走り始めの自分の基準を作る間）')
    const items = d.sources.find((s) => s.items)?.items
    if (items) p(`声をかける項目（${itemsAll ? '--items all：すべて' : '撮ったときのランナーのレベル'}）：${items.join('・')}。ほかの項目は、大きく崩れたとき（点数が 50 未満）だけ声が出る（この声は cue の線ではなく、full・zero で決まる点数で出る）`)
  }
  else p('出てほしい項目：cadence＝ピッチ（言葉は初めの1回だけで、あとはメトロノーム）。スマホ版は、いまピッチだけ声にする')
  p()
  p(`| 区間 | 種類 | 長さ | 出てほしい | ${graded.map((g) => g.src.name).join(' | ')} |`)
  p(`|---|---|---|---|${graded.map(() => '---').join('|')}|`)
  graded[0].rows.forEach((r, i) => {
    const s = r.s
    const nm = s.kind === 'gap' ? `戻し（${STEPS[s.after]?.name ?? s.after ?? ''}のあと）` : s.name
    p(`| ${nm} | ${KIND_NAME[s.kind] ?? s.kind} | ${fmt(sec(s.end - s.start), 0)}秒 | ${r.expect.join('・') || '—'} | ${graded.map((g) => g.rows[i].cell).join(' | ')} |`)
  })
  p()
  p('| まとめ | ' + graded.map((g) => g.src.name).join(' | ') + ' |')
  p('|---|' + graded.map(() => '---').join('|') + '|')
  const row = (label, f) => p(`| ${label} | ${graded.map((g) => f(g.sum)).join(' | ')} |`)
  row('判定する崩しで見つけた', (s) => `${s.hit} / ${s.judged}`)
  row('見つけるまでの秒数（平均・最大）', (s) => (s.lat.length ? `${fmt(s.lat.reduce((a, b) => a + b, 0) / s.lat.length)}・${fmt(Math.max(...s.lat))}` : '—'))
  row('ふつうの区間の誤った声', (s) => `${s.falseNormal.length}（${fmt(s.normalSec / 60)}分。10分あたり ${fmt(s.normalSec ? (s.falseNormal.length / s.normalSec) * 600 : null)}）`)
  row('戻しの区間で声が止まった', (s) => `${s.gapStopped} / ${s.gapCount}（続いた声 ${s.gapVoices}）`)
  if (d.kind === 'phone') row('付け方の確認の声（ずっと腰に付けているので、出たら誤り）', (s) => `${s.mount}`)
  p()
  // そのときの声と、いまの線で通し直した声が合っているか（コードが変わっていなければ、ほぼ同じになるはず）
  const now = d.sources.find((s) => s.name === 'いまの線')
  if (now) {
    const logged = d.sources[0].cues.filter(voiced)
    const re = now.cues.filter(voiced)
    const match = logged.filter((c) => re.some((x) => x.item === c.item && Math.abs(x.T - c.T) <= 2000)).length
    p(`通し直しの確かめ：そのときの声 ${logged.length} 回のうち、いまの線で通し直しても ±2秒以内に同じ項目で出たもの ${match} 回（通し直しの声は ${re.length} 回）。大きく違うときは、撮ったあとに判定のコードが変わったか、通し直しが撮ったときと違う`)
    p()
  }
}

const md = out.join('\n')
console.log(md)
if (outFile) {
  writeFileSync(outFile, md + '\n')
  console.log(`\n→ ${outFile}`)
}
