import { describe, expect, it } from 'vitest'
import { expectedHeel, LandingDrift, LandingMeter, LandingWatch, landingOf, refOf, type Peak } from './landing'
import { Coach } from './coach'
import { FormStage } from './form'
import { FORM, GOOD, LANDING, LIMITS } from './params'
import { L } from './landmarks'
import { formRows, nextItem, noNextNote, LANDING_NOTE, todayFocus } from './nextStep'
import { FOCUS, PHRASES } from '../../core/phrases'
import { activeItems, startProgress } from '../../core/level'
import type { FormResult, Frame, Session } from '../../core/types'
import type { Measure } from './types'

// 作りものの走り（真横から、右向き）：腰は動かず、足首は接地中に後ろへ一定の速さで動き、宙では前へ戻る。膝は脚の長さが変わらない位置。
// reach・back：足首が一番前・一番後ろに行く位置（腰から、脚の長さに対する割合）、stance：1周のうち接地している割合、period：1周の秒数。
// 手前の脚（左）の点ははっきり（0.95）、奥の脚（右）はぼんやり（0.5）。かかとは足首の 6画素後ろ、つま先は 22画素前
const LEG = 160
const HIP = { x: 300, y: 300 }
const GROUND = HIP.y + 0.92 * LEG
interface StrideOpts {
  reach: number
  back: number
  stance?: number
  period?: number
}
function legAt(ph: number, o: StrideOpts) {
  const s = o.stance ?? 0.4
  const p = ((ph % 1) + 1) % 1
  let x: number
  let y: number
  if (p < s) {
    x = o.reach - ((o.reach + o.back) * p) / s
    y = GROUND
  } else {
    const u = (p - s) / (1 - s)
    x = -o.back + ((o.reach + o.back) * (1 - Math.cos(Math.PI * u))) / 2
    y = GROUND - 0.12 * LEG * Math.sin(Math.PI * u)
  }
  const A = { x: HIP.x + x * LEG, y }
  // 膝：腰と足首から、太もも・すね（どちらも脚の長さの半分）の長さにある点のうち、前のほう
  const dx = A.x - HIP.x
  const dy = A.y - HIP.y
  const d = Math.min(LEG - 0.5, Math.hypot(dx, dy))
  const h = Math.sqrt(Math.max(0, (LEG / 2) ** 2 - (d / 2) ** 2))
  const mx = HIP.x + dx / 2
  const my = HIP.y + dy / 2
  const nx = -dy / Math.hypot(dx, dy)
  const ny = dx / Math.hypot(dx, dy)
  const K = nx > 0 ? { x: mx + nx * h, y: my + ny * h } : { x: mx - nx * h, y: my - ny * h }
  return { K, A }
}
function strideFrame(t: number, o: StrideOpts, swap = false): Frame {
  const T = o.period ?? 0.7
  const f: Frame = Array.from({ length: 33 }, () => ({ x: HIP.x, y: HIP.y - 200, v: 0.3 }))
  const put = (i: number, p: { x: number; y: number }, v: number) => (f[i] = { x: p.x, y: p.y, v })
  put(L.nose, { x: HIP.x + 40, y: HIP.y - 280 }, 0.99)
  put(L.leftEar, { x: HIP.x + 20, y: HIP.y - 284 }, 0.99)
  put(L.rightEar, { x: HIP.x + 20, y: HIP.y - 284 }, 0.5)
  put(L.leftHip, HIP, 0.99)
  put(L.rightHip, HIP, 0.6)
  const legs = [
    { ...legAt(t / T, o), v: 0.95, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, toe: L.leftFoot },
    { ...legAt(t / T + 0.5, o), v: 0.5, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, toe: L.rightFoot },
  ]
  for (const g of legs) {
    put(g.knee, g.K, g.v)
    put(g.ankle, g.A, g.v)
    put(g.heel, { x: g.A.x - 6, y: g.A.y + 8 }, g.v)
    put(g.toe, { x: g.A.x + 22, y: g.A.y + 10 }, g.v)
  }
  if (swap) {
    for (const [a, b] of [[L.leftKnee, L.rightKnee], [L.leftAnkle, L.rightAnkle], [L.leftHeel, L.rightHeel], [L.leftFoot, L.rightFoot]]) {
      const x = f[a]
      f[a] = { ...f[b], v: x.v }
      f[b] = { ...x, v: f[b].v }
    }
  }
  return f
}
// かかとの前（山のコマ）と速さの目安の見込み
const heelOf = (o: StrideOpts) => o.reach - 6 / LEG
const speedOf = (o: StrideOpts) => (o.reach + o.back) / ((o.stance ?? 0.4) * (o.period ?? 0.7))

