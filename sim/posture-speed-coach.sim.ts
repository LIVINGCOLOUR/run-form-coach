// 仮想実験（走りの途中で速さを変えたときの、姿勢の声と点数）：同じ人の楽なペースと速いペース（Riglet 2024、+0.5m/s ≒ 時速 +1.8km）を
//   LongRun でつなぎ（前の走り 300秒 → あとの走り 300秒）、実機の記録のコマの間隔で仮想のスマホに映して、アプリのコーチ（src/modes/camera/coach.ts）に
//   アプリと同じ間引きで通す。速さを上げると体全体・上体は時速 +1km で約 +0.8° 増える（docs/research/posture-vs-speed.md）ので、
//   あとの走りで出る姿勢の崩れの声と、崩れで下がった点数は、速さのせい（誤り）。比べとして、楽なペースだけを 600秒走ったものも通す。
//   仮想のランナーは声を聞いても直さない
// 動かし方：RIGLET_DIR=… npx vitest run --config sim/vitest.config.ts sim/posture-speed-coach.sim.ts（結果は sim/result-posture-speed-coach.md）
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRigletLanding, type LandingTrial } from './landing-data'
import { filmFrames } from './landing-film'
import { LongRun } from './longrun'
import { Coach } from '../src/modes/camera/coach'
import { MotionDetector } from '../src/modes/camera/motion'
import { measure } from '../src/modes/camera/geometry'
import { LANDING, LIMITS, REL_LIMITS } from '../src/modes/camera/params'
import type { Frame, ItemKey, Sample } from '../src/core/types'

const RIGLET = process.env.RIGLET_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-posture-speed-coach.md'
const SWITCH = 300 // つなぐ秒
const END = 600
const POSTURE: ItemKey[] = ['head', 'trunk', 'trunkBack', 'body', 'bodyBack', 'hip']

interface Run {
  drift: number[] // 姿勢の、今日の基準からの崩れの声の時刻（走り出してからの秒）
  form: number[] // 姿勢の、正しいフォームの線の声（整え終わったあと）
  refAt: number | null
  after: Sample[] // つないだあとの記録
  goodShare: number // 結果の「良い」の割合
  changes: number // 速さが変わったとみた回数
}

// 1秒の記録が、今日の基準からの崩れで減点されたか（比べなかった秒は数えない）
function driftDeducted(s: Sample): boolean {
  if (s.paused || !s.judge || !s.back) return false
  return s.judge.trunk > LIMITS.trunk.full || s.judge.body > LIMITS.body.full || s.back.trunk > LIMITS.trunkBack.full || s.back.body > LIMITS.bodyBack.full || s.head > LIMITS.head.full || s.hipDrop > LIMITS.hip.full
}

function coachRun(frames: { t: number; f: Frame }[]): Run {
  const coach = new Coach({ pause: false })
  const md = new MotionDetector()
  let lastMoving = false
  let runFrom = -1
  let refAt: number | null = null
  for (const { t, f } of frames) {
    if (coach.state === 'running' && !coach.wantsDetail()) coach.update({ t, present: true, moving: lastMoving })
    else {
      lastMoving = md.update(f, t)
      coach.update({ t, present: true, moving: lastMoving, m: measure(f), frame: f })
    }
    if (runFrom < 0 && coach.state === 'running') runFrom = t - coach.active
    if (refAt === null && coach.leanRef) refAt = t
  }
  const s = coach.finish()
  const a = (coach as unknown as { analyzer: { drift: { guard?: { changes: number }; rebuilds: number } } }).analyzer
  const posture = (c: { item: string }) => (POSTURE as string[]).includes(c.item)
  return {
    drift: s.cues.filter((c) => posture(c) && !c.lead).map((c) => runFrom + c.t),
    form: s.cues.filter((c) => posture(c) && c.lead).map((c) => runFrom + c.t),
    refAt,
    after: s.samples.filter((x) => runFrom + x.t >= SWITCH),
    goodShare: s.share.good,
    changes: a.drift.guard?.changes ?? a.drift.rebuilds,
  }
}

