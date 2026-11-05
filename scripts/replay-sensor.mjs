// 記録したセンサーの値を、アプリの崩れの見分け（src/modes/sensor/lean.ts の LeanDetector、数字は params.ts の HUNCH・HEAD）に流し直す
// 使い方: npm run replay:sensor -- <rfc-….json | Mac の記録のフォルダ> … [--level advanced] [--chest '{"follow":0}'] [--head '{"margin":10}']
//   rfc-….json：カメラ版といっしょに走った記録（ファイル名だけなら RFC_RUNS_DIR、既定 ~/Developer/research-data/runs/ から読む）。
//     立った姿勢は記録の stand（なければ phase:run の直前3秒）、走っているかはカメラの段階 run と歩数（アプリと同じ区切り）。
//     胸には、アプリと同じくカメラの上体と頭の位置（直近1秒のコマ）を渡す（ずれの見分け。lean.ts の camSlipSec）
//     カメラの答え（camera/params.ts の FORM：上体 > trunk.max、首 > head.neck かつ 頭の位置 > head.headLean）と、知らせた時刻・5秒の窓で比べる
//   Mac の記録のフォルダ（hardware/sensor/tools の記録。imu.csv と phases.csv）：区切りごとに知らせた回数を出す（わざと崩したテストの確かめ）
//   --level：胸の線のレベル（beginner / intermediate / advanced。params.ts の HUNCH_BY_LEVEL。なければ HUNCH＝中級）
//   --chest / --head：数字を JSON で上書きして試す（params.ts は変えない）
//   --gate stop：歩数で走っていた行から8秒までは、立ち止まっても走っているとみる（アプリに近い。物を拾った数秒を流し直す）
//   2つの立ち方（lean.ts の setPoses）：記録に pose（a・b の向き、mode pose）があれば、それで見る（カメラ版は b のカメラの上体も渡す）。
//   --pose fallback：2つの立ち方の差が小さかったときの道（b を立った姿勢にして今までの見方）を、立った姿勢の3秒を a・b の両方にして通す。
//     2つの立ち方の前の記録で、今までの見方と同じ結果になるかを確かめるため。--pose off：記録に pose があっても stand で見る
// 記録の中身は画面に出すだけで、どこにも書かない
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
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
const over = { chest: JSON.parse(opt('--chest') ?? '{}'), head: JSON.parse(opt('--head') ?? '{}') }
const level = opt('--level')
// --gate stop：歩数で走っていた行から STOP 秒までは、立ち止まっても「走っている」とみる。アプリの「走っている」は1秒ごとの歩数で決めていて、
// 立ち止まって物を拾った数秒も走っているままだった（2026-11-04）。その数秒を流し直して確かめるとき
const gate = opt('--gate')
const poseOpt = opt('--pose')
const STOP = 8
const WIN = 5
const HOLD = 20 // 行のない間を、前の行のまま「走っている」とみる長さの上限（秒）
if (!args.length) {
  console.error("使い方: npm run replay:sensor -- <rfc-….json | Mac の記録のフォルダ> … [--chest '{…}'] [--head '{…}']")
  process.exit(1)
}

