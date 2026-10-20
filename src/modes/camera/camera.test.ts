import { describe, expect, it } from 'vitest'
import { levelFrame, measure, rotateFrame, sideOffDeg } from './geometry'
import { itemScore, postureScore } from './scoring'
import { Coach, headForward, toScale } from './coach'
import { FORM, GOOD, LIMITS, REL_LIMITS, SETUP } from './params'
import { formOver, formScale } from './form'
import { activeItems, startPhrase, startProgress, STEPS } from '../../core/level'
import { formRows, gapSentence, gapState, goodGap, HEAD_NOTE, nextItem, NEXT_TEXT, todayFocus } from './nextStep'
import { capBaseline, standingIssue } from './standing'
import { LogRecorder, LOG_POINTS } from './log'
import { fullFrames } from './fullFrames'
import { analyzeRun, type TimedFrame } from './slowmo'
import { MotionDetector, RunningGate, bodyVisible } from './motion'
import { HIP_REF, RUNNING } from '../../core/params'
import { FOCUS, PHRASES, phraseId } from '../../core/phrases'
import { demoStride, strideStats, DEMO_SPM, REFERENCE } from './ui/figure'
import type { FormGroup, FormResult, Frame, Session } from '../../core/types'
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

// ふつうの走り：正しいフォームの線（FORM）の内側（体全体 5.5〜15°、上体 −2〜12°、頭は首 48°・頭の位置 52° まで）
const good: Measure = { neck: 2, headLean: 12, chin: -20, yaw: 0, trunk: 7, body: 9, hipRatio: 0.9, dir: 1 }
const bent: Measure = { ...good, trunk: 20 }
// 頭が前に出ると、首の角度も頭の位置そのものも増える
const headDown: Measure = { ...good, neck: 14, headLean: 24 }

