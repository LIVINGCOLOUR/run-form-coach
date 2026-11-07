// 仮想実験（足首のセンサーの接地時間・左右差。src/modes/sensor/contact.ts・contactCoach.ts）
//   ① 見つけ方の当たり方：RBDS（Fukuchi 2017、トレッドミル、秒速2.5・3.5・4.5m、床反力 300Hz）の膝と足首の印から、すねの角速度（前後の面・左右の面）を作り、
//     付け方（センサーの向き）を乱数で回し、ジャイロの雑音を足して、アプリの StepDetector に 100Hz・50Hz で流す。
//     見つけた着地・離地を、床反力の接地（上下の力 > 50N）と1歩ずつ比べる（本当の答えがあるのはここだけ）。
//     印から作った角速度なので、皮膚の揺れ・着地の衝撃の揺れ・ベルトでのずれは入らない（実機ではもっとぶれる）。ずらす量（着地 +26ms・離地 −90ms）と速さの当てはめは
//     同じ RBDS から決めたので、人を半分に分けた（番号の奇数・偶数）結果も出す
//   ② 線：RBDS の床反力の接地の割合（本当の値）を、線（CONTACT.norm・z）にあてて、越えた人がいるか
//   ③ 自分の記録（RFC_RUNS_DIR の rfc-*.json のうち、足首の値があるもの）をアプリの ContactCoach に通し、知らせた回数（10分あたり）と、
//     足ごとの接地時間・左右差の散らばりを出す（どの走りも、わざと腰を落とした区間はないので、知らせはすべて「ふつうの走りでの知らせ」）。
//     走っているかは、カメラの行のいちばん近い前の行（scripts/replay-sensor.mjs と同じ。20秒までの行のない間は前の行のまま）
//   ④ 作りものの走りで、接地を長くしてから知らせるまで・戻してからほめるまでの秒
// 動かし方：RBDS_DIR=… [RFC_RUNS_DIR=…] npx vitest run --config sim/vitest.config.ts sim/contact.sim.ts（結果は sim/result-contact.md）
import { it } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadRbdsLanding } from './landing-data'
import { rng } from './camera'
import { StepDetector, dfNorm, type Step } from '../src/modes/sensor/contact'
import { ContactCoach } from '../src/modes/sensor/contactCoach'
import { CONTACT, STEP } from '../src/modes/sensor/params'
import { decodeBlock } from '../src/modes/sensor/log'
import type { Vec3 } from '../src/modes/sensor/parse'
// @ts-expect-error 型のない .mjs
import { cameraRows, decodeNodes } from '../scripts/sensor-camera.mjs'

const RBDS = process.env.RBDS_DIR
const RUNS = process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs')
const OUT = process.env.SIM_OUT ?? 'sim/result-contact.md'
const DEG = 180 / Math.PI
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const sd = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const q = (a: number[], p: number) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const med = (a: number[]) => q(a, 0.5)
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '-')
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '-')
const lines: string[] = []
const say = (s = '') => lines.push(s)

// 乱数の回転（付け方の向き）
function randomRot(r: () => number): number[][] {
  const u = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]
  const n = Math.hypot(...u)
  const k = u.map((x) => x / n)
  const a = r() * Math.PI * 2
  const c = Math.cos(a)
  const s = Math.sin(a)
  const [x, y, z] = k
  return [
    [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
    [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
    [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
  ]
}
const mul = (R: number[][], v: number[]): Vec3 => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]) as Vec3

interface Hit {
  subj: number
  speed: string
  side: 'R' | 'L'
  dIc: number // 見つけた − 床反力（ms）
  dTo: number
  dCt: number
  dDf: number
  ct: number // 本当の接地時間（ms）
}

