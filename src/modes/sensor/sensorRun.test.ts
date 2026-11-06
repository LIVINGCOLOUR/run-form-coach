import { afterEach, describe, expect, it } from 'vitest'
import { MotionGate, windowStats } from './gate'
import { HEAD, POSE, RUN_GATE, SLOTS, STILL } from './params'
import type { Packet, Vec3 } from './parse'
import { sensors } from './ble'
import { SensorRunner } from './runner'
import { expectedChest } from './expect'
import { WaistPhone } from './waist'
import type { MotionLike } from '../phone/sensor'
import { sensorRunCounts } from './runLog'
import { PHRASES } from '../../core/phrases'
import type { RunLog } from '../../core/types'

// カメラなしで使うとき（センサーラン・腰スマホといっしょ）の、走っているか・立っているかの見分けと、それを使って SensorSession を動かす役

const HZ = 100
// 1件ぶんの値。kind：立つ（ほぼ揺れない）・歩く（0.25g の揺れ）・走る（1g の揺れ。浮いている間と着地）
// slouch：いつもの楽な立ち方（胸が前へ 15°。止まっている）
// runOpen：前へ傾かずに走る（頭：顎を引いた b のまま走る）
type Kind = 'stand' | 'slouch' | 'walk' | 'run' | 'hunch' | 'runOpen'
const SLOUCH = 15
function imu(kind: Kind, t: number, k: number): { a: Vec3; g: Vec3 } {
  const jitter = ((k * 7919) % 13) / 13 - 0.5 // 決まった小さな揺れ（乱数を使わない）
  if (kind === 'stand') return { a: [0.002 * jitter, 0, 1 + 0.004 * jitter], g: [2 * jitter, 1, 1] }
  if (kind === 'slouch') {
    const r = (SLOUCH * Math.PI) / 180
    return { a: [Math.sin(r) + 0.002 * jitter, 0, Math.cos(r) + 0.004 * jitter], g: [2 * jitter, 1, 1] }
  }
  if (kind === 'hunch') return { a: [Math.sin((30 * Math.PI) / 180) * (1 + Math.sin(2 * Math.PI * 2.8 * t)), 0, Math.cos((30 * Math.PI) / 180) * (1 + Math.sin(2 * Math.PI * 2.8 * t))], g: [120 * Math.sin(2 * Math.PI * 2.8 * t), 30, 10] }
  const amp = kind === 'walk' ? 0.25 : 1.0
  const f = kind === 'walk' ? 1.9 : 2.8
  const m = 1 + amp * Math.sin(2 * Math.PI * f * t)
  // 走る：前へ約12°傾いた向き（胸の走る前傾）
  const lean = kind === 'run' ? (12 * Math.PI) / 180 : 0 // runOpen・walk は 0
  return { a: [Math.sin(lean) * m, 0, Math.cos(lean) * m], g: [120 * Math.sin(2 * Math.PI * f * t), 30, 10] }
}

function feedGate(g: MotionGate, place: string, kind: Kind, from: number, sec: number, onTick?: (t: number) => void) {
  const n = Math.round(sec * HZ)
  for (let k = 0; k < n; k++) {
    const t = from + k / HZ
    const v = imu(kind, t, k)
    g.sample(place, t, v.a, v.g)
    if (k % 10 === 0) onTick?.(t)
  }
  return from + sec
}

