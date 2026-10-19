// 採点（npm run grade）を試すための見本の記録を作る（scripts/treadmill/make-sample.mjs から rolldown で1つにまとめて読む）。
// 本物の走りではない。区間ごとに角度を決めて足した作りものの値を、撮るときと同じ流れ（カメラ版は Live.tsx の、
// 骨格を取る・取らないの間引きと Coach、スマホ版は PhoneRun）に通して、書き出しと同じ形（{ log, session }）にする
import { Coach } from '../../src/modes/camera/coach'
import { LogRecorder } from '../../src/modes/camera/log'
import { activeItems, startProgress } from '../../src/core/level'
import { RUNNING } from '../../src/core/params'
import type { Frame } from '../../src/core/types'
import type { Measure } from '../../src/modes/camera/types'
import { PhoneRun } from '../../src/modes/phone/session'
import { rng, simulateJumps, simulateRun, simulateStanding } from '../../src/modes/phone/simulate'

export interface SampleSection {
  key: string
  kind: string
  start: number // ふつうの時刻（ms）
  end: number
}

// 区間ごとの、ふつうからのずれ（度。hip は腰の高さの割合）
const SHIFT: Record<string, Partial<Record<'neck' | 'headLean' | 'trunk' | 'body' | 'hip', number>>> = {
  head: { neck: 12, headLean: 10 },
  down: { neck: 3, headLean: 2 },
  hunch: { trunk: 8, neck: 6, headLean: 6, body: 2 },
  lean: { body: 6, trunk: 4 },
  sit: { hip: -0.09 },
}
const RUNNING_KINDS = new Set(['normal', 'drill', 'gap'])

// full：全コマ記録（?full=1）として作る。走っている間も間引かず、毎コマを記録に残す
export function makeCameraSample(sections: SampleSection[], jumpAt: number | null, seed = 1, full = false) {
  const r = rng(seed)
  const noise = (a: number) => (r() * 2 - 1) * a
  const first = sections[0].start - 60_000 // カメラ版は、区間の指示を始める1分前に始めて、置き方と立った姿勢を済ませておく
  const last = sections[sections.length - 1].end + 5_000
  const perf0 = 100 // performance.now() の秒（なんでもよい）
  const rec = new LogRecorder({ perfMs: perf0 * 1000, epochMs: first })
  if (full) rec.log.full = true
  const toPerf = (T: number) => perf0 + (T - first) / 1000
  const progress = startProgress('beginner')
  let coach: Coach | null = null
  let phase = 'setup'
  rec.event(perf0, 'phase:setup')
  let lastPresent = true
  let lastMoving = false
  const at = (T: number) => sections.find((s) => T >= s.start && T < s.end)
  for (let T = first; T < last; T += 1000 / 15) {
    const t = toPerf(T)
    if (phase === 'setup' && T - first > 30_000) {
      phase = 'baseline'
      rec.event(t, 'phase:baseline')
    }
    if (phase === 'baseline' && T - first > 40_000) {
      phase = 'run'
      rec.event(t, 'phase:run')
      coach = new Coach({ pause: RUNNING.pauseEnabled, items: activeItems(progress.step) })
    }
    const s = at(T)
    const moving = !!s && RUNNING_KINDS.has(s.kind)
    // 区間の始まりから2秒かけて崩す
    const k = s ? Math.min(1, (T - s.start) / 2000) : 0
    const sh = (s && s.kind === 'drill' && SHIFT[s.key]) || {}
    const m: Measure = {
      neck: 20 + (sh.neck ?? 0) * k + noise(2),
      headLean: 14 + (sh.headLean ?? 0) * k + noise(2),
      yaw: 0.01 + noise(0.005),
      trunk: (moving ? 6 : 2) + (sh.trunk ?? 0) * k + noise(1.5),
      body: (moving ? 9 : 2) + (sh.body ?? 0) * k + noise(1),
      hipRatio: (moving ? 0.88 : 0.95) * (1 + (sh.hip ?? 0) * k) + noise(0.01),
      dir: 1,
    }
    // 骨格を取らないコマ（走っている間、コーチが要らないと言ったとき）。記録には残らない
    if (!full && phase === 'run' && coach && lastPresent && !coach.wantsDetail()) {
      for (const e of coach.update({ t, present: lastPresent, moving: lastMoving })) if (e.type === 'speak') rec.event(t, e.text)
      continue
    }
    // ジャンプ：「はい」の0.5秒あとに、腰が0.3秒だけ上がる
    const jump = jumpAt !== null && T > jumpAt + 500 && T < jumpAt + 800 ? -40 : 0
    const frame: Frame = Array.from({ length: 33 }, (_, i) => ({ x: 300 + i * 3, y: 150 + i * 15 + jump, v: 0.9 }))
    frame[23] = { x: 300, y: 500 + jump, v: 0.9 }
    frame[24] = { x: 305, y: 500 + jump, v: 0.9 }
    if (phase === 'run' && coach) for (const e of coach.update({ t, present: true, moving, m })) if (e.type === 'speak') rec.event(t, e.text)
    rec.frame(t, phase, 720, 1280, frame, { visible: true, moving, by: moving ? 'steps' : null, cadence: moving ? 172 : null, m, sideDeg: 3, still: 99, pitch: 0 })
    lastPresent = true
    lastMoving = moving
  }
  const session = coach && coach.samples.length >= 30 ? { ...coach.finish(), focus: { level: progress.level, step: progress.step }, logId: rec.log.id } : undefined
  if (session) rec.log.sessionId = session.id
  return { log: rec.log, session }
}

