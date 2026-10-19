import { describe, expect, it } from 'vitest'
import { levelFrame, measure, rotateFrame, sideOffDeg } from './geometry'
import { itemScore, postureScore } from './scoring'
import { Coach, headForward, toScale } from './coach'
import { BEFORE_REF, HEAD_ABS, LIMITS, REL_LIMITS } from './params'
import { activeItems } from '../../core/level'
import { nextItem } from './nextStep'
import { capBaseline, standingIssue } from './standing'
import { LogRecorder, LOG_POINTS } from './log'
import { fullFrames } from './fullFrames'
import { analyzeRun, type TimedFrame } from './slowmo'
import { MotionDetector, RunningGate, bodyVisible } from './motion'
import { HIP_REF, RUNNING } from '../../core/params'
import { PHRASES } from '../../core/phrases'
import { demoStride, strideStats, DEMO_SPM, REFERENCE } from './ui/figure'
import type { Frame, Session } from '../../core/types'
import type { Measure } from './types'

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

// 検証用の判定（RUNNING.inPlaceForTesting）を入れたときだけ拾う。いまは切っている
function withInPlace<T>(f: () => T): T {
  const before = RUNNING.inPlaceForTesting
  RUNNING.inPlaceForTesting = true
  try {
    return f()
  } finally {
    RUNNING.inPlaceForTesting = before
  }
}

describe('その場で走る・コンパクトなフォーム（検証用の判定を入れたとき）', () => {
  it('いまは切っているので、その場で走るフリは走っていない', () => {
    expect(RUNNING.inPlaceForTesting).toBe(false)
    expect(inPlace(2.8, 25)).toBe(false)
  })
  it('脚を前後に開かなくても、左右が交互に上がるリズムが毎秒2歩以上なら走っている', () => {
    withInPlace(() => {
      expect(inPlace(2.8, 25)).toBe(true)
      expect(inPlace(2.8, 12)).toBe(true) // 小さく持ち上げるだけでも
    })
  })
  it('真横から撮って奥の脚が手前の脚に重なっていても、片脚の上下のリズムで走っていると分かる', () => withInPlace(() => {
    const base = demoStride()[0]
    const md = new MotionDetector()
    let moving = false
    for (let i = 0; i < 45; i++) {
      const t = i / 15
      const up = 25 * Math.max(0, Math.sin(Math.PI * 2.8 * t)) // 手前の脚が毎秒1.4回上がる
      const f = base.map((p) => ({ ...p }))
      for (const [n, k] of [[25, 0.6], [27, 1]] as const) f[n] = { ...f[n], x: base[25 + (n - 25)].x, y: base[n].y - up * k }
      // 奥の脚は手前の脚と同じ位置（推定が重ねて返す）
      f[26] = { ...f[25] }
      f[28] = { ...f[27] }
      moving = md.update(f, t)
    }
    expect(moving).toBe(true)
  }))
  it('立ったまま点が少し揺れるだけなら、走っていない', () => {
    const base = demoStride()[0]
    const md = new MotionDetector()
    let moving = true
    for (let i = 0; i < 45; i++) {
      const j = Math.sin(i * 2.1) * 1.2 // 1px 前後のゆれ
      moving = md.update(base.map((p) => ({ ...p, y: p.y + j })), i / 15)
    }
    expect(moving).toBe(false)
  })
  it('ゆっくり足踏みする、ほとんど持ち上げないときは走っていない', () => withInPlace(() => {
    expect(inPlace(1.2, 25)).toBe(false)
    expect(inPlace(2.8, 1)).toBe(false)
  }))
})

