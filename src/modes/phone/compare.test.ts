import { describe, expect, it } from 'vitest'
import type { RunLog } from '../../core/types'
import { LOG_COLUMNS, LOG_POINTS } from '../camera/log'
import { L } from '../camera/landmarks'
import { burstsCsv, chartSvg, compare, report, TEST1 } from './compare'
import { PhoneRun } from './session'
import { rng, simulateRun, simulateStanding, type MountSim } from './simulate'
import type { PhoneMeasure, Vec3 } from './signal'

// 比べる道具を、模擬データで作った2つの書き出しで確かめる。
// 実機テスト①の手順（docs/phone-test1.md）を短くした走りを、同じ「本当の時間」でスマホとカメラの両方に作り、
// カメラの時計だけをわざと 7.3 秒ずらしておく。道具がそのずれを見つけ、区間を当てはめ、ピッチ・向き・付け方を比べられるか

const EPOCH = 1_760_000_000_000 // スマホの時計で、本当の時間 0 秒のふつうの時刻
const CAM_SKEW = 7.3 // カメラの時計の進み（秒）

interface Part {
  kind: 'stand' | 'jump' | 'run'
  sec: number
  cadence?: number
  bounceCm?: number
  brakingMs?: number
  reach?: number // カメラ：着地で足首が腰より前に出る量（脚の長さに対する割合）
  mount?: MountSim
}
const NORMAL = { cadence: 172, bounceCm: 8, brakingMs: 0.3, reach: 0.3 }
const runOf = (sec: number, o: Partial<Part> = {}): Part => ({ kind: 'run', sec, ...NORMAL, ...o })
const rest: Part = { kind: 'stand', sec: 12 }
// 手順書の順。長さだけ短くしている（付け方の確認は 20 秒走ると決まる）
const PLAN: Part[] = [
  { kind: 'stand', sec: 6 },
  { kind: 'jump', sec: 5 },
  { kind: 'stand', sec: 6 },
  runOf(90),
  rest,
  runOf(70, { cadence: 155, bounceCm: 10, brakingMs: 0.4, reach: 0.38 }),
  rest,
  runOf(60),
  rest,
  runOf(70, { bounceCm: 12 }),
  rest,
  runOf(60),
  rest,
  runOf(40, { mount: { kind: 'loose', tiltDeg: 8, accMs: 3 } }),
  rest,
  runOf(40, { mount: { kind: 'arm' } }),
  rest,
  runOf(40, { mount: { kind: 'pocket' } }),
  rest,
  runOf(60),
  { kind: 'stand', sec: 6 },
]

const O: Vec3 = [90, 0, 0]
const REAL = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20, orientation: O }

// スマホの模擬：本当の時間で並べた値
function phoneMeasures(): PhoneMeasure[] {
  const out: PhoneMeasure[] = []
  let t0 = 0
  PLAN.forEach((p, i) => {
    if (p.kind === 'stand') out.push(...simulateStanding({ seconds: p.sec, orientation: O, noise: 0.05, t0, seed: i }))
    else if (p.kind === 'jump') {
      // その場で3回ジャンプ：沈んで押す（1.6g）→ 宙（0g）→ 着地（2.5g）
      for (const m of simulateStanding({ seconds: p.sec, orientation: O, noise: 0.05, t0, seed: i })) {
        const u = (m.t - t0) % 1.5
        const k = u < 0.25 ? 1.6 : u < 0.6 ? 0 : u < 0.75 ? 2.5 : 1
        out.push({ ...m, ax: m.ax * k, ay: m.ay * k, az: m.az * k })
      }
    } else out.push(...simulateRun({ ...REAL, cadence: p.cadence!, bounceCm: p.bounceCm!, brakingMs: p.brakingMs!, seconds: p.sec, mount: p.mount, seed: 100 + i, t0 }))
    t0 += p.sec
  })
  return out
}

function phoneFile() {
  const base = 500 // performance.now() の秒
  const run = new PhoneRun({ perfMs: base * 1000, epochMs: EPOCH }, { userAgent: 'test', intervalMs: 16.7 })
  for (const m of phoneMeasures()) run.feed({ ...m, t: base + m.t })
  const { session, log } = run.finish()
  return JSON.parse(JSON.stringify({ log, session }))
}

