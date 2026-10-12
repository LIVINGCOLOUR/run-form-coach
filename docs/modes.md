# モード（入り口）の足し方

ランフォームコーチは、入り口を3つ持つ：カメラ（トレッドミル、今あるもの）、スマホ1台（無料版）、体に付けるセンサー（別売り）。
声かけのしくみは3つで共通にし、入り口ごとに「何を測るか」だけを替える。

## しくみの分け方

| ファイル | 中身 | 持ち主 |
|---|---|---|
| `src/core/engine.ts` | 声かけのしくみ（`CueEngine`）。いつ声をかけ、直ったらほめ、きれいに走れていたらほめ、声なしで見守るか。一時停止、見えなくなったとき、結果のうち共通の部分（良い・ふつう・悪いの割合、崩れ始め、声なしで保てた時間） | カメラ版のセッション（本線）だけが直す |
| `src/core/params.ts` の `CUE`・`QUIET`・`PRAISE`・`SCORE` など | しくみの数字 | 同上 |
| `src/core/coach.ts` | カメラの「見る役」（`CameraAnalyzer`）と、それを使う `Coach`。頭・体幹・体全体・腰、走り始めの基準、走り姿のアニメーション | カメラ版 |
| 新しい入り口のフォルダ（例：`src/modes/phone/`） | その入り口の「見る役」、項目、線、声かけの言葉 | その入り口のセッション |

## 新しい入り口の作り方

`engine.ts` の `ModeAnalyzer` を1つ作り、`CueEngine` に渡す。`engine.ts` は直さない。

```ts
import { CueEngine, type ItemSpec, type ModeAnalyzer } from '../../core/engine'

type PhoneItem = 'bounce' | 'braking'          // この入り口で測る項目
interface PhoneMeasure { /* 1コマ分のスマホのセンサーの値 */ }
interface PhoneSample { t: number; score: number /* 画面や結果に使う1秒の記録 */ }

const ITEMS: ItemSpec<PhoneItem>[] = [         // 並び順が、声をかける優先順
  { key: 'bounce', limits: { full: 6, zero: 12, cue: 9 }, cue: '弾みすぎています。…' },
  { key: 'braking', limits: { full: 1, zero: 3, cue: 2 }, cue: '着地でブレーキがかかっています。…' },
]

class PhoneAnalyzer implements ModeAnalyzer<PhoneMeasure, PhoneSample, PhoneItem> {
  items = ITEMS
  second(bucket, t, ctx) {
    if (bucket.length < 3) return null
    const values = { bounce: …, braking: … }    // 線と比べる値（大きいほど崩れている向きにそろえる）
    return { sample: { t, score: ctx.score(values) }, values, ready: /* 走り始めの基準ができた秒だけ true */ false }
  }
}

const coach = new CueEngine(new PhoneAnalyzer(), { pause: true })
coach.update({ t, present: true, moving, m })  // 戻り値の speak を声で読み上げる
```

決まり：

- `values` の値は、**大きいほど崩れている**向きにそろえる。線（`limits`）の `full` 以下が満点、`zero` 以上が0点、`cue` を越えたら声をかける。
- 走り始めの自分と比べる項目は、基準ができた秒に `ready: true` を返す。声なしの見守りは、そこから `QUIET.enterWindow` 経つまで入らない。
- 一度だけかけたい声（カメラの「最初から頭が前に出ている」など）は `once` で返す。
- 声かけの言葉は `phrases.ts` の `PHRASES` に足し、音声も作り直す（`npm run voices`）。
- 項目の線は、その入り口のフォルダに置く。根拠（研究データ、試した記録）を一緒に書く。
- 1秒の点数は `ctx.score(values)`（いちばん崩れている項目の点数）を使う。自分で計算しない。

## しくみを直したくなったら

入り口のセッションで `engine.ts` を直さない。直したいことを本線（カメラ版）のセッションに頼み、本線で直して main に入れてから、入り口のブランチに取り込む（`git merge main`）。