describe('見本の走り', () => {
  // 見本は研究データ（Fukuchi ら 2017）の、着地のすねが鉛直に近い上位4分の1の脚の平均
  it('研究データの接地の長さ・ピッチ・着地のすねの角度になっている', () => {
    const st = strideStats(demoStride({ lean: 7, head: 0, drop: 0 }, 400), 120 / DEMO_SPM)
    const stride = 120 / REFERENCE.cadence
    expect(st.cadence).toBe(REFERENCE.cadence)
    expect(st.contactMs).toBeCloseTo((REFERENCE.ideal.stancePct / 100) * stride * 1000, -1)
    expect(st.flightMsPerStep).toBeGreaterThan(80) // 走りなので、両足が浮いている時間がある
    expect(Math.abs(st.shankAtContact - REFERENCE.ideal.shankAtContact[0])).toBeLessThan(3)
    // 上下動は市民ランナー860人の実測 7.7 ± 1.2cm（Malisoux ら 2023）の範囲。跳ねていないと早歩きに見える
    expect(st.verticalCm).toBeGreaterThan(6.5)
    expect(st.verticalCm).toBeLessThan(8.9)
  })
  it('見本は、データ全体（ふつうの市民ランナー）より着地のすねが鉛直に近い', () => {
    expect(REFERENCE.ideal.shankAtContact[0]).toBeLessThan(REFERENCE.normal.shankAtContact[0] - 3)
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

const good: Measure = { neck: 2, headLean: 12, chin: -20, yaw: 0, trunk: 7, body: 3, hipRatio: 0.9, dir: 1 }
const bent: Measure = { ...good, trunk: 20 }
// 頭が前に出ると、首の角度も頭の位置そのものも増える
const headDown: Measure = { ...good, neck: 14, headLean: 24 }

describe('コーチの流れ', () => {
  it('走り出しで始まり、崩れたら声をかけ、直ったらほめ、止まったら一時停止する', () => {
    const coach = new Coach()
    // 走り出したと決めるのは、直近10秒の8割のコマが走っているとき（最初の1.5秒は歩数を数え始める間で数えない）。
    // そこから2秒続いたら始める
    const s0 = feed(coach, 0, 10, good)
    expect(coach.state).toBe('waiting')
    expect(s0).toEqual([])
    const s1 = feed(coach, 10, 4, good)
    expect(coach.state).toBe('running')
    expect(s1[0]).toContain('始めます')

    const s2 = feed(coach, 14, 13, bent)
    expect(s2.some((x) => x.includes('前かがみになっています'))).toBe(true)

    // 声をかけてから15秒以内に直れば、ほめる
    const s3 = feed(coach, 27, 10, good)
    expect(s3.some((x) => x.includes('いい感じです'))).toBe(true)

    // 止まったと決めるのは、直近10秒の走っているコマが半分を切ったとき。そこから3秒続いたら一時停止
    const s4 = feed(coach, 37, 4, good, false)
    expect(coach.state).toBe('running')
    const s5 = feed(coach, 41, 6, good, false)
    expect(coach.state).toBe('paused')
    expect([...s4, ...s5].some((x) => x.includes('一時停止'))).toBe(true)
  })

  it('安定していると、声なしで確認する時間に入り、保てたら伝える', () => {
    const coach = new Coach()
    const said = feed(coach, 0, 800, good)
    expect(said.some((x) => x.includes('声なしで確認'))).toBe(true)
    expect(coach.cues.find((c) => c.text.includes('声なしで確認'))!.t).toBeGreaterThanOrEqual(360) // 走り始めの基準（3分）からさらに3分
    expect(said.some((x) => x.includes('声なしでも'))).toBe(true)
    expect(coach.quietHeldSec).toBeGreaterThan(250)
  })

  it('声なしの間に大きく崩れたら、確認をやめて声かけに戻る', () => {
    const coach = new Coach()
    feed(coach, 0, 400, good)
    expect(coach.quiet).toBe(true)
    const said = feed(coach, 400, 90, { ...good, neck: 30, headLean: 40 })
    expect(coach.quiet).toBe(false)
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })

  it('終わったら割合と走り姿をまとめる', () => {
    const coach = new Coach()
    feed(coach, 0, 120, good)
    feed(coach, 120, 60, bent)
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

describe('走り始めの自分との比べ', () => {
  it('もともと前傾が大きい人には、決まった線を越えていても、走り始めから変わらなければ声をかけない', () => {
    const coach = new Coach({ pause: false })
    const big: Measure = { ...good, trunk: 16, body: 15 } // 決まった線（上体15°・体全体14°）を越えている
    const said = feedSparse(coach, 0, 400, big).speak
    const after = coach.cues.filter((c) => c.t > 200 && (c.item === 'trunk' || c.item === 'body'))
    expect(after.length).toBe(0)
    expect(said.length).toBeGreaterThan(0) // 最初の3分は決まった線で見る
  })
  it('前傾が小さい人でも、走り始めより大きく倒れたら声をかける', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, { ...good, trunk: 3 })
    const said = feedSparse(coach, 200, 30, { ...good, trunk: 10 }).speak // 決まった線（15°）には届かないが、走り始めより7°大きい
    expect(said.some((x) => x.includes('前かがみになっています'))).toBe(true)
  })
})

describe('頭', () => {
  it('走り始めの3分は頭で声をかけず、そのあとは走り始めの自分より前に出たら声をかける', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 100, { ...good, neck: 20, headLean: 30 }).speak
    expect(a.some((x) => x.includes('頭が前に出ています'))).toBe(false)
    feedSparse(coach, 100, 100, good)
    const b = feedSparse(coach, 200, 20, { ...good, neck: 20, headLean: 30 }).speak // 走り始め（30秒〜3分）の平均より大きく前
    expect(b.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })
  it('頭の位置そのものの一度だけの声は、いまは切っている（アプリの点では、よい姿勢でも線を越えるため）', () => {
    expect(HEAD_ABS.on).toBe(false)
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 230, { ...good, headLean: 40 }).speak
    expect(a.some((x) => x.includes('頭が前に出ています'))).toBe(false)
  })
  it('一度だけの声を入れたときは、走り始めの基準ができたときに一度だけ声をかけ、戻せばほめる', () => {
    HEAD_ABS.on = true
    try {
      const coach = new Coach({ pause: false })
      const fwd: Measure = { ...good, headLean: 30 }
      const a = feedSparse(coach, 0, 200, fwd).speak
      expect(a.filter((x) => x.includes('頭が前に出ています')).length).toBe(1)
      expect(coach.cues.find((c) => c.item === 'head')!.t).toBeGreaterThan(180)
      const b = feedSparse(coach, 200, 15, { ...fwd, neck: -5, headLean: 23 }).speak
      expect(b.some((x) => x.includes('いい感じです'))).toBe(true)
    } finally {
      HEAD_ABS.on = false
    }
  })
  it('斜めから撮っているときは、頭の位置そのものでは声をかけない', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 230, { ...good, headLean: 30, yaw: 0.08 }).speak
    expect(a.some((x) => x.includes('頭が前に出ています'))).toBe(false)
  })
})

describe('前かがみ', () => {
  it('上体が倒れたら声をかけ、起こしたらほめる。一時停止を切っていれば、止まっても走り続ける扱い', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 60, good)
    const a = feedSparse(coach, 60, 10, { ...good, trunk: 20 })
    expect(a.speak.some((x) => x.includes('前かがみになっています'))).toBe(true)
    const b = feedSparse(coach, 70, 12, { ...good, trunk: 11 })
    expect(b.speak.some((x) => x.includes('いい感じです'))).toBe(true)
    feed(coach, 82, 10, good, false)
    expect(coach.state).toBe('running')
  })
})

