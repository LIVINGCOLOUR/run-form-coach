# 競合の調査

定期的に調べ直し、下の「調べた記録」に追記する。調べ方は最後の「次に調べるとき」にそろえる。

## このアプリの売り（比べる軸）

- スマホのカメラ1台で、**走っている最中に見続け**、姿勢の崩れを**その場で声で直す**
- 体の全体（首・上体・体全体の傾き・腰の落ち込み）が見える
- 機器を買わなくてよい。インストールも要らない（ウェブ）。日本語
- 映像は端末の外に出さない
- 弱み：トレッドミルの上でしか使えない

## 地図（2026-11-01 時点）

### 1. カメラ × 走っている最中に声で直す（このアプリと同じ席）

| 名前 | 中身 | 見立て |
|---|---|---|
| [RunForm AI - Running Coach](https://apps.apple.com/app/id6763226958) | 中国系の個人開発（Zhang Wei）。トレッドミルの横に iPhone を置き、走りながら声で指導、13項目とうたう。無料は月5回の解析、月 $3.99・3か月 $9.99・年 $29.99（[appshunter](https://appshunter.io/ios/app/runform-ai-running-coach/id6763226958) の写し、2026-11-01） | 評価は0件のまま。ストアの文には「約3分で解析が届く」ともあり、走りながら声をかけるのか、走った後の解析なのかがはっきりしない。宣伝文だけで、ライバル未満 |
| [running-form-analyzer](https://github.com/henryczup/running-form-analyzer)、[RunTrack](https://github.com/DrDraesel/runtrack) | GitHub の個人の試作。カメラ＋骨格推定＋その場の表示や音声 | 製品ではない |
| [Gait Coach](https://github.com/mihirk460/gait_analysis)（2026-09） | 作りはこのアプリとほぼ同じ（iPhone の Safari＋MediaPipe、横と後ろ、読み上げ） | 作者は実機の iPhone で動かしていないと書いている。製品ではない |

**ちゃんとした製品はまだない。空いている席。**（2026-11-01 も新顔なし）

### 2. カメラ × 撮ってから解析（混み合っている）

| 名前 | 中身 | 見立て |
|---|---|---|
| [Ochy](https://apps.apple.com/jp/app/running-gait-analysis-ochy/id1531481638)（フランス） | 短い動画から解析。トレッドミル用の設定あり。最新は v19.3.11（10月19日。撮影・動画の取り込み・歩きの解析の直し）。月1,500円、年5,000円。英語のみ。評価58件・平均4.5（10-09 時点。今回は確かめられず） | **一番手強い**。[170万ドルの資金、adidas adiClub と連携](https://www.businesswire.com/news/home/20250219340484/en/AI-Running-Gait-Platform-Ochy-Secures-1.7M-Pre-Seed-Funding-and-Announces-Integration-within-adidas-adiClub-Program/)、[イギリス陸連と提携](https://www.englandathletics.org/about-us/our-partners/ochy/)。その場で見るモードを足してくる可能性が一番高い |
| [RUN!](https://prtimes.jp/main/html/rd/p/000000005.000166599.html)（TNQ Tech、国内） | 3D姿勢解析、床反力の推定、点数化、ストレッチの提案。2025-10 発表 | 撮った後に解析 |
| [Form Atlas](https://note.com/runner_vision/n/nd39424678c15)、[AI陸上トレーナー](https://play.google.com/store/apps/details?id=com.harutowatanabe.mealier&listing=track-and-field&hl=ja)、[Run Pose Pro](https://apps.apple.com/jp/app/run-pose-pro/id6748298583)、[AIスポーツトレーナー](https://ai-sportstrainer.com/columns/track-and-field-app-comparison)（国内） | 個人や小さな会社。動画から解析 | 撮った後に解析 |
| [RunForm AI: Running Gait](https://apps.apple.com/us/app/runform-ai-running-gait/id6753753064)（PacoStudio） | 動画を上げると横・後ろから20以上の項目。クレジット制。評価5件・平均3.4 | 撮った後に解析 |
| Run AiK、StrideIQ | 30秒の動画から解析 | 撮った後に解析 |
| [AiKYNETIX](https://apps.apple.com/us/app/aikynetix-run-jump-optimize/id1565394039) | 撮った動画か上げた動画から解析。ストアの文に「リアルタイムの動きの解析」とある | 声で直すとは書いていない。中身は未確認 |

### 3. 体に付けるセンサー × その場で声（カメラなし）

| 名前 | 中身 | 見立て |
|---|---|---|
| [StrideCoach](https://apps.apple.com/jp/app/id6746169274)（Beflex、韓国） | **AirPods の動きのセンサー**で、走りながら声で指導。ピッチ・接地時間・上下動・衝撃・**頭の角度**・左右差など8項目。月800円、年5,000円。評価16件・平均4.9（10-09 時点。今回は確かめられず） | **一番近い対抗馬**。外でも使え、機器も要らない。ただし頭しか見えず、上体・体全体・腰は見えない |
| [Runmetrix](https://runmetrix.casio.com/jp/application/)（カシオ・アシックス） | 腰のセンサー（14,080円）。走りながらの「[リアルタイムコーチング](https://runmetrix.casio.com/jp/rtc/)」（目的別に基本・健康・フォーム改善。イヤホンが要る）を足した | リアルタイムコーチングは**トレッドミルでは使えない**と公式に書いてある（2026-10-20 確認）。声で何を言うかは未確認 |
| [Lumo Run](https://lumobodytech.com/lumo-run) | 腰のセンサーで、その場で声でフォーム指導していた | **販売終了**。その場のフォーム指導に払い続けてもらう難しさの前例 |
| NURVV Run（中敷き）、STRIV（中敷き） | 足裏のセンサーで、その場の指導 | 今の状態は未確認 |
| [Stride Pro](https://apps.apple.com/us/app/stride-pro-ai-run-coach/id6788269243)、[StrideCue](https://apps.apple.com/us/app/stridecue-ai-cadence-coach/id6762534103)、[RunVoice](https://apps.apple.com/us/app/id6741077557) | 時計やスマホのセンサーの数字（ピッチ・歩幅・心拍など）を声で知らせる、練習の組み立てをするコーチアプリ。カメラは使わない | 姿勢は見ない。StrideCoach より遠い |

### 4. ジム・医療向けの機器やサービス

| 名前 | 中身 |
|---|---|
| [Visbody Creator600](https://visbody.com/visbody-creator600/)・A600 | 視覚センサー付きのAIトレッドミル。ジム・リハビリ施設・チーム向け。見積もり制。**トレッドミルごと買い替え**が要る。A600 は「23項目をリアルタイムで解析」とうたう（[Visbody のページ](https://visbody.com/blog/visbody-creator600-the-ultimate-ai-gait-analysis-treadmill/)。メーカーの文だけ。声で直すかは未確認） |
| [Merach UltraTread](https://www.t3.com/active/merach-unveils-worlds-first-ai-powered-treadmill-that-changes-speed-and-incline-based-on-your-heart-rate)（CES 2026） | 対話するAIコーチ付きの家庭用トレッドミル（$1,199〜1,999）。心拍を見て速さと傾きを変える。**フォームは見ない** |
| [Runeasi](https://runeasi.ai/)、[DorsaVI](https://dorsavi.com/ai-motion-analysis/) | 理学療法士向け。センサーや動画AI |
| [LEOMO Performance Center Tokyo](https://jp.leomo.io/pages/lpco) | センサーを5か所に付ける対面の有料診断 |
| [ジー・サーチ ランニングフォーム診断](https://kyodonewsprwire.jp/index.php/release/202510297997) | 富士通の骨格認識。法人向け |
| Peloton Run Analysis（2026-10-01 開始） | カメラ付きの Tread Vision（$3,495）・Tread+ Vision（$6,695）で、ピッチ・歩幅・上下動を見て、走った後に点数（1〜100）と、走りの途中でどう変わったかと、次に直す1つの助言。**走っている最中は直さない**：ウィスコンシン大学の生体力学の専門家に相談して決めた（[Pelobuddy](https://www.pelobuddy.com/peloton-run-analysis/)、[The Clip Out](https://theclipout.com/run-analysis-peloton-tread-vision/)）。助言は次に走り始めるときに出る（[Engadget](https://www.engadget.com/2264548/peloton-tread-flex-vision-launch/)）。安い折りたたみの Tread Flex にはカメラがない。このアプリは、この点への答えを持っておく |

### 5. 時計（Apple Watch・Garmin）との比較（2026-10-12）

走る人の多くがもう持っている時計と比べる。料金の形（無料＝スマホ1台、月1,000円＝トレッドミルのカメラ、センサーは別売り）の各モードと並べる。

◎＝得意、○＝できる、△＝推定や条件付き、×＝できない

| | Apple Watch | Garmin の時計 | 無料版（スマホを腰に） | 有料版（トレッドミルのカメラ） | センサー版（予定） |
|---|---|---|---|---|---|
| 追加で要るもの | 時計本体 | 時計本体（胸ベルトがあればより正確） | ランニングベルト | トレッドミル | センサー（別売り） |
| 使える場所 | どこでも | どこでも | どこでも | トレッドミルの上 | どこでも |
| ピッチ | ○ | ○ | ○ | ○ | ○ |
| 上下動・接地時間・歩幅 | ○ | ○ | ○（予定） | ○（スロー動画の解析で） | ○ |
| ランニングパワー | ○ | ○ | ― | ― | ― |
| 猫背（頭が前に出る） | × | × | × | ◎ | ○（首と胸） |
| 上体・体全体の前傾 | × | × | △（胸に付けたときだけ） | ◎ | ○（胸） |
| 腰の落ち込み | × | × | × | ◎ | ×（腰のセンサーがない） |
| 着地が前すぎる | × | × | △（ブレーキから推定） | ○（スロー動画で） | ○（足首） |
| 腕振り | × | × | × | × | ○（手首） |
| 走っている最中の知らせ方 | 決めた範囲を外れたら通知（ペース・パワー・心拍・ピッチ） | 決めた範囲を外れたら振動や音（ピッチなど。未確認） | 声で、何をどう直すか | 声で、何をどう直すか | 声で、何をどう直すか |
| 直し方を言葉で言うか | ×（数字だけ） | ×（数字だけ） | ○ | ○ | ○ |
| 声を減らして身につけさせる | × | × | ○ | ○ | ○ |
| 比べる基準 | 一般的な目安 | 一般的な目安（色で評価） | 走り始めの自分 | 正しいフォームの線と、整えたあとの自分 | 走り始めの自分 |
| 走った後 | グラフ | グラフ、色の評価 | 崩れ始めた時間、次に直す1項目 | 良い1歩・悪い1歩の走り姿、崩れ始めた時間、次に直す1項目 | 同左（走り姿は除く） |

- Apple Watch：上下動・接地時間・歩幅・ランニングパワー・ピッチを時計だけで測る。ペース・パワー・心拍・ピッチの範囲を外れたら知らせる設定ができる（watchOS 9 以降）。[Apple のユーザガイド](https://support.apple.com/guide/watch/apd2a367064b/9.0/watchos/9.0)、[9to5Mac](https://9to5mac.com/2022/06/17/apple-watch-running-metrics-watchos-9/)
- Garmin：Forerunner 265・965 以降は、手首だけでパワー・ピッチ・接地時間・歩幅・上下動・上下動比を測る。胸ベルト（HRM 600 など）があるとより正確。[the5krunner](https://the5krunner.com/2023/02/06/new-garmin-wrist-running-dynamics-which-models-will-get-it/)、[Garmin HRM 600 の発表](https://www.garmin.com/en-US/newsroom/?p=5640)
- Garmin でピッチの範囲を外れたら知らせる機能は、確かめていない。
- 2026-11-01：watchOS 27 は、トレッドミルでの測り方の改善と、iPhone なしで使える Workout Buddy（声で励ます）が入ったが、姿勢は測らない（[Tom's Guide](https://www.tomsguide.com/wellness/smartwatches/watchos-27-is-live-7-new-features-to-try-first-on-your-apple-watch)、[MacRumors](https://macrumors.com/roundup/watchos-27/)）。Garmin も、姿勢を測る新しい機能の発表は見つからなかった。表は変えていない

**差は3つ**：①上半身の姿勢を見る（時計は手首にあるので見えない）、②直し方を言葉で言う（時計は数字と振動だけ）、③声を減らして身につけさせる（時計は外れるたびに鳴り続ける）。

**無料版の弱み**：腰のスマホで見られるものは時計とほぼ重なる。差は声のかけ方だけ。走っている最中と走った後に「姿勢はカメラやセンサーで見られる」と見せること、胸に付けた人には上体の前傾も見せることで補う。

## 見立て（2026-11-01）

1. カメラで見続けて、その場で声で直す席は空いている。これが売り。11月も新顔は見つからなかった。
2. 一番近いのは StrideCoach（AirPods だけ、外でも使える）。手軽さは向こうが上。こちらの差は**全身の姿勢が見える**こと。
3. Lumo Run が販売終了していることから、個人に月額で払い続けてもらうのは難しい。
4. 後から入ってくるなら Ochy。今は英語のみなので、日本では時間がある。
5. ジム・コーチ向けでは強みがある。Visbody はトレッドミルごと買い替えさせるが、こちらは**今あるトレッドミルにスマホを置くだけ**。
6. 大きい会社の動きは Peloton だけ。カメラ付きのトレッドミル（約50万円〜）で、走った後に1つだけ助言する形を選んだ。「その場で声」は避けたまま。Technogym・Life Fitness にカメラでのフォーム指導は見つからなかった。

## 調べた記録

### 2026-11-01

- **同じ席（カメラ × その場で声）に新顔なし**。英語・日本語で探したが、見つかったのは撮った後の解析か、カメラを使わない声のコーチだけ。
- RunForm AI - Running Coach：評価は0件のまま（[appshunter](https://appshunter.io/ios/app/runform-ai-running-coach/id6763226958)）。料金は無料（月5回）・月 $3.99・3か月 $9.99・年 $29.99。ストアの文に「約3分で解析が届く」とあり、走りながら声をかけるかはあいまい。
- Ochy：v19.3.11（10月19日）。撮影・動画の取り込み・歩きの解析の直しで、その場で見るモード・声・日本語は入っていない（検索の要約で確認）。
- StrideCoach：新しい更新の内容は見つからなかった。評価数は確かめられなかった。
- Peloton Run Analysis：始まった。走った後に点数と1つの助言、次に走り始めるときにも助言。走っている最中は直さないまま。Tread Vision $3,495、Tread+ Vision $6,695。
- 新しく地図に足したもの：AiKYNETIX（動画から解析）、Stride Pro・StrideCue・RunVoice（センサーの数字を声で言う。カメラなし）、Visbody A600（「23項目をリアルタイム」とうたう）、Merach UltraTread（心拍を見るAIコーチ。フォームは見ない）。
- 時計：watchOS 27 も Garmin も、姿勢を測る機能はない。
- **確かめられなかったこと**：今回の作業の場所からは App Store・カシオ（Runmetrix）などのページを直接開けず、すべて検索の要約とストアの写し（appshunter など）で確かめた。評価数・料金・更新日は、ストアを直接開いて確かめ直す必要がある。どのアプリも実際には使っていない。

### 2026-10-20（海外と競合を足した）

- 海外の YouTuber（22チャンネル）と競合アプリを `~/Developer/research-data/creators-overseas-2026-10-20.md` にまとめた（専門家の言うことの一致と食い違いも）。
- StrideCoach の Beflex は韓国の会社（KAIST の研究者が作った）。前回「国内」としたのは誤り。
- 大手は走っている最中の声を避けた（Peloton）か、外だけにした（Runmetrix）。カメラで走りながら声をうたう製品は今も RunForm AI だけ（評価は表示されないまま）。

### 2026-10-09（初回）

- 上の地図を作った。
- 前回の見立てで「大手がすでにやっている」と書いたのは誤り。その場で声をかけるとうたうのは RunForm AI（個人開発）だけだった。
- どのアプリも実際には使っていない。宣伝文とストアのページでの確認。

## 次に調べるとき

前回からの**変化**を中心に見て、上の「調べた記録」に日付を付けて追記する。地図と見立ても書き換える。

1. **同じ席への新顔**：カメラで走りを見続けて、その場で声で直すアプリが出ていないか
   - 検索例：`real-time running form feedback app camera voice`、`ランニングフォーム リアルタイム 音声 カメラ`
   - App Store・Google Play で「running form」「ランニングフォーム」の新着
2. **Ochy**：その場で見るモード、音声、日本語対応が入っていないか。ストアの更新履歴と ochy.io のブログ
3. **StrideCoach**：評価数の伸び、上体や腰まで測るようになっていないか、トレッドミル対応
4. **RunForm AI - Running Coach**：評価が付き始めたか（実際に動くかの手がかり）
5. **RUN!**・国内の個人開発：その場で見る機能が足されていないか
6. **ジム向け**：トレッドミルのメーカー（Technogym・Life Fitness・国内のジムチェーン）がカメラでのフォーム指導を入れていないか
7. 料金の変化（月額の相場）
8. **時計（Apple Watch・Garmin）**：姿勢（猫背・上体の前傾）を測り始めていないか、走っている最中に言葉で直し方を言うようになっていないか。watchOS と Garmin の新機能の発表。上の比較表も書き換える
9. **Peloton**：走っている最中の声を足していないか（いまは走った後と、次の走り始めだけ）。Visbody A600 が声で直すか
10. **新しく見張るもの**：AiKYNETIX（「リアルタイム」とうたう）、Stride Pro・StrideCue（声のコーチがカメラを足さないか）
- 自動で調べるときは、作業の場所のネットの設定で `apps.apple.com`・`play.google.com`・`runmetrix.casio.com`・`ochy.io` を開けるようにしておく（2026-11-01 は開けず、検索の要約に頼った）