describe.skipIf(!RIGLET)('速さを途中で変えたときの姿勢の声', () => {
  itAll('Riglet 楽 ⇄ 速い', () => {
    const pairs: { id: string; easy: LandingTrial; fast: LandingTrial }[] = []
    for (const id of readdirSync(RIGLET!).sort()) {
      const p = (pace: string) => join(RIGLET!, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
      if (!existsSync(p('Comfortable')) || !existsSync(p('Fast'))) continue
      try {
        pairs.push({ id, easy: loadRigletLanding(p('Comfortable'), id, '楽'), fast: loadRigletLanding(p('Fast'), id, '速い') })
      } catch (e) {
        console.log(`使えない：${id}：${(e as Error).message}`)
      }
    }
    const KINDS: [string, (x: (typeof pairs)[number]) => [LandingTrial, LandingTrial]][] = [
      ['楽なペースのまま（比べ）', (x) => [x.easy, x.easy]],
      ['楽 → 速い（速さを上げる）', (x) => [x.easy, x.fast]],
      ['速い → 楽（速さを下げる）', (x) => [x.fast, x.easy]],
    ]
    const res: Record<string, Run[]> = {}
    let k = 0
    for (const [kind, pick] of KINDS) {
      res[kind] = []
      for (const x of pairs) {
        const [a, b] = pick(x)
        const run = new LongRun()
        try {
          run.append(a, SWITCH, 7171 + k)
          run.append(b, END - SWITCH, 8181 + k)
        } catch {
          continue
        }
        const frames = filmFrames((u) => run.at(u), 0, END, { timing: 'log', seed: 929 + k++ })
        res[kind].push(coachRun(frames))
      }
      console.log(`${kind}：${res[kind].length}本`)
    }
    const pc = (x: number) => `${Math.round(x * 100)}%`
    const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—')
    const L: string[] = []
    const p = (s = '') => L.push(s)
    p('# 速さを途中で変えたときの姿勢の声と点数（仮想実験 sim/posture-speed-coach.sim.ts）')
    p()
    p(
      `Riglet 2024 の同じ人の楽なペースと速いペース（+0.5m/s ≒ 時速 +1.8km）を、前の走り ${SWITCH}秒 → あとの走り ${END - SWITCH}秒でつなぎ、実機の記録のコマの間隔で仮想のスマホ（真横・1.2m・高さ80cm）に映して、` +
        `アプリのコーチにアプリと同じ間引きで通した（今日の基準は走り始めて約3分）。姿勢の崩れの声は、今日の基準からの崩れ（頭・上体・体全体・起きすぎ・腰。線は REL_LIMITS：体全体 +${REL_LIMITS.body.cue}°・上体 +${REL_LIMITS.trunk.cue}° など）。` +
        `速さの目安が今日の基準から ±${Math.round(LANDING.speedGuard * 100)}% を越えた秒（一度越えたら ±${Math.round(LANDING.speedBack * 100)}% に戻るまで）とピッチが +${Math.round(LANDING.cadenceUp * 100)}% を越えて上がった秒は着地を比べず、それが${LANDING.postureAfter}秒続いたら姿勢も比べず（基準とも正しいフォームの線とも）、` +
        `${LANDING.speedHold}秒続いたら新しい速さで${LANDING.rebuild}秒ためて基準を作り直す。仮想のランナーは声を聞いても直さない。`,
    )
    p()
    p(`| 走り | 本数 | あとの崩れの声（10分あたり） | あとで崩れの声が出た人 | あとで崩れで減点した秒 | あとで比べなかった秒 | あとの正しいフォームの線の声（10分あたり） | 「良い」の割合（走り全体） | 速さが変わったとみた回数（1本あたり） |`)
    p(`|---|---|---|---|---|---|---|---|---|`)
    for (const [kind] of KINDS) {
      const rs = res[kind].filter((r) => r.refAt !== null && r.refAt < SWITCH)
      const n = rs.length
      const per10 = (xs: number[][]) => (xs.reduce((a, x) => a + x.filter((t) => t >= SWITCH).length, 0) / (n * (END - SWITCH))) * 600
      const secs = rs.flatMap((r) => r.after)
      p(
        `| ${kind} | ${n} | ${f2(per10(rs.map((r) => r.drift)))} | ${rs.filter((r) => r.drift.some((t) => t >= SWITCH)).length} / ${n} | ${pc(secs.filter(driftDeducted).length / secs.length)} | ${pc(secs.filter((s) => s.paused).length / secs.length)} | ${f2(per10(rs.map((r) => r.form)))} | ${pc(rs.reduce((a, r) => a + r.goodShare, 0) / n)} | ${f2(rs.reduce((a, r) => a + r.changes, 0) / n)} |`,
      )
    }
    p()
    p('「崩れで減点した秒」は、今日の基準からの崩れ（上体・体全体・起きすぎ・頭・腰）のどれかが満点の線を越えた秒（比べなかった秒は数えない）。速さの目安は16秒（間引いている間は30秒）の窓の中央値なので、速さを変えてから外れたと分かるまでに数秒〜十数秒かかる。')
    writeFileSync(OUT, L.join('\n') + '\n')
    console.log(L.join('\n'))
  })
})
