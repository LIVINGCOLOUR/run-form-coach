import { PHRASES } from '../../core/phrases'
import { PRACTICE } from './params'
import type { PhoneSession } from './session'

// ピッチを上げる練習（docs/phone-spec.md 機能3）。選んだ人だけ。数字は params.ts の PRACTICE
//   自分のピッチ（base）の +7.5% のメトロノームを鳴らして走る。2週間で8回。5〜8回目は鳴らす時間を減らす。
//   1回目は、はじめの3分で base を測り（しくみの HIP_REF の仮の基準）、そこから 2.5% ずつ上げて +7.5% にする
// 練習の走りでは、ピッチが落ちたときのメトロノーム（しくみの tone）は使わない（どちらの音か分からなくなるため。session.ts）。
// 練習の進みは、保存した走り（PhoneSession.practice）から数える。別の置き場所は持たない

// 次の練習が何回目か。programId は練習を始めた時刻（同じ8回をまとめる印）
export interface PracticePlan {
  programId: number
  n: number // 何回目か（1〜PRACTICE.runs）
  base: number | null // 自分のピッチ（歩/分）。1回目を走るまでは null
}

// 1回の練習の結果（PhoneSession.practice）
export interface PracticeResult {
  programId: number
  n: number
  base: number | null // 測れなければ null（1回目で3分走らなかった）
  counted: boolean // 1回と数えた（メトロノームを PRACTICE.minSec 秒以上鳴らし始めてから走った）
  practiceSec: number // メトロノームを鳴らし始めてから走った秒
  onSec: number // そのうち鳴らした秒
  tempoPct: number // 終わりのテンポ（base から何%上か）
  cadence: number | null // 練習の間の平均のピッチ
  cadenceOn: number | null // 鳴らしている間の平均のピッチ
  cadenceOff: number | null // 鳴らしていない間の平均のピッチ（5回目から。音なしで保てたか）
}

const DAY = 24 * 3600 * 1000

// n 回目の、鳴らし始めてから since 秒のテンポ（base から何%上か）
export function practiceTempoPct(n: number, since: number): number {
  if (n > 1) return PRACTICE.target
  return Math.min(PRACTICE.target, PRACTICE.rampStep * (1 + Math.floor(Math.max(0, since) / PRACTICE.rampEvery)))
}

// n 回目の、鳴らす時間の割合
export function practiceOnShare(n: number): number {
  const xs = PRACTICE.onShare
  return xs[Math.min(xs.length, Math.max(1, n)) - 1]
}

// n 回目の、鳴らし始めてから since 秒に鳴らすか。PRACTICE.cycle 秒ごとに、頭の割合だけ鳴らす
export function practiceOn(n: number, since: number): boolean {
  const share = practiceOnShare(n)
  if (share >= 1) return true
  const inCycle = (((since % PRACTICE.cycle) + PRACTICE.cycle) % PRACTICE.cycle) / PRACTICE.cycle
  return inCycle < share
}

// テンポ（歩/分）。小数1桁に丸める（1秒ごとに鳴らし直さないため）
export function practiceBpm(base: number, n: number, since: number): number {
  return Math.round(base * (1 + practiceTempoPct(n, since) / 100) * 10) / 10
}

// 練習の走り（新しい順でも古い順でもよい）のうち、programId のものを古い順に
export function practiceRuns(sessions: PhoneSession[], programId: number): PhoneSession[] {
  return sessions.filter((s) => s.practice?.programId === programId).sort((a, b) => a.startedAt - b.startedAt)
}

// 次の練習。前の練習が終わっていない（8回に届かず、PRACTICE.restartDays 日以内）なら、その続き。そうでなければ、はじめから
export function nextPractice(sessions: PhoneSession[], now: number): PracticePlan {
  const last = [...sessions].filter((s) => s.practice).sort((a, b) => b.startedAt - a.startedAt)[0]
  const fresh: PracticePlan = { programId: now, n: 1, base: null }
  if (!last?.practice || now - last.startedAt > PRACTICE.restartDays * DAY) return fresh
  const runs = practiceRuns(sessions, last.practice.programId)
  const done = runs.filter((s) => s.practice!.counted).length
  if (done >= PRACTICE.runs) return fresh
  const base = runs.find((s) => s.practice!.base !== null)?.practice!.base ?? null
  return { programId: last.practice.programId, n: done + 1, base }
}

