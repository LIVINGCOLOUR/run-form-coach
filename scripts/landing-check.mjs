// 着地が体より前か（オーバーストライド）の測り方の試しを、本物の骨格の点に通して表にする（中身は scripts/landing-check.ts、測り方は sim/landing.ts）
//
//   node scripts/landing-check.mjs video <clips.json> <毎秒30コマの点のフォルダ> <毎秒15コマの点のフォルダ> [--json 出力.json]
//     点は scripts/video-judge/landmarks.mjs で取ったもの（動画のコマと点は手元の一時フォルダにだけ置く。リポジトリに入れない）
//   node scripts/landing-check.mjs log <drill-….json> <カメラ版の記録 rfc-….json> [--camera-offset 秒] [--json 出力.json]
//
// 値（脚の長さに対する割合、角度は度）：足首が腰より一番前に出た量（reach）、そのときのかかと・つま先・すねの角度・膝の曲がり・両膝の前後の開き・脚の角度、
// 振れ幅のうち腰より前の割合（front）。手前の脚（点の確からしさが高いほう）の1歩ずつの中央値
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
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
const camOff = Number(opt('--camera-offset') ?? 0) * 1000
const [mode, ...rest] = args
if (!['video', 'log'].includes(mode)) {
  console.error('使い方: node scripts/landing-check.mjs video <clips.json> <点30> <点15> | log <drill.json> <カメラ版.json> [--camera-offset 秒]')
  process.exit(1)
}
const root = new URL('..', import.meta.url).pathname
const bundle = join(root, 'node_modules/.tmp/landing-check.mjs')
mkdirSync(dirname(bundle), { recursive: true })
await build({ input: join(root, 'scripts/landing-check.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const J = await import(pathToFileURL(bundle).href)
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-')
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '-')
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const row = (st) =>
  st
    ? `${st.near} ${st.n}/${st.nAll} | ${f3(st.med.reach)} / ${f3(st.medAll.reach)} / ${f3(st.medHi.reach)} | ${f3(st.med.heel)} / ${f3(st.medHi.heel)} | ${f1(st.med.shank)} / ${f1(st.medHi.shank)} | ${f1(st.med.knee)} | ${f3(st.med.kneeGap)} / ${f3(st.medHi.kneeGap)} | ${f1(st.med.legAng)} | ${f2(st.med.front)} | ${f3(st.medFar.reach)} | ${f3(st.sdNear.reach)} | ${Math.round(st.cadence) || '-'} | ${f2(st.speedL)} | ${f3(st.fa)} | ${f3(st.vert)}`
    : '- | - | - | - | - | - | - | - | - | - | - | - | - | -'
const HEAD = '| 手前・山の数 | 足首の前（手前 / 両脚 / 確か） | かかとの前（手前 / 確か） | すね（手前 / 確か） | 膝の曲がり | 両膝の開き（手前 / 確か） | 脚の角度 | 前の割合 | 奥の脚の足首 | 1歩ずつの揺れ（足首） | ピッチ | 速さの目安（脚／秒） | 腰の前後の揺れ | 腰の上下の揺れ |'
const SEP = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'

if (mode === 'video') {
  const [configPath, dir30, dir15] = rest
  const config = read(configPath)
  const load = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), read(join(dir, f))]))
  const lm30 = load(dir30)
  const lm15 = dir15 ? load(dir15) : {}
  const res = J.videoStats(config, lm30, lm15)
  for (const cond of J.VIDEO_CONDS) {
    console.log(`\n## ${cond.label}\n`)
    console.log(`| 記号 | 区間 | ${HEAD.slice(2)}`)
    console.log(`|---|---${SEP}`)
    for (const r of res.filter((x) => x.cond === cond.key)) console.log(`| ${r.id} | ${r.role} ${r.name} ${r.from}–${r.to} | ${row(r.st)} |`)
  }
  // 悪い例 − よい例の差（同じ動画・同じ速さ）。区間が2つに分かれている記号（C）は長いほう。C は別の画面どうし（腰落ち − 腰高）
  console.log('\n## 悪い例 − よい例（かかとの前・足首の前は脚の長さに対する割合、すねは度）\n')
  console.log(`| 記号 | ${J.VIDEO_CONDS.map((c) => `${c.label}：かかと / 足首 / すね`).join(' | ')} | 山の数（15コマ、悪い / よい） |`)
  console.log(`|---|${J.VIDEO_CONDS.map(() => '---').join('|')}|---|`)
  const pick = (id, role, cond) => res.filter((r) => r.id === id && r.role === role && r.cond === cond && r.st).sort((a, b) => b.to - b.from - (a.to - a.from))[0]?.st
  const sg = (x, d = 3) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '-')
  const pairsOf = [...config.clips.filter((c) => c.windows.some((w) => w.role === 'bad') && c.windows.some((w) => w.role === 'good')).map((c) => [c.id, c.id, c.id]), ...(config.pairs ?? []).map((p) => [`${p.bad}−${p.good}`, p.bad, p.good])]
  for (const [label, badId, goodId] of pairsOf) {
    const cols = J.VIDEO_CONDS.map((c) => {
      const b = pick(badId, 'bad', c.key)
      const g = pick(goodId, 'good', c.key)
      return b && g ? `${sg(b.med.heel - g.med.heel)} / ${sg(b.med.reach - g.med.reach)} / ${sg(b.med.shank - g.med.shank, 1)}` : '-'
    })
    const b15 = pick(badId, 'bad', 'c15')
    const g15 = pick(goodId, 'good', 'c15')
    console.log(`| ${label} | ${cols.join(' | ')} | ${b15?.n ?? '-'} / ${g15?.n ?? '-'} |`)
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res.map((r) => ({ ...r, st: r.st && { ...r.st, peaks: r.st.peaks } })), null, 1))
} else {
  const [drillPath, logPath] = rest
  const drill = read(drillPath)
  const file = read(logPath)
  const L = J.logStats(drill, file, camOff)
  console.log(`コマ：${L.frames.length}（走っている段階で全身が見えたコマ）、山：${L.m.peaks.length}`)
  if (L.jump) console.log(`ジャンプ：記録の時計 − Mac の時計 = ${f2((L.jump.T - camOff - drill.jumpAt) / 1000)}秒（目立ち ${f1(L.jump.strength)}）`)
  console.log(`\n| 区間 | 秒 | ${HEAD.slice(2)}`)
  console.log(`|---|---${SEP}`)
  for (const s of L.sections) console.log(`| ${s.name}${s.after ? `（${s.after}のあと）` : ''} | ${f1(s.t1 - s.t0)} | ${row(s.st)} |`)
  for (const len of [16, 6]) {
    for (const key of ['normal1', 'normal2']) {
      const ws = L.windows(key, len).filter((w) => w.st && w.st.n >= Math.floor(len / 1.6))
      const xs = ws.map((w) => w.st.med.reach)
      const sh = ws.map((w) => w.st.med.shank)
      console.log(`${key} ${len}秒の窓 ${ws.length}：足首の前 5%/中央/95% ${f3(J.q(xs, 0.05))} / ${f3(J.q(xs, 0.5))} / ${f3(J.q(xs, 0.95))}（最小 ${f3(J.q(xs, 0))}・最大 ${f3(J.q(xs, 1))}、SD ${f3(J.sd(xs))}）、すね ${f1(J.q(sh, 0.05))} / ${f1(J.q(sh, 0.5))} / ${f1(J.q(sh, 0.95))}（SD ${f1(J.sd(sh))}）`)
    }
  }
  console.log('\n今日の基準からの増え（最初のふつうの区間のはじめ30秒を除いた中央値を基準に、残りのふつうの9分で試す）')
  for (const thin of [false, true]) {
    for (const [feature, lines] of [['heel', [0.03, 0.04, 0.05, 0.06, 0.08]], ['reach', [0.03, 0.04, 0.05, 0.06, 0.08]], ['shank', [3, 4, 5, 6, 8]]]) {
      for (const len of [6, 16, 30]) {
        const r = J.driftCheck(L, { feature, lines, len, thin })
        console.log(`${thin ? '間引き3/10秒' : '全コマ'} ${feature} ${len}秒：基準 ${f3(r.ref)}（${r.near}）、窓 ${r.n}、増えの 5%/中央/95%/最大 ${f3(r.q05)} / ${f3(r.q50)} / ${f3(r.q95)} / ${f3(r.max)}（SD ${f3(r.sd)}）｜ ${r.lines.map((x) => `線 ${x.line}：${(x.share * 100).toFixed(1)}%・10分あたり ${f2(x.per10)}回`).join('、')}`)
        if (!thin && len === 16) console.log(`  区間ごとの増え：${r.drills.map((x) => `${x.name}${x.after ? `(${x.after}後)` : ''} ${f3(x.d)}`).join('、')}`)
      }
    }
  }
  console.log('\n速さを考えた着地の前（16秒の窓のかかとの前 − 仮想実験の当てはめ）')
  for (const key of ['normal1', 'normal2']) {
    const ws = J.absCheck(L, [key])
    const r = ws.map((w) => w.res)
    console.log(`${key}：窓 ${ws.length}、速さの目安 ${f2(J.q(ws.map((w) => w.speedL), 0.5))}（${f2(J.q(ws.map((w) => w.speedL), 0.05))}〜${f2(J.q(ws.map((w) => w.speedL), 0.95))}）、かかとの前 ${f3(J.q(ws.map((w) => w.heel), 0.5))}、残り 5%/中央/95%/最大 ${f3(J.q(r, 0.05))} / ${f3(J.q(r, 0.5))} / ${f3(J.q(r, 0.95))} / ${f3(J.q(r, 1))}、+0.08 を越えた窓 ${(r.filter((x) => x > 0.08).length / Math.max(1, r.length) * 100).toFixed(1)}%、+0.10 ${(r.filter((x) => x > 0.1).length / Math.max(1, r.length) * 100).toFixed(1)}%`)
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ sections: L.sections, peaks: L.m.peaks }, null, 1))
}
