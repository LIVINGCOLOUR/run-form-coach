// トレッドミルの検証で、Mac の声（say）で区間ごとの崩し方を指示し、区間の時刻を記録する（「答えつき」の記録）。
// 横の iPhone（カメラ版）と腰のスマホ（スマホ版）は、いつもどおりそれぞれのアプリで走りを記録する。
// 記録どうしは時計（どれも自動で合っている前提）で合わせ、採点は npm run grade（scripts/treadmill-grade.mjs）
//
// 使い方: npm run drill [-- オプション]
//   --dry-run              声を出さずに、時刻表だけ出す
//   --try                  1区間だけ（崩しの最初の区間を16秒）声を出して試す。記録は一時フォルダに置く
//   --steps a,b,…          崩しの並び（既定 head,down,hunch,lean,armstill,armcross,sit,slow。ほかに bouncy,heel,flat）
//   --walk 秒 / --walk-kmh 5.0   最初の歩き（0 で歩かない）と速さ
//   --jog 秒 / --jog-kmh 8.0     ジョグ全体と速さ
//   --first 秒 / --sec 秒 / --gap 秒   最初のふつう・崩し・崩しのあとの戻し（0 で戻しなし）
//   --cool 秒              最後の歩き
//   --prep 秒              歩き始めるまで（ベルトの上に立つ間）
//   --no-jump              ジャンプの合図をしない
//   --hr 145 / --hr-every 600   心拍の目安を言う（0 で言わない）とその間隔
//   --voice Kyoko / --rate 190   声と、話す速さ（1分あたりの語数。say -r）
//   --note 文              記録に残すメモ（気づいたこと）
//   --out フォルダ         置き場所（既定は環境変数 RFC_RUNS_DIR、なければ ~/Developer/research-data/runs/）
// 書き出すもの: <置き場所>/drill-YYYYMMDD-HHMM.json。区間の始まり（言い終えた時刻）と終わり（次の区間の言葉を言い始めた時刻）を、
//   Mac の時計のエポックミリ秒で残す。言うたびに書き直すので、Ctrl+C で止めても、それまでの時刻は残る
import { spawn } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildPlan, clock, DEFAULTS, len, stamp } from './treadmill/plan.mjs'

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
const num = (name, fallback) => {
  const v = opt(name)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} には0以上の数を渡してください（${v}）`)
    process.exit(1)
  }
  return n
}

const dry = flag('--dry-run')
const tryOne = flag('--try')
const noJump = flag('--no-jump')
const voice = opt('--voice') ?? 'Kyoko'
const rate = opt('--rate') ?? '190'
const note = opt('--note')
const outOpt = opt('--out')
const stepsOpt = opt('--steps')
let o = {
  steps: stepsOpt ? stepsOpt.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  prep: num('--prep', DEFAULTS.prep),
  walk: num('--walk', DEFAULTS.walk),
  walkKmh: num('--walk-kmh', DEFAULTS.walkKmh),
  jog: num('--jog', DEFAULTS.jog),
  jogKmh: num('--jog-kmh', DEFAULTS.jogKmh),
  first: num('--first', DEFAULTS.first),
  sec: num('--sec', DEFAULTS.sec),
  gap: num('--gap', DEFAULTS.gap),
  cool: num('--cool', DEFAULTS.cool),
  hr: num('--hr', DEFAULTS.hr),
  hrEvery: num('--hr-every', DEFAULTS.hrEvery) || DEFAULTS.hrEvery,
  jump: !noJump,
}
if (args.length) {
  console.error(`分からないオプション: ${args.join(' ')}（使い方は scripts/treadmill-drill.mjs の先頭）`)
  process.exit(1)
}
if (tryOne) {
  // 崩しの最初の区間だけを16秒：「次は、…。16秒。」→「あと5秒。」→ おわり
  o = { ...o, steps: [(o.steps ?? ['head'])[0]], prep: 0, walk: 0, jump: false, speedup: 0, first: 0, sec: 16, gap: 0, jog: 16, cool: 0, hr: 0 }
}

let plan
try {
  plan = buildPlan(o)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
if (tryOne) {
  // 試すときは、速さを上げる・スタートの言葉を除いて、崩しの区間だけにする
  plan.cues = plan.cues.filter((c) => c.begin === undefined || plan.sections[c.begin].kind === 'drill' || c.end)
  plan.cues = plan.cues.filter((c) => !['3', '2', '1', 'スタート。'].includes(c.say) && !/^ふつうに走ります/.test(c.say ?? ''))
  plan.sections = plan.sections.filter((s) => s.kind === 'drill')
  const t0 = plan.sections[0].plannedStart
  for (const s of plan.sections) s.plannedStart -= t0
  for (const c of plan.cues) {
    c.at -= t0
    if (c.begin !== undefined) c.begin = 0
  }
}

// 時刻表を出す
const startGuess = Date.now()
const runSec = plan.sections.filter((s) => ['normal', 'drill', 'gap'].includes(s.kind)).reduce((a, s) => a + s.plannedSec, 0)
console.log(`区間 ${plan.sections.length} 個・全体 ${len(plan.total)}（うち走る ${len(runSec)}）。声: ${voice}`)
for (const w of plan.warnings) console.log(`注意: ${w}`)
console.log('')
console.log('  始めから  時刻(今始めたら)  長さ    速さ   区間')
for (const s of plan.sections) {
  const at = `${Math.floor(s.plannedStart / 60)}:${String(Math.round(s.plannedStart % 60)).padStart(2, '0')}`.padStart(6)
  const kmh = s.kmh === undefined ? '' : s.kmh ? `${s.kmh.toFixed(1)}` : '止'
  console.log(`  ${at}    ${clock(startGuess + s.plannedStart * 1000)}        ${len(s.plannedSec).padEnd(5)}  ${kmh.padStart(4)}   ${s.kind.padEnd(7)} ${s.key}（${s.name}）`)
}
if (dry) {
  console.log('\n言う言葉:')
  for (const c of plan.cues) console.log(`  ${String(Math.round(c.at * 10) / 10).padStart(6)}秒  ${c.say ?? ''}${c.jump ? '  ← ジャンプの時刻' : ''}`)
  console.log('\n（--dry-run：声は出さず、記録も書きません）')
  process.exit(0)
}

// 記録の置き場所
const outDir = resolve(outOpt ?? (tryOne ? join(tmpdir(), 'rfc-drill') : (process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs'))))
mkdirSync(outDir, { recursive: true })
const t0 = Date.now()
const file = join(outDir, `drill-${tryOne ? 'try-' : ''}${stamp(t0)}.json`)
const record = {
  kind: 'treadmill-drill',
  version: 1,
  clock: 'mac', // 時刻はすべて Mac の時計のエポックミリ秒（Date.now()）
  startedAt: t0,
  options: plan.options,
  voice,
  note: note ?? undefined,
  plan: plan.sections.map((s) => ({ key: s.key, kind: s.kind, plannedStart: s.plannedStart, plannedSec: s.plannedSec })),
  // 区間：announceAt（言い始めた）・start（言い終えた＝区間の始まり）・end（次の区間の言葉を言い始めた＝区間の終わり）
  sections: [],
  jumpAt: null, // ジャンプの「はい」を言い始めた時刻
  said: [], // 言った言葉 [言い始め, 言い終わり, 言葉]
  done: false,
}
const save = () => {
  writeFileSync(`${file}.part`, JSON.stringify(record, null, 1))
  renameSync(`${file}.part`, file)
}

let child = null
const speak = (text) =>
  new Promise((res) => {
    const begin = Date.now()
    child = spawn('say', ['-v', voice, '-r', rate, text], { stdio: 'ignore' })
    const finish = () => {
      child = null
      res({ begin, end: Date.now() })
    }
    child.on('exit', finish)
    child.on('error', (e) => {
      console.error(`say を使えませんでした（${e.message}）`)
      finish()
    })
  })
const sleepUntil = (ms) => new Promise((res) => setTimeout(res, Math.max(0, ms - Date.now())))

// いま開いている区間を閉じる
const closeOpen = (at) => {
  const open = record.sections[record.sections.length - 1]
  if (open && open.end === null) open.end = at
}

let stopping = false
process.on('SIGINT', () => {
  if (stopping) process.exit(130)
  stopping = true
  child?.kill()
  const at = Date.now()
  closeOpen(at)
  record.stoppedAt = at
  save()
  console.log(`\n止めました。それまでの時刻を残しました → ${file}`)
  process.exit(130)
})

console.log(`\n始めます（${clock(t0)}）。記録 → ${file}`)
save()
// 走っている間に Mac が眠らないように（画面も消さない。このスクリプトが終われば元に戻る）
spawn('caffeinate', ['-di', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {})
for (const c of plan.cues) {
  await sleepUntil(t0 + c.at * 1000)
  if (stopping) break
  const s = c.begin !== undefined ? plan.sections[c.begin] : null
  const late = (Date.now() - (t0 + c.at * 1000)) / 1000
  console.log(`${clock(Date.now())}  ${s ? `【${s.name}】` : '  '}${c.say ?? ''}${late > 1.5 ? `（${late.toFixed(1)}秒おくれ）` : ''}`)
  if (!c.say) continue
  // 区間の始まりの言葉：言い始めた時刻で前の区間を閉じる
  const announceAt = Date.now()
  if (s || c.end) closeOpen(announceAt)
  if (c.jump) record.jumpAt = announceAt
  const entry = s ? { key: s.key, kind: s.kind, name: s.name, kmh: s.kmh, after: s.after, plannedStart: s.plannedStart, plannedSec: s.plannedSec, announceAt, start: null, end: null } : null
  if (entry) record.sections.push(entry)
  save()
  const r = await speak(c.say)
  if (stopping) break
  record.said.push([r.begin, r.end, c.say])
  if (entry) entry.start = r.end
  if (c.end) record.endedAt = r.end
  save()
}
if (!stopping) {
  record.done = true
  save()
  console.log(`\nおわり。記録 → ${file}`)
  console.log(`採点するとき: npm run grade -- ${file} <カメラ版の rfc-….json> [<スマホ版の rfc-phone-….json>]`)
}
