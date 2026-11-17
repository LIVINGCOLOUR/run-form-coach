# スマホ1台で姿勢（とくに腰の沈み込み）を見る競合（2026-11-17 調べ）

本人の問い：「スマホ単体で姿勢を見てくれる競合は実際あるの？」「腰の沈み込み（腰落ち）だけでも見られるとかなり使える。その競合がなければいい」。

- **スマホ単体**：スマホ1台だけ。時計・AirPods・専用のセンサーを使わない。2つの形に分けた：(A) スマホを体（腰のベルト・ポーチ・アームバンド・胸）に付けて、中の加速度・ジャイロで測る。(B) スマホのカメラで撮る（走っている最中に見る／撮ってから解析する）。
- **腰の沈み込み（腰落ち）**：膝が曲がって腰の位置が低いまま走る走り。指標なら、腰（骨盤）の高さ・接地中の腰の下がり・膝の曲がり・接地の割合（duty factor）・上下動の減りなど。**骨盤の左右の傾き（hip drop・pelvic drop）は別のもの**として分けた。
- 確かめ方：ストアの説明（App Store は検索 API の説明文、Google Play は説明のページ）・公式のヘルプ・論文（Europe PMC の要旨、読めたものは本文）・特許（Google Patents）を一次とした。レビュー記事・Product Hunt・検索の要約は「二次」。どのアプリも実際には使っていない。
- 「未確認」は、調べたが出典で確かめられなかったこと。推測では埋めていない。推測には「推測」と書いた。
- 前に調べたもの：`docs/research/phone-competitors.md`（2026-10-12。スマホ1台で取り込める機能）、`docs/competitors.md`（カメラの競合の地図）、`docs/research/post-run-review.md`（走ったあと）。ここは重ねず、腰の沈み込みとスマホ単体に絞った。

## 1. 要約

**「スマホ単体で、走っている最中に腰の沈み込みを知らせる」製品は、この範囲で探して見つからなかった。** 走ったあとに見せるものも、スマホ単体では見つからなかった。

- **(A) スマホを体に付ける形**は少ない。見つかったのは **Flyrun**（Android、ダウンロード 10万以上。ピッチ・歩幅・接地時間・滞空時間・接地の左右を走ったあとに地図の上で見せる）、**ランニングマン**（iOS、日本、2026-10 公開。足音と振動でピッチと着地の静かさ。ピッチが外れたら振動）、**하이러너스**（iOS、韓国。スマホのセンサーで姿勢を見て声で言うとうたうが、項目はピッチしか書いていない）の3つ。どれにも腰の沈み込み・膝の曲がり・腰の高さの項目はない。「スマホのセンサーで」とうたう RunSense は、公式サイトでは Apple Watch のセンサーだった。
- **(B) カメラの形**は多い（App Store の検索で、走りのフォームを動画で見るアプリが30本以上）。ただし腰の沈み込みを名前で出すものはない。近いのは**膝の曲がり**で、Caden（「接地している間の膝の曲がり」）、小鹿跑跑（「膝のクッションの角度 15〜40°」）、StrideCheck・Form Atlas（着地のときの膝の角度）など。どれも撮ったあとの解析。
- **走っている最中に声で言うカメラのアプリ**は2つ見つかった。**VelocityAI**（2026-06 公開、評価0件）は、スマホを立てて20秒走ると、走りながら声で直し方を言う。横からの項目に「膝の曲がり」「hip drive」があるが、腰の沈み込みはない。声の例は「腰の真下に着地」「小刻みに」。**RunForm AI - Running Coach**（`docs/competitors.md` で既出、評価0件のまま）は腰・膝の項目を書いていない。
- **腰の沈み込みを名前で出しているのは、専用センサーの Runmetrix（カシオ・アシックス）だけ**だった。「接地後に膝が曲がって腰の位置が下がる動き」を身長に対する % で出す（目安 3.3〜3.5%）。腰のセンサー（14,080円）が要る。走っている最中の声（リアルタイムコーチング）もセンサーとイヤホンが要り、トレッドミルでは使えない。何を声で言うかは公式に書いていない。
- **研究**：膝を深く曲げて走ると（Groucho running）、空中にいる時間がほぼなくなり、酸素の消費が最大で5割増える（McMahon 1987、要旨）。つまり接地の割合が増える。いま腰の iPhone で記録している「接地の割合が増えて、上下の加速度の山が下がる」という見方（`WAIST_SIT`）の向きと合う。腰の IMU 1個で骨盤の上下の動きを測る精度は高い（仙骨の IMU で、ずれ約 2mm。Asgari 2025、要旨）。ただし、**スマホをベルトに入れて走りで確かめた研究は見つからなかった**。
- **特許**：「スマホの加速度で腰が落ちていると判定する」特許は見つからなかった。近いのは、カシオの「腰の専用機器で、上下の加速度を2回積分して高さの波を出し、接地中のいちばん低いところを最大の沈み込みとする」もの（JP6508174B2）。判定ではなく、時刻の目印に使っている。
- **見立て**：(A) の形で腰の沈み込みを最中に言う席は、この範囲では空いている。ただし、空いているのは難しいからでもある（専用センサーの Lumo Run は販売終了、Runmetrix も専用センサー）。後から来そうなのは、カメラの VelocityAI（膝の曲がりをもう測っていて、声もある）と、腰のセンサーで沈み込みの計算をもう持っている Runmetrix。

