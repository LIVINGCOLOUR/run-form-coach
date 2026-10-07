import { describe, expect, it } from 'vitest'
import { measure, rotateFrame, sideOffDeg } from './geometry'
import { category, itemScore, postureScore } from './scoring'
import { Coach, breakdownMinute } from './coach'
import { nextItem } from './nextStep'
import { capBaseline } from './storage'
import { standingIssue } from './standing'
import { LogRecorder, LOG_POINTS } from './log'
import { MotionDetector, bodyVisible } from './motion'
import { demoStride, strideStats, DEMO_SPM } from '../ui/figure'
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

// その場で走る：足首を前後に開かず、左右の膝と足首を交互に持ち上げる（stepsPerSec 歩／秒、lift は持ち上げる高さ）
function inPlace(stepsPerSec: number, lift: number, sec = 3, fps = 15) {
  const base = demoStride()[0]
  const md = new MotionDetector()
  let moving = false
  for (let i = 0; i < sec * fps; i++) {
    const t = i / fps
    const ph = Math.sin(Math.PI * stepsPerSec * t)
    const up = (side: 'l' | 'r') => lift * Math.max(0, side === 'l' ? ph : -ph)
    const f = base.map((p) => ({ ...p }))
    for (const [i2, side, k] of [[25, 'l', 0.6], [27, 'l', 1], [26, 'r', 0.6], [28, 'r', 1]] as const) {
      f[i2] = { ...f[i2], x: base[i2 === 25 || i2 === 26 ? 25 : 27].x, y: base[i2 === 25 || i2 === 26 ? 25 : 27].y - up(side) * k }
    }
    moving = md.update(f, t)
  }
  return moving
}

describe('歩きと走りの区別（歩数の数え方）', () => {
  it('毎分約100歩の歩きは、歩数の数え方では走りにならない', () => {
    const walk = demoStride()
    const md = new MotionDetector()
    for (let i = 0; i < 100; i++) md.update(walk[i % walk.length], i / 18) // 1周20コマを1.11秒＝毎分108歩
    expect(md.by).not.toBe('steps')
    expect(md.cadence).toBeGreaterThan(95)
    expect(md.cadence).toBeLessThan(120)
  })
})

describe('その場で走る・コンパクトなフォーム', () => {
  it('脚を前後に開かなくても、左右が交互に上がるリズムが毎秒2歩以上なら走っている', () => {
    expect(inPlace(2.8, 25)).toBe(true) // 検証用の判定（IN_PLACE_FOR_TESTING）で拾う
    expect(inPlace(2.8, 12)).toBe(true) // 小さく持ち上げるだけでも
  })
  it('ゆっくり足踏みする、ほとんど持ち上げないときは走っていない', () => {
    expect(inPlace(1.2, 25)).toBe(false)
    expect(inPlace(2.8, 1)).toBe(false)
  })
})

describe('見本の走り', () => {
  // 基準：市民ランナーの接地時間 200〜300ms（よく走れる人は 200ms 前後）、上下動 6〜9cm、
  // ピッチ 160〜180歩、着地のすねは鉛直から 10° 未満（15° 以上はオーバーストライド）
  it('軽快に走る市民ランナーの値に入っている', () => {
    const st = strideStats(demoStride({ lean: 7, head: 0, drop: 0 }, 400), 120 / DEMO_SPM)
    expect(st.cadence).toBe(180)
    expect(st.contactMs).toBeGreaterThan(190)
    expect(st.contactMs).toBeLessThan(240)
    expect(st.flightMsPerStep).toBeGreaterThan(80)
    expect(st.verticalCm).toBeGreaterThan(6)
    expect(st.verticalCm).toBeLessThan(9)
    expect(Math.abs(st.shankAtContact)).toBeLessThan(10)
  })
  it('オーバーストライドの見本は、すねが15°以上前に倒れて着く', () => {
    const st = strideStats(demoStride({ lean: 7, head: 0, drop: 0, over: 1 }, 400), 120 / DEMO_SPM)
    expect(st.shankAtContact).toBeGreaterThan(15)
  })
})