export function makePhoneSample(sections: SampleSection[], jumpAt: number | null) {
  const first = sections[0].start - 30_000 // スマホ版も、指示を始める前に始めておく
  const last = sections[sections.length - 1].end + 5_000
  const perf0 = 50
  const toPerf = (T: number) => perf0 + (T - first) / 1000
  const run = new PhoneRun({ perfMs: perf0 * 1000, epochMs: first }, { userAgent: 'sample', intervalMs: 16 }, 'treadmill')
  const o: [number, number, number] = [90, 0, 0]
  const real = { noise: 0.5, jitter: 0.02, rollDeg: 4, yawDeg: 6, impact: 20, cadence: 172, bounceCm: 8, brakingMs: 0.3, orientation: o }
  const parts: { from: number; to: number; kind: string; key: string }[] = []
  let T = first
  for (const s of sections) {
    if (s.start > T) parts.push({ from: T, to: s.start, kind: 'stand', key: '' })
    parts.push({ from: s.start, to: s.end, kind: s.kind, key: s.key })
    T = s.end
  }
  parts.push({ from: T, to: last, kind: 'stand', key: '' })
  parts.forEach((p, i) => {
    const seconds = (p.to - p.from) / 1000
    if (seconds <= 0) return
    const t0 = toPerf(p.from)
    let ms
    if (p.kind === 'jump' && jumpAt !== null) {
      // 「はい」の0.5秒あとまで立って、そこから跳ぶ（模擬は3回跳ぶ）
      const wait = (jumpAt + 500 - p.from) / 1000
      ms = [...simulateStanding({ seconds: wait, orientation: o, noise: 0.05, seed: 300 + i, t0 }), ...simulateJumps({ seconds: seconds - wait, orientation: o, seed: 400 + i, t0: t0 + wait })]
    }
    else if (RUNNING_KINDS.has(p.kind)) ms = simulateRun({ ...real, ...(p.key === 'slow' ? { cadence: 155, bounceCm: 10, brakingMs: 0.4 } : {}), seconds, seed: 300 + i, t0 })
    else ms = simulateStanding({ seconds, orientation: o, noise: 0.05, seed: 300 + i, t0 })
    for (const m of ms) run.feed(m)
  })
  const { session, log } = run.finish()
  return { log, session }
}