describe('省電力（間引いて見る）', () => {
  it('走り始めの基準ができるまでは毎コマ見て、そのあと安定している間は3割ほどしか骨格を取らず、それでも崩れたら声をかける', () => {
    const coach = new Coach()
    const w = feedSparse(coach, 0, 200, good)
    expect(coach.leanRef).not.toBeNull()
    expect(w.looked).toBeGreaterThan(0.95)
    const a = feedSparse(coach, 200, 100, good)
    expect(a.looked).toBeLessThan(0.4)
    const b = feedSparse(coach, 300, 20, headDown)
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
    expect(b.looked).toBeGreaterThan(0.6)
  })

  it('点数はまだ高いが、声をかける線を少し越えた崩れでも、間引かずに見て声をかける', () => {
    const coach = new Coach()
    feedSparse(coach, 0, 200, good)
    const b = feedSparse(coach, 200, 20, { ...good, hipRatio: 0.9 * (1 - 0.043) }) // 腰 4.3%：線（4%）は越えるが点数は81
    expect(b.speak.some((x) => x === PHRASES.cueHip)).toBe(true)
  })

  it('間引いても、割合は時間どおりに数える', () => {
    const coach = new Coach()
    feedSparse(coach, 0, 600, good)
    const s = coach.finish()
    expect(s.share.good).toBeGreaterThan(0.95)
    expect(s.strides.good?.frames.length).toBe(36)
  })
})

