// カメラ版だけで使う型（骨格の点や記録の型は src/core/types.ts）

// 1コマから測った角度など
export interface Measure {
  // 首の傾き − 体幹の傾き（度）。走り始めの自分との差で「頭が前に出た量」を見る
  neck: number
  // 頭の位置そのもの：手前側の肩→耳の線の、鉛直からの前傾（度）
  headLean: number
  // スマホが体の前側から（正）か、後ろ側から（負）撮っているか（geometry の yawSign）
  yaw: number
  // 体幹の前傾（腰→肩の線と鉛直の角度。前が正）
  trunk: number
  // 体全体の前傾（足首→肩の線と鉛直の角度。前が正）
  body: number
  // 腰の高さ（腰から接地側の足首までの高さ ÷ 脚の長さ）
  hipRatio: number
  // 進む向き（右へ走っていれば 1、左なら -1）
  dir: 1 | -1
}