const root = new URL('..', import.meta.url).pathname
const tmp = join(root, 'node_modules/.tmp')
mkdirSync(tmp, { recursive: true })
const entry = join(tmp, 'replay-sensor-entry.ts')
writeFileSync(
  entry,
  [
    `export { decodeBlock, nodeHz } from '${join(root, 'src/modes/sensor/log.ts')}'`,
    `export { LeanDetector } from '${join(root, 'src/modes/sensor/lean.ts')}'`,
    `export { HUNCH, HUNCH_BY_LEVEL, HEAD, SLOTS } from '${join(root, 'src/modes/sensor/params.ts')}'`,
    `export { FORM, BASELINE } from '${join(root, 'src/modes/camera/params.ts')}'`,
  ].join('\n'),
)
const bundle = join(tmp, 'replay-sensor.mjs')
await build({ input: entry, platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const { decodeBlock, nodeHz, LeanDetector, HUNCH, HUNCH_BY_LEVEL, HEAD, SLOTS, FORM, BASELINE } = await import(pathToFileURL(bundle).href)
if (level && !HUNCH_BY_LEVEL[level]) {
  console.error(`--level は beginner / intermediate / advanced のどれか（${level}）`)
  process.exit(1)
}

const runsDir = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const pc = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-')
const say = (s = '') => console.log(s)
const KINDS = [
  { key: 'chest', name: '胸（猫背）', p: { ...(level ? HUNCH_BY_LEVEL[level] : HUNCH), ...over.chest } },
  { key: 'head', name: '頭（前に出る）', p: { ...HEAD, ...over.head } },
]
say(`胸：${JSON.stringify(KINDS[0].p)}`)
say(`頭：${JSON.stringify(KINDS[1].p)}`)

// 1つの場所の値を流す。samples：[{ tt, a }]（時刻順）、running(t)、standT：立った姿勢を覚える t。100Hz でない記録は ema を件数に合わせる。
// bentBy：ほかの場所（胸）の tick ごとの「体を曲げている」（頭はアプリと同じく、胸で曲げたと分かれば止める）
// pose：{ a, b, camB }（記録の2つの立ち方）・'fallback'（差が小さかった道を通す）・null（stand）
function replay(p, samples, running, standT, t0, t1, hz, bentBy, camAt, pose = null) {
  const k = 1 - Math.pow(1 - p.ema, 100 / hz)
  const d = new LeanDetector({ ...p, ema: k, standMin: Math.round((p.standMin * hz) / 100) }, 5)
  const ticks = []
  let i = 0
  let stood = false
  for (let t = t0, k = 0; t < t1; t += p.tick, k++) {
    while (i < samples.length && samples[i].tt <= t) d.sample(samples[i].tt, samples[i++].a)
    if (!stood && t >= standT) {
      if (pose && pose !== 'fallback') stood = d.setPoses(pose.a, pose.b, pose.camB ?? null) || d.stand(t, BASELINE.collect)
      else if (pose === 'fallback') {
        const b = d.dirOver(t, BASELINE.collect)
        if (b && !d.setPoses(b, b)) d.standDir(b)
        stood = !!b
      } else stood = d.stand(t, BASELINE.collect)
    }
    const r = d.update(t, running(t), !!bentBy?.[k], camAt?.(t) ?? null)
    ticks.push({ t, run: running(t), ...r, bentNow: d.bent(t), line: r.ref !== null && r.ref !== undefined ? r.ref + d.margin() : null })
  }
  return { d, ticks, cues: ticks.filter((x) => x.cue).map((x) => x.t), praises: ticks.filter((x) => x.praise).map((x) => x.t), slips: ticks.filter((x) => x.slip), bends: ticks.filter((x) => x.bend !== undefined), learnedAt: ticks.find((x) => x.learned !== undefined) }
}

// ずれとみなして基準を置き直した時刻と、基準の変わり方
const slipText = (r) => r.slips.map((x) => `${f1(x.t)}（${f1(x.slip.from)}→${f1(x.slip.to)}°）`).join(' ') || 'なし'

const runMin = (ticks, p) => (ticks.filter((x) => x.run).length * p.tick) / 60

function cameraLog(path) {
  const { log } = JSON.parse(readFileSync(path, 'utf8'))
  if (!log?.sensors) return say('この記録にはセンサーの値がない')
  const rows = S.cameraRows(log)
  const nodes = S.decodeNodes(log.sensors, decodeBlock)
  const standT = log.sensors.stand?.t ?? log.events.find((e) => e[1] === 'phase:run')?.[0]
  // 走っているか：その時刻のいちばん近い前のカメラの行（段階が run で、歩数で走っていた）。
  // カメラは走っている間、骨格を間引いて取る（10秒のうち3秒など。行のない間が7〜17秒）。アプリはその間も前の判定のまま
  // 「走っている」とするので、HOLD 秒までの行のない間は前の行のままにする
  const rt = rows.map((r) => r.t)
  // --gate stop：最後に歩数で走っていた行から STOP 秒までは、立ち止まっても走っているとみる
  const lastMoving = []
  rows.forEach((r, i) => (lastMoving[i] = r.moving ? r.t : (lastMoving[i - 1] ?? -Infinity)))
  const running = (t) => {
    let lo = 0
    let hi = rt.length - 1
    if (hi < 0 || t < rt[0]) return false
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (rt[m] <= t) lo = m
      else hi = m - 1
    }
    const r = rows[lo]
    return r.phase === 'run' && (gate === 'stop' ? t - lastMoving[lo] < STOP : r.moving) && t - r.t < HOLD
  }
  // カメラの答え（5秒の窓）
  const H = FORM.head
  const label = {
    chest: (rs) => (rs.length ? S.mean(rs.map((r) => r.trunk)) > FORM.trunk.max : null),
    head: (rs) => {
      const n = S.mean(rs.map((r) => r.neck))
      const h = S.mean(rs.map((r) => r.headLean))
      return S.finite(n) && S.finite(h) ? n > H.neck && h > H.headLean : null
    },
  }
  // ゆるい答え：これより下なら、はっきり崩れでない（頭は compare:sensor の「ゆるい線」、胸は FORM.trunk.max の 2/3）
  const loose = {
    chest: (rs) => (rs.length ? S.mean(rs.map((r) => r.trunk)) > (FORM.trunk.max * 2) / 3 : null),
    head: (rs) => {
      const n = S.mean(rs.map((r) => r.neck))
      const h = S.mean(rs.map((r) => r.headLean))
      return S.finite(n) && S.finite(h) ? n > 40 && h > 42 : null
    },
  }
  const runRows = rows.filter((r) => r.phase === 'run' && r.moving)
  // カメラの上体と頭の位置：その時刻の前1秒以内のコマ（段階 run）。アプリの Live.tsx と同じ
  const camAt = (t) => {
    let lo = 0
    let hi = rt.length - 1
    if (hi < 0 || t < rt[0]) return null
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (rt[m] <= t) lo = m
      else hi = m - 1
    }
    const r = rows[lo]
    return r.phase === 'run' && t - r.t < 1 && S.finite(r.trunk) && S.finite(r.headLean) ? { trunk: r.trunk, head: r.headLean } : null
  }
  const t0 = rows[0].t
  const t1 = rows[rows.length - 1].t
  let chestBent = null
  for (const K of KINDS) {
    const ni = nodes.findIndex((x) => x.place === K.p.place && x.name && x.samples.length)
    const n = nodes[ni]
    say(`\n## ${K.name}`)
    if (!n) {
      say('値がない')
      continue
    }
    const hz = nodeHz(log.sensors, ni)
    const pl = K.key === 'chest' ? log.sensors.pose : log.sensors.head?.pose
    const pose = poseOpt === 'fallback' ? 'fallback' : poseOpt !== 'off' && pl?.mode === 'pose' && pl.a && pl.b ? { a: pl.a, b: pl.b, camB: K.key === 'chest' ? (pl.cam?.b?.trunk ?? null) : null } : null
    if (pl) say(`2つの立ち方：${pl.mode}・差 ${f1(pl.deg)}°・測った回数 ${pl.tries}${pose && pose !== 'fallback' ? '（この2つで見る）' : ''}`)
    const r = replay(K.p, n.samples.map((s) => ({ tt: s.tt, a: s.a })), running, standT, t0, t1, hz, K.key === 'head' ? chestBent : null, K.key === 'chest' ? camAt : null, pose)
    if (K.key === 'chest') chestBent = r.ticks.map((x) => x.bentNow)
    say(`値の速さ ${f1(hz)}Hz・体を曲げたとみなした ${r.bends.length} 回：${r.bends.map((x) => `${f1(x.t)}（${f1(x.bend)}°）`).join(' ') || 'なし'}`)
    const mins = runMin(r.ticks, K.p)
    const last = n.samples[n.samples.length - 1].tt
    say(`値 ${f1(n.samples[0].tt)}〜${f1(last)} 秒・走った ${f1(mins)} 分（この間に値があった分）・走る前傾 ${f1(r.d.runLean)}°（${f1(r.learnedAt?.t)} 秒）・前の向き ${r.d.fwd ? 'あり' : 'なし（向きによらない角度）'}`)
    if (r.d.pose) say(`2つの立ち方で見た：差 ${f1(r.d.pose.deg)}°・線の幅 ${f1(r.d.pose.margin)}°・差し引いた走る前傾 ${f1(r.d.offset?.deg)}°（${r.d.offset?.by ?? '-'}${r.d.offset?.cam !== null && r.d.offset?.cam !== undefined ? `、カメラの上体の増え ${f1(r.d.offset.cam)}°` : ''}）`)
    // 2つの立ち方で見たときだけ：走る前傾を覚え終わる前（poseStart から）に知らせた回数と、直ってほめた回数（params.ts の poseStart・posePraise）
    if (r.d.pose) say(`  覚え終わる前に知らせた ${r.cues.filter((t) => !r.learnedAt || t < r.learnedAt.t).length} 回・ほめた ${r.praises.length} 回：${r.praises.map(f1).join(' ') || 'なし'}`)
    // 知らせたとき、その前の5秒のカメラの答え
    const cueRows = r.cues.map((t) => {
      const rs = runRows.filter((x) => x.t > t - WIN && x.t <= t)
      return { t, bad: label[K.key](rs), cam: K.key === 'chest' ? `上体${f1(S.mean(rs.map((x) => x.trunk)))}` : `首${f1(S.mean(rs.map((x) => x.neck)))}`, loose: loose[K.key](rs) }
    })
    const falseCues = cueRows.filter((c) => c.bad === false)
    const ticksWithData = r.ticks.filter((x) => x.run && x.tilt !== null)
    const runMinData = (ticksWithData.length * K.p.tick) / 60
    say(`知らせた ${r.cues.length} 回（${f1((r.cues.length / Math.max(runMinData, 1e-9)) * 10)} 回/10分）・そのうちカメラの答えが「崩れでない」${falseCues.length} 回（${f1((falseCues.length / Math.max(runMinData, 1e-9)) * 10)} 回/10分）`)
    const clear = cueRows.filter((c) => c.loose === false)
    say(`  ゆるい答え（${K.key === 'chest' ? `上体 > ${f1((FORM.trunk.max * 2) / 3)}°` : '首 > 40° かつ 頭の位置 > 42°'}）でも崩れでない（はっきり外れ）：${clear.length} 回（${f1((clear.length / Math.max(runMinData, 1e-9)) * 10)} 回/10分）`)
    say(`  ずれとみなした ${r.slips.length} 回：${slipText(r)}`)
    say(`  時刻：${cueRows.map((c) => `${f1(c.t)}${c.bad === true ? '○' : c.bad === false ? '×' : '?'}(${c.cam})`).join(' ') || 'なし'}（○ カメラも崩れ・× カメラは崩れでない。かっこはその前5秒のカメラの値）`)
    // 5秒の窓：センサーが線を越えていた割合が半分以上なら「崩れ」
    const spans = S.runSpans(rows)
    let tp = 0
    let fp = 0
    let tn = 0
    let fn = 0
    for (const w of S.windows(spans, WIN)) {
      const tk = ticksWithData.filter((x) => x.t >= w[0] && x.t < w[1] && x.line !== null)
      if (tk.length < (WIN / K.p.tick) * 0.6) continue
      const s = tk.filter((x) => x.tilt > x.line).length / tk.length >= 0.5
      const c = label[K.key](runRows.filter((x) => x.t >= w[0] && x.t < w[1]))
      if (c === null) continue
      if (s && c) tp++
      else if (s && !c) fp++
      else if (!s && c) fn++
      else tn++
    }
    const nw = tp + fp + tn + fn
    say(`5秒の窓 ${nw}（カメラの崩れ ${tp + fn}）：崩れを見つけた ${pc(tp / (tp + fn))}・崩れでないのを崩れとしなかった ${pc(tn / (tn + fp))}・一致 ${pc((tp + tn) / nw)}`)
    // 基準の動き（30秒ごと）
    const pts = []
    for (let t = Math.ceil(t0 / 30) * 30; t < t1; t += 30) {
      const x = r.ticks.find((y) => y.t >= t && y.run && y.tilt !== null)
      if (x && x.ref !== null && x.ref !== undefined) pts.push(`${Math.round(x.t)}s ${f1(x.tilt)}/${f1(x.ref)}`)
    }
    say(`  傾き/基準（30秒ごと）：${pts.join('  ') || '-'}`)
  }
}

