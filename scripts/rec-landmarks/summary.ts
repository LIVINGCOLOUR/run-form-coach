// 画面収録の点から、アプリの測り方で1本ぶんのまとめを出す（rec-landmarks.mjs から rolldown で読む）。
// 測り方は scripts/video-judge/judge.ts（アプリの src/ をそのまま使う）と同じ。アプリ本体は読むだけで変えない
//   app：毎秒15コマの点（アプリのカメラ版と同じ上限）を、なめらかにする → 全身が見えるか → 測る → 走っているか、の順に通した区間の値
//   landing：同じ毎秒15コマの点を、アプリの着地の測り方（LandingMeter → landingOf）に通した値。speed は速さの目安（脚の長さ／秒）
//   slowmo：毎秒30コマの点を、スロー分析（analyzeRun）に通した着地の値（足首の前・すねの角度）
//   coach：区間を240秒くり返して今のコーチに通したときの声（くり返しのつなぎ目で骨格がとぶので参考）
import { contacts, coachSim, track, windowStat, LINES, type LandmarkClip } from '../video-judge/judge'
import { LandingMeter, landingOf } from '../../src/modes/camera/landing'

export { LINES }

export function summarize(clip15: LandmarkClip, clipHi: LandmarkClip | null, from: number, to: number) {
  const ticks = track(clip15)
  const app = windowStat(ticks, from, to)
  const meter = new LandingMeter()
  const sv: number[] = []
  for (const k of ticks) {
    if (!k.f || k.t < from || k.t >= to) continue
    meter.update(k.f, k.t)
    const last = meter.track[meter.track.length - 1]
    if (last && last.t === k.t && Number.isFinite(last.sv)) sv.push(last.sv)
  }
  const land = landingOf(meter.peaks.filter((p) => p.t >= from && p.t < to), sv)
  const slow = clipHi ? contacts(clipHi, from, to) : null
  const sim = coachSim(ticks, [{ from, to, sec: 240 }])
  return {
    from,
    to,
    app,
    landing: land && { n: land.n, near: land.near, heel: land.heel, speed: land.speed, res: land.res, cadence: land.cadence },
    slowmo: slow,
    coach: { cues: sim.cues, ref: sim.ref ?? null },
  }
}
