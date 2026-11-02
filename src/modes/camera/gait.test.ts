import { describe, expect, it } from 'vitest'
import { armOf, GaitWatch } from './gait'
import { LandingWatch } from './landing'
import { L } from './landmarks'
import { GAIT } from './params'
import { gaitRows, GAIT_NO_CONTACT } from './nextStep'
import type { Frame } from '../../core/types'

// 作りものの走り（真横から、右向き）：1周 period 秒で、左右の足首が交互に前後に動く（前の山で接地し、接地中は後ろへ一定の速さで動く）。
// 腰は1歩ごとに上下に bob（画素、一番高い位置と低い位置の差）だけ動き、接地の真ん中で一番低い。
// 腕は手前（左）の肩→肘の線が arm（度）の幅で前後に振れ、肘の角度は elbow（度）。手前の点ははっきり（0.95）、奥はぼんやり（0.5）
const LEG = 160
const HIP0 = { x: 300, y: 300 }
const GROUND = HIP0.y + 0.92 * LEG
interface Opts {
  period?: number
  bob?: number
  arm?: number
  elbow?: number
  armVis?: number
  drop?: number // 腰を落とす量（画素）。足首の高さは変えない
}
function legAt(ph: number, hip: { x: number; y: number }) {
  const s = 0.4
  const p = ((ph % 1) + 1) % 1
  const reach = 0.35
  const back = 0.35
  let x: number
  let y: number
  if (p < s) {
    x = reach - ((reach + back) * p) / s
    y = GROUND
  } else {
    const u = (p - s) / (1 - s)
    x = -back + ((reach + back) * (1 - Math.cos(Math.PI * u))) / 2
    y = GROUND - 0.12 * LEG * Math.sin(Math.PI * u)
  }
  const A = { x: hip.x + x * LEG, y }
  const dx = A.x - hip.x
  const dy = A.y - hip.y
  const d = Math.min(LEG - 0.5, Math.hypot(dx, dy))
  const h = Math.sqrt(Math.max(0, (LEG / 2) ** 2 - (d / 2) ** 2))
  const n = Math.hypot(dx, dy)
  const K = { x: hip.x + dx / 2 + (-dy / n) * h, y: hip.y + dy / 2 + (dx / n) * h }
  return { K: K.x > hip.x + dx / 2 ? K : { x: hip.x + dx / 2 + (dy / n) * h, y: hip.y + dy / 2 - (dx / n) * h }, A }
}
function frameAt(t: number, o: Opts = {}): Frame {
  const T = o.period ?? 0.72
  const bob = o.bob ?? 10
  // 1歩（T/2）に1回上下。接地の真ん中（位相 0.2）で一番低い
  const hip = { x: HIP0.x, y: HIP0.y + (o.drop ?? 0) + (bob / 2) * Math.cos(2 * Math.PI * ((2 * t) / T - 0.4)) }
  const f: Frame = Array.from({ length: 33 }, () => ({ x: hip.x, y: hip.y - 200, v: 0.3 }))
  const put = (i: number, p: { x: number; y: number }, v: number) => (f[i] = { x: p.x, y: p.y, v })
  put(L.nose, { x: hip.x + 40, y: hip.y - 280 }, 0.99)
  put(L.leftEar, { x: hip.x + 20, y: hip.y - 284 }, 0.99)
  put(L.rightEar, { x: hip.x + 20, y: hip.y - 284 }, 0.5)
  put(L.leftHip, hip, 0.99)
  put(L.rightHip, hip, 0.6)
  const sh = { x: hip.x + 25, y: hip.y - 240 }
  put(L.leftShoulder, sh, 0.99)
  put(L.rightShoulder, sh, 0.6)
  // 腕：肩→肘の角度（鉛直から前が正）が ±arm/2 で振れる。前腕は上腕から elbow の角度で前へ
  const a = (((o.arm ?? 40) / 2) * Math.sin((2 * Math.PI * t) / T) * Math.PI) / 180
  const el = { x: sh.x + 70 * Math.sin(a), y: sh.y + 70 * Math.cos(a) }
  const b = a + Math.PI - ((o.elbow ?? 90) * Math.PI) / 180
  const wr = { x: el.x + 65 * Math.sin(b), y: el.y + 65 * Math.cos(b) }
  const av = o.armVis ?? 0.95
  put(L.leftElbow, el, av)
  put(L.leftWrist, wr, av)
  put(L.rightElbow, el, 0.4)
  put(L.rightWrist, wr, 0.4)
  const legs = [
    { ...legAt(t / T, hip), v: 0.95, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, toe: L.leftFoot },
    { ...legAt(t / T + 0.5, hip), v: 0.5, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, toe: L.rightFoot },
  ]
  for (const g of legs) {
    put(g.knee, g.K, g.v)
    put(g.ankle, g.A, g.v)
    put(g.heel, { x: g.A.x - 6, y: g.A.y + 8 }, g.v)
    put(g.toe, { x: g.A.x + 22, y: g.A.y + 10 }, g.v)
  }
  return f
}

// アプリと同じ順で通す：コマごとに着地の山を取り、1秒ごとに山を振り分けて走りの数字に渡す。
// skip(t) が true のコマは骨格を取らない（間引き）
function run(sec: number, o: Opts = {}, fps = 13, skip: (t: number) => boolean = () => false) {
  const lw = new LandingWatch()
  const gw = new GaitWatch()
  let next = 1
  for (let i = 0; i < sec * fps; i++) {
    const t = i / fps
    while (t >= next) {
      gw.second(lw.second(true).peaks)
      next++
    }
    if (skip(t)) {
      lw.tick(t)
      continue
    }
    const f = frameAt(t, o)
    lw.frame(f, t)
    gw.frame(f, t)
  }
  gw.second(lw.second(true).peaks)
  gw.second(lw.second(true).peaks)
  return gw
}