describe('コーチの流れ', () => {
  it('走り出しで始まり、正しいフォームから外れていたら声をかけ、入ったら伝え、止まったら一時停止する', () => {
    const coach = new Coach()
    // 走り出したと決めるのは、直近10秒の8割のコマが走っているとき（最初の1.5秒は歩数を数え始める間で数えない）。
    // そこから2秒続いたら始める
    const s0 = feed(coach, 0, 10, good)
    expect(coach.state).toBe('waiting')
    expect(s0).toEqual([])
    const s1 = feed(coach, 10, 4, good)
    expect(coach.state).toBe('running')
    expect(s1[0]).toContain('始めます')

    // 走り出しに整える：上体 20°（正しいフォームの線 12° を越えた前かがみ）
    const s2 = feed(coach, 14, 30, bent)
    expect(s2.some((x) => x.includes('前かがみになっています'))).toBe(true)

    // 線の内側に入って保てたら「その形です」、全部そろったら「整いました」
    const s3 = feed(coach, 44, 20, good)
    expect(s3).toContain(PHRASES.formOk)
    expect(s3).toContain(PHRASES.formSet)

    // 止まったと決めるのは、直近10秒の走っているコマが半分を切ったとき。そこから3秒続いたら一時停止
    const s4 = feed(coach, 64, 4, good, false)
    expect(coach.state).toBe('running')
    const s5 = feed(coach, 68, 6, good, false)
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

  it('終わったら割合と走り姿と、正しいフォームとの比べをまとめる', () => {
    const coach = new Coach()
    feed(coach, 0, 120, good)
    feed(coach, 120, 60, bent)
    const s = coach.finish()
    expect(s.share.good + s.share.mid + s.share.bad).toBeCloseTo(1, 5)
    expect(s.share.good).toBeGreaterThan(0.5)
    expect(s.strides.good?.frames.length).toBe(36)
    expect(s.strides.bad).toBeDefined()
    const trunk = s.form!.find((r) => r.group === 'trunk')!
    expect(trunk.value).toBeGreaterThan(good.trunk)
    expect(trunk.cues).toBeGreaterThan(0)
    expect(s.form!.map((r) => r.group)).toEqual(['body', 'landing', 'trunk', 'head'])
    // 見本の走りの着地（速さで補正したかかとの前）は、試しの線の内側
    const landing = s.form!.find((r) => r.group === 'landing')!
    expect(landing.over).toBeLessThan(0)
    expect(landing.cues).toBe(0)
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

describe('今日の基準（整えたあとの形）との比べ', () => {
  it('正しいフォームの線を越えた前傾のままの人には、整える間に3回まで言い、そのあとは5分に1回。基準は線そのもの', () => {
    const coach = new Coach({ pause: false })
    const big: Measure = { ...good, trunk: 16, body: 12 } // 上体が線（12°）を越えている
    feedSparse(coach, 0, 400, big)
    const trunk = coach.cues.filter((c) => c.item === 'trunk')
    expect(trunk.filter((c) => c.t < 200).length).toBe(FORM.tries)
    expect(trunk.filter((c) => c.t >= 200).length).toBeLessThanOrEqual(1)
    expect(trunk.every((c) => c.lead)).toBe(true)
    expect(coach.cues.some((c) => c.text === PHRASES.formSet || c.text === PHRASES.formGood)).toBe(false) // 整ったとは言わない
    expect(coach.leanRef!.trunk).toBe(FORM.trunk.max)
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
  it('最初から頭がはっきり前に出ていれば（首の角度と頭の位置の両方が線を越える）、整える間に知らせる', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 60, { ...good, neck: FORM.head.neck + 7, headLean: FORM.head.headLean + 14 }).speak
    expect(a).toContain(PHRASES.cueHead)
    expect(coach.cues.find((c) => c.item === 'head')!.lead).toBe(true)
  })
  it('片方だけが線を越えたとき（頭の位置だけ・首の角度だけ）は、頭の声をかけない', () => {
    const c1 = new Coach({ pause: false })
    const a = feedSparse(c1, 0, 230, { ...good, neck: 30, headLean: FORM.head.headLean + 10 }).speak
    expect(a).not.toContain(PHRASES.cueHead)
    const c2 = new Coach({ pause: false })
    const b = feedSparse(c2, 0, 230, { ...good, neck: FORM.head.neck + 10, headLean: 40 }).speak
    expect(b).not.toContain(PHRASES.cueHead)
  })
  it('斜めから撮っているように見えるとき（前側・後ろ側の値が FORM.head.yawMax を越える）は、頭を正しいフォームの線と比べない', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 230, { ...good, neck: 60, headLean: 70, yaw: FORM.head.yawMax + 0.05 }).speak
    expect(a).not.toContain(PHRASES.cueHead)
    expect(coach.finish().form!.find((r) => r.group === 'head')!.judged).toBe(false)
  })
})

describe('前かがみ', () => {
  it('整えたあとも、正しいフォームの線を越えて倒れたら声をかけ、戻せば伝える。一時停止を切っていれば、止まっても走り続ける扱い', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 60, good)
    expect(coach.formDone).toBe(true)
    const a = feedSparse(coach, 60, 15, { ...good, trunk: 20 })
    expect(a.speak.some((x) => x.includes('前かがみになっています'))).toBe(true)
    const b = feedSparse(coach, 75, 15, { ...good, trunk: 9 })
    expect(b.speak).toContain(PHRASES.formOk)
    feed(coach, 90, 10, good, false)
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
  it('声をかける線（正しいフォームの線）の外の項目があれば、一番外れていたものを1つだけ選ぶ（離れ方は、0点までの幅で割って比べる）', () => {
    const form = (body: number, trunk: number, neck: number): Session['form'] =>
      (['body', 'trunk', 'head'] as const).map((g) => {
        const o = formOver(g, { body, trunk, neck, headLean: neck + 10 })
        return { group: g, key: o.key, value: g === 'body' ? body : g === 'trunk' ? trunk : neck, over: o.over, inside: 0, cues: 0, fixed: false, judged: true }
      })
    const at = (f: Session['form']) => nextItem({ form: f, strides: {} } as unknown as Session)
    expect(at(form(4, 13, 30))).toMatchObject({ kind: 'line', item: 'bodyBack', from: 4, to: FORM.body.min }) // 体全体 1.5/4 > 上体 1/6
    expect(at(form(9, 16, 30))?.item).toBe('trunk')
    expect(at(form(9, 7, 30))).toBeUndefined() // 全部が線の内側で、よい例の範囲にも入っている
  })
  it('正しいフォームとの比べがない前の版の記録は、良い姿勢の1歩の平均で見る', () => {
    const s = { strides: { good: { frames: [], dir: 1, score: 90, avg: { head: 2, trunk: 14, body: 9, hipDrop: 1 } } } } as unknown as Session
    expect(nextItem(s)?.item).toBe('trunk')
  })
})

// その走りの正しいフォームとの比べ（Session.form）を作る。指定しない値は、よい例の真ん中
const formOf = (group: FormGroup, value: number, extra: Partial<FormResult> = {}): FormResult => {
  const v = { body: GOOD.body.mid, trunk: GOOD.trunk.mid, neck: GOOD.head.neck.mid, headLean: extra.value2 ?? GOOD.head.headLean.mid, [group === 'head' ? 'neck' : group]: value }
  const o = formOver(group, v)
  return { group, key: o.key, value, over: o.over, inside: 1, cues: 0, fixed: false, judged: true, ...(group === 'head' ? { value2: v.headLean } : {}), ...extra }
}
const runOf = (body: number, trunk: number, neck: number, headLean: number, yaw = 0.01): Session =>
  ({
    id: 'r',
    startedAt: 0,
    durationSec: 900,
    samples: [],
    cues: [],
    strides: {},
    share: { good: 1, mid: 0, bad: 0 },
    quietHeldSec: 0,
    form: [formOf('body', body), formOf('trunk', trunk), formOf('head', neck, { value2: headLean, yaw })],
  }) as Session

describe('よい例との差', () => {
  it('差は、よい例の範囲の外にいた量。内側なら 0 で、近いほうの端の側', () => {
    expect(goodGap({ group: 'body', value: GOOD.body.min - 0.8 })).toEqual({ key: 'bodyBack', gap: expect.closeTo(0.8, 5) })
    expect(goodGap({ group: 'body', value: GOOD.body.max + 0.4 })).toEqual({ key: 'body', gap: expect.closeTo(0.4, 5) })
    expect(goodGap({ group: 'body', value: GOOD.body.max - 0.2 })).toEqual({ key: 'body', gap: 0 })
    expect(goodGap({ group: 'trunk', value: GOOD.trunk.min - 1 })).toEqual({ key: 'trunkBack', gap: expect.closeTo(1, 5) })
    expect(goodGap({ group: 'trunk', value: GOOD.trunk.max + 1.5 })).toEqual({ key: 'trunk', gap: expect.closeTo(1.5, 5) })
  })

  it('頭は前に出た側だけを見て、首の角度と頭の位置の両方が上の端を越えたときに、越えた量の小さいほう', () => {
    expect(goodGap({ group: 'head', value: GOOD.head.neck.max + 5, value2: GOOD.head.headLean.max + 2 }).gap).toBeCloseTo(2, 5)
    expect(goodGap({ group: 'head', value: GOOD.head.neck.max + 5, value2: GOOD.head.headLean.max - 1 }).gap).toBe(0) // 首の角度だけ（上体が起きた）
    expect(goodGap({ group: 'head', value: GOOD.head.neck.max - 3, value2: GOOD.head.headLean.max + 6 }).gap).toBe(0) // 頭の位置だけ（体ごと前）
    expect(goodGap({ group: 'head', value: GOOD.head.neck.min - 10, value2: GOOD.head.headLean.min - 10 }).gap).toBe(0) // 後ろ側は見ない
    expect(goodGap({ group: 'head', value: GOOD.head.neck.max + 4 }).gap).toBeCloseTo(4, 5) // 頭の位置がない記録は首の角度だけ
  })

  it('画面に出す数字（小数1桁）で、範囲の内側・ほぼ同じ・離れているを分ける', () => {
    expect(gapState('body', 0.04)).toBe('in') // 「0°」の差は言わない
    expect(gapState('body', GOOD.body.near - 0.2)).toBe('near')
    expect(gapState('body', GOOD.body.near)).toBe('off')
    expect(gapState('trunk', GOOD.trunk.near - 0.04)).toBe('off') // 画面では near と同じ数字になる
    expect(gapState('head', GOOD.head.near - 0.1)).toBe('near')
  })

  it('結果の画面の行：差（主役）、あなたの値とよい例の範囲、声をかける線との比べ', () => {
    const rows = formRows(runOf(GOOD.body.min - 0.8, GOOD.trunk.mid, GOOD.head.neck.max + 5.1, GOOD.head.headLean.max + 1.9, SETUP.frontMax + 0.02).form!)
    expect(rows.map((r) => r.label)).toEqual(['体全体の前傾', '上体の前傾', '頭の位置'])
    expect(rows[0]).toMatchObject({ state: 'off', gap: '0.8°', word: '起きています', you: `${GOOD.body.min - 0.8}°`, good: `${GOOD.body.min}°〜${GOOD.body.max}°`, lineOut: false })
    expect(rows[0].line).toBe(`声をかける線 ${FORM.body.min}°〜${FORM.body.max}°：内側でした`)
    expect(gapSentence(rows[0])).toBe('よい例より 0.8° 起きています')
    expect(rows[0].note).toBeUndefined()
    expect(gapSentence(rows[1])).toBe('よい例の範囲です')
    expect(rows[1].line).toBe(`声をかける線 後ろ${-FORM.trunk.min}°〜${FORM.trunk.max}°：内側でした`)
    // 頭：差は 1.9°（頭の位置）で、ほぼ同じ。スマホが前側から撮っていたように見えたので、数字は出したまま注意を添える
    expect(rows[2]).toMatchObject({ state: 'near', gap: '1.9°', word: '前に出ています', good: `首${GOOD.head.neck.max}°・頭の位置${GOOD.head.headLean.max}°まで`, note: HEAD_NOTE })
    expect(rows[2].you).toBe(`首${Math.round((GOOD.head.neck.max + 5.1) * 10) / 10}°・頭の位置${Math.round((GOOD.head.headLean.max + 1.9) * 10) / 10}°`)
    expect(gapSentence(rows[2])).toBe('よい例より 1.9° 前に出ています（ほぼ同じ）')
    expect(rows[2].line).toBe(`声をかける線 首${FORM.head.neck}°と頭の位置${FORM.head.headLean}°：内側でした`)
    // 真横から撮れていれば、注意は出さない
    expect(formRows(runOf(8, 7, 36, 39.7, SETUP.frontMax - 0.02).form!)[2].note).toBeUndefined()
  })

  it('声をかける線との比べは、外れていたか・声をかけて直ったかを添える', () => {
    const out = formRows([formOf('body', FORM.body.min - 1, { cues: FORM.tries, fixed: false })])[0]
    expect(out.lineOut).toBe(true)
    expect(out.line).toBe(`声をかける線 ${FORM.body.min}°〜${FORM.body.max}°：外でした（声をかけても、内側に入りませんでした）`)
    expect(gapSentence(out)).toBe(`よい例より ${Math.round((GOOD.body.min - FORM.body.min + 1) * 10) / 10}° 起きています`)
    expect(formRows([formOf('trunk', GOOD.trunk.mid, { cues: 1, fixed: true })])[0].line).toContain('声をかけて、内側に入りました')
    expect(formRows([formOf('head', 60, { value2: 70, judged: false })])[0].line).toContain('比べていません')
  })

  it('線の外の項目がなければ、よい例から一番離れていた項目を選ぶ（0点までの幅で割って比べ、ほぼ同じのものは選ばない）', () => {
    // 体全体 0.8°（÷4 = 0.2）と上体 1.8°（÷6 = 0.3）なら上体
    expect(nextItem(runOf(GOOD.body.min - 0.8, GOOD.trunk.min - 1.8, 30, 35))).toMatchObject({ kind: 'good', item: 'trunkBack', group: 'trunk', to: GOOD.trunk.min, gap: expect.closeTo(1.8, 5) })
    // 体全体 1.4°（0.35）なら体全体。線（5.5°）の内側
    expect(nextItem(runOf(GOOD.body.min - 1.4, GOOD.trunk.min - 1.8, 30, 35))).toMatchObject({ kind: 'good', item: 'bodyBack', to: GOOD.body.min })
    expect(nextItem(runOf(GOOD.body.max + 1, GOOD.trunk.mid, 30, 35))).toMatchObject({ kind: 'good', item: 'body', to: GOOD.body.max })
    // どれも near より小さい差なら、選ばない
    expect(nextItem(runOf(GOOD.body.min - 0.3, GOOD.trunk.min - 0.5, GOOD.head.neck.max + 5, GOOD.head.headLean.max + 2))).toBeUndefined()
    // 線の外の項目は、よい例との差より先
    expect(nextItem(runOf(GOOD.body.min - 1.4, FORM.trunk.max + 1, 30, 35))).toMatchObject({ kind: 'line', item: 'trunk', to: FORM.trunk.max })
  })

  it('頭は、首の角度と頭の位置の小さいほうの差で選ぶ。スマホが前側から撮っていたように見えた走りでは選ばない', () => {
    const n = nextItem(runOf(GOOD.body.mid, GOOD.trunk.mid, GOOD.head.neck.max + 6, GOOD.head.headLean.max + 4))
    expect(n).toMatchObject({ kind: 'good', item: 'head', gap: expect.closeTo(4, 5) })
    expect(n!.from - n!.to).toBeCloseTo(4, 5) // 走り姿の「次の一歩」は、頭を差の分だけ戻した形
    const front = SETUP.frontMax + 0.02
    expect(nextItem(runOf(GOOD.body.mid, GOOD.trunk.mid, GOOD.head.neck.max + 6, GOOD.head.headLean.max + 4, front))).toBeUndefined()
    expect(nextItem(runOf(GOOD.body.min - 1, GOOD.trunk.mid, GOOD.head.neck.max + 6, GOOD.head.headLean.max + 4, front))?.item).toBe('bodyBack')
  })

  it('結果の頭には、走っていた秒の前側・後ろ側の値の平均を残す', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 120, { ...good, yaw: SETUP.frontMax + 0.03 })
    const form = coach.finish().form!
    const head = form.find((r) => r.group === 'head')!
    expect(head.yaw).toBeCloseTo(SETUP.frontMax + 0.03, 5)
    expect(head.judged).toBe(true) // 線と比べるのをやめる yawMax よりは小さい
    expect(formRows(form).find((r) => r.group === 'head')!.note).toBe(HEAD_NOTE)
    expect(form.find((r) => r.group === 'body')!.yaw).toBeUndefined()
  })
})

describe('今日の意識（ホームと、走り出す前の声は同じ1つ）', () => {
  it('前回の走りで、よい例から一番離れていた項目を、ホームにも声にも出す', () => {
    const f = todayFocus([runOf(GOOD.body.min - 0.8, GOOD.trunk.mid, 30, 35)], startProgress('beginner'))
    expect(f).toMatchObject({ item: 'bodyBack', title: NEXT_TEXT.bodyBack.title, say: PHRASES.focusBodyBack })
    expect(f.reason).toContain('よい例より 0.8° 起きていました')
    expect(f.next).toMatchObject({ kind: 'good', item: 'bodyBack' }) // ホームの走り姿も、この1つだけを変えて見せる
  })

  it('前回、声をかける線の外の項目があれば、それを（レベルの段階より先に）', () => {
    const f = todayFocus([runOf(GOOD.body.mid, FORM.trunk.max + 2, 30, 35)], startProgress('beginner'))
    expect(f).toMatchObject({ item: 'trunk', title: NEXT_TEXT.trunk.title, say: PHRASES.focusUpright })
    expect(f.reason).toContain('声をかける線')
    for (const [body, trunk] of [[GOOD.body.max + 2, GOOD.trunk.mid], [GOOD.body.mid, GOOD.trunk.min - 2]]) {
      const g = todayFocus([runOf(body, trunk, 30, 35)], startProgress('advanced'))
      expect(g.say).toBe(FOCUS[g.item!])
    }
  })

  it('よい例とほぼ同じなら、レベルの段階のこと（すべて見る段階なら、すべての項目を見ます）。声も同じ', () => {
    const s = runOf(GOOD.body.min - 0.2, GOOD.trunk.mid, 30, 35)
    const p = startProgress('beginner')
    const f = todayFocus([s], p)
    expect(f).toMatchObject({ title: STEPS[0].title, say: startPhrase(p) })
    expect(f.item).toBeUndefined()
    expect(todayFocus([s], startProgress('advanced'))).toMatchObject({ title: 'すべての項目を見ます', say: PHRASES.focusAll })
    expect(todayFocus([], p)).toMatchObject({ title: STEPS[0].title, say: PHRASES.focusUpright }) // まだ走っていない
  })

  it('段階が上がった次の走りは、新しく見る段階のことを伝える（前回の差より先に、1回だけ）', () => {
    const s = runOf(GOOD.body.min - 0.8, GOOD.trunk.mid, 30, 35)
    const up = { ...startProgress('beginner'), step: 1, justUp: true }
    expect(todayFocus([s], up)).toMatchObject({ title: STEPS[1].title, reason: PHRASES.stepHip, say: PHRASES.stepHip })
    expect(todayFocus([s], { ...up, justUp: false }).item).toBe('bodyBack')
  })

  it('項目ごとの言葉はどれも PHRASES にあり、音声がある', () => {
    const voices = Object.keys(import.meta.glob('../../../public/voices/female/*.m4a'))
    for (const text of Object.values(FOCUS)) {
      const id = phraseId(text)
      expect(id).toBeDefined()
      expect(voices).toContain(`../../../public/voices/female/${id}.m4a`)
    }
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

  it('正しいフォームの線で整える声は、どのレベルでもかける（頭を見ていない段階でも、頭がはっきり前なら言う）', () => {
    const coach = new Coach({ pause: false, items: ['trunk', 'body'] })
    const said = feedSparse(coach, 0, 90, { ...good, neck: FORM.head.neck + 8, headLean: FORM.head.headLean + 12 }).speak
    expect(said).toContain(PHRASES.cueHead)
    const c2 = new Coach({ pause: false, items: ['trunk', 'body'] })
    expect(feedSparse(c2, 0, 230, { ...good, headLean: 30 }).speak).not.toContain(PHRASES.cueHead) // 線の内側
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

describe('今日の基準は、歩数で走っていた秒だけで作る', () => {
  const walk: Measure = { ...good, trunk: 1, body: 1, neck: 0, hipRatio: 0.95 }
  // 正しいフォームの線の内側だが、ふつうの形とは違う走り（基準を作り直すかを見る）
  const other: Measure = { ...good, trunk: 3, body: 6, neck: 0, hipRatio: 0.95 }

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

  it('基準ができる前に止まったら、ためた分を捨てて、次に走り出したところから整え直す', () => {
    const coach = new Coach({ pause: false })
    feed(coach, 0, 100, other) // 走っている（moving）が、基準ができる前に止まる
    expect(coach.refSeconds).toBeGreaterThan(30)
    feed(coach, 100, 20, other, false)
    expect(coach.refSeconds).toBe(0)
    expect(coach.formDone).toBe(false)
    expect(coach.state).toBe('running') // 一時停止は切っている
    expect(coach.leanRef).toBeNull()
    feed(coach, 120, 230, good)
    expect(coach.leanRef).not.toBeNull()
    expect(coach.leanRef!.trunk).toBeCloseTo(good.trunk, 5)
    // 止まる前の形（上体 3°）を基準にしていないので、ふつうの姿勢（上体 7°）で声はかからない
    expect(coach.cues.filter((c) => ['head', 'trunk', 'body', 'hip'].includes(c.item))).toEqual([])
    expect(coach.cues.filter((c) => c.text === PHRASES.formGood).length).toBe(2) // 走り出すたびに整える
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
  it('今日の基準より上体が起きたら「上体が起きています」、体全体が後ろに残ったら「体が後ろに残っています」', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    const a = feedSparse(coach, 200, 30, { ...good, trunk: 1 }).speak // 基準より6°起きた（正しいフォームの線 −2° より後ろではない）
    expect(a).toContain(PHRASES.cueTrunkBack)
    const coach2 = new Coach({ pause: false })
    feedSparse(coach2, 0, 200, good)
    const b = feedSparse(coach2, 200, 30, { ...good, body: 4.5 }).speak // 体全体が基準より 4.5° 後ろ
    expect(b).toContain(PHRASES.cueBodyBack)
  })
  it('起きた形のまま走り出しても、正しいフォームの線の内側なら声をかけない。線より後ろなら、整える間に知らせる', () => {
    const coach = new Coach({ pause: false })
    const said = feedSparse(coach, 0, 400, { ...good, trunk: 0, body: 6.5 }).speak
    expect(said.some((x) => x === PHRASES.cueTrunkBack || x === PHRASES.cueBodyBack)).toBe(false)
    const coach2 = new Coach({ pause: false })
    const early = feedSparse(coach2, 0, 60, { ...good, trunk: -8 }).speak // 上体が鉛直より 8° 後ろ
    expect(early).toContain(PHRASES.cueTrunkBack)
    const coach3 = new Coach({ pause: false })
    const early3 = feedSparse(coach3, 0, 60, { ...good, body: 3 }).speak // 体全体が線（5.5°）より起きている
    expect(early3).toContain(PHRASES.cueBodyBack)
  })
  it('歩いている秒は、起きすぎを判定しない（歩くと上体も体全体も起きる）', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    const walk: Measure = { ...good, trunk: 0, body: 0 }
    const speak: string[] = []
    for (let i = 0; i < 60 * 15; i++) for (const e of coach.update({ t: 200 + i / 15, present: true, moving: false, m: walk })) if (e.type === 'speak') speak.push(e.text)
    expect(speak.some((x) => x === PHRASES.cueTrunkBack || x === PHRASES.cueBodyBack)).toBe(false)
  })
  it('起きすぎの値は、今日の基準から後ろへ傾いた量を、点数の目盛りに直したもの', () => {
    expect(toScale('trunkBack', REL_LIMITS.trunkBack.cue)).toBeCloseTo(LIMITS.trunkBack.cue)
    expect(toScale('bodyBack', REL_LIMITS.bodyBack.zero)).toBeCloseTo(LIMITS.bodyBack.zero)
    expect(toScale('bodyBack', 0)).toBeLessThan(LIMITS.bodyBack.full)
  })
})

describe('頭が前に出た量', () => {
  it('上体が起きて首の角度だけが増えたとき（頭の位置そのものは同じ）は、頭の声をかけない', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 200, good)
    // 上体 7° → −2°（9°起きた。正しいフォームの線の際）。首の角度 = 肩→耳 − 腰→肩 なので +9° 増えるが、肩→耳（頭の位置）は 12° のまま
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
  it('今日の基準からの変化に、上体の変化を足して記録する。声はかけない', () => {
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
  it('基準からの起きすぎは、腰の段階で足す（正しいフォームの線の起きすぎは、どのレベルでも整える）', () => {
    expect(activeItems(0)).not.toContain('trunkBack')
    expect(activeItems(1)).toEqual(expect.arrayContaining(['hip', 'trunkBack', 'bodyBack']))
  })
})

describe('体全体の倒れすぎ（正しいフォームの線）', () => {
  it('線（FORM.body.max）の内側なら、前傾が大きくても声をかけない。線を越えたら整える間に知らせる', () => {
    const coach = new Coach({ pause: false })
    const a = feedSparse(coach, 0, 120, { ...good, body: FORM.body.max - 1 }).speak
    expect(a).not.toContain(PHRASES.cueBody)
    const coach2 = new Coach({ pause: false })
    const b = feedSparse(coach2, 0, 120, { ...good, body: FORM.body.max + 2 }).speak
    expect(b).toContain(PHRASES.cueBody)
  })
})

describe('正しいフォームへ整える（走り出し）', () => {
  const cuesOf = (coach: Coach) => coach.cues.filter((c) => c.lead).map((c) => (c.item === 'recover' ? 'ok' : c.item === 'praise' ? c.text : c.item))

  it('最初から整っていれば、声をかけずに「姿勢は整っています」。今日の基準は、走っていた形の平均', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 240, good)
    expect(cuesOf(coach)).toEqual([PHRASES.formGood])
    expect(coach.cues.find((c) => c.text === PHRASES.formGood)!.t).toBeLessThan(FORM.from + FORM.window + FORM.settle + 5)
    expect(coach.leanRef).toMatchObject({ trunk: good.trunk, body: good.body, neck: good.neck, headLean: good.headLean })
  })

  it('外れていたら、体全体 → 上体 → 頭の順に1つずつ知らせ、線の内側に入ったら「その形です」。全部入ったら「整いました」', () => {
    const coach = new Coach({ pause: false })
    // 体全体が倒れすぎ・上体が前かがみ・頭が前：まず体全体だけを言う（上体と頭は待つ）
    feedSparse(coach, 0, 40, { ...good, body: 17, trunk: 15, neck: 55, headLean: 66 })
    expect(cuesOf(coach)).toEqual(['body'])
    // 体全体を直すと「その形です」、次に上体
    feedSparse(coach, 40, 25, { ...good, trunk: 15, neck: 55, headLean: 66 })
    expect(cuesOf(coach)).toEqual(['body', 'ok', 'trunk'])
    // 上体を直すと、次に頭
    feedSparse(coach, 65, 25, { ...good, neck: 55, headLean: 66 })
    expect(cuesOf(coach)).toEqual(['body', 'ok', 'trunk', 'ok', 'head'])
    // 頭も直すと、整った
    feedSparse(coach, 90, 25, good)
    expect(cuesOf(coach)).toEqual(['body', 'ok', 'trunk', 'ok', 'head', 'ok', PHRASES.formSet])
    expect(coach.formDone).toBe(true)
    // そのあいだ、しくみ自身の声（基準からの崩れ・ほめる）はかからない
    expect(coach.cues.filter((c) => !c.lead && c.t < 115)).toEqual([])
  })

  it('入らなければ、同じ項目は CUE.cooldown ごとに FORM.tries 回まで。そのあとは FORM.later 秒に1回で、次の項目へ進む', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 600, { ...good, body: 3, neck: 55, headLean: 66 })
    const body = coach.cues.filter((c) => c.item === 'bodyBack').map((c) => c.t)
    expect(body.slice(0, FORM.tries).map((t, i, a) => (i ? t - a[i - 1] : 0))).toEqual([0, 30, 30])
    expect(body[FORM.tries] - body[FORM.tries - 1]).toBeGreaterThanOrEqual(FORM.later)
    // 体全体をあきらめたら、頭へ進む
    expect(coach.cues.find((c) => c.item === 'head')!.t).toBeGreaterThan(body[FORM.tries - 1])
    expect(coach.cues.some((c) => c.text === PHRASES.formSet)).toBe(false)
    // 入らなかった項目の基準は、線そのもの
    expect(coach.leanRef!.body).toBe(FORM.body.min)
    const r = coach.finish().form!.find((x) => x.group === 'body')!
    expect(r).toMatchObject({ key: 'bodyBack', fixed: false })
    expect(r.over).toBeCloseTo(FORM.body.min - 3, 5)
  })

  it('基準ができる前に止まって整え直しても、同じ項目の声は1回の走りで FORM.tries 回まで（走っているかが行き来する人にくり返さない）', () => {
    const coach = new Coach({ pause: false })
    const fwd: Measure = { ...good, trunk: 16 }
    feedSparse(coach, 0, 120, fwd)
    feed(coach, 120, 15, fwd, false) // 止まる（基準ができる前）
    feedSparse(coach, 135, 120, fwd)
    expect(coach.formDone).toBe(true)
    expect(coach.cues.filter((c) => c.item === 'trunk' && c.lead && c.t < 250).length).toBe(FORM.tries)
  })

  it('今日の基準は、整えたあとの、線の内側にいた秒だけで作る（直す前の形を混ぜない）', () => {
    const coach = new Coach({ pause: false })
    feedSparse(coach, 0, 50, { ...good, body: 3, trunk: 2 }) // 体ごと起きた形（上体 2° は線の内側）
    feedSparse(coach, 50, 300, good)
    expect(coach.leanRef!.body).toBeCloseTo(good.body, 5)
    expect(coach.leanRef!.trunk).toBeCloseTo(good.trunk, 5)
  })

  it('線のすぐ際で揺れているだけでは、「その形です」と言わない（直ったかは線の内側に margin 以上入ったかで見る）', () => {
    const coach = new Coach({ pause: false })
    let t = 0
    const speak: string[] = []
    // 体全体 5.0〜5.8° を 2 秒おきに行き来（線 5.5° の際）
    for (let i = 0; i < 90 * 15; i++, t += 1 / 15) {
      const m = { ...good, body: Math.floor(t / 2) % 2 ? 5.8 : 5.0 }
      for (const e of coach.update({ t, present: true, moving: true, m, frame: demoStride()[i % 20] })) if (e.type === 'speak') speak.push(e.text)
    }
    expect(speak).not.toContain(PHRASES.formOk)
  })

  it('今日の基準ができて間引いて見ている間も、正しいフォームの線を越えたら細かく見直して知らせる', () => {
    const coach = new Coach({ pause: false })
    const edge: Measure = { ...good, body: 6 } // 線（5.5°）の少し内側で整う
    feedSparse(coach, 0, 300, edge)
    expect(coach.leanRef!.body).toBeCloseTo(6, 5)
    const quietLook = feedSparse(coach, 300, 60, edge).looked
    expect(quietLook).toBeLessThan(0.4)
    // 基準からは 1° しか起きていない（基準からの崩れの線 3.5° の手前）が、正しいフォームの線は越えた
    const a = feedSparse(coach, 360, 60, { ...edge, body: 5 })
    expect(a.speak).toContain(PHRASES.cueBodyBack)
    expect(coach.cues.filter((c) => c.item === 'bodyBack').every((c) => c.lead)).toBe(true)
  })

  it('歩いている秒は、正しいフォームの線と比べない', () => {
    const coach = new Coach({ pause: false })
    feed(coach, 0, 30, good)
    const walk: Measure = { ...good, trunk: -5, body: 1 }
    const speak: string[] = []
    for (let i = 0; i < 60 * 15; i++) for (const e of coach.update({ t: 30 + i / 15, present: true, moving: false, m: walk })) if (e.type === 'speak') speak.push(e.text)
    expect(speak.some((x) => x === PHRASES.cueTrunkBack || x === PHRASES.cueBodyBack)).toBe(false)
  })

  it('線を外れた量は、点数の目盛りに直す（内側の margin までは満点、線で声の線、線の外 span で0点）', () => {
    expect(itemScore('bodyBack', formScale('body', 'bodyBack', -FORM.body.margin))).toBe(100)
    expect(formScale('body', 'bodyBack', 0)).toBeCloseTo(LIMITS.bodyBack.cue)
    expect(itemScore('bodyBack', formScale('body', 'bodyBack', FORM.body.span))).toBe(0)
    expect(formOver('trunk', { trunk: FORM.trunk.max + 2, body: 9, neck: 0, headLean: 0 })).toEqual({ key: 'trunk', over: 2 })
    expect(formOver('head', { trunk: 7, body: 9, neck: FORM.head.neck + 5, headLean: FORM.head.headLean - 1 }).over).toBe(-1)
  })
})
