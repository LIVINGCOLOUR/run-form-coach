# ランフォームコーチ（RUN FORM COACH）

トレッドミルの横に置いたスマホ1台で走りを見続け、外から見て分かるフォームの崩れ（猫背・前傾）を、その場で声で直すウェブアプリ。

- 骨格の推定：MediaPipe Pose Landmarker（端末の中で動かす。映像は保存も送信もしない）
- 記録：端末の中（IndexedDB）だけ
- 画面：React + Vite + TypeScript

## 開発

```sh
npm install
npm run dev     # https が要る iPhone での確認は、公開先（Vercel）で行う
npm test        # 計測・判定・声かけの流れのテスト
```

「動画で試す」から、横から撮ったランニングの動画を入れると、カメラの代わりに動画で一通り動かせる（直立の基準は仮のものになる）。
