// 画像上の点（ピクセル座標。y は下向き）と、MediaPipe の見えている確からしさ
export interface Pt {
  x: number
  y: number
  v: number
}

// 1コマの骨格（MediaPipe Pose の33点）
export type Frame = Pt[]

// 姿勢の項目。trunkBack・bodyBack は、上体・体全体が起きすぎた（後ろに傾いた）側
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
  head: number // 今日の基準（整えたあとの形）から頭が前に出た量（度）。基準ができるまでは 0
  trunk: number
  body: number
  hipDrop: number // 今日の基準の腰の高さからの下がり（%）
  score: number // 姿勢スコア 0〜100
  quiet: boolean // 声なしで確認している時間か
  // 今日の基準からの崩れ（上体と体全体の増え方を LIMITS の目盛りに直したもの）。基準ができるまでは無い
  judge?: { trunk: number; body: number }
  // 起きすぎの側（今日の基準から後ろへ傾いた量を、LIMITS の目盛りに直したもの）。基準ができるまでは無い
  back?: { trunk: number; body: number }
  headLean?: number // 頭の位置そのもの（肩→耳の前傾、度）
  neck?: number // 首の角度そのもの（肩→耳の前傾 − 腰→肩の前傾、度）
  yaw?: number // スマホが体の前側から（正）か後ろ側から（負）撮っているか（geometry の yawSign の1秒の平均）
  // 正しいフォームの線（camera/params.ts の FORM）を外れた量を、LIMITS の目盛りに直したもの。判定しなかった項目は無い
  form?: Partial<Record<ItemKey, number>>
  // 顎：耳→鼻の線の上向きの、今日の基準からの変化（度。上体が起きた分は差し引く）。測って記録するだけで、声はかけない
  chin?: number
}

// 正しいフォームとの比べ（カメラ版、src/modes/camera/form.ts）。結果の画面と次の一歩に使う。
// よい例（camera/params.ts の GOOD）との差は、ここには入れず、画面に出すときに value から出す（よい例を合わせ直したら、前の走りにも効くように）
export type FormGroup = 'body' | 'trunk' | 'head'
export interface FormResult {
  group: FormGroup
  key: ItemKey // 外れていた側（内側なら、近いほうの線の側）
  value: number // 走っていた秒の平均（度）。頭は首の角度
  value2?: number // 頭の位置そのもの（頭だけ）
  over: number // 平均が線からどれだけ外れていたか（度。内側なら負）
  inside: number // 線と比べた窓の平均（FORM.window 秒）のうち、内側だった割合（0〜1）
  cues: number // 正しいフォームの線で知らせた回数
  fixed: boolean // 知らせたあと、線の内側に入った（直った）ことがある
  judged: boolean // 線と比べられた（頭は、斜めから撮っているときは比べない）
  // 走っていた秒の、前側・後ろ側の値（geometry の yawSign）の平均（頭だけ）。SETUP.frontMax を越えていたら、
  // スマホが前側から撮っていたか点の取り方がずれていて、頭は実際より大きく出ているかもしれない
  yaw?: number
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
  lead?: boolean // 正しいフォームの線で言った声（整える・直った・整った）
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
  form?: FormResult[] // 正しいフォームとの比べ（カメラ版）
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
