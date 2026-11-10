// カメラ版だけで使う型（骨格の点や記録の型は src/core/types.ts）

// 1コマから測った角度など
export interface Measure {
  // 首の傾き − 体幹の傾き（度）。正しいフォームの線と、今日の基準との差で「頭が前に出た量」を見る
  neck: number
  // 頭の位置そのもの：手前側の肩→耳の線の、鉛直からの前傾（度）
  headLean: number
  // 顎：手前側の耳→鼻の線の、水平からの上向き（度。鼻が耳より下なら負）。測って記録するだけ
  chin: number
  // スマホが体の前側から（正）か、後ろ側から（負）撮っているか（geometry の yawSign）
  yaw: number
  // 体幹の前傾（腰→肩の線と鉛直の角度。前が正）
  trunk: number
  // 体全体の前傾（足首→肩の線と鉛直の角度。前が正）
  body: number
  // 腰の高さ（腰から接地側の足首までの高さ ÷ 脚の長さ）。浮いているコマも含む。記録するだけで、腰落ちの判定には使わない（mid を使う）
  hipRatio: number
  // 立脚中期のコマだけ（geometry の midstance）：腰の中心から立脚側の足首までの高さ ÷ 立脚側の脚の長さ（hip）と、立脚側の膝の曲がり（knee、度）。
  // 腰落ちの判定に使う。立脚中期でないコマには無い
  mid?: { hip: number; knee: number }
  // 片足のコマ（両足首の高さの差が脚の長さの HIP_MID.sep より大きい）だけ：低いほう（接地している側）の脚の膝の曲がり（度）。
  // 腰落ちの新しい候補（params.ts の HIP_COMB）に使う。記録するだけ
  kst?: number
  // 進む向き（右へ走っていれば 1、左なら -1）
  dir: 1 | -1
}

// 腰の決まった線（params.ts の HIP_ABS）の1秒の値。記録（Sample の hipAbs）に残すだけで、声・判定・点数には使わない
//   v：直近の、腰を測れた n 個の1秒の、立脚中期の腰の高さ（腰の中心から立脚側の足首までの高さ ÷ 立脚側の脚の長さ）の平均。low：v が線を下回った
export interface HipAbs {
  v: number
  n: number
  low?: true
}

// 腰落ちの新しい候補（params.ts の HIP_COMB）の1秒の値。記録（Sample の hipComb）に残すだけで、声・判定・点数には使わない
//   low：その秒の全部のコマの、腰の中心 → 低いほうの足首の高さ ÷ 脚の長さ（hipRatio）の平均（n コマ）
//   kst：その秒の片足のコマの、低いほうの脚の膝の曲がり（度）の平均（nK コマ。片足のコマがなければ無い）
//   drop：今日の基準からの low の下がり（%、下がると正）。knee：今日の基準からの kst の増え（度）。
//   comb：(drop + knee × HIP_COMB.kneeW) ÷ 2。基準ができるまでと、測れなかった値は無い
export interface HipComb {
  low: number
  n: number
  kst?: number
  nK: number
  drop?: number
  knee?: number
  comb?: number
}
