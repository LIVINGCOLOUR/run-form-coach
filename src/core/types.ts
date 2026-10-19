// 画像上の点（ピクセル座標。y は下向き）と、MediaPipe の見えている確からしさ
export interface Pt {
  x: number
  y: number
  v: number
}

// 1コマの骨格（MediaPipe Pose の33点）
export type Frame = Pt[]

// 姿勢の項目。trunkBack・bodyBack は、上体・体全体が走り始めの自分より起きすぎた（後ろに傾いた）側
export type ItemKey = 'head' | 'trunk' | 'trunkBack' | 'body' | 'bodyBack' | 'hip'
// 並び順が、声をかける優先順（頭 → 上体 → 上体の起きすぎ → 体全体 → 体全体の起きすぎ → 腰）
export const ITEM_KEYS: ItemKey[] = ['head', 'trunk', 'trunkBack', 'body', 'bodyBack', 'hip']

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
  head: number // 走り始めの自分の首の角度との差（度）。基準ができるまでは 0
  trunk: number
  body: number
  hipDrop: number // 序盤の自分の腰の高さからの下がり（%）
  score: number // 姿勢スコア 0〜100
  quiet: boolean // 声なしで確認している時間か
  // 判定に使った値（上体と体全体は、走り始めの自分からの増え方を LIMITS の目盛りに直したもの）。ないときは trunk・body そのもの
  judge?: { trunk: number; body: number }
  // 起きすぎの側の判定の値（LIMITS の目盛り）。基準ができる前は、決まった線と比べる値（後ろへの傾き）
  back?: { trunk: number; body: number }
  headLean?: number // 頭の位置そのもの（肩→耳の前傾、度）
  // 顎：耳→鼻の線の上向きの、走り始めの自分からの変化（度。上体が起きた分は差し引く）。測って記録するだけで、声はかけない
  chin?: number
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
  focus?: { level: 'beginner' | 'intermediate' | 'advanced'; step: number } // この走りのレベルと、注意した項目の段階（level.ts）
}

// 調整用の記録（カメラ版は src/modes/camera/log.ts の LogRecorder で作る）
export interface RunLog {
  id: string
  startedAt: number
  width: number
  height: number
  columns: string[]
  points: number[]
  phases: readonly string[]
  rows: number[][]
  events: [number, string][] // [t, 話した言葉や段階の切り替え]
  sessionId?: string
  // 同じ瞬間の performance.now()（ms）と Date.now()（ms）。t が performance.now() の秒のとき（カメラで撮ったとき）だけある。
  // 別の端末の記録（スマホ版）と時刻を合わせるのに使う：ふつうの時刻（ms） = epochMs + (t × 1000 − perfMs)
  // 動画で試したときの t は動画の中の秒なので、付けない
  clock?: { perfMs: number; epochMs: number }
  // 走っている間も間引かず、毎コマ骨格を取った記録（カメラ版の「全コマ記録」?full=1 と、動画で試したとき）。
  // ないときは、安定して走っている間は間引いている（取らなかったコマは rows にない）
  full?: boolean
}
