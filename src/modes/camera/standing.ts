import type { Baseline } from '../../core/types'
import { BASELINE } from './params'

// 直立の基準を取るときの、立ち姿勢（猫背）のチェック
// 骨格の点には背骨の途中がないので、背中の丸みそのものは測れない。代わりに、猫背で崩れる2つを見る
//   頭：肩の真上に耳があるか（頭が前に出ると、肩→耳の線が前に倒れる）
//   上体：腰の真上に肩があるか（背中が丸まると、肩が前に落ちて腰→肩の線が前に倒れる）
// 角度は鉛直からの前傾（度）。今日の基準ではなく、決まった線（params.ts の BASELINE.standingHead・standingTrunk。決め方もそこ）と比べる。
// 猫背で立ったままだと、その形が胸・頭のセンサーの「立った姿勢」になってしまうので、線の内側に入ってから基準を取る
export const STANDING_LIMITS = { head: BASELINE.standingHead, trunk: BASELINE.standingTrunk }

export interface Standing {
  head: number
  trunk: number
}

export type StandingIssue = 'head' | 'back'

// 一番はずれている1つだけを返す（直すのは1つずつ）。問題がなければ null
export function standingIssue(s: Standing): StandingIssue | null {
  const head = s.head - STANDING_LIMITS.head
  const back = s.trunk - STANDING_LIMITS.trunk
  if (head <= 0 && back <= 0) return null
  // 上体の1°は頭の1°より姿勢全体への影響が大きいので、上体を倍に見る
  return back * 2 >= head ? 'back' : 'head'
}

// 3秒の直立を測り終えたときに、どうするか。tries：これまでに測り直してもらった回数。
//   猫背（線を越えた）で、まだ BASELINE.retries 回に届いていなければ retry（「猫背になっています。背筋をまっすぐ伸ばしてください」と言って測り直す）。
//   線の内側か、測り直しを使い切ったら accept（その姿勢で基準を取り、センサーの立った姿勢もこの3秒で覚える）。使い切ったときは issue が残る（結果の画面に出す）
export function standingDecision(s: Standing, tries: number): { issue: StandingIssue | null; retry: boolean } {
  const issue = standingIssue(s)
  return { issue, retry: issue !== null && tries < BASELINE.retries }
}

export const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// 猫背ぎみに立った日に基準が甘くならないよう、直近の基準の真ん中より5°以上悪い分は5°までに抑える
export const BASELINE_SLACK = BASELINE.slack
export function capBaseline(neck: number, history: Baseline[]): number {
  if (!history.length) return neck
  const sorted = history.map((b) => b.neck).sort((a, b) => a - b)
  return Math.min(neck, sorted[Math.floor(sorted.length / 2)] + BASELINE_SLACK)
}