function macRecord(dir) {
  const ph = readFileSync(join(dir, 'phases.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
  const phases = ph.map(([name, ms]) => ({ name, t: Number(ms) / 1000 }))
  const lines = readFileSync(join(dir, 'imu.csv'), 'utf8').trim().split('\n')
  const head = lines[0].split(',')
  const col = Object.fromEntries(head.map((c, i) => [c, i]))
  const per = new Map()
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const e = per.get(c[col.node]) ?? []
    e.push({ ms: Number(c[col.time_ms]), pc: Number(c[col.pc_ms]), a: [Number(c[col.ax_g]), Number(c[col.ay_g]), Number(c[col.az_g])] })
    per.set(c[col.node], e)
  }
  // 時刻：センサーの時刻に、届いた時刻との差のいちばん小さい値（いちばん遅れの少なかった件）を足す
  const series = (name) => {
    const xs = per.get(name) ?? []
    const off = Math.min(...xs.map((x) => x.pc - x.ms))
    return xs.map((x) => ({ tt: (x.ms + off) / 1000, a: x.a })).sort((a, b) => a.tt - b.tt)
  }
  const phaseAt = (t) => {
    let p = null
    for (const x of phases) if (x.t <= t) p = x.name
    return p
  }
  const RUN = new Set(['走り出す', 'ふつうに走る', '猫背で走る', '胸を張って走る', '振動に気づくか'])
  const running = (t) => RUN.has(phaseAt(t))
  const standT = phases.find((x) => x.name === '走り出す')?.t
  const t0 = phases[0].t
  const t1 = phases[phases.length - 1].t
  for (const K of KINDS) {
    const name = SLOTS.find((s) => s.place === K.p.place)?.name // Mac のテストも同じ付け方（頭=1・胸=2）
    const r = replay(K.p, series(name), running, standT, t0, t1, 100)
    say(`\n## ${K.name}（${name}）`)
    say(`走る前傾 ${f1(r.d.runLean)}°（${f1(r.learnedAt ? r.learnedAt.t - t0 : NaN)} 秒・${phaseAt(r.learnedAt?.t ?? 0)}）・前の向き ${r.d.fwd ? 'あり' : 'なし'}`)
    const by = new Map()
    for (const t of r.cues) by.set(phaseAt(t), (by.get(phaseAt(t)) ?? 0) + 1)
    let k = 0
    for (const x of phases.slice(0, -1)) {
      k++
      const end = phases[k].t
      const tk = r.ticks.filter((y) => y.t >= x.t && y.t < end && y.tilt !== null)
      const n = r.cues.filter((t) => t >= x.t && t < end).length
      say(`  ${x.name.padEnd(8, '　')} ${f1(end - x.t)}秒  傾き 中央値 ${f1(S.median(tk.map((y) => y.tilt)))}°・基準 ${f1(S.median(tk.map((y) => y.ref)))}°  知らせた ${n} 回`)
    }
    say(`  ずれとみなした ${r.slips.length} 回：${slipText(r)}`)
  }
}

for (const a of args) {
  const p = existsSync(a) ? a : join(runsDir, a)
  say(`\n# ${p.split(sep).pop()}`)
  if (existsSync(join(p, 'imu.csv'))) macRecord(p)
  else cameraLog(p)
}
