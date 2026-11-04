// 実機の記録で試す（胸のセンサーとカメラの猫背）：カメラ・センサーといっしょに走った記録を、いまのコーチ（src/modes/camera/coach.ts）にレベルごとの線で通し直し、
// 同じ時計で胸のセンサーの値を LeanDetector（src/modes/sensor/lean.ts）に流して、
//   ① カメラが「背中が丸まっています」と言った時刻に、胸が震えたか（声の10秒前〜5秒後）と、その時刻の胸の傾き（走る基準からの増え）・基準・置き直し
//   ② ふつうに走った区間で、カメラの猫背の声の近く（±15秒）でないのに胸が震えた回数（10分あたり）
//   ③ カメラの猫背の値（1秒ごとの hunchOf）と、胸の傾きの基準からの増え（同じ1秒の平均）の関係（相関と、当てはめた直線）
// を、胸の線（margin・hold）を変えて出す。「走っている」はアプリと同じく、コーチが走っている・歩数で走っているとみた間（Live.tsx の sensorTimer）。
// 区切り：2026-11-04 20:05 は崩しのないふつうの走り（本人）。2026-11-03 15:08 は台本（sim/strictness.sim.ts と同じ。猫背 405〜465秒）。
//   2026-11-02 20:23 は崩しのない走り（胸のセンサーがずれた）。センサーの値は記録の上限（params.ts の SENSOR_LOG）までしか残っていない
// 限り：記録はアプリが間引いて撮ったもの。ランナーは震えを感じて直していない（記録のまま）。カメラの声はコーチに通し直したもの（11-04 は走ったときの声も出す）
// 動かし方：RFC_RUNS_DIR=<記録の置き場所（既定 ~/Developer/research-data/runs）> npx vitest run --config sim/vitest.config.ts sim/chest-camera.sim.ts
//   結果は sim/result-chest-camera.md（記録そのものは書かない。回数と角度だけ）
import { it as itAll } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Coach } from '../src/modes/camera/coach'
import * as P from '../src/modes/camera/params'
import { CUE as CUE_TEXT } from '../src/core/phrases'
import { LEVEL_LABEL, type Level } from '../src/core/level'
import type { Frame, ItemKey, RunLog, Sample } from '../src/core/types'
import { LeanDetector } from '../src/modes/sensor/lean'
import { decodeBlock } from '../src/modes/sensor/log'
import { HUNCH, HUNCH_BY_LEVEL, type LeanParams } from '../src/modes/sensor/params'
// @ts-expect-error 型のない .mjs（scripts/sensor-camera.test.ts と同じく読む）
import { decodeNodes } from '../scripts/sensor-camera.mjs'

const DIR = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const OUT = process.env.SIM_OUT ?? 'sim/result-chest-camera.md'
const RUNS = [
  { label: '2026-11-04 20:05（上級。崩しのないふつうの走り）', file: 'rfc-20261104-2005_log-1793790318421.json', normal: [[0, 1e9]] as [number, number][], slip: [] as [number, number][], drill: null as [number, number] | null },
  // 11-03：台本の区切り（秒）+104.6。ふつう 1〜3分・4〜5分・8分〜。猫背 5〜6分（sim/strictness.sim.ts の segs1103）
  {
    label: '2026-11-03 15:08（上級。台本つき、715秒から胸のセンサーがずれた）',
    file: 'rfc-20261103-1508_log-1793686084534.json',
    normal: [[164.6, 284.6], [344.6, 404.6], [584.6, 715]] as [number, number][],
    slip: [[715, 1e9]] as [number, number][],
    drill: [404.6, 464.6] as [number, number],
  },
  // 11-02 20:23：胸のセンサーが走り出しから少しずつずれた（3分半で約15°。カメラの上体は 2〜8° でまっすぐ）ので、まるごと「ずれの間」に数える
  { label: '2026-11-02 20:23（上級。崩しのない走り、胸のセンサーがずれ続けた）', file: 'rfc-20261102-2023_log-1793618622849.json', normal: [] as [number, number][], slip: [[0, 1e9]] as [number, number][], drill: null },
]
const it = itAll.skipIf(!existsSync(join(DIR, RUNS[0].file)))
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']
const BY_TEXT = new Map(Object.entries(CUE_TEXT).map(([k, v]) => [v, k as ItemKey]))
const HUNCH_TEXT = CUE_TEXT.hunch
const BEFORE = 10 // カメラの声の、この秒数前から
const AFTER = 5 // この秒数後までに胸が震えたら「合った」
const NEAR = 15 // カメラの猫背の声からこの秒数より離れて震えたら「外れ」
const MARGINS = [3, 4, 5, 5.5, 6, 7, 8]
const HOLDS = [1, 1.5]

