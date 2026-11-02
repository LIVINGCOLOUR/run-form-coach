// カメラ版と自作のセンサーを同時に使った走り（トレッドミル、テスト期間）の記録1本で、センサーだけの判定をカメラの骨格に合わせる材料を出す
// 使い方: npm run compare:sensor -- <rfc-….json（カメラ版の書き出し { log, session }）> [--win 秒] [--json 出力.json]
//   ファイル名だけなら RFC_RUNS_DIR（既定 ~/Developer/research-data/runs/）から読む
//   --win：まとめる窓の長さ（既定 5秒）。--json：決めた線と一致率を JSON に書く（リポジトリの中には書かない）
// 出すもの（走っていた間＝カメラの段階が run で、歩数で走っていたコマだけ）：
//   1. センサーごとの取れ方（最初と最後の時刻、2秒より長い切れ目、sensor: のできごと、遅れ）
//   2. 頭：頭のセンサーの、立った姿勢（カメラが直立の基準を取った phase:baseline → phase:run）からの傾き と、カメラの首の角度・頭の位置・顎・スマホの傾き
//   3. 胸：胸のセンサーの傾き と、カメラの上体（腰→肩）
//   4. ピッチ：足首のセンサーの自己相関（tools/coach.py と同じ）と、カメラのピッチ
//   5. 着地：足首の衝撃の山（左右）と、カメラの着地の山（landing.ts の LandingMeter に記録の点を通す）
//   6. 腕振り：手首のジャイロの大きさ と、カメラの手首の前後の振れ幅
//   崩れの答えは、カメラの正しいフォームの線（camera/params.ts の FORM）で窓ごとに付ける。決めた線は画面に出すだけで、params.ts には書かない（人が決める）
// 計算は scripts/sensor-camera.mjs。ブロックの戻し方・カメラの線・着地の測り方は src/ のものを rolldown で読む（src/ は変えない）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import * as S from './sensor-camera.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const WIN = Number(opt('--win') ?? 5)
const jsonOut = opt('--json')
const [input] = args
if (!input) {
  console.error('使い方: npm run compare:sensor -- <カメラ版の書き出し.json> [--win 秒] [--json 出力.json]')
  process.exit(1)
}
const runsDir = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const path = existsSync(input) ? input : join(runsDir, input)

