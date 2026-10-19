// 人の動画で今のカメラ版の判定を試す（3）：landmarks.mjs の出力を judge.ts（src/ の判定のコードをそのまま使う）に通して表にする
//
//   node scripts/video-judge/landmarks.mjs <clips.json> <点のフォルダ>     … 先に骨格の点を取る（Chrome を画面なしで使う）
//   node scripts/video-judge/run.mjs <clips.json> <点のフォルダ> [--contacts <毎秒30コマの点のフォルダ>] [--seconds] [--json 出力.json]
//
// clips.json の windows（role: bad / good）ごとに、見えたコマの割合・足が画面の端にかかった割合と、
// 首・頭の位置・上体・体全体・腰の高さ・顎を出し、同じ動画の悪い例とよい例の差を今の声をかける線と比べる。
// 判定の値は、アプリと同じ毎秒15コマの点（landmarks.mjs のふつう）で出す。
// --contacts を付けると、そのフォルダの点（landmarks.mjs --fps 30 など）をスロー分析（analyzeRun）に通して、着地の値も出す。
// pairs（別々の動画の bad / good）も同じように比べる。--seconds で1秒ごとの値も出す
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const jsonOut = opt('--json')
const showSec = args.includes('--seconds')
const ctDir = opt('--contacts')
const [configPath, lmDir] = args.filter((a) => !a.startsWith('--'))
if (!configPath || !lmDir) {
  console.error('使い方: node scripts/video-judge/run.mjs <clips.json> <点のフォルダ> [--contacts <毎秒30コマの点のフォルダ>] [--seconds] [--json 出力.json]')
  process.exit(1)
}
const root = new URL('../..', import.meta.url).pathname
const bundle = join(root, 'node_modules/.tmp/video-judge.mjs')
mkdirSync(dirname(bundle), { recursive: true })
await build({ input: join(root, 'scripts/video-judge/judge.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const J = await import(pathToFileURL(bundle).href)

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-')
const pct = (x) => `${Math.round(x * 100)}%`
const yn = (b) => (b ? '○' : '×')
const out = { lines: J.LINES, clips: [] }

console.log(`声をかける線：頭 +${J.LINES.head}°、上体 +${J.LINES.trunkRel}°、体全体 +${J.LINES.bodyRel}°、腰 ${J.LINES.hip}%（走り始めの自分から）／決まった線：上体 ${J.LINES.trunkAbs}°、体全体 ${J.LINES.bodyAbs}°、頭の位置 ${J.LINES.headAbs}°\n`)
const stats = {}
for (const c of config.clips) {
  const lm = JSON.parse(readFileSync(join(lmDir, `${c.id}.json`), 'utf8'))
  const ticks = J.track(lm)
  const ws = c.windows.map((w) => ({ ...w, s: J.windowStat(ticks, w.from, w.to) }))
  // 同じ役（bad / good）の区間が2つに分かれているとき（C の画面）は、まとめた値も作る
  const byRole = {}
  for (const role of ['bad', 'good']) {
    const list = ws.filter((w) => w.role === role)
    if (!list.length) continue
    if (list.length === 1 || list.some((w) => w.name !== list[0].name)) byRole[role] = list
    else {
      const ts = ticks.filter((k) => list.some((w) => k.t >= w.from && k.t < w.to))
      byRole[role] = [{ ...list[0], from: list[0].from, to: list[list.length - 1].to, s: J.windowStat(ts, ts[0].t, ts[ts.length - 1].t + 0.01) }]
    }
  }
  // 着地（スロー分析）：まとめた区間は、いちばん長い元の区間で見る
  const lm30 = ctDir ? JSON.parse(readFileSync(join(ctDir, `${c.id}.json`), 'utf8')) : null
  for (const w of Object.values(byRole).flat()) {
    const src = ws.filter((x) => x.role === w.role).reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
    w.ct = lm30 ? J.contacts(lm30, src.from, src.to) : null
  }
  stats[c.id] = { ticks, byRole }
  console.log(`## ${c.id} ${c.title}`)
  console.log('| 区間 | 秒 | 見えた | 歩数で走る | 足が端 | 確からしさ | 向き | ピッチ | 首(neck) | 頭の位置 | 上体 | 体全体 | 腰の高さ | 顎 | 着地の足 | 着地のすね | 着地の数 | スロー |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const w of [...(byRole.bad ?? []), ...(byRole.good ?? [])]) {
    const s = w.s
    console.log(`| ${w.role} ${w.name} | ${w.from}–${w.to} | ${pct(s.visibleRatio)} | ${pct(s.movingRatio)} | ${pct(s.feetCutRatio)} | ${f2(s.keyVis)} | ${f1(s.dir)} | ${Math.round(s.cadence) || '-'} | ${f1(s.neck)}±${f1(s.neckSd)} | ${f1(s.headLean)} | ${f1(s.trunk)}±${f1(s.trunkSd)} | ${f1(s.body)}±${f1(s.bodySd)} | ${f2(s.hipRatio)}±${f2(s.hipSd)} | ${f1(s.chin)}±${f1(s.chinSd)} | ${f2(w.ct?.footAhead)} | ${f1(w.ct?.shank)} | ${w.ct?.n ?? '-'} | ${w.ct ? `${w.ct.slow}倍` : '-'} |`)
  }
  const rec = { id: c.id, title: c.title, windows: Object.values(byRole).flat().map((w) => ({ role: w.role, name: w.name, from: w.from, to: w.to, ...w.s, contacts: w.ct })), compare: [], sim: [] }
  for (const good of byRole.good ?? []) {
    for (const bad of byRole.bad ?? []) {
      const d = { ...J.compare(bad.s, good.s), footAhead: (bad.ct?.footAhead ?? NaN) - (good.ct?.footAhead ?? NaN), shank: (bad.ct?.shank ?? NaN) - (good.ct?.shank ?? NaN) }
      const g2b = J.coachSim(ticks, [...[good].map((w) => ({ from: w.from, to: w.to, sec: 240 })), { from: bad.from, to: bad.to, sec: 60 }])
      const after = g2b.cues.filter((x) => x.t >= g2b.switchAt[1]).map((x) => `${x.item}@+${f1(x.t - g2b.switchAt[1])}s`)
      const before = g2b.cues.filter((x) => x.t < g2b.switchAt[1]).map((x) => `${x.item}@${x.t}s`)
      console.log(`- ${bad.name} − ${good.name}：頭 ${f1(d.head)}° ${yn(d.cues.head)}／上体 ${f1(d.trunk)}° ${yn(d.cues.trunk)}／体全体 ${f1(d.body)}° ${yn(d.cues.body)}／腰の下がり ${f1(d.hip)}% ${yn(d.cues.hip)}／顎 ${f1(d.chin)}°／着地の足 ${f2(d.footAhead)}／着地のすね ${f1(d.shank)}°`)
      console.log(`  コーチに通す（よい例240秒→悪い例60秒）：悪い例で ${after.join(', ') || '声なし'}${before.length ? `（よい例の間に ${before.join(', ')}）` : ''}`)
      rec.compare.push({ bad: bad.name, good: good.name, ...d })
      rec.sim.push({ kind: 'good→bad', bad: bad.name, good: good.name, after, before })
    }
  }
  for (const bad of byRole.bad ?? []) {
    const only = J.coachSim(ticks, [{ from: bad.from, to: bad.to, sec: 240 }])
    const cues = only.cues.map((x) => `${x.item}@${x.t}s`)
    console.log(`  悪い例（${bad.name}）だけを240秒：${cues.join(', ') || '声なし'}（基準の頭の位置 ${f1(only.ref?.headLean)}°、向き ${f2(only.ref?.yaw)}）`)
    rec.sim.push({ kind: 'bad only', bad: bad.name, cues, ref: only.ref })
  }
  if (showSec) {
    for (const w of c.windows) {
      console.log(`  1秒ごと ${w.role} ${w.name}: ` + J.perSecond(ticks, w.from, w.to).map((s) => `${s.t}s neck ${f1(s.neck)} tr ${f1(s.trunk)} bd ${f1(s.body)} hip ${f2(s.hipRatio)}`).join(' / '))
    }
  }
  console.log('')
  out.clips.push(rec)
}

for (const p of config.pairs ?? []) {
  const bad = stats[p.bad].byRole.bad[0]
  const good = stats[p.good].byRole.good[0]
  const d = { ...J.compare(bad.s, good.s), footAhead: (bad.ct?.footAhead ?? NaN) - (good.ct?.footAhead ?? NaN), shank: (bad.ct?.shank ?? NaN) - (good.ct?.shank ?? NaN) }
  console.log(`## 組 ${p.bad} − ${p.good}（${p.note ?? ''}）`)
  console.log(`- 頭 ${f1(d.head)}° ${yn(d.cues.head)}／上体 ${f1(d.trunk)}° ${yn(d.cues.trunk)}／体全体 ${f1(d.body)}° ${yn(d.cues.body)}／腰の下がり ${f1(d.hip)}% ${yn(d.cues.hip)}／顎 ${f1(d.chin)}°／着地の足 ${f2(d.footAhead)}／着地のすね ${f1(d.shank)}°`)
  // コーチに通す：よい例の動画のあとに、悪い例の動画を時刻をずらしてつなぐ（それぞれいちばん長い区間）
  const longest = (id, role) => config.clips.find((c) => c.id === id).windows.filter((w) => w.role === role).reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  const gw = longest(p.good, 'good')
  const bw = longest(p.bad, 'bad')
  const comb = [...stats[p.good].ticks, ...stats[p.bad].ticks.map((k) => ({ ...k, t: k.t + 1000 }))]
  const g2b = J.coachSim(comb, [{ from: gw.from, to: gw.to, sec: 240 }, { from: bw.from + 1000, to: bw.to + 1000, sec: 60 }])
  const after = g2b.cues.filter((x) => x.t >= g2b.switchAt[1]).map((x) => `${x.item}@+${f1(x.t - g2b.switchAt[1])}s`)
  console.log(`  コーチに通す（よい例240秒→悪い例60秒）：悪い例で ${after.join(', ') || '声なし'}\n`)
  out.clips.push({ id: `${p.bad}−${p.good}`, compare: [{ bad: p.bad, good: p.good, ...d }], sim: [{ kind: 'good→bad', after }] })
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1))
