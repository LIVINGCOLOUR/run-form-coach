// 画像上の点（ピクセル座標。y は下向き）と、MediaPipe の見えている確からしさ
export interface Pt {
  x: number
  y: number
  v: number
}

// 1コマの骨格（MediaPipe Pose の33点）
export type Frame = Pt[]

// 姿勢の項目
export type ItemKey = 'head' | 'trunk' | 'body' | 'hip'

// 1コマから測った角度など
export interface Measure {
  // 首の傾き − 体幹の傾き（度）。直立との差で「頭が前に出た量」を見る
  neck: number
  // 体幹の前傾（腰→肩の線と鉛直の角度。前が正）
  trunk: number
  // 体全体の前傾（足首→肩の線と鉛直の角度。前が正）
  body: number
  // 腰の高さ（腰から接地側の足首までの高さ ÷ 脚の長さ）
  hipRatio: number
  // 進む向き（右へ走っていれば 1、左なら -1）
  dir: 1 | -1
}

// 初回だけ取る直立の基準
export interface Baseline {
  neck: number
  createdAt: number
  head?: number // 立ち姿勢：肩→耳の前傾（度）
  trunk?: number // 立ち姿勢：腰→肩の前傾（度）
}

// 1秒ごとの記録
export interface Sample {
  t: number // 練習開始からの秒（一時停止中は進まない）
  head: number // 直立との差（度）
  trunk: number
  body: number
  hipDrop: number // 序盤の自分の腰の高さからの下がり（%）
  score: number // 姿勢スコア 0〜100
  quiet: boolean // 声なしで確認している時間か
}

export type Category = 'good' | 'mid' | 'bad'

// アニメーション用の1歩（正規化済みの骨格の連続）
export interface Stride {
  frames: Frame[]
  dir: 1 | -1
  score: number
  avg: { head: number; trunk: number; body: number; hipDrop: number }
}

export interface CueLog {
  t: number
  item: ItemKey | 'praise' | 'recover'
  text: string
}

export interface Session {
  id: string
  startedAt: number
  durationSec: number
  speedKmh?: number
  samples: Sample[]
  cues: CueLog[]
  strides: Partial<Record<Category, Stride>>
  share: Record<Category, number> // 0〜1
  breakdownMin?: number // 崩れ始め（分）
  quietHeldSec: number // 声なしで保てた秒数
  taps?: number[] // そばの人が「今悪い」を押した時刻（秒）
  provisionalBaseline?: boolean // 動画で試したときの仮の基準
  logId?: string // 調整用の記録
  standing?: { head: number; trunk: number; issue: 'head' | 'back' | null } // 走る前の立ち姿勢（猫背のチェック）
}
