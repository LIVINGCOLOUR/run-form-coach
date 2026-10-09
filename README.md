# ランフォームコーチ（RUN FORM COACH）

▶ 紹介動画：https://run-form-coach.vercel.app/promo/

トレッドミルの横に置いたスマホ1台で走りを見続け、外から見て分かるフォームの崩れ（猫背・前傾）を、その場で声で直すウェブアプリ。

- 骨格の推定：MediaPipe Pose Landmarker（端末の中で動かす。映像は保存も送信もしない）
- 記録：端末の中（IndexedDB）だけ
- 画面：React + Vite + TypeScript

判定の精度を上げるための検証データの集め方（水戸ランナー塾への相談を含む）は [docs/validation-plan.md](docs/validation-plan.md)。
競合の調査（定期的に調べ直す）は [docs/competitors.md](docs/competitors.md)。

## 開発

```sh
npm install
npm run dev     # https が要る iPhone での確認は、公開先（Vercel）で行う
npm test        # 計測・判定・声かけの流れのテスト
```

「動画で試す」から、横から撮ったランニングの動画を入れると、カメラの代わりに動画で一通り動かせる（直立の基準は仮のものになる）。

## 紹介動画（video/）

**紹介動画（だれでも見られる）：https://run-form-coach.vercel.app/promo/** （構想を含む）

書き出した動画の元ファイルは [リリース promo-2026-10-07](https://github.com/LIVINGCOLOUR/run-form-coach/releases/tag/promo-2026-10-07) にもある。公開ページの動画は `public/promo/` に置いている。

Remotion と SVG で作る60秒・縦（1080×1920）の紹介動画。ナレーションは Vertex AI の Gemini TTS、音楽は Lyria 3 Pro（Vertex AI には Lyria 3.5 がないため）。
骨格の絵は、アプリと同じ `src/ui/figure.ts` で描く。

```sh
cd video
npm install
npm run narration   # ナレーションを作り直す（gcloud でログインしておく）
npm run studio      # プレビュー
npm run render      # out/run-form-coach-promo.mp4 に書き出す
```