describe('画面から外れたとき', () => {
  it('走っている途中なら5秒で戻るよう促し、30秒戻らなければ終わる', () => {
    const coach = new Coach()
    feed(coach, 0, 20, good)
    const s1 = absent(coach, 20, 6)
    expect(s1.some((x) => x.includes('戻ってください'))).toBe(true)
    expect(coach.state).toBe('running')
    const s2 = absent(coach, 26, 25)
    expect(coach.state).toBe('ended')
    expect(s2.some((x) => x.includes('ここで終わりにします'))).toBe(true)
  })

  it('戻ってくれば続ける', () => {
    const coach = new Coach()
    feed(coach, 0, 20, good)
    absent(coach, 20, 10)
    feed(coach, 30, 5, good)
    expect(coach.state).toBe('running')
  })

  it('止まってから外れたなら、10秒でおつかれさまでした', () => {
    const coach = new Coach()
    feed(coach, 0, 20, good)
    feed(coach, 20, 10, good, false)
    expect(coach.state).toBe('paused')
    const s = absent(coach, 30, 11)
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
    expect(a.length).toBe(16 + LOG_POINTS.length * 3)
    expect(b.length).toBe(16)
    expect(b[11]).toBe(99)
    expect(rec.log.events).toEqual([[1.5, '始めます。']])
  })
})

describe('スロー動画の分析', () => {
  // 見本の走りを 240fps で3周ぶん撮った動画の代わり。slow 倍に引き延ばすと、iPhone のスロー動画と同じ時間の流れになる
  const clip = (slow: number, over = 0): TimedFrame[] => {
    const stride = 120 / REFERENCE.cadence
    const per = Math.round(stride * 240)
    const one = demoStride({ lean: 7, head: 0, drop: 0, over }, per)
    return Array.from({ length: per * 3 + 10 }, (_, i) => ({ t: (i / 240) * slow, f: one[i % per] }))
  }
  it('実際の速さの240fps動画から、ピッチ・接地時間・着地のすねを出す', () => {
    const r = analyzeRun(clip(1))!
    expect(r.slow).toBe(1)
    expect(r.cadence).toBeCloseTo(REFERENCE.cadence, -1)
    // 見本の足は地面すれすれをゆっくり下りるので、脚の長さの3%以内を「着いている」とすると長めに出る。
    // 実際の走り（研究データの床反力）との比べは sim/placement.sim.ts で行っている
    expect(Math.abs(r.contactMs! - strideStats(demoStride({ lean: 7, head: 0, drop: 0 }, 400), 120 / DEMO_SPM).contactMs)).toBeLessThan(60)
    expect(Math.abs(r.shankAtContact - REFERENCE.ideal.shankAtContact[0])).toBeLessThan(4)
    expect(r.flightMs!).toBeGreaterThan(60)
    expect(r.contacts.length).toBeGreaterThanOrEqual(2)
  })
  it('8倍に引き延ばされたスロー動画でも、倍率を見分けて同じ値を出す', () => {
    const a = analyzeRun(clip(1))!
    const b = analyzeRun(clip(8))!
    expect(b.slow).toBe(8)
    expect(b.cadence).toBeCloseTo(a.cadence, 5)
    expect(b.contactMs!).toBeCloseTo(a.contactMs!, 5)
    expect(b.framesPerSec).toBeCloseTo(240, 0)
  })
  it('点がぶれていても、8倍スローの倍率と接地時間を取り違えない', () => {
    // 脚の長さの0.6%（約0.5cm）の、コマごとにばらばらなぶれを足す
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
    const noisy = clip(8).map(({ t, f }) => ({ t, f: f.map((p) => ({ ...p, x: p.x + rnd(), y: p.y + rnd() })) }))
    const a = analyzeRun(clip(1))!
    const b = analyzeRun(noisy)!
    expect(b.slow).toBe(8)
    expect(Math.abs(b.cadence - a.cadence)).toBeLessThan(5)
    expect(Math.abs(b.contactMs! - a.contactMs!)).toBeLessThan(25)
  })
  it('オーバーストライドの走りは、着地のすねが大きく出る', () => {
    expect(analyzeRun(clip(1, 1))!.shankAtContact).toBeGreaterThan(analyzeRun(clip(1))!.shankAtContact + 10)
  })
})