## 2. (A) スマホを体に付けて測る製品

| 名前 | 付け方・測るもの | 腰の沈み込み・膝・腰の高さ | 最中か後か | 状態（2026-11-17） | 出典 |
|---|---|---|---|---|---|
| **Flyrun**（Android。作り手は Saku Sourulahti〔二次〕） | 「スマホだけで」。ランニングベルト・アームバンド・きついポケットに入れる（二次）。ピッチ・歩幅・接地時間・滞空時間・接地の左右（contact balance） | なし | 走ったあと（項目が地図のどこで変わったか・傾向）。最中の声は説明にない（未確認） | Google Play で 10万以上のダウンロード、2026-11-12 更新。「20万人以上が使った」（本人の説明）。2020年の公開（二次）。iOS 版は App Store の検索で見つからなかった。精度を確かめた資料は見つからなかった | 一次：[Google Play](https://play.google.com/store/apps/details?id=com.application.runapp.flyruntracker&hl=en)。二次：[Product Hunt](https://www.producthunt.com/products/flyrun) |
| **ランニングマン - 静かに走るBPMコーチ**（F DESIGN WORKS、日本、iOS） | iPhone をポケットかアームバンドに。「足音」と「振動」からピッチと着地の静かさ | なし | 最中：ピッチが目標（初期 175±10）を外れたときだけ振動。後：静かさ・ピッチ・一定性の点数 | 2026-10-18 公開、評価0件、無料 | 一次：[App Store](https://apps.apple.com/jp/app/id6823164410) |
| **하이러너스**（HiRunners、韓国、iOS。理学療法士3人の Team Unlock） | 「スマホのセンサーでランニングの姿勢を分析」「走っている最中に声で」。書いてある項目はピッチだけ。付ける場所の記載なし | 記載なし（未確認） | 最中（声）とうたう | 版 1.0（2026-03-03）のまま、評価0件。説明のサイトは 404 | 一次：[App Store](https://apps.apple.com/kr/app/id6759629871) |
| **RunSense**（PragmaTec、フィンランド） | ストアは「端末の動きのセンサー」と書くが、公式サイトは「**Apple Watch** の動きのセンサー（60Hz）」。ピッチ・接地時間・上下動・腕振り | なし | 最中：フォームが崩れたら振動と声（有料版） | 2026-05-02 更新、評価0件、iOS 26 以上。**スマホ単体ではない** | 一次：[App Store](https://apps.apple.com/app/id6763195853)、[公式](https://www.pragmatec.fi/apps/runsense) |
| **Racefox Run**（スウェーデン） | 胸の加速度（Polar H10 か Racefox の胸ベルト）。無料版は「スマホとイヤホンで足りる」とあったが、スマホだけで何を測るかは未確認 | 未確認 | 最中（声） | **App Store から消えている**（検索 API で8地域とも0件）。資料は2019年ごろ | 二次：[the5krunner（2019）](https://the5krunner.com/2019/11/14/polar-running-form-analysis-via-racefox/)、[endurance.biz（2019）](https://endurance.biz/2019/industry-news/racefox-run-form-analysis-now-available-for-polar-h10-customers/) |
| **StrideCoach**（Beflex）・**Kora** | AirPods の動きのセンサー。StrideCoach は8項目（頭の角度など）、Kora は頭の傾き・横揺れ・衝撃・ピッチ | なし | StrideCoach は最中（声）、Kora は後 | StrideCoach は「スマホだけ」の段ではフォームを測らない（公式の機能表）。**どちらもスマホ単体ではない** | 一次：[StrideCoach の機能表](https://stridecoach-beflex.web.app/features)、[Kora（App Store）](https://apps.apple.com/jp/app/id6795675723) |
| **Runmetrix アプリ**（センサーなし） | センサーなしでは距離・ペース・ピッチ・歩幅の読み上げと練習の計画だけ。フォームの点数・分析・リアルタイムコーチングは「別売のモーションセンサーが必要」 | センサーなしでは出ない | ― | 2026-11-11 更新、評価 3,491件（日本） | 一次：[App Store](https://apps.apple.com/jp/app/id1542548501) |
| **OneStep Move** | スマホをポケットに入れて30秒歩く | 歩きだけ。走りはない | 後 | 2026-11-17 更新 | 一次：App Store の説明（検索 API） |
| （参考）**Lumo Run** | 腰の専用センサー。ピッチ・弾み・ブレーキ・骨盤の傾きと回旋 | 沈み込みの項目はない | 最中（声） | 販売終了（`docs/competitors.md`） | 二次：[Techradar](https://www.techradar.com/reviews/lumo-run) ほか |

説明を読めなかったもの：Smart Runner（App Store id6745174894。検索の要約では「走りの加速度を集めてフォームを良くする」）、跑步步态分析（id6761259458）、Run Dynamics（id6463495111）は、どれも今は App Store にない（検索 API で0件、ストアのページは 404）。何を測っていたかは未確認。

## 3. (B) カメラで撮る製品

「腰」の列は、腰の沈み込み・膝の曲がり・腰の高さに当たる項目。骨盤の左右の傾き（hip drop）は「別」と書いた。

| 名前 | 撮り方・時期 | 腰の沈み込み・膝・腰の高さ | 最中の声 | 状態（2026-11-17） | 出典 |
|---|---|---|---|---|---|
| **VelocityAI: Run Faster**（Moncef SAMAI） | スマホを立てて20秒走る（トラック・道・トレッドミル、横か後ろ）。撮った動画も可 | 横：ピッチ・オーバーストライド・上下動・上体の前傾・**膝の曲がり**・hip drive。後ろ：hip drop（別）・骨盤の横揺れなど。腰の沈み込みの名前はない | **あり**。「走りながら、声のコーチが直すところを言う」。例は「腰の真下に着地」「もっと小刻みに」。膝の曲がりを声で言うかは未確認 | 2026-06-01 公開、2026-11-16 更新（版 1.2.0）、評価0件（米国・日本）。無料は週3回 | 一次：[App Store](https://apps.apple.com/app/id6769135046) |
| **RunForm AI - Running Coach**（伟 张） | トレッドミルの横に iPhone。3分 | 13項目とうたい、書いてあるのはピッチ・上下動・上体の角度・接地時間・左右差。膝・腰の記載なし | **あり**（ピッチ・上体の前傾・着地） | 2026-06-13 公開のまま、評価0件 | 一次：[App Store](https://apps.apple.com/app/id6763226958) |
| **Caden: Running Form Analysis**（Aeron Horne） | 横から3〜10秒。後 | 着地の膝の曲がり・**接地している間の膝の曲がり**・弾み（腰の上下）・蹴り出しの膝の曲がり・上体・頭 | なし | 2026-10-02 公開、評価3件。有料 | 一次：[App Store](https://apps.apple.com/app/id6814006218) |
| **小鹿跑跑**（中国） | 動画。後 | **膝のクッションの角度（15〜40°）**・股関節の伸び・上体の前傾・着地の角度 | なし（メトロノームは別にある） | 2026-06-26 公開、評価2件、38元 | 一次：[App Store](https://apps.apple.com/cn/app/id6776240875) |
| **StrideCheck**（Nullspark） | 横から10秒（トレッドミル・道）。後 | 着地の膝の曲がり・上下動・上体 | なし | 2026-08-24、評価1件 | 一次：[App Store](https://apps.apple.com/app/id6802892775) |
| **RunForm AI: Running Gait**（Paco Studio） | 横と後ろの動画。後 | 膝の角度・股関節の曲げ伸ばし・遊脚の膝・反対の膝。後ろ：骨盤の傾き・左右差（別） | なし | 2026-10-19 更新、評価5件、クレジット制 | 一次：[App Store](https://apps.apple.com/app/id6753753064) |
| **Ochy**（フランス） | 短い動画（道・トレッドミル・トラック）。後 | 公式の例：プロネーション・骨盤の傾き・オーバーストライド・ピッチ・膝の位置・滞空時間。「関節の角度」。沈み込みの名前は見当たらない | なし | 2026-11-12 更新、評価は米国 308件・日本 60件。Google Play 10万以上 | 一次：[公式（runners）](https://www.ochy.io/runners)、[App Store](https://apps.apple.com/jp/app/id1531481638) |
| **Run Picker**（YEONGMI KIM） | 最中は声でペース・ピッチ・心拍。フォームは走ったあとに横から5〜10秒の動画 | ピッチ・接地・上下動・着地・オーバーストライド・膝の引き上げ。沈み込みなし | 声はあるが、フォームの声ではない | 2026-10-16 更新、評価0件 | 一次：[App Store](https://apps.apple.com/jp/app/id6785751196) |
| **Form Atlas**（日本） | 動画を上げる。後 | 着地時の平均膝角度・体幹の前傾・オーバーストライド比率 | なし | 2026-10-13 更新、評価1件 | 一次：[App Store](https://apps.apple.com/jp/app/id6751313062) |
| **Run Pose Pro**（日本） | 動画。後 | 「膝・腰・腕・姿勢・着地」（中身は書いていない） | なし | 2026-06-18 更新、評価4件 | 一次：[App Store](https://apps.apple.com/jp/app/id6748298583) |
| **RUN!**（TNQ Tech、日本） | 動画（3D の姿勢推定）。後 | 姿勢・関節の動き・**重心の動き**・床反力・接地時間 | なし | 2025-10-14 のまま、評価1件、3,000円 | 一次：[App Store](https://apps.apple.com/jp/app/id6753888103) |
| **RunGait**・**RunBest**（韓国）・**바른 Run**（韓国）・**Recura**・**RunGaitAnalysis**・**GaitLab**・**KneeDrive**・**Flapp** | 動画。後（KneeDrive の「Live」は短く撮ってすぐ見る形で、走りながらの声ではない） | 膝の角度（RunGait・RunBest・바른 Run・Recura・Flapp）、hip drop（別。RunGait・RunBest・Recura・RunGaitAnalysis）。바른 Run は 8・10・12 km/h ごとの基準 | なし | どれも評価0〜9件 | 一次：App Store の説明（検索 API。id は 6757428588・6829754363・6769394175・6761824591・6787775842・6755685826・6761278359・6811158284） |
| **AIスポーツトレーナー**（日本） | 10秒の動画。50競技 | 「技術・安定性・出力・リズム・連動性」。ランの腰・膝の項目は書いていない | なし | 2026-11-15 更新、評価42件 | 一次：[App Store](https://apps.apple.com/jp/app/id6742685461) |

ほかに、名前に running form と付く一般向けのカメラのアプリで、腰の沈み込みを名前で出すもの・「sitting」「back seat」を判定するものは見つからなかった。

## 4. 専用センサーでの基準（比べるための物差し）

| 製品 | 腰の沈み込みに当たるもの | 測り方と言葉 | 出典 |
|---|---|---|---|
| **Runmetrix**（カシオ・アシックス、腰のセンサー CMT-S20R-AS） | **腰の沈み込み**（％）：「接地後に膝が曲がって腰の位置が下がる動き。身長を100%とした比率で表し、数値が大きいほど深く沈み込んでいる」。目安は 1km 3:00 で 3.3、4:00・5:00 で 3.4、6:00 で 3.5。小さいほど「骨盤を軸とした全身の連動」の点数が上がる。ほかに**接地時間率**（％。1周期のうち接地している割合）・上下動（cm と身長比）・体幹の後傾（°、目安 1.4） | センサーは短パンの後ろに挟む（腰）。9軸＋GPS、200Hz（Miyazaki 2025 の本文。研究ではこの値を英語で body drop〔% height〕と呼んでいる）。リアルタイムコーチングは「イヤホンおよび Runmetrix モーションセンサーが必要」「トレッドミルには対応しておりません」。何を声で言うか（沈み込みを言うか）は公式に書いていない（未確認）。この値を研究で確かめた論文は見つからなかった | 一次：[用語解説](https://runmetrix.casio.com/jp/support/glossary/index.html)、[リアルタイムコーチング](https://runmetrix.casio.com/jp/rtc/)、[アプリの説明](https://runmetrix.casio.com/jp/application/)、[Miyazaki 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12575221/) |
| **Stryd**（足のポッド） | **Duty Factor**（1歩のうち足が地面にある割合）、上下動（骨盤の上下で見る）、接地時間、脚のバネ（LSS）。腰の高さ・膝の項目はない | 足のセンサー | 一次：[Stryd Metrics](https://help.stryd.com/en/articles/6879522-stryd-metrics) |
| **Garmin**（HRM-Pro・HRM 600・Running Dynamics Pod） | ピッチ・上下動・接地時間・左右・歩幅・上下動比の6つ。沈み込み・膝はない | 胸か腰の加速度で胴の動き | 一次：[Forerunner 955 の説明書](https://www8.garmin.com/manuals-apac/webhelp/forerunner955/EN-SG/GUID-16B503BA-936C-4A24-A8F2-9E3C07B49647-9193.html) |
| **COROS POD 2**（腰か足） | 腰に付けると歩幅・接地時間・左右など「and more」。沈み込みの名前は見つからなかった（公式サポートのページは 403 で読めず、未確認） | 腰の加速度 | 一次：[POD 2 ガイド](https://coros.com/stories/coros-coaches/c/pod-2-guide) |
| **Lumo Run**（販売終了） | ピッチ・弾み・ブレーキ・骨盤の傾き・骨盤の回旋（記事によって接地時間・歩幅も）。沈み込みはない | 腰。最中に声 | 二次：[Techradar](https://www.techradar.com/reviews/lumo-run)、[Wareable](https://www.wareable.com/running/lumo-run-review) |

**分かったこと**：Runmetrix の「腰の沈み込み」は、**1歩の中で、着地のあとに腰がどれだけ下がるか**（動きの量）で、腰の高さそのもの（走っている間ずっと低いか）ではない。カシオの特許（6章）にある「上下の加速度を2回積分して高さの波を出す」やり方なら、腰の機器だけで出せる。このアプリの腰の iPhone でも、上下動（`bounceCm`）は同じ考えで出している。同じ考えで「接地からいちばん低いところまでの下がり（身長比）」を出して記録に足す案はある（**推測**。わざとの腰落ちでこの値が増えるか、上下動と同じく減るかは、記録で確かめていない）。

## 5. 研究と精度

### 5-1. 腰を落とした走り（Groucho running）で何が変わるか

- **McMahon 1987**（要旨）：膝を曲げて走ると、体の上下のバネ（vertical stiffness）が小さくなり、足から頭への衝撃が減るが、**酸素の消費が最大で約5割増える**。深く曲げると**空中にいる時間がほぼなくなる**。→ 接地の割合が増える。いまの `WAIST_SIT` の「接地の割合が増える」向きと合う。[J Appl Physiol 62:2326](https://doi.org/10.1152/jappl.1987.62.6.2326)
- **Khassetarash & Edwards 2026**（プレプリント、要旨）：9人、時速約10km（2.8 m/s）のトレッドミル。膝を曲げた走りで上下の床反力の山が **−15.8%**、もっと曲げると **−22.9%**。→ 腰の上下の加速度の山が下がる、という `WAIST_SIT` のもう1つの向きとも合う（力の山と腰の加速度の山は同じではないので、向きが合うところまで）。[bioRxiv](https://doi.org/10.64898/2026.08.14.744758)
- このアプリの記録（2026-11-09、腰の iPhone）：腰落ち2回で接地の割合 +11.1% / +7.0%、山 −15.1% / −12.2%（`src/modes/sensor/params.ts` の `WAIST_SIT` の説明）。向きは上の2つの研究と同じ。

### 5-2. 腰の IMU 1個（スマホに近い形）で測れるか

| 研究 | 中身 | 精度 | 読んだ範囲 |
|---|---|---|---|
| Patoz ほか 2022 | 仙骨の IMU 1個、100人、時速9〜13km | 接地時間の二乗平均誤差 20ms（8%）、滞空 20ms（18%） | 本文（`docs/research/phone-competitors.md` で確認済み）。**接地の割合そのものの精度は出していない**（接地時間 ÷ 1歩の時間なので、誤差は接地時間の誤差に近いと考えられるが、推測） |
| Asgari & Heller 2025 | 仙骨の IMU、24人のランナー、モーションキャプチャと比べる | 骨盤の位置のずれ（Bland-Altman のかたより）約 2mm（カルマンフィルタ）、骨盤の角度のかたより約 0.3° | 要旨。[Sensors 25:315](https://pmc.ncbi.nlm.nih.gov/articles/PMC11768178/) |
| Lawson ほか 2024 | 背中の上の GPS 機器の加速度（1個）＋身長・脚の長さなどからニューラルネットで関節の角度を推定。13人、トレッドミル | 主な場面の関節・体節の角度の相対誤差 平均 13.0%。いちばん良いのは胸・骨盤・股関節の曲げ伸ばし（10% 未満）。**膝の数字は要旨にない** | 要旨。[Appl Sci 14:1730](https://doi.org/10.3390/app14051730) |
| Miyazaki ほか 2025 | Runmetrix のセンサーで日本のマラソン 1,437人。後半の大きな失速を前半の値で予測 | 予測の正しさ 73.9%。効いたのは歩幅・接地時間・vertical stiffness。body drop（腰の沈み込み）は使える値の一覧にある | 本文。[Front Sports Act Living](https://pmc.ncbi.nlm.nih.gov/articles/PMC12575221/) |

- **スマホをベルト・ポーチ・ポケットに入れて、走りの接地・膝・腰の下がりを確かめた研究は見つからなかった**（Europe PMC で `(smartphone OR "mobile phone" OR iPhone) AND (running OR runners) AND (waist OR belt OR armband OR pocket OR "lower back" OR trunk) AND ("ground contact" OR "contact time" OR "stance time" OR "vertical oscillation" OR "knee flexion" OR "duty factor")`、2015〜2026年、2026-11-17）。研究はどれも、肌やベルトにしっかり固定した専用の IMU。スマホはベルトの中で動くので、この精度はそのままは当てはまらない。
- 腰の IMU 1個から**膝の角度**を出す研究は、歩きでは見つかった（Toyoshima 2025、骨盤の IMU で歩きの関節の角度、要旨に数字なし）が、走りで膝の曲がりを確かめたものは見つからなかった。

### 5-3. カメラ（骨格の推定）で膝の曲がりを測る精度

- **Gao ほか 2026**（メタ分析、要旨）：走りの横から見た下肢の角度を、マーカーなしの方法とマーカーありの方法で比べた8本。二乗平均誤差は**膝 4.30°**（95% 信頼区間 2.55〜6.05°）、股関節 3.84°、足首 3.93°。カメラの台数・コマ数を増やしても、どの関節でもよくなるとは言えなかった。8本のうちカメラ1台のものがいくつかは要旨に書いていない（未確認）。[Front Bioeng Biotechnol](https://doi.org/10.3389/fbioe.2026.1915559)
- **Ota ほか 2021**（要旨）：OpenPose でトレッドミルの歩き・走り、24人、VICON と比べる。走りの**膝の曲がりの山**は一致がよい〜とてもよい（ICC）。骨盤・股関節の正面から見た角度は合わない。[Gait Posture](https://doi.org/10.1016/j.gaitpost.2021.02.006)
- このアプリの記録：2026-11-09 のわざとの腰落ち2回を、カメラは2回とも見逃した（立脚中期の腰の高さで +1.3%・+0.3%。全部のコマの腰の高さでは約2.8%）。膝の角度の誤差（約4°）に比べて、腰を落とすときの膝の変わりがどれだけ大きいかは、まだ確かめていない。

## 6. 特許

Google Patents を検索エンジン経由で探した（J-PlatPat は直接は検索できなかった）。「スマホの加速度で腰が落ちていると判定する」特許は**見つからなかった**。近いもの：

| 番号 | 出願人 | 要点 | 状態（Google Patents の表示。法的な結論ではない） |
|---|---|---|---|
| [JP6508174B2](https://patents.google.com/patent/JP6508174B2/ja) | カシオ計算機（2016-11-29 出願） | 腰にベルトで付けた**専用の機器**。上下の加速度を**2回積分して高さの波**を出し、各足の接地中のいちばん低いところを「最大沈み込みタイミング」とする。それを目印に、脚を振り出す期間を分けて走りの速さを評価する（沈み込みの量で判定するものではない） | 登録（公報 2019-05-08。今も有効かは未確認） |
| [WO2020195874A1](https://patents.google.com/patent/WO2020195874A1/ja) | カシオ計算機（2019-03-25 優先） | 腰の専用機器の加速度で、ブレーキの波の形から走り方（かかと・中足・前足の5型）を見分ける。「上体の沈み込みが最大量になるタイミング」を使う別案、「膝関節の屈曲が大きいフォアフット走法」に触れるだけ | Ceased（国際段階の終わり） |
| [JP2016034479A](https://patents.google.com/patent/JP2016034479A/ja) | セイコーエプソン | 胴（腰）の加速度で着地の位置を評価。着地後の沈み込みの最下点を推進効率の目印に使う | 取り下げ（2019-10-25） |
| [CN106999757A](https://patents.google.com/patent/CN106999757A/zh) | 個人（李達洙、2014 優先） | 上半身の IMU（胸・背中）とスマホなどで、理想の弾み（上下の加速度）と比べる。弾みが小さすぎる・着地が硬いなどを、声・振動で最中に知らせる。膝・腰の高さは書いていない | 年金の未払いで消滅（2025-09-12） |
| [CN109009142A](https://patents.google.com/patent/CN109009142A/zh) | Goertek | 足首の6軸センサーで、接地中の足首の角度とピッチを判定 | 登録 |

## 7. 空いているか（見立て）

- **(A) スマホを体に付けて、腰の沈み込みを走っている最中に言う**：この範囲では誰もやっていない。スマホを体に付ける形のアプリ自体が少なく（Flyrun・ランニングマン・하이러너스）、どれも沈み込みを測らない。Flyrun は10万以上のダウンロードがあるので、「時計なしでスマホをベルトに入れてフォームを測る」使い方に需要はある（推測。何人が続けて使っているかは分からない）。
- **(B) カメラ**：膝の曲がりを撮ったあとに出すものは多く、腰の沈み込みに近い。走りながらの声のカメラは VelocityAI と RunForm AI の2つで、どちらも評価0件。VelocityAI は膝の曲がりをもう測っているので、「腰が落ちている」を声で言い出すのは手間が少ないはず（推測）。`docs/competitors.md` の「カメラ × 走っている最中に声で直す」の席には、VelocityAI を足す必要がある。
- **専用センサー**：Runmetrix は腰の沈み込みを名前で出し、目安の値も持ち、走っている最中の声もある。スマホ単体の形を出す力はいちばんある（推測。いまはセンサーなしではフォームを出さない）。
- **空いている理由も見ておく**：腰のセンサーだけで最中に声をかけた Lumo Run は販売終了。スマホはベルトの中で動くので、専用センサーの精度の研究がそのまま当てはまらない。外れた声は信頼を失うので、腰の iPhone の記録（`npm run drill:hip` を3本）で、腰落ちとピッチの低下・疲れ・べた足を分けられるかを先に確かめるのが筋。
- **特許**：見つけた範囲では、スマホでの判定をふさぐものはない。ただし J-PlatPat を直接は検索していないし、法的な判断ではない。

## 8. 探した範囲と、確かめられなかったこと

**探した範囲（2026-11-17）**

- App Store：iTunes の検索 API で、米国（running form・running gait・running technique・running posture・running form coach・ground contact time・vertical oscillation・hip drop running・treadmill running form など19語）、日本（ランニングフォーム・ランニング 姿勢・走り方・腰高・ランフォーム など12語）、中国（跑姿・跑步姿态・跑步步态 など4語）、韓国（러닝 자세・러닝 폼）。重ならないアプリ 2,029本の説明文を、走り×フォーム×（センサー・カメラ・腰・膝などの語）で絞って読んだ。
- Google Play：running form・running gait analysis・running posture・ランニングフォーム・跑姿・러닝 자세・hip drop running など15語の検索結果（米国の英語のページ）から103本の説明を読んだ。
- ウェブ検索（英語・日本語・中国語・韓国語）：スマホを腰・ベルトに付けるフォームのアプリ、「腰が落ちる」「腰高」「sitting back」を判定するアプリ、Runmetrix の沈み込みの定義、特許。
- 論文：Europe PMC（要旨・本文）と Crossref。
- 反対の証拠として「スマホだけで、腰・骨盤の姿勢を最中に声で言う」を探したが、見つかったのは AirPods（StrideCoach・Kora）、Apple Watch（RunSense）、専用センサー（Runmetrix・Lumo Run）だった。

**確かめられなかったこと**

- VelocityAI が、膝の曲がり（腰の落ち）を走っている最中に声で言うか。声の例は着地とピッチだけ。
- 하이러너스 が何を測り、何を声で言うか（説明のサイトは 404）。
- Flyrun が走っている最中に声や振動で知らせるか、iOS 版があるか、作り手の会社と国、精度。
- Racefox Run の無料版（スマホとイヤホンだけ）で何を測っていたか。いまはストアにない。
- Smart Runner・跑步步态分析・Run Dynamics（どれも今は App Store にない）の中身。
- Runmetrix のリアルタイムコーチングで、腰の沈み込みを声で言うか。腰の沈み込みの計算の仕方（特許 JP6508174B2 の「高さの波」と同じかは推測）と、その値を研究で確かめた論文。
- COROS POD 2 を腰に付けたときの全部の項目（サポートのページは 403）。
- Ochy の全部の項目（公式は例だけ）。
- 腰を落とした走りで、膝の曲がりが何度変わるか（McMahon 1987 の本文は読めなかった）。
- スマホをベルトに入れて、走りの接地の割合・腰の下がりを確かめた研究（見つからなかった）。
- J-PlatPat での特許の検索（直接は使えなかった）。Google Patents の状態は Google の推定で、法的な結論ではない。
- Google Play は米国の英語のページだけを見た。日本のストアの Android だけのアプリは見落としているかもしれない。

## 出典

ストア（2026-11-17 に説明を読んだ）
- Flyrun：[Google Play](https://play.google.com/store/apps/details?id=com.application.runapp.flyruntracker&hl=en)、[Product Hunt（二次）](https://www.producthunt.com/products/flyrun)、[公式](https://flyrunapp.com/)
- [ランニングマン](https://apps.apple.com/jp/app/id6823164410)、[하이러너스](https://apps.apple.com/kr/app/id6759629871)、[RunSense](https://apps.apple.com/app/id6763195853)（[公式](https://www.pragmatec.fi/apps/runsense)）、[Kora](https://apps.apple.com/jp/app/id6795675723)、[Runmetrix](https://apps.apple.com/jp/app/id1542548501)
- [VelocityAI](https://apps.apple.com/app/id6769135046)、[RunForm AI - Running Coach](https://apps.apple.com/app/id6763226958)、[Caden](https://apps.apple.com/app/id6814006218)、[StrideCheck](https://apps.apple.com/app/id6802892775)、[RunForm AI: Running Gait](https://apps.apple.com/app/id6753753064)、[Ochy](https://apps.apple.com/jp/app/id1531481638)（[公式](https://www.ochy.io/runners)）、[Run Picker](https://apps.apple.com/jp/app/id6785751196)、[Form Atlas](https://apps.apple.com/jp/app/id6751313062)、[Run Pose Pro](https://apps.apple.com/jp/app/id6748298583)、[RUN!](https://apps.apple.com/jp/app/id6753888103)、[小鹿跑跑](https://apps.apple.com/cn/app/id6776240875)、[AIスポーツトレーナー](https://apps.apple.com/jp/app/id6742685461)
- StrideCoach：[機能表](https://stridecoach-beflex.web.app/features)

専用センサー
- Runmetrix：[用語解説](https://runmetrix.casio.com/jp/support/glossary/index.html)、[リアルタイムコーチング](https://runmetrix.casio.com/jp/rtc/)、[アプリの説明](https://runmetrix.casio.com/jp/application/)
- [Stryd Metrics](https://help.stryd.com/en/articles/6879522-stryd-metrics)、[Garmin Running Dynamics](https://www8.garmin.com/manuals-apac/webhelp/forerunner955/EN-SG/GUID-16B503BA-936C-4A24-A8F2-9E3C07B49647-9193.html)、[COROS POD 2 ガイド](https://coros.com/stories/coros-coaches/c/pod-2-guide)
- Lumo Run（二次）：[Techradar](https://www.techradar.com/reviews/lumo-run)、[Wareable](https://www.wareable.com/running/lumo-run-review)
- Racefox（二次）：[the5krunner](https://the5krunner.com/2019/11/14/polar-running-form-analysis-via-racefox/)、[endurance.biz](https://endurance.biz/2019/industry-news/racefox-run-form-analysis-now-available-for-polar-h10-customers/)

研究
- McMahon TA, Valiant G, Frederick EC. Groucho running. *J Appl Physiol* 1987;62:2326-2337. [doi:10.1152/jappl.1987.62.6.2326](https://doi.org/10.1152/jappl.1987.62.6.2326)（要旨）
- Khassetarash A, Edwards WB. Groucho running reveals disparate results between ground reaction force and tibia-fibula bone strain in runners. bioRxiv 2026. [doi:10.64898/2026.08.14.744758](https://doi.org/10.64898/2026.08.14.744758)（要旨、査読前）
- Asgari H, Heller B. Validation and Analysis of Recreational Runners' Kinematics Obtained from a Sacral IMU. *Sensors* 2025;25:315. [doi:10.3390/s25020315](https://doi.org/10.3390/s25020315)（要旨）
- Lawson M ほか. Can Machine Learning Predict Running Kinematics Based on Upper Trunk GPS-Based IMU Acceleration? *Appl Sci* 2024;14:1730. [doi:10.3390/app14051730](https://doi.org/10.3390/app14051730)（要旨）
- Miyazaki Y ほか. Early marathon running metrics from inertial measurement units predict significant pace reduction. *Front Sports Act Living* 2025. [doi:10.3389/fspor.2025.1681444](https://doi.org/10.3389/fspor.2025.1681444)（本文）
- Toyoshima K ほか. Individual Variability in Deep Learning-Based Joint Angle Estimation from a Single IMU. *Sensors* 2025. [doi:10.3390/s26010178](https://doi.org/10.3390/s26010178)（要旨、歩き）
- Gao M ほか. Accuracy of markerless motion capture in assessing sagittal-plane lower limb kinematics during running: a systematic review and meta-analysis. *Front Bioeng Biotechnol* 2026. [doi:10.3389/fbioe.2026.1915559](https://doi.org/10.3389/fbioe.2026.1915559)（要旨）
- Ota M ほか. Verification of validity of gait analysis systems during treadmill walking and running using human pose tracking algorithm. *Gait Posture* 2021. [doi:10.1016/j.gaitpost.2021.02.006](https://doi.org/10.1016/j.gaitpost.2021.02.006)（要旨）
- Patoz ほか 2022：`docs/research/phone-competitors.md` の出典

特許：上の6章の表のリンク（Google Patents）
