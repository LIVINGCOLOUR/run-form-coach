import { describe, expect, it } from 'vitest'
import { measure, rotateFrame, sideOffDeg } from './geometry'
import { category, itemScore, postureScore } from './scoring'
import { Coach, breakdownMinute } from './coach'
import { nextItem } from './nextStep'
import { capBaseline } from './storage'
import { MotionDetector } from './motion'
import { demoStride } from '../ui/figure'
import type { Frame, Measure, Sample, Session } from './types'

const mirror = (f: Frame): Frame => f.map((p) => ({ ...p, x: 340 - p.x }))

describe('角度の測定', () => {
  it('体幹の前傾を測れる', () => {
    for (const lean of [0, 7, 15]) {
      const f = demoStride({ lean, head: 0, drop: 0 })[0]
      expect(measure(f).trunk).toBeCloseTo(lean, 0)
    }
  })

  it('左向きに走っても同じ角度になる', () => {
    const f = demoStride({ lean: 10, head: 4, drop: 0 })[5]
    const a = measure(f)
    const b = measure(mirror(f))
    expect(b.dir).toBe(-1)
    expect(b.trunk).toBeCloseTo(a.trunk, 5)
    expect(b.neck).toBeCloseTo(a.neck, 5)
  })

  it('頭が前に出ると neck が大きくなる', () => {
    const a = measure(demoStride({ lean: 7, head: 0, drop: 0 })[0])
    const b = measure(demoStride({ lean: 7, head: 10, drop: 0 })[0])
    expect(b.neck - a.neck).toBeGreaterThan(5)
  })

  it('スマホが傾いていても、補正すれば同じ角度になる', () => {
    const f = demoStride({ lean: 7, head: 0, drop: 0 })[0]
    const tilted = rotateFrame(f, -4, 170, 262) // 画像が4°傾いた状態
    expect(Math.abs(measure(tilted).trunk - 7)).toBeGreaterThan(3)
    const fixed = rotateFrame(tilted, 4, 170, 262)
    expect(measure(fixed).trunk).toBeCloseTo(7, 1)
  })

  it('真横から撮れていれば、ずれは小さい', () => {
    const f = demoStride()[0]
    expect(sideOffDeg(f)).toBeLessThan(5)
  })
})

describe('点数', () => {
  it('満点の範囲と0点の間は比例する', () => {
    expect(itemScore('head', 3)).toBe(100)
    expect(itemScore('head', 10)).toBe(50)
    expect(itemScore('head', 20)).toBe(0)
    expect(itemScore('trunk', 15)).toBe(50)
  })
  it('姿勢スコアは一番低い項目', () => {
    expect(postureScore({ head: 0, trunk: 15, body: 0, hip: 0 })).toBe(50)
  })
  it('良い・ふつう・悪い', () => {
    expect(category(85)).toBe('good')
    expect(category(60)).toBe('mid')
    expect(category(20)).toBe('bad')
  })
})

describe('走っているかの検知', () => {
  it('脚が動いていれば走っている、止まっていれば止まっている', () => {
    const run = demoStride()
    const md = new MotionDetector()
    let moving = false
    for (let i = 0; i < 90; i++) moving = md.update(run[i % run.length], i / 30)
    expect(moving).toBe(true)
    const still = new MotionDetector()
    let m2 = true
    for (let i = 0; i < 90; i++) m2 = still.update(run[0], i / 30)
    expect(m2).toBe(false)
  })
})

// 30fps で、指定した姿勢の測定値を流し込む
function feed(coach: Coach, from: number, sec: number, m: Measure, moving = true, frames = demoStride()) {
  const speak: string[] = []
  for (let i = 0; i < sec * 30; i++) {
    const t = from + i / 30
    for (const e of coach.update({ t, present: true, moving, m, frame: frames[i % frames.length] })) if (e.type === 'speak') speak.push(e.text)
  }
  return speak
}

const good: Measure = { neck: 2, trunk: 7, body: 3, hipRatio: 0.9, dir: 1 }
const headDown: Measure = { ...good, neck: 14 }

describe('コーチの流れ', () => {
  it('走り出しで始まり、崩れたら声をかけ、直ったらほめ、止まったら一時停止する', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    const s1 = feed(coach, 0, 5, good)
    expect(coach.state).toBe('running')
    expect(s1[0]).toContain('始めます')

    const s2 = feed(coach, 5, 13, headDown)
    expect(s2.some((x) => x.includes('頭が前に出ています'))).toBe(true)

    // 声をかけてから15秒以内に直れば、ほめる
    const s3 = feed(coach, 18, 10, good)
    expect(s3.some((x) => x.includes('いい感じです'))).toBe(true)

    const s4 = feed(coach, 28, 5, good, false)
    expect(coach.state).toBe('paused')
    expect(s4.some((x) => x.includes('一時停止'))).toBe(true)
  })

  it('安定していると、声なしで確認する時間に入り、保てたら伝える', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    const said = feed(coach, 0, 600, good)
    expect(said.some((x) => x.includes('声なしで確認'))).toBe(true)
    expect(said.some((x) => x.includes('声なしでも'))).toBe(true)
    expect(coach.quietHeldSec).toBeGreaterThan(250)
  })

  it('声なしの間に大きく崩れたら、確認をやめて声かけに戻る', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feed(coach, 0, 200, good)
    expect(coach.quiet).toBe(true)
    const said = feed(coach, 200, 90, { ...good, neck: 30 })
    expect(coach.quiet).toBe(false)
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })

  it('終わったら割合と走り姿をまとめる', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feed(coach, 0, 120, good)
    feed(coach, 120, 60, headDown)
    const s = coach.finish()
    expect(s.share.good + s.share.mid + s.share.bad).toBeCloseTo(1, 5)
    expect(s.share.good).toBeGreaterThan(0.5)
    expect(s.strides.good?.frames.length).toBe(36)
    expect(s.strides.bad).toBeDefined()
  })
})

