// 仮想実験：同じ走りを、置き方を変えた仮想のスマホで映し、アプリの判定がどれだけずれるかを測る
// 動かし方：RBDS_DIR=<研究データのフォルダ> npx vitest run --config sim/vitest.config.ts sim/placement.sim.ts
// 研究データ：https://doi.org/10.6084/m9.figshare.4543435 の RBDSnnnrunT35markers.txt / forces.txt / static.txt
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { loadTrial, type Trial, type V3, type JointName } from './rbds'
import { makeCamera, toFrame, rng, type Placement, type Noise, type Body } from './camera'
import { analyzeRun, type TimedFrame } from '../src/core/slowmo'
import { MotionDetector } from '../src/core/motion'
import { levelFrame, measure, rotateFrame } from '../src/core/geometry'
import { W, H } from './camera'

const DIR = process.env.RBDS_DIR!
const SUBJECTS = Array.from({ length: 12 }, (_, i) => `RBDS${String(i + 1).padStart(3, '0')}`)
const T0 = 3 // 見る区間（秒）
const SLOW_SEC = 6
const LIVE_SEC = 25 // 記録は30秒なので、見る区間がはみ出さないように

const BASE: Placement = { yaw: 0, dist: 1.2, height: 0.8, roll: 0, vfov: 106, k1: 0 }
const BASE_NOISE: Noise = { sigma: 0.01, collapse: 0.3, swapPerSec: 0.5 }

// 一つずつ変える
const CASES: { group: string; label: string; pl: Partial<Placement>; noise?: Partial<Noise> }[] = [
  { group: '基準', label: '真横・1.2m・高さ80cm・超広角・ぶれ1%', pl: {} },
  { group: '真横からのずれ', label: '15°', pl: { yaw: 15 } },
  { group: '真横からのずれ', label: '30°', pl: { yaw: 30 } },
  { group: '真横からのずれ', label: '45°', pl: { yaw: 45 } },
  { group: '真横からのずれ', label: '−30°（後ろ側から）', pl: { yaw: -30 } },
  { group: 'スマホの高さ', label: '20cm（床置き）', pl: { height: 0.2 } },
  { group: 'スマホの高さ', label: '50cm', pl: { height: 0.5 } },
  { group: 'スマホの高さ', label: '120cm', pl: { height: 1.2 } },
  { group: 'スマホの高さ', label: '160cm（見下ろし）', pl: { height: 1.6 } },
  { group: '見下ろしの補正', label: '120cm＋補正', pl: { height: 1.2, fix: true } },
  { group: '見下ろしの補正', label: '160cm＋補正', pl: { height: 1.6, fix: true } },
  { group: '見下ろしの補正', label: '20cm（見上げ）＋補正', pl: { height: 0.2, fix: true } },
  { group: '見下ろしの補正', label: '傾き6°＋補正', pl: { roll: 6, fix: true } },
  { group: '見下ろしの補正', label: '基準＋補正', pl: { fix: true } },
  { group: '距離', label: '0.9m', pl: { dist: 0.9 } },
  { group: '距離', label: '2.0m', pl: { dist: 2.0 } },
  { group: '距離', label: '3.0m', pl: { dist: 3.0 } },
  { group: 'スマホの傾き（直さない）', label: '3°', pl: { roll: 3 } },
  { group: 'スマホの傾き（直さない）', label: '6°', pl: { roll: 6 } },
  { group: 'レンズ', label: '超広角・たる型のゆがみ', pl: { k1: -0.15 } },
  { group: 'レンズ', label: '1倍・2.0m', pl: { vfov: 67, dist: 2.0 } },
  { group: '点のぶれ', label: 'なし（0%）', pl: {}, noise: { sigma: 0, collapse: 0, swapPerSec: 0 } },
  { group: '点のぶれ', label: '0.5%', pl: {}, noise: { sigma: 0.005 } },
  { group: '点のぶれ', label: '2%', pl: {}, noise: { sigma: 0.02 } },
  { group: '点のぶれ', label: '3%・奥の脚ほぼ重なる', pl: {}, noise: { sigma: 0.03, collapse: 0.7, swapPerSec: 1 } },
  { group: '悪い条件の重なり', label: '30°・床置き・3m・ぶれ2%', pl: { yaw: 30, height: 0.2, dist: 3.0 }, noise: { sigma: 0.02 } },
]

const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
function at(trial: Trial, t: number): Body {
  const x = t * trial.fps
  const i = Math.min(trial.joints.hipR.length - 2, Math.floor(x))
  const u = x - i
  const g = (k: JointName) => lerp3(trial.joints[k][i], trial.joints[k][i + 1], u)
  return { hipR: g('hipR'), hipL: g('hipL'), kneeR: g('kneeR'), kneeL: g('kneeL'), ankleR: g('ankleR'), ankleL: g('ankleL'), heelR: g('heelR'), heelL: g('heelL'), toeR: g('toeR'), toeL: g('toeL'), pelvis: g('pelvis') }
}
const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const mean = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN
}

