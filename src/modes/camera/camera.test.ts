import { describe, expect, it } from 'vitest'
import { levelFrame, measure, rotateFrame, sideOffDeg } from './geometry'
import { itemScore, postureScore } from './scoring'
import { Coach } from './coach'
import { nextItem } from './nextStep'
import { capBaseline, standingIssue } from './standing'
import { LogRecorder, LOG_POINTS } from './log'
import { analyzeRun, type TimedFrame } from './slowmo'
import { MotionDetector, bodyVisible } from './motion'
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

describe('その場で走る・コンパクトなフォーム', () => {
  it('脚を前後に開かなくても、左右が交互に上がるリズムが毎秒2歩以上なら走っている', () => {
    expect(inPlace(2.8, 25)).toBe(true) // 検証用の判定（IN_PLACE_FOR_TESTING）で拾う
    expect(inPlace(2.8, 12)).toBe(true) // 小さく持ち上げるだけでも
  })
  it('真横から撮って奥の脚が手前の脚に重なっていても、片脚の上下のリズムで走っていると分かる', () => {
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
  })
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
  it('ゆっくり足踏みする、ほとんど持ち上げないときは走っていない', () => {
    expect(inPlace(1.2, 25)).toBe(false)
    expect(inPlace(2.8, 1)).toBe(false)
  })
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

const good: Measure = { neck: 2, headLean: 12, yaw: 0, trunk: 7, body: 3, hipRatio: 0.9, dir: 1 }
const bent: Measure = { ...good, trunk: 20 }
const headDown: Measure = { ...good, neck: 14 }

describe('コーチの流れ', () => {
  it('走り出しで始まり、崩れたら声をかけ、直ったらほめ、止まったら一時停止する', () => {
    const coach = new Coach()
    const s1 = feed(coach, 0, 5, good)
    expect(coach.state).toBe('running')
    expect(s1[0]).toContain('始めます')

    const s2 = feed(coach, 5, 13, bent)
    expect(s2.some((x) => x.includes('前かがみになっています'))).toBe(true)

    // 声をかけてから15秒以内に直れば、ほめる
    const s3 = feed(coach, 18, 10, good)
    expect(s3.some((x) => x.includes('いい感じです'))).toBe(true)

    const s4 = feed(coach, 28, 5, good, false)
    expect(coach.state).toBe('paused')
    expect(s4.some((x) => x.includes('一時停止'))).toBe(true)
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
    const said = feed(coach, 400, 90, { ...good, neck: 30 })
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
    const a = feedSparse(coach, 0, 100, { ...good, neck: 20 }).speak
    expect(a.some((x) => x.includes('頭が前に出ています'))).toBe(false)
    feedSparse(coach, 100, 100, good)
    const b = feedSparse(coach, 200, 20, { ...good, neck: 20 }).speak // 走り始め（30秒〜3分）の平均より大きく前
    expect(b.some((x) => x.includes('頭が前に出ています'))).toBe(true)
  })
  it('最初から頭が前に出ている人には、走り始めの基準ができたときに一度だけ声をかけ、戻せばほめる', () => {
    const coach = new Coach({ pause: false })
    const fwd: Measure = { ...good, headLean: 30 }
    const a = feedSparse(coach, 0, 200, fwd).speak
    expect(a.filter((x) => x.includes('頭が前に出ています')).length).toBe(1)
    expect(coach.cues.find((c) => c.item === 'head')!.t).toBeGreaterThan(180)
    const b = feedSparse(coach, 200, 15, { ...fwd, neck: -5, headLean: 23 }).speak
    expect(b.some((x) => x.includes('いい感じです'))).toBe(true)
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
  it('安定している間は3割ほどしか骨格を取らず、それでも崩れたら声をかける', () => {
    const coach = new Coach()
    const a = feedSparse(coach, 0, 200, good)
    expect(a.looked).toBeLessThan(0.4)
    const b = feedSparse(coach, 200, 20, headDown)
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
    expect(b.looked).toBeGreaterThan(0.6)
  })

  it('点数はまだ高いが、声をかける線を少し越えた崩れでも、間引かずに見て声をかける', () => {
    const coach = new Coach()
    feedSparse(coach, 0, 200, good)
    const b = feedSparse(coach, 200, 20, { ...good, neck: 8 }) // 頭 +6°：線（5°）は越えるが点数は90
    expect(b.speak.some((x) => x.includes('頭が前に出ています'))).toBe(true)
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
    expect(a.length).toBe(15 + LOG_POINTS.length * 3)
    expect(b.length).toBe(15)
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
    const small = feedSparse(coach, 200, 20, { ...good, neck: 9 }).speak // 頭 +7°：線（5°）は越えるが点数は80
    expect(small.some((x) => x.includes('頭が前に出ています'))).toBe(false)
    const big = feedSparse(coach, 220, 30, { ...good, neck: 15 }).speak // 頭 +13°：点数20
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