describe('見下ろしの補正', () => {
  it('下を向いたスマホで撮った線の傾きを、まっすぐ立てて撮ったときの傾きに戻す', () => {
    // 縦640画素・縦の画角106°のカメラを、下に20°向けて、前に10°倒れた線を撮る
    const H = 640
    const W = 480
    const f = H / 2 / Math.tan((53 * Math.PI) / 180)
    const pitch = (20 * Math.PI) / 180
    const shot = (X: number, Y: number, Z: number) => {
      // カメラ座標（x 右・y 下・z 前）。下に向けた分だけ回す
      const y = Y * Math.cos(pitch) - Z * Math.sin(pitch)
      const z = Y * Math.sin(pitch) + Z * Math.cos(pitch)
      return { x: W / 2 + (f * X) / z, y: H / 2 + (f * y) / z, v: 1 }
    }
    const top = shot(0.2, 0.3, 1.5)
    const bottom = shot(0.2 + 0.4 * Math.tan((10 * Math.PI) / 180), 0.7, 1.5)
    const fr = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
    fr[0] = top
    fr[1] = bottom
    const lv = levelFrame(fr, 20, 106, W, H)
    const ang = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI
    expect(Math.abs(ang(top, bottom) - 10)).toBeGreaterThan(1) // そのままだとずれる
    expect(ang(lv[0], lv[1])).toBeCloseTo(10, 1)
  })
})

describe('次の一歩', () => {
  it('理想との差が一番大きい項目を1つだけ選ぶ', () => {
    const s = { strides: { good: { frames: [], dir: 1, score: 90, avg: { head: 2, trunk: 12, body: 4, hipDrop: 1 } } } } as unknown as Session
    expect(nextItem(s)?.item).toBe('trunk')
  })
})