// 本当の値（3次元の点と床反力から）
function truth(trial: Trial, t0: number, t1: number) {
  const cs = trial.contacts.filter((c) => c.start >= t0 && c.end <= t1)
  const leg = mean(cs.map((c) => {
    const b = at(trial, c.start)
    const d = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    return d(b.hipR, b.kneeR) + d(b.kneeR, b.ankleR)
  }))
  const shank = cs.map((c) => {
    const b = at(trial, c.start)
    const right = Math.min(b.heelR[1], b.toeR[1]) <= Math.min(b.heelL[1], b.toeL[1])
    const k = right ? b.kneeR : b.kneeL
    const a = right ? b.ankleR : b.ankleL
    // 前後と上下の面で、膝→足首の線と鉛直の角度。足首が前に出るほど正
    return (Math.atan2(a[0] - k[0], k[1] - a[1]) * 180) / Math.PI
  })
  const steps = cs.slice(1).map((c, i) => c.start - cs[i].start)
  const vo = cs.slice(0, -1).map((c, i) => {
    const ys: number[] = []
    for (let t = c.start; t < cs[i + 1].start; t += 1 / 150) ys.push(at(trial, t).pelvis[1])
    return Math.max(...ys) - Math.min(...ys)
  })
  return {
    cadence: 60 / median(steps),
    contactMs: median(cs.map((c) => (c.end - c.start) * 1000)),
    shank: median(shank),
    voCm: median(vo) / 10,
    legMm: leg,
  }
}

function film(trial: Trial, pl: Placement, noise: Noise, fps: number, t0: number, sec: number, seed: number): TimedFrame[] {
  const center = at(trial, t0).pelvis
  const project = makeCamera(pl, [center[0], center[1], center[2]])
  const r = rng(seed)
  const state = { ar: [] as number[], swap: 0 }
  const out: TimedFrame[] = []
  for (let i = 0; i < sec * fps; i++) {
    const t = t0 + i / fps
    let f = toFrame(at(trial, t), project, noise, state, r, 1 / fps)
    // アプリと同じ直し方：左右の傾きを戻してから、上下の向きを戻す
    if (pl.fix) f = levelFrame(rotateFrame(f, pl.roll, W / 2, H / 2), project.pitch, pl.vfov, W, H)
    out.push({ t: i / fps, f })
  }
  return out
}

it('置き方による判定のずれ', () => {
  const trials = SUBJECTS.flatMap((s) => {
    try {
      return [loadTrial(DIR, s)]
    } catch (e) {
      console.log(`使えない：${(e as Error).message}`)
      return []
    }
  })
  console.log(`使う人数：${trials.length}`)
  const rows: string[] = []
  const raw: unknown[] = []
  for (const c of CASES) {
    const pl = { ...BASE, ...c.pl }
    const noise = { ...BASE_NOISE, ...c.noise }
    const err = { cadence: [] as number[], contact: [] as number[], shank: [] as number[], vo: [] as number[] }
    let noContact = 0
    let failed = 0
    const live = { moving: [] as number[], cadence: [] as number[], hipWander: [] as number[] }
    trials.forEach((trial, k) => {
      const tr = truth(trial, T0, T0 + SLOW_SEC)
      // 走ったあとのスロー分析（240fps）
      const rep = analyzeRun(film(trial, pl, noise, 240, T0, SLOW_SEC, 100 + k))
      if (!rep) failed++
      else {
        err.cadence.push(rep.cadence - tr.cadence)
        err.shank.push(rep.shankAtContact - tr.shank)
        err.vo.push((rep.verticalLeg * tr.legMm) / 10 - tr.voCm)
        if (rep.contactMs === null) noContact++
        else err.contact.push(rep.contactMs - tr.contactMs)
      }
      // 走りながらの判定（毎秒15コマ）
      const fr = film(trial, pl, noise, 15, T0, LIVE_SEC, 200 + k)
      const md = new MotionDetector()
      let mv = 0
      const cad: number[] = []
      const hip: { t: number; v: number }[] = []
      for (const { t, f } of fr) {
        if (md.update(f, t)) mv++
        if (md.cadence) cad.push(md.cadence)
        hip.push({ t, v: measure(f).hipRatio })
      }
      live.moving.push(mv / fr.length)
      live.cadence.push(median(cad) - truth(trial, T0, T0 + LIVE_SEC).cadence)
      // 腰の高さ：最初の10秒の平均を基準に、6秒平均がどれだけ下がって見えるか（実際は崩れていないので、全部見かけのずれ）
      const ref = mean(hip.filter((h) => h.t < 10).map((h) => h.v))
      let worst = 0
      for (let s = 10; s + 6 <= LIVE_SEC; s++) {
        const w = mean(hip.filter((h) => h.t >= s && h.t < s + 6).map((h) => h.v))
        worst = Math.max(worst, ((ref - w) / ref) * 100)
      }
      live.hipWander.push(worst)
    })
    const fmt = (xs: number[], d = 1) => (xs.length ? `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(d)}（±${mean(xs.map(Math.abs)).toFixed(d)}）` : '—')
    rows.push(
      `| ${c.group} | ${c.label} | ${fmt(err.cadence)} | ${fmt(err.contact, 0)}${noContact ? `／測れず${noContact}` : ''} | ${fmt(err.shank)} | ${fmt(err.vo)} | ${Math.round(mean(live.moving) * 100)}% | ${fmt(live.cadence)} | ${Math.max(...live.hipWander).toFixed(1)}% | ${failed ? failed : ''} |`,
    )
    raw.push({ case: c, err, noContact, failed, live })
  }
  const head = `| 条件 | 置き方 | ピッチ（歩/分） | 接地時間（ms） | 着地のすね（°） | 上下動（cm） | 走っている判定 | ピッチ（毎秒15コマ） | 腰の高さの見かけの下がり（最大） | 分析できず |\n|---|---|---|---|---|---|---|---|---|---|`
  const text = `${head}\n${rows.join('\n')}`
  console.log(text)
  writeFileSync(process.env.SIM_OUT ?? 'sim/result.md', text + '\n')
  writeFileSync((process.env.SIM_OUT ?? 'sim/result.md').replace(/\.md$/, '.json'), JSON.stringify(raw))
})