function rbdsPart() {
  if (!RBDS) return say('（RBDS_DIR がないので ① ② は飛ばした）')
  const ids = [...new Set(readdirSync(RBDS).filter((f) => /runT\d\dforces/.test(f)).map((f) => f.slice(0, 7)))].sort()
  const r = rng(20261104).u
  const hits: Record<number, Hit[]> = { 100: [], 50: [] }
  const trials: { subj: number; speed: string; hz: number; ctL: number; ctR: number; estL: number; estR: number; v: number; vTrue: number; dfTrue: number; missed: number; total: number }[] = []
  const trueDf: { speed: string; df: number }[] = []
  for (const speed of ['25', '35', '45'])
    for (const id of ids) {
      let tr
      try {
        tr = loadRbdsLanding(RBDS, id, speed)
      } catch {
        continue
      }
      const subj = Number(id.slice(4))
      const J = tr.joints
      const fps = tr.fps
      const all = tr.contacts.slice().sort((a, b) => a.on - b.on)
      const strideOf = (side: 'R' | 'L') => {
        const cs = all.filter((c) => c.side === side)
        const xs: number[] = []
        for (let k = 0; k + 1 < cs.length; k++) xs.push(cs[k + 1].on - cs[k].on)
        return xs
      }
      const ctOf = (side: 'R' | 'L') => all.filter((c) => c.side === side).map((c) => c.off - c.on)
      trueDf.push({ speed, df: (med([...ctOf('R'), ...ctOf('L')]) / med([...strideOf('R'), ...strideOf('L')])) })
      for (const hz of [100, 50]) {
        const est: Record<'R' | 'L', Step[]> = { R: [], L: [] }
        let missed = 0
        let total = 0
        for (const side of ['R', 'L'] as const) {
          const K = J[side === 'R' ? 'kneeR' : 'kneeL']!
          const A = J[side === 'R' ? 'ankleR' : 'ankleL']!
          // すねの角度：前後の面（足首が膝より前で正）。左右の面は印の取り違えで値が跳ねる（数千 dps）ので印からは作らず、
          // 前後の面の 15% を 0.1秒ずらして足した、作りものの横の回転にする
          const sag = K.map((k, i) => Math.atan2(A[i][0] - k[0], k[1] - A[i][1]))
          const n = Math.floor(((K.length - 1) / fps) * hz)
          const at = (xs: number[], t: number) => {
            const x = t * fps
            const i = Math.min(xs.length - 2, Math.floor(x))
            return xs[i] + (xs[i + 1] - xs[i]) * (x - i)
          }
          const R = randomRot(r)
          const d = new StepDetector(STEP)
          d.running = true
          const dt = 1 / hz
          // 記録が30秒と短いので、軸を決める間（10秒）も1歩を逃さないよう、同じ記録を2回流し、2回目の1歩だけ使う
          const steps: Step[] = []
          for (const pass of [0, 1])
            for (let j = 1; j < n - 1; j++) {
              const t = j / hz
              const ws = ((at(sag, t + dt) - at(sag, t - dt)) / (2 * dt)) * DEG
              const tf = Math.max(dt, t - 0.1)
              const wf = 0.15 * ((at(sag, tf + dt) - at(sag, tf - dt)) / (2 * dt)) * DEG
              // 体の向き：x = 前後の軸まわり（左右の面）、z = 左右の軸まわり（前後の面）。雑音は LSM6DSV16X より大きめの ±5 dps
              const g = mul(R, [wf + (r() - 0.5) * 10, (r() - 0.5) * 10, ws + (r() - 0.5) * 10])
              d.sample(pass * 1000 + t, g, mul(R, [0, 1, 0]))
              if (pass) steps.push(...d.steps())
              else d.steps()
            }
          const cs = tr.contacts.filter((c) => c.side === side)
          for (const s of steps) {
            const ic = s.ic - 1000
            const to = s.to - 1000
            const c = cs.find((x) => Math.abs(x.on - ic) < 0.1)
            const nx = c && cs.find((x) => x.on > c.on + 0.3)
            if (!c || !nx) continue
            const st = nx.on - c.on
            hits[hz].push({ subj, speed, side, dIc: (ic - c.on) * 1000, dTo: (to - c.off) * 1000, dCt: (s.ct - (c.off - c.on)) * 1000, dDf: s.df - (c.off - c.on) / st, ct: (c.off - c.on) * 1000 })
            est[side].push(s)
          }
          // 取りこぼし：2回目に流した間の、床反力の接地（最初と最後の1歩は前後がないので除く）のうち、見つけた1歩に当たらなかったもの
          const inner = cs.slice(1, -1)
          total += inner.length
          missed += inner.filter((c) => !steps.some((s) => Math.abs(s.ic - 1000 - c.on) < 0.1)).length
        }
        trials.push({
          subj, speed, hz,
          ctL: med(ctOf('L')) * 1000, ctR: med(ctOf('R')) * 1000,
          estL: med(est.L.map((s) => s.ct)) * 1000, estR: med(est.R.map((s) => s.ct)) * 1000,
          v: med([...est.L, ...est.R].map((s) => s.v)), vTrue: (Number(speed) / 10) * 3.6,
          dfTrue: trueDf[trueDf.length - 1].df, missed, total,
        })
      }
    }

  say('## ① 着地・離地の見つけ方の当たり方（RBDS、床反力の接地と1歩ずつ）')
  say()
  say('すねの角速度は印から作ったもの（皮膚の揺れ・衝撃の揺れなし）。付け方の向きは記録ごとに乱数、横の回転（前後の面の15%、0.1秒遅れ）と雑音 ±5 dps を足した。ずらす量と速さの当てはめは同じ RBDS から決めた（半分ずつの結果も出す）。')
  say()
  say('| 間隔 | 速さ | 人 | 1歩 | 取りこぼし | 着地のずれ 平均 ± ばらつき（ms） | 離地のずれ | 接地時間のずれ | 上から5%の大きさ | 接地の割合のずれ |')
  say('|---|---|---|---|---|---|---|---|---|---|')
  for (const hz of [100, 50])
    for (const sp of ['25', '35', '45']) {
      const h = hits[hz].filter((x) => x.speed === sp)
      const tt = trials.filter((x) => x.hz === hz && x.speed === sp)
      const miss = tt.reduce((a, x) => a + x.missed, 0) / Math.max(1, tt.reduce((a, x) => a + x.total, 0))
      say(`| ${hz}Hz | 秒速${Number(sp) / 10}m | ${tt.length} | ${h.length} | ${(miss * 100).toFixed(1)}% | ${f1(mean(h.map((x) => x.dIc)))} ± ${f1(sd(h.map((x) => x.dIc)))} | ${f1(mean(h.map((x) => x.dTo)))} ± ${f1(sd(h.map((x) => x.dTo)))} | ${f1(mean(h.map((x) => x.dCt)))} ± ${f1(sd(h.map((x) => x.dCt)))} | ${f0(q(h.map((x) => Math.abs(x.dCt)), 0.95))} | ${f3(mean(h.map((x) => x.dDf)))} ± ${f3(sd(h.map((x) => x.dDf)))} |`)
    }
  say()
  for (const half of ['奇数', '偶数']) {
    const h = hits[100].filter((x) => (x.subj % 2 === 1) === (half === '奇数'))
    say(`- 100Hz、番号が${half}の人だけ：接地時間のずれ ${f1(mean(h.map((x) => x.dCt)))} ± ${f1(sd(h.map((x) => x.dCt)))} ms（${h.length}歩）`)
  }
  // 人・足ごとのずれ（1本の真ん中の値）：これが「その人の接地時間がどれだけ高め・低めに出るか」
  const per = trials.filter((x) => x.hz === 100)
  const legErr = per.flatMap((x) => [x.estL - x.ctL, x.estR - x.ctR]).filter(Number.isFinite)
  const dfErr = per.map((x) => {
    const est = (x.estL + x.estR) / 2
    const tru = (x.ctL + x.ctR) / 2
    return ((est - tru) / tru) * x.dfTrue
  })
  say(`- 人・足ごとの真ん中の値のずれ（100Hz）：接地時間 ${f1(mean(legErr))} ± ${f1(sd(legErr))} ms（上から5% ${f0(q(legErr.map(Math.abs), 0.95))} ms）。接地の割合にすると ± ${f3(sd(dfErr))}`)
  const si = (l: number, r: number) => (Math.abs(r - l) / ((l + r) / 2)) * 100
  const siT = per.map((x) => si(x.ctL, x.ctR))
  const siE = per.map((x) => si(x.estL, x.estR))
  say(`- 接地時間の左右差（1本の真ん中の値、|右 − 左| ÷ 平均）：床反力 中央 ${f1(med(siT))}%・上から1割 ${f1(q(siT, 0.9))}%・いちばん大きい ${f1(Math.max(...siT))}%。見つけた値 中央 ${f1(med(siE))}%・上から1割 ${f1(q(siE, 0.9))}%・いちばん大きい ${f1(Math.max(...siE.filter(Number.isFinite)))}%（線 ${CONTACT.si}%）`)
  const vErr = per.map((x) => x.v - x.vTrue)
  say(`- 速さの見積もり（すねの振れ幅 ÷ 1歩きの時間）：ベルトとの差 ${f1(mean(vErr))} ± ${f1(sd(vErr))} km/h（いちばん大きい ${f1(Math.max(...vErr.map(Math.abs)))}）。` +
    `アプリの式の既定は RBDS の当てはめ（speedA ${STEP.speedA}。params.ts）で、ベルトの速さを入れた走りで人ごとに合わせる（speedFit.ts。この仮想実験と ③ の自分の記録は、合わせる前の既定の式で通している。` +
    `自分の記録を時速9.0km の 11-05 で合わせると speedA 約 +0.11 で、③ の速さの見積もりは約 +1 km/h 高くなる。知らせの回数は変わらない：接地の割合の線は時速9km より遅いと端の値）`)
  say()

  say('## ② 線：いつも走っている人の接地の割合（RBDS の床反力の本当の値。10km をキロ5分より速く走る人）')
  say()
  say(`線 = その速さの平均 + ${CONTACT.z} × 標準偏差（Patoz ら 2022、115人：時速9km 37.7 ± 3.1%、11km 34.7 ± 2.5%、13km 32.6 ± 2.2%。表の外は端の値）`)
  say()
  say('| 速さ | 人 | 接地の割合 中央 | 上から1割 | いちばん大きい | 線 | 線を越えた人 | いちばん大きい人の z |')
  say('|---|---|---|---|---|---|---|---|')
  for (const sp of ['25', '35', '45']) {
    const xs = trueDf.filter((x) => x.speed === sp).map((x) => x.df)
    const v = (Number(sp) / 10) * 3.6
    const n = dfNorm(v)
    const line = n.mean + CONTACT.z * n.sd
    say(`| 秒速${Number(sp) / 10}m（${f1(v)}km） | ${xs.length} | ${f3(med(xs))} | ${f3(q(xs, 0.9))} | ${f3(Math.max(...xs))} | ${f3(line)} | ${xs.filter((x) => x > line).length} | ${f1((Math.max(...xs) - n.mean) / n.sd)} |`)
  }
  say()
}

