# Mac から iPhone に https でアプリを配る（開発用）

iPhone の Safari でカメラを使うには https が要る。公開先（Vercel）に送らずに手元の変更を iPhone で試すときは、Mac で https の開発サーバーを動かす。
ふだんの `npm run dev`・`npm run build`・公開には関係しない（設定は `vite.https.config.mjs`、`vite.config.ts` はそのまま）。

## 動かす

```
npm run dev:https
```

- 最初の1回と、Mac の Wi-Fi のアドレスが変わったときに、証明書を作る（`~/.config/run-form-coach/dev-cert/`。リポジトリの外）
- 画面に `iPhone の Safari で開く: https://<Mac のアドレス>:5173/` と出る。iPhone と Mac は同じ Wi-Fi に

## iPhone に証明書を入れる（最初の1回と、作り直したとき）

1. iPhone の Safari で `https://<Mac のアドレス>:5173/rfc-dev-cert.cer` を開く。「この接続はプライベートではありません」と出たら「詳細を表示」→「この Web サイトを閲覧」
2. 「構成プロファイルをダウンロードしようとしています」→「許可」
3. 設定 → 一般 → VPN とデバイス管理 → 「run-form-coach dev」→ インストール
4. 設定 → 一般 → 情報 → 証明書信頼設定 → 「run-form-coach dev」をオンにする
5. Safari で `https://<Mac のアドレス>:5173/` を開く。警告が出なければよい

証明書を作り直したら、古いプロファイルを消して入れ直す（設定 → 一般 → VPN とデバイス管理）。

## 気をつけること

- 開発サーバーのアプリは、公開先とは別のサイトとして扱われる。基準・設定・送る鍵・まだ送っていない記録は、公開先のものとは別になる。記録を Mac へ送るなら、このサイトでも送る鍵を入れる
- 記録を送る `/api/upload` は、公開先（Vercel）の関数に回している。送るときに1回、公開先を読みに行く
- 開発サーバーは、iPhone に向けて Mac のファイルを配っている。家の Wi-Fi など、知らない人のいないところで使い、終わったら止める（Ctrl+C）