describe('走りの数字（gait.ts）', () => {
  it('1歩ずつ区切って、ピッチ・上下動・腰の高さ・腕振りを測る', () => {
    const g = run(30).result()
    expect(g.steps).toBeGreaterThan(70) // 30秒で約83歩（最初の1歩と、1周たまる前の腕は数えない）
    expect(g.cadence!).toBeGreaterThan(160)
    expect(g.cadence!).toBeLessThan(173) // 1周 0.72 秒 ＝ 毎分 166.7 歩
    // 上下動：本当は 10 画素 ÷ 160 = 0.0625。毎秒13コマでは山と谷を取り逃がして小さめに出る
    expect(g.vo!).toBeGreaterThan(0.045)
    expect(g.vo!).toBeLessThanOrEqual(0.0626)
    // 腰の高さ：低いほうの足首から腰まで ÷ 脚の長さ（平均で 0.92 前後）
    expect(g.hip!).toBeGreaterThan(0.88)
    expect(g.hip!).toBeLessThan(0.95)
    // 腕：振れ幅 40°、肘 90°
    expect(g.arm!).toBeGreaterThan(34)
    expect(g.arm!).toBeLessThanOrEqual(40.1)
    expect(g.elbow!).toBeCloseTo(90, 0)
  })

  it('弾めば上下動が大きく、腰を落とせば腰の高さが低く、腕を振らなければ振れ幅が小さく、腕を伸ばせば肘の角度が大きく出る', () => {
    const base = run(30).result()
    const bouncy = run(30, { bob: 20 }).result()
    expect(bouncy.vo! / base.vo!).toBeGreaterThan(1.7)
    expect(bouncy.vo! / base.vo!).toBeLessThan(2.3)
    const low = run(30, { drop: 12 }).result()
    expect(base.hip! - low.hip!).toBeGreaterThan(0.06) // 12 ÷ 160 = 0.075
    const still = run(30, { arm: 8 }).result()
    expect(still.arm!).toBeLessThan(10)
    const straight = run(30, { elbow: 150 }).result()
    expect(straight.elbow!).toBeCloseTo(150, 0)
  })

  it('ピッチは、1周の長さが変わればそのまま変わる', () => {
    const slow = run(30, { period: 0.8 }).result()
    expect(slow.cadence!).toBeGreaterThan(144)
    expect(slow.cadence!).toBeLessThan(156) // 毎分 150 歩
  })

  it('手前の腕の点がはっきりしないときは、腕を測らない', () => {
    expect(armOf(frameAt(0, { armVis: 0.3 }))).toBeNull()
    const g = run(30, { armVis: 0.3 }).result()
    expect(g.arm).toBeUndefined()
    expect(g.elbow).toBeUndefined()
    expect(g.vo).toBeDefined()
  })

  it('骨格を取らなかった間（間引き）をまたぐ歩は測らない。測れた歩が少なければ値を出さない', () => {
    // 10秒のうち3秒だけ見る（アプリのふだんの間引き）
    const thin = run(60, {}, 13, (t) => t % 10 >= 3)
    for (const s of thin.steps) expect(s.t % 10).toBeLessThan(3.2)
    expect(thin.result().vo).toBeDefined()
    const short = run(8).result()
    expect(short.steps).toBeLessThan(GAIT.minSteps)
    expect(short.cadence).toBeUndefined()
    expect(short.vo).toBeUndefined()
  })
})

describe('結果の画面：走りの数字の行', () => {
  const g = { steps: 300, cadence: 166.4, vo: 0.063, hip: 0.954, arm: 30.6, elbow: 92.8 }
  it('ピッチと腕振りは値だけ。上下動と腰の高さは、研究データのふつうの走りと並べる（腰の高さは立った姿勢で割る）', () => {
    const rows = gaitRows(g, 1.01)
    expect(rows.map((r) => r.key)).toEqual(['cadence', 'vo', 'hip', 'arm'])
    expect(rows[0].parts[0].value).toBe('166')
    expect(rows[0].range).toBeUndefined()
    expect(rows[1].parts[0].value).toBe('6.3')
    expect(rows[1].state).toBe('in')
    expect(rows[1].range).toContain(`${GAIT.typical.vo.min * 100}〜${GAIT.typical.vo.max * 100}%`)
    expect(rows[2].parts[0].value).toBe('94.5') // 0.954 ÷ 1.01
    expect(rows[2].state).toBe('in')
    expect(rows[3].parts.map((p) => p.value)).toEqual(['31', '93'])
    expect(rows[3].range).toBeUndefined()
    expect(GAIT_NO_CONTACT).toContain('接地時間')
  })
  it('範囲の外なら、どちら側かを言う。立った姿勢がない走りでは、腰の高さを出さない', () => {
    const rows = gaitRows({ ...g, vo: 0.11, hip: 0.9 }, 1.0)
    expect(rows.find((r) => r.key === 'vo')!.state).toBe('high')
    expect(rows.find((r) => r.key === 'vo')!.word).toBe('範囲より大きめです')
    expect(rows.find((r) => r.key === 'hip')!.state).toBe('low')
    expect(rows.find((r) => r.key === 'hip')!.word).toBe('範囲より低めです')
    expect(gaitRows(g).some((r) => r.key === 'hip')).toBe(false)
    expect(gaitRows({ steps: 5 })).toEqual([])
  })
})