describe('ランナーのレベル', () => {
  it('注意していない項目は、少しの崩れでは声をかけず、大きく崩れたら声をかける', () => {
    const coach = new Coach({ pause: false, items: ['trunk', 'body'] })
    feedSparse(coach, 0, 200, good)
    const small = feedSparse(coach, 200, 20, { ...good, neck: 9, headLean: 19 }).speak // 頭 +7°：線（5°）は越えるが点数は80
    expect(small.some((x) => x.includes('頭が前に出ています'))).toBe(false)
    const big = feedSparse(coach, 220, 30, { ...good, neck: 15, headLean: 25 }).speak // 頭 +13°：点数20
    expect(big.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })

  it('頭を見ていない段階では、最初から頭が前に出ていても3分の時点で声をかけない', () => {
    const coach = new Coach({ pause: false, items: ['trunk', 'body'] })
    const said = feedSparse(coach, 0, 230, { ...good, headLean: 30 }).speak
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(false)
  })
})

describe('調整用の記録の時計', () => {
  it('カメラで撮るときは performance.now() とふつうの時刻の対応を残し、動画のときは残さない', () => {
    const live = new LogRecorder({ perfMs: 12345, epochMs: 1_760_000_000_000 })
    expect(live.log.clock).toEqual({ perfMs: 12345, epochMs: 1_760_000_000_000 })
    expect(live.log.startedAt).toBe(1_760_000_000_000)
    expect(new LogRecorder().log.clock).toBeUndefined()
  })
})

describe('全コマ記録（検証用）', () => {
  it('URL に ?full=1 があるときだけ', () => {
    expect(fullFrames('?full=1')).toBe(true)
    expect(fullFrames('?x=2&full=1')).toBe(true)
    expect(fullFrames('')).toBe(false)
    expect(fullFrames('?full=0')).toBe(false)
    expect(fullFrames('?full')).toBe(false)
  })
})

describe('走り始め・止まり（直近のコマの割合）', () => {
  // 1コマずつの判定を毎秒 fps コマ流す。on(t) が「走っている」か。返すのは、gate が走っていると決めた最初の時刻
  const drive = (g: RunningGate, from: number, sec: number, on: (t: number) => boolean, fps = 15) => {
    let first: number | null = null
    for (let i = 0; i < sec * fps; i++) {
      const t = from + i / fps
      g.push(t, on(t))
      if (g.running && first === null) first = t
    }
    return first
  }

  it('歩きで、ときどきピッチが走りの線を越えるコマが混ざっても（3割）、走り出したとはしない', () => {
    const g = new RunningGate()
    // 1秒のうち 0.3 秒だけ「走っている」（歩きでも、16%のコマでピッチが130歩以上に出た）
    expect(drive(g, 0, 120, (t) => t % 1 < 0.3)).toBeNull()
    // 2秒のうち1.3秒（65%）でも、まだ走り出さない
    expect(drive(g, 120, 60, (t) => t % 2 < 1.3)).toBeNull()
  })

  it('走り出したら、約 ratioWindow × startRatio 秒で走っていると決める', () => {
    const g = new RunningGate()
    drive(g, 0, 30, () => false)
    const first = drive(g, 30, 20, () => true)!
    expect(first - 30).toBeGreaterThan(RUNNING.ratioWindow * RUNNING.startRatio - 1)
    expect(first - 30).toBeLessThan(RUNNING.ratioWindow * RUNNING.startRatio + 1)
  })

  it('見ていない間があいた直後のコマは数えない。間引いて見ている間（10秒のうち3秒）に、走っているのに止まったとはしない', () => {
    const g = new RunningGate()
    drive(g, 0, 20, () => true)
    expect(g.running).toBe(true)
    // 3秒見て7秒休む。見始めの1秒は、歩数を数え直している間で「走っていない」と出る
    for (let k = 0; k < 20; k++) {
      const t0 = 20 + k * 10
      drive(g, t0, 3, (t) => t - t0 >= 1)
      expect(g.running).toBe(true)
    }
  })

  it('止まったら（走っているコマが半分を切ったら）止まったとし、続けて見ていないと走り出したとはしない', () => {
    const g = new RunningGate()
    drive(g, 0, 20, () => true)
    drive(g, 20, 8, () => false)
    expect(g.running).toBe(false)
    // 間引いた飛び飛びのコマ（3秒おきの0.5秒）がすべて「走っている」でも、続けて見ていないので決めない
    for (let k = 0; k < 10; k++) drive(g, 30 + k * 3, 2, () => true, 1)
    expect(g.running).toBe(false)
  })
})

describe('走り始めの基準は、歩数で走っていた秒だけで作る', () => {
  const walk: Measure = { ...good, trunk: 1, body: 1, neck: 0, hipRatio: 0.95 }

  it('歩きのコマ（走っていない）は、走っているかの割合で始まらないので、基準に入らない', () => {
    const coach = new Coach({ pause: false })
    // 歩き：1秒のうち2割のコマだけ「走っている」と出る
    let t = 0
    for (; t < 120; t += 1 / 30) coach.update({ t, present: true, moving: t % 1 < 0.2, m: walk })
    expect(coach.state).toBe('waiting')
    feed(coach, 120, 200, good)
    expect(coach.state).toBe('running')
    expect(coach.leanRef!.trunk).toBeCloseTo(good.trunk, 5)
    expect(coach.leanRef!.body).toBeCloseTo(good.body, 5)
  })

  it('基準ができる前に止まったら、ためた分を捨てて、次に走り出したところから作り直す', () => {
    const coach = new Coach({ pause: false })
    feed(coach, 0, 100, walk) // 走っている（moving）が、基準ができる前に止まる
    expect(coach.refSeconds).toBeGreaterThan(30)
    feed(coach, 100, 20, walk, false)
    expect(coach.refSeconds).toBe(0)
    expect(coach.state).toBe('running') // 一時停止は切っている
    expect(coach.leanRef).toBeNull()
    feed(coach, 120, 230, good)
    expect(coach.leanRef).not.toBeNull()
    expect(coach.leanRef!.trunk).toBeCloseTo(good.trunk, 5)
    // 歩きの姿勢（上体 1°）を基準にしていないので、ふつうの姿勢（上体 7°）で声はかからない
    expect(coach.cues.filter((c) => ['head', 'trunk', 'body', 'hip'].includes(c.item))).toEqual([])
  })

  it('基準ができてから止まっても、基準は作り直さない', () => {
    const coach = new Coach({ pause: false })
    feed(coach, 0, HIP_REF.to + 20, good)
    const ref = coach.leanRef
    expect(ref).not.toBeNull()
    feed(coach, HIP_REF.to + 20, 20, walk, false)
    feed(coach, HIP_REF.to + 40, 30, walk)
    expect(coach.leanRef).toBe(ref)
  })
})

describe('起きすぎ（上体・体全体が後ろへ）', () => {
  it('走り始めより上体が起きたら「上体が起きています」、体全体が後ろに残ったら「体が後ろに残っています」', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    const a = feedSparse(coach, 200, 30, { ...good, trunk: 1 }).speak // 走り始めより6°起きた（決まった線の 5° より後ろではない）
    expect(a).toContain(PHRASES.cueTrunkBack)
    const coach2 = new Coach({ pause: false })
    feedSparse(coach2, 0, 200, good)
    const b = feedSparse(coach2, 200, 30, { ...good, body: -1.5 }).speak // 体全体が走り始めより 4.5° 後ろ
    expect(b).toContain(PHRASES.cueBodyBack)
  })
  it('走り始めから同じ傾きなら、もともと上体が起きている人にも声をかけない。基準の前は、はっきり後ろに傾いたときだけ', () => {
    const coach = new Coach({ pause: false })
    const said = feedSparse(coach, 0, 400, { ...good, trunk: -2, body: 2 }).speak
    expect(said.some((x) => x === PHRASES.cueTrunkBack || x === PHRASES.cueBodyBack)).toBe(false)
    const coach2 = new Coach({ pause: false })
    const early = feedSparse(coach2, 0, 60, { ...good, trunk: -8 }).speak // 上体が鉛直より 8° 後ろ
    expect(early).toContain(PHRASES.cueTrunkBack)
  })
  it('歩いている秒は、起きすぎを判定しない（歩くと上体も体全体も起きる）', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    const walk: Measure = { ...good, trunk: 0, body: 0 }
    const speak: string[] = []
    for (let i = 0; i < 60 * 15; i++) for (const e of coach.update({ t: 200 + i / 15, present: true, moving: false, m: walk })) if (e.type === 'speak') speak.push(e.text)
    expect(speak.some((x) => x === PHRASES.cueTrunkBack || x === PHRASES.cueBodyBack)).toBe(false)
  })
  it('起きすぎの値は、走り始めから後ろへ傾いた量を、決まった線の目盛りに直したもの', () => {
    expect(toScale('trunkBack', REL_LIMITS.trunkBack.cue)).toBeCloseTo(LIMITS.trunkBack.cue)
    expect(toScale('bodyBack', REL_LIMITS.bodyBack.zero)).toBeCloseTo(LIMITS.bodyBack.zero)
    expect(toScale('bodyBack', 0)).toBeLessThan(LIMITS.bodyBack.full)
  })
})

