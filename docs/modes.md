# 声かけのしくみと、入り口（モード）の足し方

ランフォームコーチは、入り口を3つ持つ：カメラ（トレッドミル。`docs/camera-mode.md`）、スマホ1台を腰に（無料版。`docs/phone-spec.md`）、体に付けるセンサー（別売り。`docs/sensor-mode.md`）。
声かけのしくみは3つで共通にし、入り口ごとに「何を測るか」だけを替える。

## しくみの分け方

| ファイル | 中身 | 持ち主 |
|---|---|---|
| `src/core/engine.ts` | 声かけのしくみ（`CueEngine`）。いつ声をかけ、直ったらほめ、きれいに走れていたらほめ、声なしで見守るか。同じ項目の知らせは1時間に `LIMIT.perHour` 回まで（方針は `docs/product.md`）。一時停止、見えなくなったとき、結果のうち共通の部分（良い・ふつう・悪いの割合、崩れ始め、声なしで保てた時間） | カメラ版のセッション（本線）だけが直す |
| `src/core/params.ts`（`CUE`・`QUIET`・`PRAISE`・`SCORE`・`LIMIT` など） | しくみの数字 | 同上 |
| `src/modes/camera/` | カメラの「見る役」（`coach.ts` の `CameraAnalyzer`）と、それを使う `Coach`。走り出しに正しいフォームへ整える段階（`form.ts`）、今日の基準、速さの見張り、走り姿。流れと項目は `docs/camera-mode.md`、数字は同じフォルダの `params.ts` | カメラ版 |
| `src/modes/sensor/` | 自作のセンサーへのつなぎ（Web Bluetooth）、通知のパーサ、崩れの見分け、記録。動かす役 `SensorRunner`（`runner.ts`）をカメラ版・腰スマホ・センサーランで共通に使う（カメラ版は区切りをカメラから渡し、ほかはセンサーの揺れで決める：`gate.ts`）。センサーだけで走る「センサーラン」の画面（`screens/`）と記録（`runLog.ts`）もここ | センサー版 |
| 新しい入り口のフォルダ（例：`src/modes/phone/`） | その入り口の「見る役」、項目、線、声かけの言葉 | その入り口のセッション |

## 新しい入り口の作り方

`engine.ts` の `ModeAnalyzer` を1つ作り、`CueEngine` に渡す。`engine.ts` は直さない。

```ts
import { CueEngine, type ItemSpec, type ModeAnalyzer, type Values } from '../../core/engine'
import { PHRASES } from '../../core/phrases'

type PhoneItem = 'bounce' | 'braking'          // この入り口で測る項目
interface PhoneMeasure { /* 1コマ分のスマホのセンサーの値 */ }
interface PhoneSample { t: number; score: number | null /* 画面や結果に使う1秒の記録。判定しない秒は null */ }

const ITEMS: ItemSpec<PhoneItem>[] = [         // 並び順が、声をかける優先順
  { key: 'bounce', limits: { full: 6, zero: 12, cue: 9 }, cue: '弾みすぎています。…' },
  { key: 'braking', limits: { full: 1, zero: 3, cue: 2 }, cue: '着地でブレーキがかかっています。…' },
]

class PhoneAnalyzer implements ModeAnalyzer<PhoneMeasure, PhoneSample, PhoneItem> {
  items = ITEMS
  say = { lost: PHRASES.phoneLost, giveUp: PHRASES.phoneGiveUp }  // 入り口で替える言葉（なければカメラの言葉）
  second(bucket, t, ctx) {
    if (bucket.length < 3) return null
    // 線と比べる値（大きいほど崩れている向きにそろえる）。判定しない項目は入れない。基準ができる前なら {}
    const values: Values<PhoneItem> = this.ref ? { bounce: …, braking: … } : {}
    return { sample: { t, score: ctx.score(values) }, values, ready: /* 走り始めの基準ができた秒だけ true */ false }
  }
}

const coach = new CueEngine(new PhoneAnalyzer(), { pause: true })
coach.update({ t, present: true, moving, m })  // 戻り値の speak を声で読み上げる
```

決まり：

- `values` の値は、**大きいほど崩れている**向きにそろえる。線（`limits`）の `full` 以下が満点、`zero` 以上が0点、`cue` を越えたら声をかける。
- その秒に判定しない項目は `values` に**入れない**（0 を入れると「崩れていない」と数えられ、「良い」の割合が水増しされる）。走り始めの基準ができる前の項目や、測れなかった項目がこれにあたる。1つも入れなければ、その秒は判定しない秒になる。
- 判定しない秒の扱い（しくみが決める）：
  - 1秒の点数は、判定した項目だけで出す。1つもなければ `null`。
  - 良い・ふつう・悪いの割合と崩れ始めには入れない（分母からも外す）。結果の時間（`durationSec`）には入る。
  - 声かけ・直ったかの確認は、項目ごとに、その項目を判定した秒だけで見る。判定した秒が `CUE.window × CUE.coverage` に足りなければ声をかけない。
  - 5分ほめる・声なしの見守りに入る・見守りをやめるは、判定した秒だけの平均で見る。見守り中の判定しない秒は、保てた時間に数えない。判定した秒がほとんどないまま見守りの時間が終わったら、「保てていました」とは言わない。
- 走り始めの自分と比べる項目は、基準ができた秒に `ready: true` を返す。声なしの見守りは、そこから `QUIET.enterWindow` 経つまで入らない。
- しくみが話す言葉（`SAY` の開始・一時停止・見えなくなったとき・終わりなど）は、見る役の `say` で入り口ごとに替えられる。替えなかった言葉はカメラの言葉のまま。
- 一度だけかけたい声（カメラの「最初から頭が前に出ている」など）は `once` で返す。
- 声かけの言葉は `phrases.ts` の `PHRASES` に足し、音声も作り直す（`npm run voices`）。
- 項目の線は、その入り口のフォルダに置く。根拠（研究データ、試した記録）を一緒に書く。
- 線の厳しさをランナーのレベル（`core/level.ts`）で変えるときも、入り口のフォルダで持つ（カメラ版は `camera/params.ts` の `STRICT` と `applyStrictness`。`Coach` を作るときにレベルを渡す）。点数も同じ線から出すので、良い姿勢の割合も同じだけ変わる。
- 1秒の点数は `ctx.score(values)`（判定した項目のうち、いちばん崩れている項目の点数。判定した項目がなければ `null`）を使う。自分で計算しない。

## しくみを直したくなったら

入り口の都合で `engine.ts` を曲げない。直したいことは本線（カメラ版）の担当がまとめて直し、ほかの入り口を壊さないことをテストで確かめる（どの入り口も main の上で作る）。