const NORMAL: StrideOpts = { reach: 0.35, back: 0.35 } // 速さの目安 2.5、かかとの前 0.31 → 速さで補正 +0.044（線の内側）
const FAR: StrideOpts = { reach: 0.45, back: 0.25 } // 同じ速さで足が前に着く → 速さで補正 +0.14（線の外）
const AHEAD: StrideOpts = { reach: 0.41, back: 0.29 } // 同じ速さで、基準より +0.06 前（声をかける線 +0.05 と、大きな崩れ +0.07 の間）
const FAST: StrideOpts = { reach: 0.4, back: 0.4, period: 0.62 } // 速さの目安 3.2（+29%）

function meterOn(o: StrideOpts, sec: number, fps = 13, swapEvery = 0) {
  const m = new LandingMeter()
  for (let i = 0; i < sec * fps; i++) {
    const t = i / fps
    m.update(strideFrame(t, o, swapEvery > 0 && i % swapEvery < 2), t)
  }
  return m
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

describe('着地の山（LandingMeter）', () => {
  it('1歩ずつ、前にあるほうの足首が一番前に出た山を取り、そのコマのかかとの前を測る（左右の名前を取り違えても山は変わらない）', () => {
    const m = meterOn(NORMAL, 30)
    const near = m.peaks.filter((p) => p.side === 'L')
    // 1周 0.7 秒に左右1つずつ（30秒で約 43 周。山を確かめる最初の1歩は数えない）
    expect(m.peaks.length).toBeGreaterThan(80)
    expect(m.peaks.length).toBeLessThan(88)
    expect(med(near.map((p) => p.heel))).toBeCloseTo(heelOf(NORMAL), 1)
    expect(Math.abs(med(near.map((p) => p.heel)) - heelOf(NORMAL))).toBeLessThan(0.02)
    // 名前の取り違え（13コマに2コマ）があっても、山の数とかかとの前は変わらない
    const sw = meterOn(NORMAL, 30, 13, 13)
    expect(Math.abs(sw.peaks.length - m.peaks.length)).toBeLessThanOrEqual(2)
    expect(Math.abs(med(sw.peaks.filter((p) => p.side === 'L').map((p) => p.heel)) - heelOf(NORMAL))).toBeLessThan(0.02)
  })

  it('速さの目安は、接地している足首が後ろへ動く速さ（脚の長さ／秒）', () => {
    const m = meterOn(NORMAL, 20)
    const w = landingOf(m.peaks, m.track.map((x) => x.sv))!
    expect(w.speed / speedOf(NORMAL)).toBeGreaterThan(0.95)
    expect(w.speed / speedOf(NORMAL)).toBeLessThan(1.05)
    const f = meterOn(FAST, 20)
    expect(landingOf(f.peaks, f.track.map((x) => x.sv))!.speed / w.speed).toBeGreaterThan(1.2)
  })
})

describe('着地の窓の値と、今日の基準からの増え', () => {
  it('手前の脚（点の確からしさが高いほう）の山の中央値を、速さから見込むかかとの前と比べる。山が足りなければ比べない', () => {
    const m = meterOn(FAR, 20)
    const w = landingOf(m.peaks, m.track.map((x) => x.sv))!
    expect(w.near).toBe('L')
    expect(w.res).toBeCloseTo(w.heel - expectedHeel(w.speed), 10)
    expect(w.res).toBeGreaterThan(FORM.landing.max) // 同じ速さで足が前に着く
    const n = meterOn(NORMAL, 20)
    expect(landingOf(n.peaks, n.track.map((x) => x.sv))!.res).toBeLessThan(FORM.landing.max)
    expect(landingOf(m.peaks.slice(0, 2 * LANDING.minSteps - 2), [2.5])).toBeNull()
  })

  it('歩数で走っていた秒の山だけを残し、間引いて見ている間は長い窓で見る', () => {
    const watch = new LandingWatch()
    let t = 0
    const run = (sec: number, stepping: boolean, look: (u: number) => boolean = () => true) => {
      for (let s = 0; s < sec; s++) {
        for (let i = 0; i < 13; i++, t += 1 / 13) {
          if (look(t)) watch.frame(strideFrame(t, NORMAL), t)
          else watch.tick(t)
        }
        watch.second(stepping)
      }
    }
    run(20, false)
    expect(watch.window()).toBeNull() // 走っていなかった秒の山は使わない
    run(20, true)
    expect(watch.dense()).toBe(true)
    const w = watch.window()!
    expect(w.n).toBeGreaterThan(15)
    expect(w.n).toBeLessThan(26) // 16秒ぶん（1周 0.7 秒）
    // 10秒のうち3秒だけ骨格を取る（アプリのふだんの間引き）と、30秒の窓で見る
    run(40, true, (u) => u % 10 < 3)
    expect(watch.dense()).toBe(false)
    const thin = watch.window()!
    expect(thin.n).toBeGreaterThanOrEqual(LANDING.minSteps)
    expect(watch.window(LANDING.window)?.n ?? 0).toBeLessThan(thin.n)
  })

  it('速さの目安が今日の基準から ±15% を越えて変わった秒は比べず、それが20秒続いたら、新しい速さで60秒ためて基準を作り直す', () => {
    const peaksOf = (o: StrideOpts) => {
      const m = meterOn(o, 30)
      return { peaks: m.peaks, sv: m.track.map((x) => x.sv).filter((v) => v > 0.3) }
    }
    const base = peaksOf(NORMAL)
    const d = new LandingDrift()
    d.set(refOf(base.peaks, base.sv))
    expect(d.ref!.near).toBe('L')
    const w = (o: StrideOpts) => {
      const p = peaksOf(o)
      return { w: landingOf(p.peaks, p.sv, 'L'), sec: p }
    }
    // 同じ速さで足が前に着く：比べて、増えを返す
    const a = w(AHEAD)
    expect(d.judge(a.w, a.sec, true)).toBeCloseTo(heelOf(AHEAD) - heelOf(NORMAL), 1)
    expect(d.judge(a.w, a.sec, false)).toBeUndefined() // 歩数で走っていない秒は比べない
    // 速さの目安が +29%：比べない。短く外れただけ（窓の揺れ）なら、同じ基準で比べ続ける
    const f = w(FAST)
    for (let s = 0; s < 5; s++) expect(d.judge(f.w, f.sec, true)).toBeUndefined()
    expect(d.ref).not.toBeNull()
    expect(d.judge(a.w, a.sec, true)).toBeCloseTo(heelOf(AHEAD) - heelOf(NORMAL), 1)
    // LANDING.speedHold 秒続いたら、速さが変わったとみて作り直す
    for (let s = 1; s < LANDING.speedHold; s++) d.judge(f.w, f.sec, true)
    expect(d.ref).not.toBeNull()
    expect(d.judge(f.w, f.sec, true)).toBeUndefined()
    expect(d.ref).toBeNull()
    expect(d.rebuilds).toBe(1)
    for (let s = 1; s < LANDING.rebuild; s++) expect(d.judge(f.w, f.sec, true)).toBeUndefined()
    expect(d.ref).toBeNull()
    d.judge(f.w, f.sec, true)
    expect(d.ref!.speed / d.ref!.heel).toBeGreaterThan(0) // 新しい速さの基準
    expect(Math.abs(d.ref!.speed / f.w!.speed - 1)).toBeLessThan(0.05)
    expect(d.judge(f.w, f.sec, true)).toBeCloseTo(0, 2)
    // ピッチが上がって足が前に出たなら（速さを上げた）、速さの目安が変わらなくても比べない。ピッチが下がったとき（大また）は比べる
    const h = new LandingDrift()
    h.set({ heel: 0.3, speed: 2.5, near: 'L', n: 50, cadence: 170 })
    const win = (cadence: number) => ({ n: 20, near: 'L' as const, heel: 0.36, speed: 2.5, res: 0, cadence })
    expect(h.judge(win(170 * (1 + LANDING.cadenceUp) + 1), f.sec, true)).toBeUndefined()
    expect(h.judge(win(170 * 0.9), f.sec, true)).toBeCloseTo(0.06, 5)
    // ためている間に速さがまた変わったら（LANDING.speedHold 秒続いたら）、新しい速さでため直す
    const g = new LandingDrift()
    g.set(null)
    for (let s = 0; s < 30; s++) g.judge(f.w, f.sec, true)
    const n = w(NORMAL)
    for (let s = 0; s < LANDING.speedHold + LANDING.rebuild - 1; s++) g.judge(n.w, n.sec, true)
    expect(g.ref).toBeNull()
    g.judge(n.w, n.sec, true)
    expect(Math.abs(g.ref!.speed / n.w!.speed - 1)).toBeLessThan(0.05)
  })
})

// コーチに、作りものの走りのコマと、ふつうの姿勢の測定値を 30fps で渡す
const good: Measure = { neck: 2, headLean: 12, chin: -20, yaw: 0, trunk: 7, body: 9, hipRatio: 0.9, dir: 1 }
function feed(coach: Coach, from: number, sec: number, o: StrideOpts, m: Measure = good) {
  const speak: string[] = []
  for (let i = 0; i < sec * 30; i++) {
    const t = from + i / 30
    for (const e of coach.update({ t, present: true, moving: true, m, frame: strideFrame(t, o) })) if (e.type === 'speak') speak.push(e.text)
  }
  return speak
}
const analyzer = (c: Coach) => (c as unknown as { analyzer: { drift: LandingDrift } }).analyzer

describe('コーチ：着地', () => {
  it('着地が試しの線を越えている間は、整ったと言わない（まだ声もかけない）。線の内側なら「姿勢は整っています」', () => {
    const far = new Coach({ pause: false })
    const s1 = feed(far, 0, 120, FAR)
    expect(far.formDone).toBe(true) // 整え終わりは待たせない（しくみの声かけは始まる）
    expect(s1).not.toContain(PHRASES.formGood)
    expect(s1).not.toContain(PHRASES.formSet)
    expect(s1).not.toContain(PHRASES.cueLanding)
    const ok = new Coach({ pause: false })
    expect(feed(ok, 0, 120, NORMAL)).toContain(PHRASES.formGood)
  })

  it('今日の基準より足が前に着く状態が続いたら「足が体より前に着いています」。速さが大きく変わったときは言わず、基準を作り直す', () => {
    const coach = new Coach({ pause: false, items: activeItems(2) })
    feed(coach, 0, 260, NORMAL)
    expect(coach.leanRef).not.toBeNull()
    expect(analyzer(coach).drift.ref).not.toBeNull()
    const said = feed(coach, 260, 60, AHEAD)
    expect(said).toContain(PHRASES.cueLanding)
    const s = coach.samples[coach.samples.length - 1]
    expect(s.land!.drift!).toBeGreaterThan(LIMITS.landing.cue)
    // 別のコーチで：速さだけ上げる（着地は前に出るが、比べない）
    const c2 = new Coach({ pause: false, items: activeItems(2) })
    feed(c2, 0, 260, NORMAL)
    expect(feed(c2, 260, 60, FAST)).not.toContain(PHRASES.cueLanding)
    expect(analyzer(c2).drift.rebuilds).toBeGreaterThanOrEqual(1)
    // 着地をまだ見ない段階（腰の段階まで）では、少しの増えでは言わない（大きく崩れたときだけ）
    const c3 = new Coach({ pause: false, items: activeItems(1) })
    feed(c3, 0, 260, NORMAL)
    expect(feed(c3, 260, 60, AHEAD)).not.toContain(PHRASES.cueLanding)
  })

  it('結果の画面：着地の位置の行（よい例との差、試しの線、試しの測り方と添える）', () => {
    const coach = new Coach({ pause: false })
    feed(coach, 0, 200, FAR)
    const form = coach.finish().form!
    const lr = form.find((r) => r.group === 'landing')!
    expect(lr.over).toBeGreaterThan(0)
    expect(lr.speed!).toBeGreaterThan(2)
    const row = formRows(form).find((r) => r.group === 'landing')!
    expect(row.label).toBe('着地の位置')
    expect(row.state).toBe('off')
    expect(row.word).toBe('前に着いています')
    expect(row.gap).toBe(`${Math.round((lr.value - GOOD.landing.max) * 100)}%`)
    expect(row.you).toBe(`+${Math.round(lr.value * 100)}%`)
    expect(row.good).toBe(`+${Math.round(GOOD.landing.max * 100)}%まで`)
    expect(row.line).toBe(`試しの線 +${Math.round(FORM.landing.max * 100)}%まで：外でした（足が体より前に着いていました）`)
    expect(row.lineOut).toBe(true)
    expect(row.note).toBe(LANDING_NOTE)
  })

  it('次の一歩：試しの測り方のうちは、線を越えたときだけ着地を選ぶ（よい例の範囲を外れただけでは選ばない）。ホームと走り出しの声も同じ1つ', () => {
    const base: FormResult[] = [
      { group: 'body', key: 'body', value: GOOD.body.mid, over: -2, inside: 1, cues: 0, fixed: false, judged: true },
      { group: 'trunk', key: 'trunk', value: GOOD.trunk.mid, over: -2, inside: 1, cues: 0, fixed: false, judged: true },
    ]
    const land = (value: number): FormResult => ({ group: 'landing', key: 'landing', value, over: value - FORM.landing.max, inside: 1, cues: 0, fixed: false, judged: true })
    const run = (form: FormResult[]): Session => ({ id: 'r', startedAt: 0, durationSec: 900, samples: [], cues: [], strides: {}, share: { good: 1, mid: 0, bad: 0 }, quietHeldSec: 0, form }) as Session
    // よい例（+9%）より外だが、線（+10%）の内側：選ばない
    const between = run([...base, land((GOOD.landing.max + FORM.landing.max) / 2 + 0.002)])
    expect(formRows(between.form!).find((r) => r.group === 'landing')!.state).not.toBe('in')
    expect(nextItem(between)).toBeUndefined()
    // よい例から離れていても選ばなかった着地は、そう書く（いまの値では、よい例の上の端と試しの線が近いので、離れた着地はたいてい線の外になる）
    const offRow = { ...formRows([land(FORM.landing.max - 0.001)])[0], state: 'off' as const }
    expect(noNextNote([offRow])).toContain('着地は試しの測り方')
    // 線の外：選ぶ。ホームの今日の意識と、走り出す前の声は同じ
    const over = run([...base, land(FORM.landing.max + 0.03)])
    expect(nextItem(over)).toMatchObject({ kind: 'line', item: 'landing', group: 'landing', to: FORM.landing.max })
    const f = todayFocus([over], startProgress('beginner'))
    expect(f).toMatchObject({ item: 'landing', say: FOCUS.landing, title: '体の真下に足を下ろす' })
    expect(f.say).toBe(PHRASES.focusLanding)
    expect(f.reason).toContain('試しの線')
    // ほかの項目が線の外なら、そちら（離れ方は0点までの幅で割って比べる）
    const trunkOut = run([{ ...base[0] }, { group: 'trunk', key: 'trunk', value: FORM.trunk.max + 3, over: 3, inside: 0, cues: 3, fixed: false, judged: true }, land(FORM.landing.max + 0.01)])
    expect(nextItem(trunkOut)?.item).toBe('trunk')
  })

  it('FORM.landing.say を true にすると、整える間に着地も知らせ（体全体のあと、上体の前）、直ったら「その形です」', () => {
    const before = FORM.landing.say
    FORM.landing.say = true
    try {
      const coach = new Coach({ pause: false })
      const s1 = feed(coach, 0, 60, FAR)
      expect(s1).toContain(PHRASES.cueLanding)
      const s2 = feed(coach, 60, 40, NORMAL)
      expect(s2).toContain(PHRASES.formOk)
      // 着地の行は「声をかける線」になり、よい例との差でも次の一歩に選ぶ
      const r = formRows(coach.finish().form!).find((x) => x.group === 'landing')!
      expect(r.line.startsWith('声をかける線')).toBe(true)
      expect(r.note).toBeUndefined()
    } finally {
      FORM.landing.say = before
    }
  })

  it('声にしない間は、着地が線を越えていても、整える間を細かく見続けない（間引きを止めない）', () => {
    const st = new FormStage()
    const peaks = (): Peak[] => {
      const m = meterOn(FAR, 1.2)
      return m.peaks
    }
    for (let t = 0; t < 40; t++) st.second(t, t, true, { trunk: 7, body: 9, neck: 2, headLean: 12 }, 0, () => 1e9, { peaks: peaks().map((p) => ({ ...p, t })), sv: [2.5, 2.5, 2.5] })
    expect(st.landing!).toBeGreaterThan(FORM.landing.max)
    expect(st.busy(40)).toBe(false)
  })
})