describe('走っているか・立っているかの見分け（gate.ts の MotionGate）', () => {
  it('窓のばらつき：揺れのない値は 0、1g の正弦の揺れは約 0.71', () => {
    expect(windowStats([]).n).toBe(0)
    const xs = Array.from({ length: 300 }, (_, k) => ({ t: k / 100, a: 1 + Math.sin(2 * Math.PI * 2.8 * (k / 100)), g: k % 10 }))
    expect(windowStats(xs).accStd).toBeGreaterThan(0.68)
    expect(windowStats(xs).accStd).toBeLessThan(0.74)
    expect(windowStats(xs).gyroMed).toBe(5) // 300件の真ん中（上側）
  })

  it('胸：立つ → 走る（3秒で走り出し）→ 信号で止まる（4秒で止まった）→ 歩くでは走らない', () => {
    const g = new MotionGate()
    const runs: [number, boolean][] = []
    const tick = (t: number) => runs.push([t, g.update(t)])
    let t = feedGate(g, '胸', 'stand', 0, 5, tick)
    expect(g.running).toBe(false)
    expect(g.still(t)).toBe(true)
    const runFrom = t
    t = feedGate(g, '胸', 'run', t, 20, tick)
    expect(g.running).toBe(true)
    expect(g.still(t)).toBe(false)
    const on = runs.find(([, r]) => r)![0] - runFrom
    // 窓が埋まるまで + 続けて startSec
    expect(on).toBeGreaterThanOrEqual(RUN_GATE.startSec)
    expect(on).toBeLessThan(RUN_GATE.startSec + RUN_GATE.win + 1)
    // 2秒だけ止まる（走りを続けている扱い）
    t = feedGate(g, '胸', 'stand', t, 2, tick)
    expect(g.running).toBe(true)
    t = feedGate(g, '胸', 'run', t, 5, tick)
    // 信号待ち 30秒：止まる
    const stopFrom = t
    runs.length = 0
    t = feedGate(g, '胸', 'stand', t, 30, tick)
    expect(g.running).toBe(false)
    const off = runs.find(([, r]) => !r)![0] - stopFrom
    expect(off).toBeGreaterThanOrEqual(RUN_GATE.stopSec)
    expect(off).toBeLessThan(RUN_GATE.stopSec + RUN_GATE.win + 1)
    // 歩く（給水所の前後など）：走っているとはみない
    runs.length = 0
    feedGate(g, '胸', 'walk', t, 60, tick)
    expect(runs.some(([, r]) => r)).toBe(false)
  })

  it('胸がなければ頭、頭もなければ足首で見る。値が来なければ走っていない', () => {
    const g = new MotionGate()
    expect(g.vote(1)).toBe(null)
    feedGate(g, '頭', 'run', 0, 4)
    expect(g.vote(4)).toBe(true)
    expect(g.last.place).toBe('頭')
    const a = new MotionGate()
    feedGate(a, '左足首', 'walk', 0, 4)
    expect(a.vote(4)).toBe(false)
    expect(a.last.place).toBe('左足首')
    // 胸があれば、胸で決める（頭が揺れていても）
    const b = new MotionGate()
    feedGate(b, '頭', 'run', 0, 4)
    feedGate(b, '胸', 'walk', 0, 4)
    expect(b.vote(4)).toBe(false)
    expect(b.last.place).toBe('胸')
  })

  it('立っている：胸と頭（来ているもの）がどちらも3秒じっとしていれば。頭を動かしていたら、まだ', () => {
    const g = new MotionGate()
    expect(g.still(3)).toBe(null)
    feedGate(g, '胸', 'stand', 0, 2)
    expect(g.still(2)).toBe(false) // まだ3秒たまっていない
    feedGate(g, '胸', 'stand', 2, 2)
    expect(g.still(4)).toBe(true)
    // 頭が届き始めて、揺れている
    feedGate(g, '頭', 'walk', 1, 3)
    expect(g.still(4)).toBe(false)
    feedGate(g, '胸', 'stand', 4, STILL.sec)
    feedGate(g, '頭', 'stand', 4, STILL.sec)
    expect(g.still(4 + STILL.sec)).toBe(true)
  })
})

// センサーの受け口（ble.ts の sensors）に、つながったことにして値を流す（Bluetooth なしで SensorRunner を動かす）
type Hub = { nodes: { status: string }[]; listeners: Set<(node: number, t: number, p: Packet) => void>; refresh: () => void }
const hub = sensors as unknown as Hub
const node = (place: string) => SLOTS.findIndex((s) => s.place === place)
const connect = (places: string[]) => {
  for (const p of places) hub.nodes[node(p)].status = 'connected'
  hub.refresh()
}
let seq = 0
function send(place: string, kind: Kind, from: number, sec: number, runner: SensorRunner) {
  const n = Math.round(sec * HZ)
  for (let k = 0; k < n; k += 10) {
    const t = from + k / HZ
    const samples = Array.from({ length: 10 }, (_, j) => {
      const v = imu(kind, t + j / HZ, k + j)
      return { seq: seq++ & 0xffff, t: Math.round((t + j / HZ) * 1000), g: v.g, a: v.a, raw: new Uint8Array(12) }
    })
    for (const fn of hub.listeners) fn(node(place), t + 0.09, { seq: samples[0].seq, range: 16, n: 10, samples })
    runner.tick(t + 0.09)
  }
  return from + sec
}