describe('頭が前に出た量', () => {
  it('上体が起きて首の角度だけが増えたとき（頭の位置そのものは同じ）は、頭の声をかけない', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    // 上体 7° → −2°（9°起きた）。首の角度 = 肩→耳 − 腰→肩 なので +9° 増えるが、肩→耳（頭の位置）は 12° のまま
    const said = feedSparse(coach, 200, 40, { ...good, trunk: -2, neck: 11 }).speak
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(false)
    expect(said).toContain(PHRASES.cueTrunkBack)
  })
  it('首の角度と頭の位置そのものの増えの、小さいほう', () => {
    expect(headForward(9, 0.5)).toBe(0.5)
    expect(headForward(10, 14)).toBe(10)
  })
})

describe('顎（測るだけ）', () => {
  it('走り始めからの変化に、上体の変化を足して記録する。声はかけない', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    const said = feedSparse(coach, 200, 30, { ...good, chin: 0 }).speak // 顎が 20° 上がった
    expect(coach.samples[coach.samples.length - 1].chin).toBeCloseTo(20, 0)
    expect(said.some((x) => x.includes('顎'))).toBe(false)
    feedSparse(coach, 230, 10, { ...good, chin: -15, trunk: 2 }) // 上体が5°起きて、頭もいっしょに5°上を向いた分は差し引く
    expect(coach.samples[coach.samples.length - 1].chin).toBeCloseTo(0, 0)
  })
})