const root = new URL('..', import.meta.url).pathname
const tmp = join(root, 'node_modules/.tmp')
mkdirSync(tmp, { recursive: true })
const entry = join(tmp, 'sensor-camera-entry.ts')
writeFileSync(
  entry,
  [
    `export { decodeBlock } from '${join(root, 'src/modes/sensor/log.ts')}'`,
    `export { LandingMeter } from '${join(root, 'src/modes/camera/landing.ts')}'`,
    `export { FORM } from '${join(root, 'src/modes/camera/params.ts')}'`,
    `export { HUNCH } from '${join(root, 'src/modes/sensor/params.ts')}'`,
  ].join('\n'),
)
const bundle = join(tmp, 'sensor-camera.mjs')
await build({ input: entry, platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const { decodeBlock, LandingMeter, FORM, HUNCH } = await import(pathToFileURL(bundle).href)

const { log } = JSON.parse(readFileSync(path, 'utf8'))
if (!log?.sensors) {
  console.error('この記録にはセンサーの値がありません')
  process.exit(1)
}
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-')
const pc = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-')
const out = { file: path.split(sep).pop(), win: WIN }
const say = (s = '') => console.log(s)

// ---- カメラ ----
const rows = S.cameraRows(log)
const spans = S.runSpans(rows)
const inRun = (t) => spans.some(([a, b]) => t >= a && t <= b)
const runSecs = new Set()
for (const r of rows) if (r.phase === 'run' && r.moving && inRun(r.t)) runSecs.add(Math.floor(r.t))
const evT = (name) => log.events.find((e) => e[1] === name)?.[0]
const baseT0 = evT('phase:baseline')
const baseT1 = evT('phase:run')
say(`# センサーとカメラの比べ：${out.file}`)
say(`全コマ記録 ${log.full ? 'あり' : 'なし（走っている間は間引き）'}・カメラのコマ ${rows.length}・直立の基準 ${f1(baseT0)}〜${f1(baseT1)} 秒`)
say(`走っていた区間（カメラ。5秒より短い区間は除く）：${spans.map(([a, b]) => `${f1(a)}〜${f1(b)}`).join('、')}（計 ${f1(spans.reduce((s, [a, b]) => s + b - a, 0))} 秒）`)
out.runSpans = spans

// ---- センサーの取れ方 ----
const nodes = S.decodeNodes(log.sensors, decodeBlock)
const sensorEvents = log.events.filter((e) => /^sensor:/.test(e[1]))
say('\n## センサーの取れ方')
say('場所     名前        件数   最初〜最後(秒)        走った間の取れ方  2秒より長い切れ目                 遅れ(中央値)  抜け  範囲の端')
out.nodes = []
for (const n of nodes) {
  if (!n.name) continue
  const c = S.coverage(n.samples)
  const share = spans.length ? spans.reduce((s, [a, b]) => s + S.coveredShare(n.samples, a, b) * (b - a), 0) / spans.reduce((s, [a, b]) => s + b - a, 0) : NaN
  const sat = S.saturated(n.samples)
  const gaps = c.gaps.map(([a, b]) => `${f1(a)}→${f1(b)}`).join(' ') || 'なし'
  say(`${n.place.padEnd(5, '　')} ${n.name.padEnd(10)} ${String(c.n).padStart(6)}  ${f1(c.first)}〜${f1(c.last)}`.padEnd(48) + `  ${pc(share).padStart(5)}            ${gaps.padEnd(32)} ${(f2(n.lag) + 's').padStart(7)}  ${n.lost ?? '-'}  ${sat}件`)
  out.nodes.push({ place: n.place, name: n.name, n: c.n, first: c.first, last: c.last, runShare: share, gaps: c.gaps, lag: n.lag, lost: n.lost, saturated: sat })
}
say(`sensor: のできごと：${sensorEvents.map((e) => `${f1(e[0])} ${e[1]}`).join('、') || 'なし'}`)
if (log.sensors.cappedAt !== undefined) say(`※ ${f1(log.sensors.cappedAt)} 秒で上限に達し、そのあとの値は残っていない`)

const node = (place) => nodes.find((n) => n.place === place && n.name && n.samples.length)

// 秒ごとのカメラの値（走っていた秒だけ）
const camSec = new Map()
for (const r of rows) {
  if (r.phase !== 'run' || !r.moving || !inRun(r.t)) continue
  const k = Math.floor(r.t)
  const e = camSec.get(k) ?? { neck: [], headLean: [], chin: [], pitch: [], trunk: [], body: [], cadence: [] }
  for (const c of Object.keys(e)) e[c].push(r[c])
  camSec.set(k, e)
}
const secs = [...camSec.keys()].sort((a, b) => a - b)
const camMean = (k, c) => S.mean(camSec.get(k)?.[c] ?? [])
const wins = S.windows(spans, WIN)
const winSecs = (w) => secs.filter((k) => k >= w[0] && k + 1 <= w[1] + 1e-9)

// ---- 頭・胸の傾き ----
// 立った姿勢：カメラが直立の基準を取った間（phase:baseline → phase:run）の加速度の平均の向き。胸は記録の stand もある
// 走る前傾：走り出して HUNCH.skip 秒たってから HUNCH.learn 秒の傾きの中央値（hunch.ts と同じ）。margin はそこからの増え
function tiltPart(place) {
  const n = node(place)
  if (!n) return null
  const ref = S.gravityDir(n.samples, baseT0 ?? -Infinity, baseT1 ?? -Infinity)
  if (!ref.dir) return { place, missing: '直立の基準の間に値がない' }
  const grav = S.perSecondGravity(n.samples)
  const runK = [...runSecs].filter((k) => grav.has(k))
  const ts = S.tiltSeries(grav, ref.dir, runK)
  const t0 = spans[0]?.[0] ?? 0
  const learn = runK.filter((k) => k >= t0 + HUNCH.skip && k < t0 + HUNCH.skip + HUNCH.learn).map((k) => ts.get(k).tilt)
  const runLean = learn.length >= 5 ? S.median(learn) : NaN
  return { place, n, ref, ts, runK, runLean, learnN: learn.length }
}

// 窓ごとの値の表と、相関・線
function compareTilt(part, camCols, label, labelName) {
  const res = { place: part.place, standN: part.ref.n, runLean: part.runLean, sensorSecs: part.runK.length }
  const sx = (k, key) => part.ts.get(k)?.[key]
  // 秒ごとの相関
  res.perSecond = {}
  for (const key of ['tilt', 'pitch']) {
    res.perSecond[key] = {}
    for (const c of camCols) {
      const ks = secs.filter((k) => part.ts.has(k))
      res.perSecond[key][c] = S.corr(ks.map((k) => sx(k, key)), ks.map((k) => camMean(k, c)))
    }
  }
  // 窓ごと
  const wv = []
  for (const w of wins) {
    const ks = winSecs(w).filter((k) => part.ts.has(k))
    const cks = winSecs(w)
    if (ks.length < WIN * 0.6) continue
    const v = { t: w[0], tilt: S.mean(ks.map((k) => sx(k, 'tilt'))), fb: S.mean(ks.map((k) => sx(k, 'pitch'))) }
    for (const c of camCols) v[c] = S.mean(cks.flatMap((k) => camSec.get(k)[c]))
    v.bad = label(v)
    wv.push(v)
  }
  res.windows = wv
  res.perWindow = {}
  for (const c of camCols) res.perWindow[c] = S.corr(wv.map((v) => v.tilt), wv.map((v) => v[c]))
  const labels = wv.map((v) => v.bad)
  res.fit = { tilt: S.bestThreshold(wv.map((v) => v.tilt), labels), pitch: S.bestThreshold(wv.map((v) => v.fb), labels) }
  res.labelName = labelName
  return res
}

function printTilt(res, camCols) {
  if (!res) return
  say(`立った姿勢の件数 ${res.standN}・センサーの値がある走った秒 ${res.sensorSecs}・走る前傾（hunch.ts の覚え方）${f1(res.runLean)}°`)
  say(`秒ごとの相関 r（傾き / 前後の傾き）：` + camCols.map((c) => `${c} ${f2(res.perSecond.tilt[c].r)} / ${f2(res.perSecond.pitch[c].r)}（${res.perSecond.tilt[c].n}秒）`).join('、'))
  say(`${WIN}秒の窓の相関 r（傾き）：` + camCols.map((c) => `${c} ${f2(res.perWindow[c].r)}（${res.perWindow[c].n}窓）`).join('、'))
  const t = res.windows.map((v) => v.tilt)
  say(`センサーの傾き（${WIN}秒の窓）：中央値 ${f1(S.median(t))}°・下から1割 ${f1(S.quantile(t, 0.1))}°・上から1割 ${f1(S.quantile(t, 0.9))}°`)
  const f = res.fit.tilt
  say(`カメラの答え（${res.labelName}）：崩れの窓 ${f.pos} / ${f.n}`)
  if (f.pos && f.neg) {
    say(`  傾きの線 ${f1(f.threshold)}°（走る前傾 + ${f1(f.threshold - res.runLean)}°）${f.dir > 0 ? 'より大きい' : '以下'}を崩れとすると：` +
      `崩れを見つけた ${pc(f.sens)}・崩れでないのを崩れとしなかった ${pc(f.spec)}・一致 ${pc(f.agree)}・AUC ${f2(f.auc)}`)
    // 線のまわりの余裕：崩れの窓のいちばん小さい傾きと、崩れでない窓の上から1割・いちばん大きい傾き
    const posT = res.windows.filter((v) => v.bad === true).map((v) => v.tilt)
    const negT = res.windows.filter((v) => v.bad === false).map((v) => v.tilt)
    res.gap = { posMin: Math.min(...posT.filter(S.finite)), negP90: S.quantile(negT, 0.9), negMax: Math.max(...negT.filter(S.finite)) }
    say(`  崩れの窓の傾きの最小 ${f1(res.gap.posMin)}°・崩れでない窓の上から1割 ${f1(res.gap.negP90)}°・最大 ${f1(res.gap.negMax)}°`)
    const p = res.fit.pitch
    if (p.pos && p.neg) say(`  前後の傾きの線 ${f1(p.threshold)}° では：見つけた ${pc(p.sens)}・しなかった ${pc(p.spec)}・一致 ${pc(p.agree)}・AUC ${f2(p.auc)}`)
  } else say('  崩れの窓か、崩れでない窓のどちらかがないので、線は決められない')
}

const H = FORM.head
const headCols = ['neck', 'headLean', 'chin', 'pitch']
say('\n## 頭（頭のセンサーの傾き と カメラの首の角度・頭の位置）')
say('※ カメラの pitch はスマホの傾き（頭の向きではない）。比べのために並べるだけ')
const head = tiltPart('頭')
let headRes = null
if (!head) say('頭のセンサーの値がない')
else if (head.missing) say(head.missing)
else {
  headRes = compareTilt(head, headCols, (v) => (S.finite(v.neck) && S.finite(v.headLean) ? v.neck > H.neck && v.headLean > H.headLean : null), `首 > ${H.neck}° かつ 頭の位置 > ${H.headLean}°（FORM.head）`)
  printTilt(headRes, headCols)
  // 線の際に人がいないとき、答えの線を下げて見る（よい例の上の端など）
  for (const [nk, hl, name] of [[40, 42, '首 > 40° かつ 頭の位置 > 42°（ふつうの区間の16秒平均の最大に近い、ゆるい線）']]) {
    const labels = headRes.windows.map((v) => (S.finite(v.neck) && S.finite(v.headLean) ? v.neck > nk && v.headLean > hl : null))
    const f = S.bestThreshold(headRes.windows.map((v) => v.tilt), labels)
    if (f.pos && f.neg) say(`  参考：答えを ${name} にすると：崩れの窓 ${f.pos}/${f.n}・線 ${f1(f.threshold)}°・見つけた ${pc(f.sens)}・しなかった ${pc(f.spec)}・一致 ${pc(f.agree)}・AUC ${f2(f.auc)}`)
    headRes.loose = { neckMin: nk, headLeanMin: hl, ...f }
  }
}
out.head = headRes && { ...headRes, windows: undefined }

const T = FORM.trunk
say('\n## 胸（胸のセンサーの傾き と カメラの上体）')
const chest = tiltPart('胸')
let chestRes = null
if (!chest) say('胸のセンサーの値がない')
else if (chest.missing) say(chest.missing)
else {
  const st = log.sensors.stand
  if (st && chest.ref.dir) {
    const c = Math.max(-1, Math.min(1, st.base.reduce((s, v, i) => s + v * chest.ref.dir[i], 0)))
    say(`記録の立った姿勢（${f1(st.t)} 秒、アプリが覚えた向き）と、ここで取った向きの差 ${f1((Math.acos(c) * 180) / Math.PI)}°`)
  }
  if (log.sensors.runLean) {
    say(`アプリが覚えた走る前傾 ${f1(log.sensors.runLean.deg)}°（${f1(log.sensors.runLean.t)} 秒）`)
    const last = chest.n.samples[chest.n.samples.length - 1].tt
    // hunch.ts は胸の値が HUNCH.stale 秒より古いと覚えない。覚えた時刻に記録の値がないなら、届いた値が記録に入っていない
    if (log.sensors.runLean.t > last + 60) say(`※ 記録の胸の値は ${f1(last)} 秒で終わっているのに、アプリはそのあとで走る前傾を覚えている（届いた値が記録に残っていないか、つなぎ直したあとの値）`)
  }
  chestRes = compareTilt(chest, ['trunk', 'body'], (v) => (S.finite(v.trunk) ? v.trunk > T.max : null), `上体 > ${T.max}°（FORM.trunk.max）`)
  printTilt(chestRes, ['trunk', 'body'])
  // 上体の線を越えた窓がないときは、上体の値の上側（上から2割）を答えにして、分かれ方だけ見る
  const tr = chestRes.windows.map((v) => v.trunk)
  const q8 = S.quantile(tr, 0.8)
  const f = S.bestThreshold(chestRes.windows.map((v) => v.tilt), chestRes.windows.map((v) => (S.finite(v.trunk) ? v.trunk > q8 : null)))
  if (f.pos && f.neg) say(`  参考：答えを「上体がこの走りの上から2割（> ${f1(q8)}°）」にすると：線 ${f1(f.threshold)}°・見つけた ${pc(f.sens)}・しなかった ${pc(f.spec)}・一致 ${pc(f.agree)}・AUC ${f2(f.auc)}（${f.n}窓）`)
  chestRes.upper = { trunkMin: q8, ...f }
}
out.chest = chestRes && { ...chestRes, windows: undefined }

// ---- ピッチ ----
say('\n## ピッチ（足首のセンサーの自己相関 と カメラのピッチ）')
const la = node('左足首')
const ra = node('右足首')
const cadRows = []
for (const w of wins) {
  const cut = (n) => (n ? n.samples.filter((s) => s.tt >= w[0] && s.tt < w[1]) : [])
  const cs = [S.cadenceOf(cut(la)), S.cadenceOf(cut(ra))].filter(Number.isFinite)
  const cam = S.median(winSecs(w).flatMap((k) => camSec.get(k).cadence))
  const pk = [S.cadenceFromPeaks(S.impactPeaks(cut(la))), S.cadenceFromPeaks(S.impactPeaks(cut(ra)))].filter(Number.isFinite)
  cadRows.push({ t: w[0], sensor: cs.length ? S.mean(cs) : NaN, peaks: pk.length ? S.mean(pk) : NaN, l: S.cadenceOf(cut(la)), r: S.cadenceOf(cut(ra)), cam })
}
{
  const d = cadRows.filter((v) => S.finite(v.sensor) && S.finite(v.cam)).map((v) => v.sensor - v.cam)
  const r = S.corr(cadRows.map((v) => v.sensor), cadRows.map((v) => v.cam))
  say(`${WIN}秒の窓 ${d.length}：センサー 中央値 ${f1(S.median(cadRows.map((v) => v.sensor)))}・カメラ 中央値 ${f1(S.median(cadRows.map((v) => v.cam)))} 歩/分`)
  say(`差（センサー − カメラ）：中央値 ${f1(S.median(d))}・絶対値の中央値 ${f1(S.median(d.map(Math.abs)))}・3歩/分以内 ${pc(d.filter((x) => Math.abs(x) <= 3).length / d.length)}・相関 r ${f2(r.r)}`)
  const dp = cadRows.filter((v) => S.finite(v.peaks) && S.finite(v.cam)).map((v) => v.peaks - v.cam)
  const rp = S.corr(cadRows.map((v) => v.peaks), cadRows.map((v) => v.cam))
  say(`参考：衝撃の山の間隔から：差の中央値 ${f1(S.median(dp))}・絶対値の中央値 ${f1(S.median(dp.map(Math.abs)))}・3歩/分以内 ${pc(dp.filter((x) => Math.abs(x) <= 3).length / dp.length)}・相関 r ${f2(rp.r)}`)
  const lr = cadRows.filter((v) => S.finite(v.l) && S.finite(v.r)).map((v) => v.l - v.r)
  say(`左右の足首の差：絶対値の中央値 ${f1(S.median(lr.map(Math.abs)))} 歩/分`)
  out.cadence = { windows: d.length, sensorMedian: S.median(cadRows.map((v) => v.sensor)), cameraMedian: S.median(cadRows.map((v) => v.cam)), diffMedian: S.median(d), absDiffMedian: S.median(d.map(Math.abs)), within3: d.filter((x) => Math.abs(x) <= 3).length / d.length, r: r.r, peaks: { diffMedian: S.median(dp), within3: dp.filter((x) => Math.abs(x) <= 3).length / dp.length, r: rp.r } }
}

// ---- 着地 ----
say('\n## 着地（足首の衝撃の山 と カメラの着地の山）')
const peaksOf = (n) => (n ? S.impactPeaks(n.samples).filter((p) => inRun(p.t)) : [])
const ip = { L: peaksOf(la), R: peaksOf(ra) }
const satL = la ? S.saturated(la.samples.filter((s) => inRun(s.tt))) : 0
const satR = ra ? S.saturated(ra.samples.filter((s) => inRun(s.tt))) : 0
{
  const mL = S.median(ip.L.map((p) => p.g))
  const mR = S.median(ip.R.map((p) => p.g))
  say(`衝撃の山（1歩ごと、走った間）：左 ${ip.L.length} 歩 中央値 ${f1(mL)}g（上から1割 ${f1(S.quantile(ip.L.map((p) => p.g), 0.9))}g）・右 ${ip.R.length} 歩 中央値 ${f1(mR)}g（上から1割 ${f1(S.quantile(ip.R.map((p) => p.g), 0.9))}g）`)
  say(`左右の差（左 − 右）÷ 平均：${pc((mL - mR) / ((mL + mR) / 2))}・範囲（±16g）の端に張りついた件：左 ${satL}・右 ${satR}`)
  // 窓ごとの左右差の揺れ
  const asym = wins.map((w) => {
    const l = S.median(ip.L.filter((p) => p.t >= w[0] && p.t < w[1]).map((p) => p.g))
    const r = S.median(ip.R.filter((p) => p.t >= w[0] && p.t < w[1]).map((p) => p.g))
    return (l - r) / ((l + r) / 2)
  })
  say(`${WIN}秒の窓ごとの左右差：中央値 ${pc(S.median(asym))}・下から1割 ${pc(S.quantile(asym, 0.1))}・上から1割 ${pc(S.quantile(asym, 0.9))}`)
  out.impact = { left: { n: ip.L.length, median: mL }, right: { n: ip.R.length, median: mR }, asym: (mL - mR) / ((mL + mR) / 2), asymWindows: { median: S.median(asym), p10: S.quantile(asym, 0.1), p90: S.quantile(asym, 0.9) }, saturated: { L: satL, R: satR } }
}
{
  // カメラの着地の山（足首が腰より一番前に出た瞬間）。記録の点は、アプリがなめらかにして傾きを直したあとのもの
  const m = new LandingMeter('lead')
  for (const r of rows) if (r.pts && r.phase === 'run' && r.moving && inRun(r.t)) m.update(S.frameOf(r.pts), r.t)
  const cp = m.peaks.filter((p) => inRun(p.t))
  // それぞれのカメラの山に、あとに続くいちばん近いセンサーの山（どちらの足首でも）を 0.35 秒以内で合わせる
  const all = [...ip.L.map((p) => ({ ...p, side: 'L' })), ...ip.R.map((p) => ({ ...p, side: 'R' }))].sort((a, b) => a.t - b.t)
  const pairs = []
  for (const c of cp) {
    let best = null
    for (const s of all) {
      const d = s.t - c.t
      if (d < -0.15 || d > 0.35) continue
      if (!best || Math.abs(d - 0.05) < Math.abs(best.t - c.t - 0.05)) best = s
    }
    if (best) pairs.push({ c, s: best, d: best.t - c.t })
  }
  const same = pairs.filter((p) => p.c.side === p.s.side).length
  say(`カメラの着地の山 ${cp.length}（左の名前 ${cp.filter((p) => p.side === 'L').length}・右 ${cp.filter((p) => p.side === 'R').length}）のうち、センサーの山と合ったもの ${pairs.length}`)
  say(`センサーの山 − カメラの山の時刻：中央値 ${f2(S.median(pairs.map((p) => p.d)))} 秒・カメラの左右の名前とセンサーの足首が同じ ${pc(same / pairs.length)}`)
  const hc = S.corr(pairs.map((p) => p.c.heel), pairs.map((p) => p.s.g))
  const shc = S.corr(pairs.map((p) => p.c.shank), pairs.map((p) => p.s.g))
  say(`1歩ごとの相関 r：かかとの前（heel）と衝撃 ${f2(hc.r)}・すねの角度と衝撃 ${f2(shc.r)}（${hc.n}歩）`)
  const byS = (side, k) => S.median(pairs.filter((p) => p.s.side === side).map((p) => p.c[k]))
  say(`センサーの足首ごとのカメラの値（中央値）：かかとの前 左 ${f2(byS('L', 'heel'))}・右 ${f2(byS('R', 'heel'))}、すねの角度 左 ${f1(byS('L', 'shank'))}°・右 ${f1(byS('R', 'shank'))}°`)
  out.landing = { cameraPeaks: cp.length, matched: pairs.length, lagMedian: S.median(pairs.map((p) => p.d)), sideAgree: same / pairs.length, rHeelImpact: hc.r, rShankImpact: shc.r }
}

// ---- 腕振り ----
say('\n## 腕振り（手首のジャイロ と カメラの手首の前後の振れ幅）')
{
  const wr = node('右手首')
  const wl = node('左手首')
  const wn = wr ?? wl
  if (!wn) say('手首のセンサーの値がない')
  else {
    // カメラは、センサーと同じ側の手首と、反対側の手首のうち、点の確からしさが高いほう（真横から撮ると、奥の腕はほとんど見えない。
    // 左右の腕は同じ大きさで逆に振るので、見えるほうで代える）
    const same = wn.place === '右手首' ? 16 : 15
    const run = rows.filter((r) => r.pts && r.phase === 'run' && r.moving && inRun(r.t))
    const visOf = (mp) => S.mean(run.map((r) => r.pts[mp].v))
    const mp = visOf(same) >= visOf(31 - same) ? same : 31 - same
    say(`手首の点の確からしさ（走った間の平均）：同じ側 ${f2(visOf(same))}・反対側 ${f2(visOf(31 - same))} → ${mp === same ? '同じ側' : '反対側'}の手首で比べる`)
    const rowsW = []
    for (const w of wins) {
      const g = wn.samples.filter((s) => s.tt >= w[0] && s.tt < w[1]).map((s) => Math.hypot(s.g[0], s.g[1], s.g[2]))
      const cr = run.filter((r) => r.t >= w[0] && r.t < w[1])
      const near = cr.map((r) => S.armOffset(r.pts, mp))
      const vis = S.mean(cr.map((r) => r.pts[mp].v))
      if (g.length < WIN * 20 || near.filter(S.finite).length < WIN * 5) continue
      rowsW.push({ t: w[0], gyro: S.quantile(g, 0.9), rms: Math.sqrt(S.mean(g.map((x) => x * x))), cam: S.quantile(near, 0.95) - S.quantile(near, 0.05), vis })
    }
    const r1 = S.corr(rowsW.map((v) => v.gyro), rowsW.map((v) => v.cam))
    const r2 = S.corr(rowsW.map((v) => v.rms), rowsW.map((v) => v.cam))
    say(`${wn.place}のセンサー・${rowsW.length}窓`)
    say(`ジャイロの大きさの上から1割：中央値 ${f1(S.median(rowsW.map((v) => v.gyro)))} dps・カメラの振れ幅（体幹の長さに対する割合）：中央値 ${f2(S.median(rowsW.map((v) => v.cam)))}`)
    say(`相関 r：上から1割 ${f2(r1.r)}・RMS ${f2(r2.r)}（${r1.n}窓）`)
    out.arm = { place: wn.place, cameraWrist: mp === same ? 'same' : 'other', windows: rowsW.length, gyroP90Median: S.median(rowsW.map((v) => v.gyro)), camSwingMedian: S.median(rowsW.map((v) => v.cam)), camVis: S.mean(rowsW.map((v) => v.vis)), rP90: r1.r, rRms: r2.r }
  }
}

// ---- まとめ：線の案 ----
say('\n## 線の案（params.ts には書いていない。決めるのは人）')
const snip = []
if (headRes?.fit.tilt.pos && headRes.fit.tilt.neg) {
  const f = headRes.fit.tilt
  snip.push(`  // 頭：${out.file} の ${f.n}窓（${WIN}秒）、カメラの答え ${headRes.labelName} の窓 ${f.pos}。見つけた ${pc(f.sens)}・外れなかった ${pc(f.spec)}・一致 ${pc(f.agree)}・AUC ${f2(f.auc)}`)
  snip.push(`  head: { margin: ${f1(f.threshold - headRes.runLean)} }, // 走る前傾 ${f1(headRes.runLean)}° から。立った姿勢から ${f1(f.threshold)}°`)
}
if (chestRes?.fit.tilt.pos && chestRes.fit.tilt.neg) {
  const f = chestRes.fit.tilt
  snip.push(`  // 胸：${f.n}窓、答え ${chestRes.labelName} の窓 ${f.pos}。見つけた ${pc(f.sens)}・外れなかった ${pc(f.spec)}・一致 ${pc(f.agree)}・AUC ${f2(f.auc)}`)
  snip.push(`  chest: { margin: ${f1(f.threshold - chestRes.runLean)} }, // いまの HUNCH.margin は ${HUNCH.margin}`)
} else if (chestRes) snip.push(`  // 胸：カメラの上体の線（${chestRes.labelName}）を越えた窓がないので、HUNCH.margin（${HUNCH.margin}）は確かめられない`)
if (snip.length) say(['// 案（このまま貼らない。数字は1本の走りから）', ...snip].join('\n'))
else say('線を決められる項目がなかった（カメラの答えで崩れの窓と崩れでない窓の両方がそろわなかった）')
out.snippet = snip

if (jsonOut) {
  const p = resolve(jsonOut)
  if ((p + sep).startsWith(resolve(root) + sep)) {
    console.error(`書き出し先がリポジトリの中です（${p}）。走りの記録から作ったものはリポジトリの外に置きます`)
    process.exit(1)
  }
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(out, null, 2))
  say(`\n→ ${p}`)
}