// cond が true になるまで（max 秒まで）0.1秒ずつ流す。2つの立ち方の段階が変わったところで、次の姿勢に変えるため
function sendUntil(place: string, kind: Kind, from: number, runner: SensorRunner, cond: () => boolean, max = 20) {
  let t = from
  while (!cond() && t - from < max) t = send(place, kind, t, 0.1, runner)
  return t
}

describe('センサーだけで動かす（runner.ts の SensorRunner。センサーラン・腰スマホといっしょ）', () => {
  afterEach(() => {
    for (const n of hub.nodes) if (n.status === 'connected') n.status = 'idle'
    hub.refresh()
  })

  it('2つの立ち方の案内 → じっとした3秒ずつで測る → 走り出す → 猫背で知らせる → 信号で止まる', () => {
    connect(['胸'])
    const events: [number, string][] = []
    const said: string[] = []
    const r = new SensorRunner({ onEvent: (t, text) => events.push([t, text]), say: (x) => said.push(x) })
    let t = performance.now() / 1000
    expect(r.phase).toBe('stand')
    // ポケットに入れる間（揺れる）
    t = send('胸', 'walk', t, 3, r)
    expect(said[0]).toBe(PHRASES.poseHabit)
    expect(r.stoodAt).toBe(null)
    // a：いつもの楽な立ち方（猫背）。3秒じっとしたら、b の案内に進む
    t = sendUntil('胸', 'slouch', t, r, () => r.stage === 'b')
    expect(r.stage).toBe('b')
    expect(said).toContain(PHRASES.poseOpen)
    expect(r.stoodAt).toBe(null)
    // b：胸を開いた立ち方。案内のあと、もう一度3秒じっとしたら決める
    t = send('胸', 'stand', t, 4, r)
    expect(r.stoodAt).not.toBe(null)
    expect(r.poseResult!.parts.find((p) => p.key === 'chest')).toMatchObject({ mode: 'pose' })
    // 窓のふちに、ポケットに入れる間の値が少し入ることがある（じっとしたかは gate.ts の窓で見ている）
    expect(Math.abs(r.poseResult!.parts.find((p) => p.key === 'chest')!.deg! - SLOUCH)).toBeLessThan(1.5)
    expect(events.some((e) => e[1] === 'sensor:autoStand')).toBe(true)
    expect(events.some((e) => e[1] === 'sensor:stand')).toBe(true)
    expect(events.some((e) => e[1].startsWith('sensor:pose 胸 pose '))).toBe(true)
    expect(said).toContain(PHRASES.poseDone)
    expect(r.phase).toBe('ready')
    // 走る：走る前傾を覚える（10秒たってから30秒）まで、知らせない
    t = send('胸', 'run', t, 50, r)
    expect(r.phase).toBe('run')
    expect(events.some((e) => e[1].startsWith('sensor:run on 胸'))).toBe(true)
    expect(events.some((e) => e[1].startsWith('sensor:runLean'))).toBe(true)
    expect(r.runSec).toBeGreaterThan(40)
    // 猫背（前へ 30°）
    t = send('胸', 'hunch', t, 5, r)
    // 信号待ち：止まる。止まっている間は立った姿勢を覚え直さない
    const stood = r.stoodAt
    t = send('胸', 'stand', t, 20, r)
    expect(r.phase).toBe('stop')
    expect(r.stoodAt).toBe(stood)
    expect(events.some((e) => e[1].startsWith('sensor:run off'))).toBe(true)
    // 走り出したあとは、待つ案内を言わない
    const n = said.length
    send('胸', 'stand', t, 40, r)
    expect(said.length).toBe(n)
    const log = r.finish()!
    expect(log.stand).toBeDefined()
    expect(log.runLean).toBeDefined()
    // 2つの立ち方の記録：向き・角度・見方。差し引いた分（その速さで正しい胸の前傾）
    expect(log.pose).toMatchObject({ mode: 'pose', tries: 1 })
    expect(Math.abs(log.pose!.deg! - SLOUCH)).toBeLessThan(1.5)
    expect(log.pose!.a).toHaveLength(3)
    expect(log.pose!.b).toHaveLength(3)
    expect(log.runLean!.offset).toBeDefined()
    expect(log.secCols).toContain('chestIdx')
    // 1秒ごとのまとめに、走っていたか（センサーで決めたもの）が入る
    const iRun = log.secCols!.indexOf('run')
    expect(log.sec!.some((row) => row[iRun] === 1)).toBe(true)
    expect(log.sec!.some((row) => row[iRun] === 0)).toBe(true)
    // 知らせた回数は、その場で数える（まとめに残す）
    expect(r.session.counts.cues.chest).toBeGreaterThan(0)
    expect(r.session.counts.cues.head).toBe(0)
    expect(r.session.counts.capped.chest).toBe(0)
    // 位置情報を渡していないので、受け取らない（GPS の欄は null）
    expect(r.gpsStatus).toBe(null)
    expect(log.sec!.every((row) => row[log.secCols!.indexOf('gpsV')] === null)).toBe(true)
    return new Promise<void>((done) =>
      setTimeout(() => {
        // 振動の結果（つながっていないので震えない）が返ってから、知らせた記録が入る
        expect(log.cues.length).toBeGreaterThan(0)
        expect(log.cues.length).toBe(r.session.counts.cues.chest)
        done()
      }, 0),
    )
  })

  it('センサーラン：位置情報の速さと高さを1秒ごとのまとめに残し、様子の変わり目を events に残す。走り終わったら止める', () => {
    connect(['胸'])
    let onFix: ((f: { t: number; speed: number | null; accuracy: number; altitude: number | null; altitudeAccuracy: number | null }) => void) | null = null
    let onStatus: ((s: 'none' | 'on' | 'denied' | 'error', code?: number) => void) | null = null
    let stopped = false
    const events: string[] = []
    const got: number[] = []
    const r = new SensorRunner({
      onEvent: (_t, text) => events.push(text),
      say: () => {},
      gps: (fix, status) => {
        onFix = fix
        onStatus = status
        return () => (stopped = true)
      },
      onGps: (f) => got.push(f.t),
    })
    let t = performance.now() / 1000
    onStatus!('on')
    onFix!({ t, speed: 3, accuracy: 10, altitude: 50, altitudeAccuracy: 5 })
    t = send('胸', 'stand', t, 2, r)
    expect(r.gpsStatus).toBe('on')
    expect(events).toContain('gps: on')
    expect(got).toHaveLength(1)
    const log = r.current()!
    const col = (name: string) => log.secCols!.indexOf(name)
    expect(log.sec!.some((row) => row[col('gpsV')] === 10.8 && row[col('gpsAcc')] === 10 && row[col('alt')] === 50 && row[col('altAcc')] === 5)).toBe(true)
    // 位置が来なくなって10秒より経てば null
    t = send('胸', 'stand', t, 12, r)
    expect(log.sec![log.sec!.length - 1][col('gpsV')]).toBe(null)
    // 様子は変わったときだけ残す
    onStatus!('error', 3)
    onStatus!('error', 3)
    expect(events.filter((e) => e.startsWith('gps:'))).toEqual(['gps: on', 'gps: error 3'])
    r.finish()
    expect(stopped).toBe(true)
  })

  it('位置情報のないブラウザでは gps: none と残す。カメラ版（running を渡す）では受け取らない', () => {
    connect(['胸'])
    const events: string[] = []
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text), say: () => {}, gps: true })
    expect(events).toContain('gps: none')
    expect(r.gpsStatus).toBe('none')
    r.finish()
    const cam = new SensorRunner({ onEvent: (_t, text) => events.push(text), running: () => false, gps: true })
    expect(cam.gpsStatus).toBe(null)
    cam.finish()
  })

  it('案内の声を話している間にじっとしても、測らない（言い終えてから3秒で測る）', () => {
    connect(['胸'])
    let speaking = true
    const r = new SensorRunner({ onEvent: () => {}, say: () => {}, speaking: () => speaking })
    let t = performance.now() / 1000
    t = send('胸', 'slouch', t, 6, r)
    expect(r.stage).toBe('a')
    speaking = false
    t = send('胸', 'slouch', t, 2, r)
    expect(r.stage).toBe('a')
    t = send('胸', 'slouch', t, 2, r)
    expect(r.stage).toBe('b')
    // b の案内を話している間も測らない
    speaking = true
    t = send('胸', 'stand', t, 6, r)
    expect(r.stoodAt).toBe(null)
    speaking = false
    t = send('胸', 'stand', t, 2, r)
    expect(r.stoodAt).toBe(null)
    send('胸', 'stand', t, 2, r)
    expect(r.stoodAt).not.toBe(null)
  })

  it('2つの立ち方の差が小さい：案内して測り直し（POSE.retries 回）、それでも小さければ今までの見方にして記録に残す', () => {
    connect(['胸'])
    const events: string[] = []
    const said: string[] = []
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text), say: (x) => said.push(x) })
    let t = performance.now() / 1000
    for (let i = 0; i < POSE.retries; i++) {
      t = sendUntil('胸', 'stand', t, r, () => r.stage === 'b') // a（変えていない）
      t = sendUntil('胸', 'stand', t, r, () => r.stage === 'a') // b
      expect(r.stoodAt).toBe(null)
      expect(r.stage).toBe('a')
      expect(said.filter((x) => x === PHRASES.poseRetry)).toHaveLength(i + 1)
    }
    t = sendUntil('胸', 'stand', t, r, () => r.stage === 'b')
    t = sendUntil('胸', 'stand', t, r, () => r.stoodAt !== null)
    expect(r.stoodAt).not.toBe(null)
    expect(r.poseResult!.parts.find((p) => p.key === 'chest')!.mode).toBe('fallback')
    expect(said).toContain(PHRASES.poseSmall)
    expect(events.filter((e) => e.startsWith('sensor:poseDiff'))).toHaveLength(POSE.retries + 1)
    expect(events.some((e) => e.startsWith('sensor:poseFallback 胸'))).toBe(true)
    expect(r.session.current()!.pose).toMatchObject({ mode: 'fallback', tries: POSE.retries + 1 })
    expect(r.session.current()!.pose!.degs).toHaveLength(POSE.retries + 1)
    // 今までの見方：走る前傾 + margin で見る（走り出しの猫背を基準にする）
    send('胸', 'run', t, 50, r)
    expect(r.session.current()!.runLean!.offset).toBeUndefined()
    r.finish()
  })

  it('猫背のまま走り出しても（走り出しから 30°）、2つの立ち方で見れば知らせる', () => {
    connect(['胸'])
    const r = new SensorRunner({ onEvent: () => {}, say: () => {} })
    let t = performance.now() / 1000
    t = sendUntil('胸', 'slouch', t, r, () => r.stage === 'b')
    t = sendUntil('胸', 'stand', t, r, () => r.stoodAt !== null)
    send('胸', 'hunch', t, 70, r)
    const log = r.finish()!
    expect(log.runLean!.deg).toBeGreaterThan(25)
    // 差し引くのは、その速さで正しい胸の前傾（ベルトの速さも足首もないので、講師の速さのよい例）。走り出しの 30° にはよらない
    expect(log.runLean).toMatchObject({ offset: expectedChest().deg, by: 'speed', kmh: null, speedBy: 'none' })
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(log.cues.length).toBeGreaterThan(3)
        done()
      }, 0),
    )
  })

  it('トレッドミルでベルトの速さを入れたら、胸の正しい前傾はその速さのよい例から決める。腰のスマホの向きも、2つの立ち方とあわせて記録する', () => {
    connect(['胸'])
    const events: string[] = []
    // 腰のスマホ：胸と同じく、a で前へ 6°・b でまっすぐ、走ると前へ 4°（スマホの軸の重力の向き。m/s² の大きさは向きに効かない）
    let emit: (e: MotionLike) => void = () => {}
    let waistDeg = 0
    let now = performance.now() / 1000
    const waist = new WaistPhone((_t, text) => events.push(text), (cb) => ((emit = cb), () => {}), () => now)
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text), say: () => {}, belt: () => 9, waist })
    const g = (deg: number) => ({ accelerationIncludingGravity: { x: 9.8 * Math.sin((deg * Math.PI) / 180), y: 0, z: 9.8 * Math.cos((deg * Math.PI) / 180) }, rotationRate: null })
    // 胸の値が届くたび（0.1秒ごと）に、腰のスマホの値を6件（60回/秒）
    const offPkt = sensors.onPacket((_n, t) => {
      for (let i = 1; i <= 6; i++) {
        now = t - 0.1 + i / 60
        emit(g(waistDeg))
      }
    })
    let t = performance.now() / 1000
    waistDeg = 6
    t = sendUntil('胸', 'slouch', t, r, () => r.stage === 'b')
    waistDeg = 0
    t = sendUntil('胸', 'stand', t, r, () => r.stoodAt !== null)
    waistDeg = 4
    send('胸', 'hunch', t, 70, r)
    offPkt()
    const log = r.finish()!
    expect(log.runLean).toMatchObject({ offset: expectedChest(9).deg, by: 'speed', kmh: 9, speedBy: 'belt' })
    expect(events.some((e) => /^sensor:runLean .* speed 9 belt/.test(e))).toBe(true)
    expect(log.waist).toMatchObject({ mode: 'pose' })
    expect(log.waist!.deg!).toBeCloseTo(6, 0)
    expect(events).toContain('waist: on')
    const iw = log.secCols!.indexOf('waist')
    const ih = log.secCols!.indexOf('wHz')
    const last = log.sec!.filter((row) => row[iw] !== null).pop()!
    expect(last[iw]!).toBeCloseTo(4, 0)
    expect(last[ih]!).toBeGreaterThan(0)
  })

  it('頭だけ：いつもの頭（前へ15°）と顎を引いた頭で測り、前に出たまま走り出すと走る前傾を覚える前から震わせ、直すとほめる（声は出さない）', () => {
    connect(['頭'])
    const events: [number, string][] = []
    const r = new SensorRunner({ onEvent: (t, text) => events.push([t, text]), say: () => {} })
    let t = performance.now() / 1000
    t = sendUntil('頭', 'slouch', t, r, () => r.stage === 'b')
    t = sendUntil('頭', 'stand', t, r, () => r.stoodAt !== null)
    expect(r.poseResult!.parts.find((p) => p.key === 'head')).toMatchObject({ mode: 'pose' })
    // 前へ 12° のまま走り出す（いつもの頭 15° に近い）：差し引くのは HEAD.poseCap までなので、線 3 + 8 = 11° を越える
    t = send('頭', 'run', t, 25, r)
    const runOn = events.find((e) => e[1].startsWith('sensor:run on'))![0]
    t = send('頭', 'runOpen', t, 10, r)
    const log = r.current()!
    expect(log.head!.runLean).toBeUndefined() // まだ覚えていない（走って40秒まで）
    const ok = events.filter((e) => e[1].startsWith('sensor:headOk'))
    expect(ok).toHaveLength(1)
    return new Promise<void>((done) =>
      setTimeout(() => {
        const cues = events.filter((e) => e[1].startsWith('sensor:head ')).map((e) => e[0])
        expect(cues.length).toBeGreaterThan(0)
        expect(cues[0] - runOn).toBeLessThan(HEAD.poseStart + HEAD.poseHold + 1)
        expect(ok[0][0]).toBeGreaterThan(cues[cues.length - 1])
        r.finish()
        done()
      }, 0),
    )
  })

  it('腰スマホ（声の案内なし）は、今までどおり1つの立ち方を覚える', () => {
    connect(['胸'])
    const events: string[] = []
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text) })
    let t = performance.now() / 1000
    t = send('胸', 'stand', t, 4, r)
    expect(r.stoodAt).not.toBe(null)
    expect(events).toContain('sensor:autoStand')
    expect(events.some((e) => e.startsWith('sensor:pose'))).toBe(false)
    r.finish()
  })

  it('アプリが止まっていた（画面が消えた）間を events に残す。足首だけなら立つ案内は出さない', () => {
    connect(['左足首'])
    const events: string[] = []
    const said: string[] = []
    const r = new SensorRunner({ onEvent: (_t, text) => events.push(text), say: (x) => said.push(x) })
    expect(r.phase).toBe('ready')
    const t = performance.now() / 1000
    r.tick(t + 0.1)
    r.tick(t + 10)
    expect(r.gaps).toBe(1)
    expect(events.some((e) => e.startsWith('sensor:gap'))).toBe(true)
    expect(said).not.toContain(PHRASES.poseHabit)
    expect(said).toContain(PHRASES.waitRun)
    expect(r.trunk).toBe(false)
    r.finish()
    expect(r.finish()).toBe(undefined) // 2回目も同じ（値が届いていない）
  })

  it('カメラ版：走っているかと立った姿勢は外から渡す（センサーでは決めない）', () => {
    connect(['胸'])
    let running = false
    const r = new SensorRunner({ onEvent: () => {}, running: () => running })
    expect(r.gate).toBe(null)
    let t = performance.now() / 1000
    t = send('胸', 'stand', t, 4, r)
    expect(r.stoodAt).toBe(null) // カメラが直立の基準を取るまでは覚えない
    r.stand(t, 3)
    expect(r.stoodAt).toBe(t)
    running = true
    send('胸', 'stand', t, 5, r) // 揺れなくても、カメラが走っていると言えば走っている
    expect(r.runSec).toBeGreaterThan(4)
    r.finish()
  })
})