// カメラの模擬：横から撮った骨格（ピクセル、下が正）。脚の長さ 300px（0.9m とみなす）。毎秒15コマ。
// 走り出して10秒までは毎コマ、そのあとは 10 秒に 3 秒だけ骨格を取る（カメラ版の省電力と同じ）
function cameraFile(clock: boolean) {
  const PX = 300 / 0.9
  const g = rng(42)
  const perf0 = 2000 // カメラの performance.now() の秒（記録を始めた瞬間）
  const startTrue = -3 // 記録を始めた本当の時間
  const rows: number[][] = []
  let t0 = 0
  let runFrom: number | null = null
  for (const p of PLAN) {
    for (let k = 0; k * (1 / 15) < p.sec; k++) {
      const tt = t0 + k / 15
      if (p.kind === 'run') runFrom ??= tt
      const since = runFrom === null ? 0 : tt - runFrom
      if (since > 10 && since % 10 >= 3) continue
      let hipY = 400
      let la = 0
      let ra = 0
      let lift = 0
      if (p.kind === 'jump') {
        const u = (tt - t0) % 1.5
        hipY += u < 0.25 ? 20 : u < 0.6 ? -50 * Math.sin((Math.PI * (u - 0.25)) / 0.35) : 0
      } else if (p.kind === 'run') {
        const f = p.cadence! / 60 // 1歩の周波数
        hipY += (p.bounceCm! / 100 / 2) * PX * Math.cos(2 * Math.PI * f * tt)
        // 足首：2歩で1周、前に p.reach、後ろに 0.5 振れる。左右は半周ずれる
        const sw = (ph: number) => {
          const c = Math.cos(ph)
          return c > 0 ? c * p.reach! : c * 0.5
        }
        la = sw(Math.PI * f * tt) * 300
        ra = sw(Math.PI * f * tt + Math.PI) * 300
        lift = 30
      }
      const n = () => 1.5 * g()
      const hipX = 320
      const pt = (x: number, y: number) => [x + n(), y + n(), 0.9]
      const pts: Record<number, number[]> = {
        [L.nose]: pt(hipX + 30, hipY - 330),
        [L.leftEar]: pt(hipX, hipY - 335),
        [L.rightEar]: pt(hipX, hipY - 335),
        [L.leftShoulder]: pt(hipX, hipY - 280),
        [L.rightShoulder]: pt(hipX, hipY - 280),
        [L.leftElbow]: pt(hipX, hipY - 200),
        [L.rightElbow]: pt(hipX, hipY - 200),
        [L.leftWrist]: pt(hipX + 20, hipY - 150),
        [L.rightWrist]: pt(hipX + 20, hipY - 150),
        [L.leftHip]: pt(hipX, hipY),
        [L.rightHip]: pt(hipX, hipY),
        [L.leftKnee]: pt(hipX + la / 2, hipY + 150 - lift),
        [L.rightKnee]: pt(hipX + ra / 2, hipY + 150 - lift),
        [L.leftAnkle]: pt(hipX + la, hipY + 290),
        [L.rightAnkle]: pt(hipX + ra, hipY + 290),
        [L.leftHeel]: pt(hipX + la - 10, hipY + 295),
        [L.rightHeel]: pt(hipX + ra - 10, hipY + 295),
        [L.leftFoot]: pt(hipX + la + 20, hipY + 300),
        [L.rightFoot]: pt(hipX + ra + 20, hipY + 300),
      }
      const t = perf0 + (tt - startTrue) // カメラの performance.now() の秒
      const head = [t, 2, 1, p.kind === 'run' ? 1 : 0, 1, p.kind === 'run' ? Math.round(p.cadence!) : -1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      rows.push([...head, ...LOG_POINTS.flatMap((i) => pts[i])])
    }
    t0 += p.sec
  }
  // カメラの時計：本当の時間 startTrue の瞬間に、ふつうの時刻は EPOCH + startTrue + CAM_SKEW
  const epochMs = EPOCH + (startTrue + CAM_SKEW) * 1000
  const log: RunLog = { id: 'log-x', startedAt: epochMs, width: 640, height: 480, columns: LOG_COLUMNS, points: LOG_POINTS, phases: ['setup', 'baseline', 'run'], rows, events: [] }
  if (clock) log.clock = { perfMs: perf0 * 1000, epochMs }
  return JSON.parse(JSON.stringify({ log }))
}

describe('スマホ版とカメラ版を比べる道具', () => {
  const ph = phoneFile()
  const cam = cameraFile(true)
  const c = compare(ph, cam)

  it('ずらしたカメラの時計を見つけて合わせる', () => {
    expect(c.alignment.how).toBe('activity')
    expect(c.alignment.offset).toBeCloseTo(CAM_SKEW, 0)
    expect(Math.abs(c.alignment.offset - CAM_SKEW)).toBeLessThan(0.2)
  })

  it('立って休む間で区切って、手順書の区間を順に当てはめる', () => {
    expect(c.segments.map((s) => s.step?.key)).toEqual(TEST1.map((s) => s.key))
  })

  it('腰の区間のピッチは ±2 歩/分で合う（模擬データなので）', () => {
    for (const s of c.summary.filter((x) => x.seg.step?.waist)) {
      expect(s.cadence.n).toBeGreaterThan(0)
      expect(Math.abs(s.cadence.meanDiff!)).toBeLessThan(2)
    }
    expect(c.gates.cadence.ok).toBe(true)
    const slow = c.summary.find((s) => s.seg.step?.key === 'slow')!
    expect(slow.camCadence!).toBeCloseTo(155, -1)
  })

  it('ピッチを落とした区間で、上下動とブレーキがスマホとカメラで同じ向きに動く', () => {
    const slow = c.summary.find((s) => s.seg.step?.key === 'slow')!
    expect(slow.bounceDir).toMatchObject({ phone: 'up', camera: 'up', same: true })
    expect(slow.brakingDir).toMatchObject({ phone: 'up', camera: 'up', same: true })
    const bouncy = c.summary.find((s) => s.seg.step?.key === 'bouncy')!
    expect(bouncy.bounceDir).toMatchObject({ phone: 'up', camera: 'up', same: true })
  })

  it('付け方の確認を区間ごとにやり直し、鳴るべき区間だけで鳴る', () => {
    const got = Object.fromEntries(c.summary.map((s) => [s.seg.step!.key, s.mount.replay]))
    expect(got).toEqual({ normal1: null, slow: null, normal2: null, bouncy: null, normal3: null, loose: 'loose', arm: 'notWaist', pocket: 'notWaist', normal4: null })
    expect(c.gates.mount.ok).toBe(true)
    // 走りの中では、最初に見つけた区間（ゆるい）でだけ鳴る
    expect(c.summary.find((s) => s.mount.live)?.seg.step?.key).toBe('loose')
  })

  it('表・図・CSV を出す', () => {
    const md = report(c)
    expect(md).toContain('関門の目安')
    expect(md).toContain('ピッチを落とす')
    expect(chartSvg(c)).toMatch(/^<svg[\s\S]*<\/svg>\n$/)
    expect(burstsCsv(c).split('\n').length).toBeGreaterThan(20)
  })

  it('カメラの記録に時計の対応がなくても（古い記録）、広く探して合わせる', () => {
    // 時計の対応がないと、最初のコマを記録の始まり（startedAt）とみなす。模擬では記録を始めて 3 秒後が最初のコマなので、
    // 見つけるずれは 3 秒小さくなる（ずれの値は、もとの大まかな位置からの直し）
    const old = compare(ph, cameraFile(false))
    expect(old.alignment.clockOffset).toBe(false)
    expect(Math.abs(old.alignment.offset - (CAM_SKEW - 3))).toBeLessThan(0.2)
    expect(old.segments.length).toBe(TEST1.length)
  })

  it('ずれを手で指定することもできる', () => {
    const m = compare(ph, cam, { offset: 7 })
    expect(m.alignment.how).toBe('manual')
    expect(m.alignment.offset).toBe(7)
  })
})