// ---- ③ 自分の記録 ----
function runsPart() {
  say('## ③ 自分の記録（アプリの ContactCoach に通した。わざと腰を落とした区間はない）')
  say()
  if (!existsSync(RUNS)) return say('（RFC_RUNS_DIR がないので飛ばした）')
  const files = readdirSync(RUNS).filter((f) => /^rfc-\d{8}-\d{4}_log-.*\.json$/.test(f)).sort()
  say('| 記録 | 走った（足首の値あり） | 判定した | 腰の知らせ | 左右差の知らせ | 10分あたり | 接地時間 左 / 右（ms） | 接地の割合 | z 上から1% | 左右差 下1割 / 中央 / 上1割（%、右が長いと正） | 付け方の違いで左右差を見なかった | 衝撃の左右差 中央（%） | 速さの見積もり | ピッチ |')
  say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  let allMin = 0
  let allCues = 0
  const notes: string[] = []
  for (const f of files) {
    const log = JSON.parse(readFileSync(join(RUNS, f), 'utf8')).log
    if (!log?.sensors) continue
    const nodes = decodeNodes(log.sensors, decodeBlock) as { place: string; samples: { tt: number; g: Vec3; a: Vec3 }[] }[]
    const Ls = nodes.find((x) => x.place === '左足首')?.samples ?? []
    const Rs = nodes.find((x) => x.place === '右足首')?.samples ?? []
    if (Ls.length < 1000 || Rs.length < 1000) continue
    const rows = cameraRows(log) as { t: number; phase: string; moving: boolean }[]
    const rt = rows.map((x) => x.t)
    const running = (t: number) => {
      let lo = 0
      let hi = rt.length - 1
      if (hi < 0 || t < rt[0]) return false
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (rt[m] <= t) lo = m
        else hi = m - 1
      }
      const x = rows[lo]
      return x.phase === 'run' && x.moving && t - x.t < 20
    }
    const co = new ContactCoach()
    let i = 0
    let j = 0
    let runSec = 0
    let judged = 0
    const cues: { item: string; t: number; value?: number }[] = []
    const vals: NonNullable<ContactCoach['last']>[] = []
    const end = Math.min(Ls[Ls.length - 1].tt, Rs[Rs.length - 1].tt)
    for (let t = Math.max(Ls[0].tt, Rs[0].tt); t < end; t += 0.1) {
      for (; i < Ls.length && Ls[i].tt <= t; i++) co.sample('L', Ls[i].tt, Ls[i].tt, Ls[i].g, Ls[i].a)
      for (; j < Rs.length && Rs[j].tt <= t; j++) co.sample('R', Rs[j].tt, Rs[j].tt, Rs[j].g, Rs[j].a)
      const run = running(t)
      if (run) runSec += 0.1
      for (const c of co.tick(t, run)) if (c.kind === 'cue') cues.push({ ...c, t })
      if (co.last?.steady) {
        judged += 0.1
        vals.push(co.last)
      }
    }
    const sit = cues.filter((c) => c.item === 'sit').length
    const asym = cues.length - sit
    allMin += judged / 60
    allCues += cues.length
    const si = vals.map((v) => v.ctSi)
    const name = f.slice(4, 17)
    if (cues.length) notes.push(`${name}：` + cues.map((c) => `${f0(c.t)}秒 ${c.item}（${f1(c.value ?? NaN)}）`).join('、'))
    say(`| ${name} | ${f1(runSec / 60)}分 | ${f1(judged / 60)}分 | ${sit} | ${asym} | ${judged > 0 ? f1(cues.length / (judged / 600)) : '-'} | ${f0(med(vals.map((v) => v.ctL)) * 1000)} / ${f0(med(vals.map((v) => v.ctR)) * 1000)} | ${f3(med(vals.map((v) => v.df)))} | ${f1(q(vals.map((v) => v.z), 0.99))} | ${f1(q(si, 0.1))} / ${f1(q(si, 0.5))} / ${f1(q(si, 0.9))} | ${f0((vals.filter((v) => v.mountDiff).length / Math.max(1, vals.length)) * 100)}% | ${f0(med(vals.map((v) => v.impSi)))} | ${f1(med(vals.map((v) => v.v)))} | ${f0(med(vals.map((v) => v.cad)))} |`)
  }
  say()
  for (const n of notes) say(`- 知らせた時刻（記録の時計）と値：${n}`)
  say()
  say(`あわせて、判定した ${f1(allMin)} 分で ${allCues} 回（10分あたり ${allMin > 0 ? f1(allCues / (allMin / 10)) : '-'} 回）。`)
  say()
}