describe('センサーランの結果の数え方', () => {
  it('知らせた回数・体を曲げた・止まっていた・立った姿勢（前の記録：まとめに回数がなく、events から数える）', () => {
    const log = {
      id: 'sensor-log-1', startedAt: 1, width: 0, height: 0, columns: [], points: [], phases: [], rows: [], mode: 'sensor',
      events: [[1, 'sensor:contact sit 2.1'], [2, 'sensor:contact longL 16'], [3, 'sensor:contactOk sit'], [4, 'sensor:contact longR 17'], [5, 'sensor:contact stride 8.2'], [6, 'sensor:capped 胸']],
      sensors: { version: 1, nodes: [], stride: 2, blocks: [], cues: [[1, 20, 1], [2, 21, 0]], head: { cues: [[3, 40, 1]] }, bends: [[5, 80]] },
      summary: { runSec: 600, gaps: 2, stood: false, trunk: true },
    } as unknown as RunLog
    expect(sensorRunCounts(log)).toEqual({ runMin: 10, chest: 2, head: 1, sit: 1, side: 2, stride: 1, capped: 1, bends: 1, gaps: 2, stood: false, trunk: true })
  })

  it('まとめに回数があれば、そこから数える', () => {
    const log = {
      id: 'sensor-log-2', startedAt: 1, width: 0, height: 0, columns: [], points: [], phases: [], rows: [], mode: 'sensor', events: [],
      sensors: { version: 1, nodes: [], stride: 2, blocks: [], cues: [[1, 20, 1]] },
      summary: { runSec: 7200, gaps: 0, stood: true, trunk: true, cues: { chest: 1, head: 0, sit: 3, longL: 2, longR: 1, stride: 4 }, capped: { chest: 0, head: 0, sit: 1, longL: 0, longR: 0, stride: 1 }, slips: { chest: 0, head: 0 }, gps: 'on' },
    } as unknown as RunLog
    expect(sensorRunCounts(log)).toMatchObject({ runMin: 120, chest: 1, sit: 3, side: 3, stride: 4, capped: 2 })
  })
})
