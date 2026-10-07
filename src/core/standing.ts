// 直立の基準を取るときの、立ち姿勢（猫背）のチェック
// 骨格の点には背骨の途中がないので、背中の丸みそのものは測れない。代わりに、猫背で崩れる2つを見る
//   頭：肩の真上に耳があるか（頭が前に出ると、肩→耳の線が前に倒れる）
//   上体：腰の真上に肩があるか（背中が丸まると、肩が前に落ちて腰→肩の線が前に倒れる）
// 角度は鉛直からの前傾（度）。しきい値は仮の値で、実際の記録を見て直す
export const STANDING_LIMITS = { head: 20, trunk: 6 }

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

export const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