// 走り終わった後に見せる、練習の進み
export interface PracticeProgress {
  runs: PracticeResult[] // 1回と数えた回（古い順）
  base: number | null
  done: number
  total: number
  latest: number | null // 最後の回のピッチ（5回目からは鳴らしていない間、なければ練習の間の平均）
  changePct: number | null // base からの変化（%）
}

export function practiceProgress(sessions: PhoneSession[], programId: number): PracticeProgress {
  const all = practiceRuns(sessions, programId).map((s) => s.practice!)
  const runs = all.filter((p) => p.counted)
  const base = all.find((p) => p.base !== null)?.base ?? null
  const last = runs[runs.length - 1]
  const latest = last ? (last.cadenceOff ?? last.cadence) : null
  return { runs, base, done: runs.length, total: PRACTICE.runs, latest, changePct: base && latest ? ((latest - base) / base) * 100 : null }
}

// 1回の練習の走りの中で、いつメトロノームを鳴らすかを決める。PhoneRun が1秒の記録ごとに呼ぶ
export class PracticeRun {
  readonly plan: PracticePlan
  base: number | null
  startAt: number | null = null // 鳴らし始めた秒（しくみの走った秒）
  on = false // 鳴らしている
  bpm: number | null = null // 鳴らしているテンポ
  private secs: { t: number; on: boolean; cadence: number | null }[] = [] // 鳴らし始めてからの1秒の記録

  constructor(plan: PracticePlan) {
    this.plan = plan
    this.base = plan.base
  }

  // 画面を開いたときに言う言葉（1回目だけ。はじめの3分は測るだけと伝える）
  intro(): string | null {
    return this.base === null ? PHRASES.practiceFirst : null
  }

  // 1秒ごと。ref は見る役の仮の基準のピッチ（1回目の base にする）。running はしくみが走っている状態か
  // 戻り値：鳴らす（on とテンポ）・止める（off）・言う言葉
  second(t: number, cadence: number | null, ref: number | null, running: boolean): { tone?: 'on' | 'off'; say?: string } {
    const out: { tone?: 'on' | 'off'; say?: string } = {}
    if (this.base === null && ref !== null) this.base = ref
    if (this.base === null || !running) {
      if (this.on) {
        this.on = false
        out.tone = 'off'
      }
      return out
    }
    if (this.startAt === null) {
      this.startAt = t
      out.say = practiceOnShare(this.plan.n) < 1 ? PHRASES.practiceFade : PHRASES.practiceGo
    }
    const since = t - this.startAt
    const want = practiceOn(this.plan.n, since)
    const bpm = practiceBpm(this.base, this.plan.n, since)
    if (want && (!this.on || bpm !== this.bpm)) {
      this.on = true
      this.bpm = bpm
      out.tone = 'on'
    } else if (!want && this.on) {
      this.on = false
      out.tone = 'off'
    }
    this.secs.push({ t, on: this.on, cadence })
    return out
  }

  // 走りが止まった（一時停止・途切れ・終わり）。鳴らしていたら止める（true を返す）。1秒の記録が来なくなるので、ここで止める
  halt(): boolean {
    if (!this.on) return false
    this.on = false
    return true
  }

  // 鳴らしているときのテンポ。鳴らしていなければ null
  tempo(): number | null {
    return this.on ? this.bpm : null
  }

  result(): PracticeResult {
    const avg = (xs: { cadence: number | null }[]) => {
      const ys = xs.flatMap((x) => (x.cadence === null ? [] : [x.cadence]))
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null
    }
    const on = this.secs.filter((x) => x.on)
    const off = this.secs.filter((x) => !x.on)
    // 走っていると分からなかった秒は記録がないので、秒は記録の数ではなく時刻で数える
    const since = this.startAt !== null && this.secs.length ? this.secs[this.secs.length - 1].t - this.startAt : 0
    const practiceSec = this.secs.length ? since + 1 : 0
    return {
      programId: this.plan.programId,
      n: this.plan.n,
      base: this.base,
      counted: practiceSec >= PRACTICE.minSec,
      practiceSec,
      onSec: on.length,
      tempoPct: practiceTempoPct(this.plan.n, since),
      cadence: avg(this.secs),
      cadenceOn: avg(on),
      cadenceOff: avg(off),
    }
  }
}