describe('全身が見えているか', () => {
  it('真横から撮って奥側の手足が隠れていても、手前側が見えていれば全身が入っている', () => {
    const f = demoStride()[0].map((p, i) => ([12, 24, 26, 28, 8].includes(i) ? { ...p, v: 0.2 } : p))
    expect(bodyVisible(f)).toBe(true)
  })
  it('並び方がおかしいもの（人の見間違い）や、小さすぎるものは入っていない', () => {
    const f = demoStride()[0]
    const upside = f.map((p) => ({ ...p, y: 600 - p.y }))
    expect(bodyVisible(upside)).toBe(false)
    expect(bodyVisible(f, 0.5, 300)).toBe(true)
    expect(bodyVisible(f, 0.5, 3000)).toBe(false)
  })
  it('足首が両方見えなければ、入っていない', () => {
    const f = demoStride()[0].map((p, i) => ([27, 28].includes(i) ? { ...p, v: 0.2 } : p))
    expect(bodyVisible(f)).toBe(false)
  })
})

describe('走っているかの検知', () => {
  it('脚が動いていれば走っている、止まっていれば止まっている', () => {
    const run = demoStride()
    const md = new MotionDetector()
    let moving = false
    // 見本は1周20コマ。毎秒30コマで流すと1周0.667秒（毎分180歩）
    for (let i = 0; i < 90; i++) moving = md.update(run[i % run.length], i / 30)
    expect(moving).toBe(true)
    // 歩数の数え方で走りと判断し、ピッチも出る
    expect(md.by).toBe('steps')
    expect(md.cadence).toBeGreaterThan(170)
    expect(md.cadence).toBeLessThan(190)
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

describe('前かがみ', () => {
  it('上体が倒れたら声をかけ、起こしたらほめる。一時停止を切っていれば、止まっても走り続ける扱い', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 }, { pause: false })
    feedSparse(coach, 0, 60, good)
    const a = feedSparse(coach, 60, 10, { ...good, trunk: 20 })
    expect(a.speak.some((x) => x.includes('上体が前に倒れすぎています'))).toBe(true)
    const b = feedSparse(coach, 70, 12, { ...good, trunk: 11 })
    expect(b.speak.some((x) => x.includes('いい感じです'))).toBe(true)
    feed(coach, 82, 10, good, false)
    expect(coach.state).toBe('running')
  })
})

describe('省電力（間引いて見る）', () => {
  it('安定している間は3割ほどしか骨格を取らず、それでも崩れたら声をかける', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    const a = feedSparse(coach, 0, 120, good)
    expect(a.looked).toBeLessThan(0.4)
    const b = feedSparse(coach, 120, 20, headDown)
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
    expect(b.looked).toBeGreaterThan(0.6)
  })

  it('点数はまだ高いが、声をかける線を少し越えた崩れでも、間引かずに見て声をかける', () => {
    const coach = new Coach({ neck: 2, createdAt: 0 })
    feedSparse(coach, 0, 120, good)
    const b = feedSparse(coach, 120, 20, { ...good, neck: 8 }) // 頭 +6°：線（5°）は越えるが点数は90
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
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

describe('立ち姿勢（猫背）のチェック', () => {
  it('まっすぐなら問題なし、頭が前・背中が丸いを見分ける', () => {
    expect(standingIssue({ head: 10, trunk: 2 })).toBeNull()
    expect(standingIssue({ head: 30, trunk: 2 })).toBe('head')
    expect(standingIssue({ head: 15, trunk: 12 })).toBe('back')
  })
})

describe('調整用の記録', () => {
  it('取れたコマごとに、判定の数字と骨格の点を1行で残す。点がないコマは数字だけ', () => {
    const rec = new LogRecorder()
    const f = demoStride()[0]
    rec.frame(1.234, 'run', 480, 640, f, { visible: true, moving: true, by: 'steps', cadence: 171.4, m: measure(f), sideDeg: 3, still: 5 })
    rec.frame(1.3, 'setup', 480, 640, null, { visible: false, moving: false, by: null, cadence: null, sideDeg: 90, still: 1e9 })
    rec.frame(1.4, 'loading', 480, 640, null, { visible: false, moving: false, by: null, cadence: null, sideDeg: 90, still: 0 })
    rec.event(1.5, '始めます。')
    const [a, b] = rec.log.rows
    expect(rec.log.rows.length).toBe(2)
    expect(a.slice(0, 6)).toEqual([1.23, 2, 1, 1, 1, 171])
    expect(a.length).toBe(12 + LOG_POINTS.length * 3)
    expect(b.length).toBe(12)
    expect(b[11]).toBe(99)
    expect(rec.log.events).toEqual([[1.5, '始めます。']])
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