describe('声なしの見守り中', () => {
  it('声をかける項目が線を越えたら、点数の平均が下がるのを待たずに見守りをやめて声をかける', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 420, good)
    expect(coach.quiet).toBe(true)
    // 頭 +9°：線（8°）は越えるが、点数は 60 点（「ふつう」の線 50 点は切らない）
    const said = feedSparse(coach, 420, 40, { ...good, neck: 11, headLean: 21 }).speak
    expect(coach.quiet).toBe(false)
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })
  it('注意していない項目は、見守り中も小さな崩れでは声をかけない', () => {
    const coach = new Coach({ pause: false, items: ['trunk', 'body'] })
    feedSparse(coach, 0, 420, good)
    expect(coach.quiet).toBe(true)
    const said = feedSparse(coach, 420, 40, { ...good, neck: 11, headLean: 21 }).speak
    expect(said.some((x) => x.includes('頭が前に出ています'))).toBe(false)
  })
})

describe('ランナーのレベル（起きすぎ）', () => {
  it('起きすぎは、腰の段階で足す（最初の段階の「背を高く」と食い違わないように）', () => {
    expect(activeItems(0)).not.toContain('trunkBack')
    expect(activeItems(1)).toEqual(expect.arrayContaining(['hip', 'trunkBack', 'bodyBack']))
  })
})

describe('基準ができる前の体全体', () => {
  it('BEFORE_REF.body より小さい傾きは、決まった線（14°）を越えていても声をかけない。はっきり大きいときは声をかける', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 120, { ...good, body: (LIMITS.body.cue + BEFORE_REF.body) / 2 }).speak
    expect(a).not.toContain(PHRASES.cueBody)
    const coach2 = new Coach({ pause: false })
    const b = feedSparse(coach2, 0, 120, { ...good, body: BEFORE_REF.body + 2 }).speak
    expect(b).toContain(PHRASES.cueBody)
  })
})
