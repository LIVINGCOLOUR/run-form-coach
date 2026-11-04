import { afterEach, describe, expect, it } from 'vitest'
import { MotionGate, windowStats } from './gate'
import { RUN_GATE, SLOTS, STILL } from './params'
import type { Packet, Vec3 } from './parse'
import { sensors } from './ble'
import { SensorRunner } from './runner'
import { sensorRunCounts } from './runLog'
import { PHRASES } from '../../core/phrases'
import type { RunLog } from '../../core/types'

// カメラなしで使うとき（センサーラン・腰スマホといっしょ）の、走っているか・立っているかの見分けと、それを使って SensorSession を動かす役

const HZ = 100
// 1件ぶんの値。kind：立つ（ほぼ揺れない）・歩く（0.25g の揺れ）・走る（1g の揺れ。浮いている間と着地）
type Kind = 'stand' | 'walk' | 'run' | 'hunch'
function imu(kind: Kind, t: number, k: number): { a: Vec3; g: Vec3 } {
  const jitter = ((k * 7919) % 13) / 13 - 0.5 // 決まった小さな揺れ（乱数を使わない）
  if (kind === 'stand') return { a: [0.002 * jitter, 0, 1 + 0.004 * jitter], g: [2 * jitter, 1, 1] }
  if (kind === 'hunch') return { a: [Math.sin((30 * Math.PI) / 180) * (1 + Math.sin(2 * Math.PI * 2.8 * t)), 0, Math.cos((30 * Math.PI) / 180) * (1 + Math.sin(2 * Math.PI * 2.8 * t))], g: [120 * Math.sin(2 * Math.PI * 2.8 * t), 30, 10] }
  const amp = kind === 'walk' ? 0.25 : 1.0
  const f = kind === 'walk' ? 1.9 : 2.8
  const m = 1 + amp * Math.sin(2 * Math.PI * f * t)
  // 走る：前へ約12°傾いた向き（胸の走る前傾）
  const lean = kind === 'run' ? (12 * Math.PI) / 180 : 0
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

describe('センサーだけで動かす（runner.ts の SensorRunner。センサーラン・腰スマホといっしょ）', () => {
  afterEach(() => {
    for (const n of hub.nodes) if (n.status === 'connected') n.status = 'idle'
    hub.refresh()
  })

  it('立つ案内 → じっとした3秒で立った姿勢を覚える → 走り出す → 猫背で知らせる → 信号で止まる', () => {
    connect(['胸'])
    const events: [number, string][] = []
    const said: string[] = []
    const r = new SensorRunner({ onEvent: (t, text) => events.push([t, text]), say: (x) => said.push(x) })
    let t = performance.now() / 1000
    expect(r.phase).toBe('stand')
    // ポケットに入れる間（揺れる）
    t = send('胸', 'walk', t, 3, r)
    expect(said[0]).toBe(PHRASES.baseStand)
    expect(r.stoodAt).toBe(null)
    t = send('胸', 'stand', t, 4, r)
    expect(r.stoodAt).not.toBe(null)
    expect(events.some((e) => e[1] === 'sensor:autoStand')).toBe(true)
    expect(events.some((e) => e[1] === 'sensor:stand')).toBe(true)
    expect(said).toContain(PHRASES.baseDone)
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
    // 1秒ごとのまとめに、走っていたか（センサーで決めたもの）が入る
    const iRun = log.secCols!.indexOf('run')
    expect(log.sec!.some((row) => row[iRun] === 1)).toBe(true)
    expect(log.sec!.some((row) => row[iRun] === 0)).toBe(true)
    return new Promise<void>((done) =>
      setTimeout(() => {
        // 振動の結果（つながっていないので震えない）が返ってから、知らせた記録が入る
        expect(log.cues.length).toBeGreaterThan(0)
        done()
      }, 0),
    )
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
    expect(said).not.toContain(PHRASES.baseStand)
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
  it('知らせた回数・体を曲げた・止まっていた・立った姿勢', () => {
    const log = {
      id: 'sensor-log-1', startedAt: 1, width: 0, height: 0, columns: [], points: [], phases: [], rows: [], mode: 'sensor',
      events: [[1, 'sensor:contact sit 2.1'], [2, 'sensor:contact longL 16'], [3, 'sensor:contactOk sit'], [4, 'sensor:contact longR 17']],
      sensors: { version: 1, nodes: [], stride: 2, blocks: [], cues: [[1, 20, 1], [2, 21, 0]], head: { cues: [[3, 40, 1]] }, bends: [[5, 80]] },
      summary: { runSec: 600, gaps: 2, stood: false, trunk: true },
    } as unknown as RunLog
    expect(sensorRunCounts(log)).toEqual({ runMin: 10, chest: 2, head: 1, sit: 1, side: 2, bends: 1, gaps: 2, stood: false, trunk: true })
  })
})