type Tick = { t: number; run: boolean; tilt: number | null; ref: number | null; cue: boolean; slip: boolean }
interface Out {
  cues: { t: number; item: ItemKey }[]
  samples: { t: number; s: Sample }[] // 1秒ごとのコーチの値と、その時刻（記録の時計）
  chest: Map<string, { ticks: Tick[]; cues: number[]; slips: { t: number; from: number; to: number }[] }>
}

const key = (p: LeanParams) => `${p.margin}/${p.hold}/${p.slipDrift}`

// 記録をコーチに通し、同じ時計で胸のセンサーの値を、線ごとの LeanDetector に流す（アプリと同じく、tick ごとに「走っている」を渡す）
function replay(log: RunLog, params: LeanParams[]): Out {
  const col = (n: string) => log.columns.indexOf(n)
  const [it_, ip, iv, imov, ineck, itrunk, ibody, ihip, iyaw, ilean, ichin] = ['t', 'phase', 'visible', 'moving', 'neck', 'trunk', 'body', 'hipRatio', 'yaw', 'headLean', 'chin'].map(col)
  const coach = new Coach({ pause: false, items: Object.keys(CUE_TEXT) as ItemKey[] })
  const off = log.columns.length - 1
  const npts = log.points.length
  const frameOf = (r: number[]): Frame | undefined => {
    if (r.length < off + npts * 3) return undefined
    const f: Frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
    log.points.forEach((pi, k) => (f[pi] = { x: r[off + k * 3], y: r[off + k * 3 + 1], v: r[off + k * 3 + 2] }))
    return f
  }
  // 胸のセンサー
  const nodes = decodeNodes(log.sensors, decodeBlock) as { place: string; name: string; samples: { tt: number; a: [number, number, number] }[] }[]
  const chest = nodes.find((n) => n.place === HUNCH.place && n.name && n.samples.length)!
  const hz = 100 / (log.sensors!.stride ?? 2)
  const standT = log.sensors!.stand?.t ?? log.events.find((e) => e[1] === 'phase:run')![0]
  const dets = params.map((p) => {
    const k = 1 - Math.pow(1 - p.ema, 100 / hz)
    return { p, d: new LeanDetector({ ...p, ema: k, standMin: Math.round((p.standMin * hz) / 100) }, 5), out: { ticks: [] as Tick[], cues: [] as number[], slips: [] as { t: number; from: number; to: number }[] } }
  })
  const dataEnd = chest.samples[chest.samples.length - 1].tt
  let si = 0
  let stood = false
  let nextTick: number | null = null
  const sensorTo = (t: number, running: boolean) => {
    if (nextTick === null) nextTick = t
    while (nextTick <= t && nextTick <= dataEnd + 1) {
      const tt = nextTick
      while (si < chest.samples.length && chest.samples[si].tt <= tt) {
        const s = chest.samples[si++]
        for (const x of dets) x.d.sample(s.tt, s.a)
      }
      if (!stood && tt >= standT) stood = dets.every((x) => x.d.stand(tt, P.BASELINE.collect))
      for (const x of dets) {
        const r = x.d.update(tt, running)
        x.out.ticks.push({ t: tt, run: running, tilt: r.tilt, ref: r.ref ?? null, cue: r.cue, slip: !!r.slip })
        if (r.cue) x.out.cues.push(tt)
        if (r.slip) x.out.slips.push({ t: tt, ...r.slip })
      }
      nextTick += HUNCH.tick
    }
  }
  const run = log.phases.indexOf('run')
  const rows = log.rows.filter((r) => r[ip] === run).sort((a, b) => a[it_] - b[it_])
  const out: Out = { cues: [], samples: [], chest: new Map() }
  let seenCue = 0
  let seenSample = 0
  const handle = (t: number) => {
    for (; seenCue < coach.cues.length; seenCue++) {
      const item = BY_TEXT.get(coach.cues[seenCue].text)
      if (item) out.cues.push({ t, item })
    }
    for (; seenSample < coach.samples.length; seenSample++) out.samples.push({ t, s: coach.samples[seenSample] })
    sensorTo(t, coach.state === 'running' && coach.stepping)
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
  for (const x of dets) out.chest.set(key(x.p), x.out)
  return out
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

// 胸の、走る基準からの増え（tilt − ref）。基準ができる前と、走っていない tick は null
const delta = (x: Tick) => (x.run && x.tilt !== null && x.ref !== null ? x.tilt - x.ref : null)

// カメラの声の前 BEFORE 秒の、胸の増えのようす：6秒平均の最大と、hold 秒続けて越えていた増えの最大（この margin までなら震えた、の目安。基準の寄り方は無視）
function around(ticks: Tick[], t: number, hold: number) {
  const w = ticks.filter((x) => x.t > t - BEFORE && x.t <= t + AFTER)
  const ds = w.map(delta)
  let best = -Infinity
  const n = Math.round(hold / HUNCH.tick)
  for (let i = n; i < ds.length; i++) {
    const seg = ds.slice(i - n, i + 1)
    if (seg.some((d) => d === null)) continue
    best = Math.max(best, Math.min(...(seg as number[])))
  }
  const six = ticks.filter((x) => x.t > t - 6 && x.t <= t).map(delta).filter((d): d is number => d !== null)
  const at = ticks.filter((x) => x.t <= t).at(-1)
  return { sustained: best, six: mean(six), ref: at?.ref ?? null }
}

// 直線の当てはめ（y = a + b x）と相関
function fit(xs: number[], ys: number[]) {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return { b: sxy / sxx, a: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy), n: xs.length }
}

it('胸のセンサーの線を、カメラの猫背の声に合わせる', () => {
  const lines: string[] = []
  const p = (s = '') => lines.push(s)
  const cands: LeanParams[] = []
  for (const m of MARGINS) for (const h of HOLDS) cands.push({ ...HUNCH, margin: m, hold: h, slipDrift: Math.max(8, m) })
  for (const lv of LEVELS) if (!cands.some((c) => key(c) === key(HUNCH_BY_LEVEL[lv]))) cands.push(HUNCH_BY_LEVEL[lv])
  p('# 胸のセンサーの猫背の線を、カメラの猫背の声に合わせる（記録した走り）')
  p()
  p('動かし方と限りは sim/chest-camera.sim.ts の先頭。胸の「増え」は、胸のセンサーの前への傾きの、走る基準（LeanDetector の ref）からの増え（度）。')
  p(`「合った」は、カメラの「${HUNCH_TEXT}」の ${BEFORE}秒前〜${AFTER}秒後に胸が震えたこと。「外れ」は、ふつうの区間で、カメラの猫背の声から ±${NEAR}秒より離れて震えたこと（10分あたり。胸の値があって走っていた時間で割る）。`)
  p('ずれの見張り（slipDrift）は margin と 8° の大きいほう。')
  p()
  type Agg = { hit: number; cam: number; fp: number; clear: number; min: number; slipN: number; slipMin: number; earlier: number[] }
  const agg = new Map<string, Record<Level, Agg>>()
  const rel: { x: number[]; y: number[] } = { x: [], y: [] }
  for (const R of RUNS) {
    if (!existsSync(join(DIR, R.file))) continue
    const { log } = JSON.parse(readFileSync(join(DIR, R.file), 'utf8')) as { log: RunLog }
    if (!log.sensors) continue
    p(`## ${R.label}`)
    p()
    const live = log.events.filter((e) => e[1] === HUNCH_TEXT).map((e) => e[0])
    const liveBuzz = log.sensors.cues.map((c) => c[0])
    const dataEnd = Math.max(...log.sensors.blocks.map((b) => b[0]))
    let adv: Out | null = null
    for (const lv of LEVELS) {
      P.applyStrictness(lv)
      const o = replay(log, cands)
      if (lv === 'advanced') adv = o
      const cam = o.cues.filter((c) => c.item === 'hunch' && c.t <= dataEnd).map((c) => c.t)
      const base = o.chest.get(key(HUNCH))!
      const inSegs = (segs: [number, number][]) => (u: number) => segs.some(([a, b]) => u >= a && u < b)
      const inNormal = inSegs(R.normal)
      const inSlip = inSegs(R.slip)
      const minutes = (f: (u: number) => boolean) => (base.ticks.filter((x) => delta(x) !== null && f(x.t)).length * HUNCH.tick) / 60
      const runMin = minutes(inNormal)
      const slipMin = minutes(inSlip)
      // その時刻の前6秒の、カメラの猫背の値の平均（基準ができる前や比べなかった秒は無い）
      const cam6 = (u: number) => mean(o.samples.filter((x) => x.t > u - 6 && x.t <= u && x.s.hunch !== undefined && !x.s.paused).map((x) => x.s.hunch!))
      p(`### ${LEVEL_LABEL[lv]}の線（カメラの猫背 ${P.STRICT[lv].hunch.cue}°）：カメラの猫背の声 ${cam.length}回（胸の値がある ${f1(dataEnd)}秒まで）・胸の値があって走っていた ふつうの区間 ${f1(runMin)}分・ずれの間 ${f1(slipMin)}分`)
      p()
      if (cam.length) {
        p('| カメラの声（秒） | その前6秒の胸の増え（平均） | 1.5秒続いた胸の増えの最大 | 1秒続いた最大 | 基準 | 今の線（+' + HUNCH.margin + '°）で震えた |')
        p('|---|---|---|---|---|---|')
        for (const t of cam) {
          const a15 = around(base.ticks, t, 1.5)
          const a1 = around(base.ticks, t, 1)
          const hit = base.cues.some((c) => c >= t - BEFORE && c <= t + AFTER)
          p(`| ${f1(t)} | +${f1(a15.six)}° | +${f1(a15.sustained)}° | +${f1(a1.sustained)}° | ${f1(a15.ref ?? NaN)}° | ${hit ? '○' : '×'} |`)
        }
        p()
      }
      p('| 胸の線（margin / hold） | 合った | 外れ（10分あたり） | 外れの回数 | そのうちカメラの猫背が1°未満 | ずれの間の震え（10分あたり） | ずれとみなした（秒） | 合ったときの、声より前の秒（中央） |')
      p('|---|---|---|---|---|---|---|---|')
      for (const c of cands) {
        const x = o.chest.get(key(c))!
        const hits = cam.map((t) => x.cues.filter((u) => u >= t - BEFORE && u <= t + AFTER)[0]).map((u, i) => (u === undefined ? null : cam[i] - u))
        const nHit = hits.filter((h) => h !== null).length
        const fp = x.cues.filter((u) => inNormal(u) && !cam.some((t) => Math.abs(u - t) <= NEAR))
        const clear = fp.filter((u) => !(cam6(u) >= 1))
        const inSlipCues = x.cues.filter(inSlip)
        const early = hits.filter((h): h is number => h !== null).sort((a, b) => a - b)
        const rate = (n: number, m: number) => (m > 0 ? f1((n / m) * 10) : '-')
        p(`| +${c.margin}° / ${c.hold}秒 | ${nHit} / ${cam.length} | ${rate(fp.length, runMin)} | ${fp.length} | ${clear.length} | ${rate(inSlipCues.length, slipMin)} | ${x.slips.map((s) => `${f1(s.t)}（${f1(s.from)}→${f1(s.to)}°）`).join(' ') || 'なし'} | ${early.length ? f1(early[Math.floor(early.length / 2)]) : '-'} |`)
        const a = agg.get(key(c)) ?? (Object.fromEntries(LEVELS.map((l) => [l, { hit: 0, cam: 0, fp: 0, clear: 0, min: 0, slipN: 0, slipMin: 0, earlier: [] }])) as Record<Level, Agg>)
        a[lv].hit += nHit
        a[lv].cam += cam.length
        a[lv].fp += fp.length
        a[lv].min += runMin
        a[lv].clear += clear.length
        a[lv].slipN += inSlipCues.length
        a[lv].slipMin += slipMin
        a[lv].earlier.push(...early)
        agg.set(key(c), a)
      }
      p()
      // 関係：中級の線（どのレベルでも hunchOf の値は同じ。基準は同じ作り方）で1回だけ
      if (lv === 'advanced') {
        const xs: number[] = []
        const ys: number[] = []
        for (const s of o.samples) {
          if (s.s.hunch === undefined || s.s.paused || s.t > dataEnd) continue
          const ds = base.ticks.filter((x) => x.t > s.t - 1 && x.t <= s.t).map(delta).filter((d): d is number => d !== null)
          if (ds.length < 5) continue
          xs.push(s.s.hunch)
          ys.push(mean(ds))
        }
        // 6秒平均どうし（カメラの判定と同じ長さ）
        const x6: number[] = []
        const y6: number[] = []
        for (let i = 5; i < xs.length; i++) {
          x6.push(mean(xs.slice(i - 5, i + 1)))
          y6.push(mean(ys.slice(i - 5, i + 1)))
        }
        const f = fit(xs, ys)
        const g = fit(x6, y6)
        rel.x.push(...x6)
        rel.y.push(...y6)
        const bins = [-Infinity, 0, 1, 2, 3, 4, Infinity]
        const binText = bins.slice(0, -1).map((lo, i) => {
          const hi = bins[i + 1]
          const ys2 = y6.filter((_, k) => x6[k] > lo && x6[k] <= hi).sort((a, b) => a - b)
          const q = (pp: number) => ys2[Math.min(ys2.length - 1, Math.floor(ys2.length * pp))]
          return `| ${lo === -Infinity ? `≤ ${hi}` : hi === Infinity ? `> ${lo}` : `${lo}〜${hi}`}° | ${ys2.length} | +${f1(q(0.5))}° | +${f1(q(0.1))}〜+${f1(q(0.9))}° |`
        })
        p(`カメラの猫背の値（hunchOf、今日の基準から）と胸の増えの関係（1秒ごと ${f.n}組：相関 ${f.r.toFixed(2)}・胸 = ${f1(f.a)} + ${f.b.toFixed(2)} × カメラ。6秒平均どうし：相関 ${g.r.toFixed(2)}・胸 = ${f1(g.a)} + ${g.b.toFixed(2)} × カメラ）`)
        p()
        p('| カメラの猫背（6秒平均） | 秒数 | 胸の増え（6秒平均）の真ん中 | 下から1割〜上から1割 |')
        p('|---|---|---|---|')
        p(binText.join('\n'))
        p()
      }
      // 11-03 のわざとの猫背の区間：胸が最初に震えた秒
      if (R.drill) {
        const [a, b] = R.drill
        const cells = cands.map((c) => {
          const u = o.chest.get(key(c))!.cues.find((t) => t >= a && t < b)
          return `+${c.margin}°/${c.hold}秒 ${u === undefined ? '×' : `${f1(u - a)}秒`}`
        })
        p(`わざとの猫背（${f1(a)}〜${f1(b)}秒）に胸が最初に震えたのは、指示から：${cells.join('・')}`)
        p()
      }
    }
    if (live.length) {
      p(`### 走ったときの声（上級）：カメラの猫背の声 ${live.map(f1).join('・')} 秒。胸が震えたのは ${liveBuzz.map(f1).join('・')} 秒（胸の値は ${f1(dataEnd)} 秒まで）`)
      p()
      const inData = live.filter((t) => t <= dataEnd)
      const base = adv!.chest.get(key(HUNCH))!
      p('| 走ったときのカメラの声（秒） | その前6秒の胸の増え（平均） | 1.5秒続いた胸の増えの最大 | 基準 |')
      p('|---|---|---|---|')
      for (const t of inData) {
        const a = around(base.ticks, t, 1.5)
        p(`| ${f1(t)} | +${f1(a.six)}° | +${f1(a.sustained)}° | ${f1(a.ref ?? NaN)}° |`)
      }
      p()
      p('胸の線ごとに、走ったときのカメラの声に合ったか：' + cands.map((c) => {
        const cs = adv!.chest.get(key(c))!.cues
        return `+${c.margin}°/${c.hold}秒 ${inData.filter((t) => cs.some((u) => u >= t - BEFORE && u <= t + AFTER)).length}/${inData.length}`
      }).join('・'))
    }
    p()
  }
  p('## まとめ（記録の合計）')
  p()
  p('外れ・ずれの間の震えは10分あたり。カッコ内は、外れのうちカメラの猫背の値が1°未満だったもの（はっきり外れ）')
  p()
  p('| 胸の線（margin / hold） | ' + LEVELS.map((l) => `${LEVEL_LABEL[l]}のカメラに合った | 外れ`).join(' | ') + ' | ずれの間の震え |')
  p('|---|' + LEVELS.map(() => '---|---').join('|') + '|---|')
  const r10 = (n: number, m: number) => f1((n / Math.max(m, 1e-9)) * 10)
  for (const c of cands) {
    const a = agg.get(key(c))!
    p(`| +${c.margin}° / ${c.hold}秒${c.slipDrift !== Math.max(8, c.margin) ? `（slipDrift ${c.slipDrift}）` : ''} | ` + LEVELS.map((l) => `${a[l].hit} / ${a[l].cam} | ${r10(a[l].fp, a[l].min)}（${r10(a[l].clear, a[l].min)}）`).join(' | ') + ` | ${r10(a.advanced.slipN, a.advanced.slipMin)} |`)
  }
  p()
  const g = fit(rel.x, rel.y)
  p(`カメラの猫背（6秒平均）と胸の増え（6秒平均）は、記録をあわせて 相関 ${g.r.toFixed(2)}・胸 = ${f1(g.a)} + ${g.b.toFixed(2)} × カメラ（${g.n}組）。`)
  p()
  p(`選んだ線（src/modes/sensor/params.ts の HUNCH_BY_LEVEL、hold はどれも 1.5秒）：${LEVELS.map((l) => `${LEVEL_LABEL[l]} +${HUNCH_BY_LEVEL[l].margin}°`).join('・')}。`)
  p('読み方（記録を見て確かめたこと）：')
  p('- 11-04 の記録は、センサーの値が記録の上限（約35分）で 2453秒に止まっている。走ったときのカメラの猫背の声 6回のうち、あとの3回（2610・3374・3602秒）は胸の値がなく比べられない')
  p('- 11-04 の 1278.5秒の声は、胸の増えが 1.5秒続いて +3° ほどしかなく、+3° / 1秒 まで下げないと合わない（外れが10分に 5.8回、ずれの間は 34回）')
  p('- 11-04 に走ったときに胸が大きく震えた 1331・1618・2093秒（傾き 77〜87°）は、胸も頭も数秒だけ大きく前に倒れたところ（何をしたかは記録からは分からない）。通し直しでは、その数秒を走っていないとみて震えない')
  p('- 11-03 は 715秒から胸のセンサーがずれ、11-02 20:23 は走り出しからずれ続けた。この間の震えは「外れ」に入れず「ずれの間の震え」に分けた。線を下げると、ずれて線を越えたままの間に鳴る回数が増える')
  P.applyStrictness(P.DEFAULT_STRICT)
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
})
