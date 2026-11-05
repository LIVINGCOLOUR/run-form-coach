# ランフォームコーチ（RUN FORM COACH）

▶ 紹介動画：https://run-form-coach.vercel.app/promo/

走っている最中にフォームの崩れを見つけ、その場で直すウェブアプリ。入り口は3つ。

- **トレッドミル（本線）**：横に置いたスマホ1台で走りを見続け、外から見て分かるフォームの崩れ（猫背・頭が前・前傾・腰の落ち込み・足が体より前に着く）を、その場で声で直す
- **腰スマホ（無料）**：スマホを腰に付けて外を走り、ピッチの崩れを声とメトロノームで直す
- **センサーラン**：自作のセンサーを体に付けて外を走り、崩れた場所を振動で知らせる

作りと記録：

- 骨格の推定：MediaPipe Pose Landmarker（端末の中で動かす。映像は保存も送信もしない）
- 記録：端末の中（IndexedDB）。テスト期間は、走った記録（骨格の点の数字とセンサーの値。映像は入らない）を開発者の Mac へ送っている（`CLAUDE.md` の「手順」）
- 画面：React + Vite + TypeScript

文書の地図（方針 → 仕組み → 根拠 → 手順）は [CLAUDE.md](CLAUDE.md) のいちばん上。製品とモデルの方針は [docs/product.md](docs/product.md)、確かめ方と結果は [docs/validation-plan.md](docs/validation-plan.md)、競合の調査は [docs/competitors.md](docs/competitors.md)。

## 開発

```sh
npm install
npm run dev     # https が要る iPhone での確認は、公開先（Vercel）か npm run dev:https（docs/dev-https.md）で行う
npm test        # 計測・判定・声かけの流れのテスト
```

「動画で試す」から、横から撮ったランニングの動画を入れると、カメラの代わりに動画で一通り動かせる（直立の基準は仮のものになる）。

## 紹介動画（video/）

**紹介動画（だれでも見られる）：https://run-form-coach.vercel.app/promo/** （構想を含む）

書き出した動画の元ファイルは [リリース promo-2026-10-07](https://github.com/LIVINGCOLOUR/run-form-coach/releases/tag/promo-2026-10-07) にもある。公開ページの動画は `public/promo/` に置いている。

Remotion と SVG で作る60秒・縦（1080×1920）の紹介動画。ナレーションは Vertex AI の Gemini TTS、音楽は Lyria 3 Pro（Vertex AI には Lyria 3.5 がないため）。
骨格の絵は、アプリと同じ `src/modes/camera/ui/figure.ts` で描く。

```sh
cd video
npm install
npm run narration   # ナレーションを作り直す（gcloud でログインしておく）
npm run studio      # プレビュー
npm run render      # out/run-form-coach-promo.mp4 に書き出す
```
