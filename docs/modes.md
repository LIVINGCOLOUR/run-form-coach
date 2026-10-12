# モード（入り口）の足し方

ランフォームコーチは、入り口を3つ持つ：カメラ（トレッドミル、今あるもの）、スマホ1台（無料版）、体に付けるセンサー（別売り）。
声かけのしくみは3つで共通にし、入り口ごとに「何を測るか」だけを替える。

## しくみの分け方

| ファイル | 中身 | 持ち主 |
|---|---|---|
| `src/core/engine.ts` | 声かけのしくみ（`CueEngine`）。いつ声をかけ、直ったらほめ、きれいに走れていたらほめ、声なしで見守るか。一時停止、見えなくなったとき、結果のうち共通の部分（良い・ふつう・悪いの割合、崩れ始め、声なしで保てた時間） | カメラ版のセッション（本線）だけが直す |
| `src/core/params.ts`（`CUE`・`QUIET`・`PRAISE`・`SCORE` など） | しくみの数字 | 同上 |
| `src/modes/camera/coach.ts` | カメラの「見る役」（`CameraAnalyzer`）と、それを使う `Coach`。頭・体幹・体全体・腰、走り始めの基準、走り姿のアニメーション。上体と体全体は最初の3分も決まった線で判定し、頭と腰は走り始めの基準ができるまで判定しない。カメラの数字は同じフォルダの `params.ts` | カメラ版 |
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
- 1秒の点数は `ctx.score(values)`（判定した項目のうち、いちばん崩れている項目の点数。判定した項目がなければ `null`）を使う。自分で計算しない。

## しくみを直したくなったら

入り口のセッションで `engine.ts` を直さない。直したいことを本線（カメラ版）のセッションに頼み、本線で直して main に入れてから、入り口のブランチに取り込む（`git merge main`）。