// ---- ④ 作りものの走りで、知らせるまで・ほめるまで ----
function synthPart() {
  say('## ④ 作りものの走り：接地を長くしてから知らせるまで、戻してからほめるまで')
  say()
  const T = 0.72
  const shank = (u: number, ct: number, peak: number) => {
    const z2 = ct + STEP.toLead + 0.11
    const zc = T - STEP.icDelay
    const k: [number, number][] = [[0, -150], [0.06, -300], [ct * 0.6, -30], [ct + STEP.toLead, -250], [z2, 0], [(z2 + zc) / 2, peak], [zc, 0], [T, -150]]
    for (let n = 0; n + 1 < k.length; n++) if (u >= k[n][0] && u <= k[n + 1][0]) return k[n][1] + ((k[n + 1][1] - k[n][1]) * (u - k[n][0])) / (k[n + 1][0] - k[n][0])
    return -150
  }
  say('崩しは120秒から。知らせてから10秒で直す（知らせる → 直す → ほめる、の流れ）。知らせがなければ60秒で戻す')
  say()
  say('| 崩し | 接地の割合 | 知らせるまで（秒） | 知らせた場所 | 直してからほめるまで（秒） |')
  say('|---|---|---|---|---|')
  for (const [label, ctL, ctR] of [
    ['両足の接地 270 → 335ms', 0.335, 0.335],
    ['両足の接地 270 → 320ms', 0.32, 0.32],
    ['両足の接地 270 → 305ms', 0.305, 0.305],
    ['右足だけ 270 → 320ms', 0.27, 0.32],
  ] as const) {
    const co = new ContactCoach()
    let first = NaN
    let where = ''
    let praise = NaN
    let fixAt = 180
    for (let i = 0; i < 260 * 100; i++) {
      const t = i / 100
      const bad = t > 120 && t < fixAt
      for (const [side, ct, ph] of [['L', bad ? ctL : 0.27, 0], ['R', bad ? ctR : 0.27, T / 2]] as const) co.sample(side, t, t, [0, 0, shank((t + ph) % T, ct, 450)], [0, 1, 0])
      if (i % 10) continue
      for (const c of co.tick(t, true)) {
        if (c.kind === 'cue' && Number.isNaN(first)) {
          first = t - 120
          where = c.places.join('・')
          fixAt = Math.min(fixAt, t + 10)
        }
        if (c.kind === 'praise' && t > fixAt && Number.isNaN(praise)) praise = t - fixAt
      }
    }
    say(`| ${label} | ${f3((ctL + ctR) / 2 / T)} | ${f0(first)} | ${where || '-'} | ${f0(praise)} |`)
  }
  say()
}

it('足首の接地時間・左右差', () => {
  say('# 足首のセンサーの接地時間・左右差（仮想実験 sim/contact.sim.ts）')
  say()
  rbdsPart()
  runsPart()
  synthPart()
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
})