// 実機と同じく、コーチが要らないと言ったコマは骨格を取らずに時間だけ進める（毎秒15コマ）
function feedSparse(coach: Coach, from: number, sec: number, m: Measure) {
  const speak: string[] = []
  let looked = 0
  const frames = demoStride()
  for (let i = 0; i < sec * 15; i++) {
    const t = from + i / 15
    const look = coach.wantsDetail()
    if (look) looked++
    const inp = look ? { t, present: true, moving: true, m, frame: frames[(i * 2) % frames.length] } : { t, present: true, moving: true }
    for (const e of coach.update(inp)) if (e.type === 'speak') speak.push(e.text)
  }
  return { speak, looked: looked / (sec * 15) }
}

const absent = (coach: Coach, from: number, sec: number) => {
  const speak: string[] = []
  for (let i = 0; i < sec * 15; i++) for (const e of coach.update({ t: from + i / 15, present: false, moving: false })) if (e.type === 'speak') speak.push(e.text)
  return speak
}

describe('省電力（間引いて見る）', () => {
  it('安定している間は3割ほどしか骨格を取らず、それでも崩れたら声をかける', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    const a = feedSparse(coach, 0, 120, good)
    expect(a.looked).toBeLessThan(0.4)
    const b = feedSparse(coach, 120, 20, headDown)
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
    expect(b.looked).toBeGreaterThan(0.6)
  })

  it('間引いても、割合は時間どおりに数える', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feedSparse(coach, 0, 600, good)
    const s = coach.finish()
    expect(s.share.good).toBeGreaterThan(0.95)
    expect(s.strides.good?.frames.length).toBe(36)
  })
})

describe('画面から外れたとき', () => {
  it('走っている途中なら5秒で戻るよう促し、30秒戻らなければ終わる', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feed(coach, 0, 20, good)
    const s1 = absent(coach, 20, 6)
    expect(s1.some((x) => x.includes('戻ってください'))).toBe(true)
    expect(coach.state).toBe('running')
    const s2 = absent(coach, 26, 25)
    expect(coach.state).toBe('ended')
    expect(s2.some((x) => x.includes('ここで終わりにします'))).toBe(true)
  })

  it('戻ってくれば続ける', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feed(coach, 0, 20, good)
    absent(coach, 20, 10)
    feed(coach, 30, 5, good)
    expect(coach.state).toBe('running')
  })

  it('止まってから外れたなら、10秒でおつかれさまでした', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feed(coach, 0, 20, good)
    feed(coach, 20, 5, good, false)
    expect(coach.state).toBe('paused')
    const s = absent(coach, 25, 11)
    expect(coach.state).toBe('ended')
    expect(s).toEqual(['おつかれさまでした。'])
  })
})

describe('直立の基準', () => {
  it('毎回取り直すが、直近より5°以上悪い日は5°までに抑える', () => {
    const h = [3, 2, 4].map((neck) => ({ neck, createdAt: 0 }))
    expect(capBaseline(1, h)).toBe(1)
    expect(capBaseline(6, h)).toBe(6)
    expect(capBaseline(12, h)).toBe(8)
    expect(capBaseline(12, [])).toBe(12)
  })
})

describe('崩れ始め', () => {
  it('後半にスコアが下がった時刻を見つける', () => {
    const samples: Sample[] = Array.from({ length: 3600 }, (_, t) => ({ t, head: 0, trunk: 7, body: 3, hipDrop: 0, score: t < 2280 ? 92 : 55, quiet: false }))
    const m = breakdownMinute(samples)
    expect(m).toBeGreaterThanOrEqual(36)
    expect(m).toBeLessThanOrEqual(42)
  })
  it('崩れなければ出さない', () => {
    const samples: Sample[] = Array.from({ length: 1800 }, (_, t) => ({ t, head: 0, trunk: 7, body: 3, hipDrop: 0, score: 90, quiet: false }))
    expect(breakdownMinute(samples)).toBeUndefined()
  })
})

describe('次の一歩', () => {
  it('理想との差が一番大きい項目を1つだけ選ぶ', () => {
    const s = { strides: { good: { frames: [], dir: 1, score: 90, avg: { head: 2, trunk: 12, body: 4, hipDrop: 1 } } } } as unknown as Session
    expect(nextItem(s)?.item).toBe('trunk')
  })
})
