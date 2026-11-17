# 走ったあとのフォームのふり返り：ほかの製品が見せているもの（2026-11-16 調べ）

外で走ったあとに、自分のフォームをふり返る機能を厚くする前に、ほかのアプリ・時計・センサーが「走ったあと」に何を見せているかを並べた。
いちばん知りたいのは、**長い走り（2時間など）の、どこでフォームが崩れたかを示す仕組み**があるか。

- 確かめ方：公式のヘルプ・説明書・製品ページ・App Store・会社の登記を一次情報とし、レビュー記事・掲示板は「二次」と書いた。どの製品も実際には使っていない
- 「未確認」は、調べたが出典で確かめられなかったこと。推測では埋めていない
- 「走っている最中」の機能は `docs/competitors.md` と `docs/research/phone-competitors.md`。ここは走ったあとだけ。トレッドミルの動画の解析は軽く触れるだけにした

## 1. 要約

どこも同じようにやっているのは、**走りの平均の数字**（ピッチ・接地時間・上下動・歩幅・左右バランス）と、**過去の走りとの比べ（週・月の傾向）**。時計と胸ベルト・足のセンサーの多く（Garmin・COROS・Stryd・Huawei・intervals.icu など）は、**走りの中の時間のグラフ**も出す。比べる基準は、ほかのランナーの分布（Garmin の色、COROS の5段階、Stryd の同じ年代）か、自分の過去の平均がほとんど。
少ないのは、**長い走りの中で「何分（何km）から崩れた」と自動で示すもの**。消費者向けで、はっきり自動で示すものは見つからなかった。近いのは、①グラフを自分で読む（Stryd・COROS は「この値がこれだけ変わったら疲れ」の目安を記事で教えるだけ）、②アシックスの ASICS RACE REPORT（センサーの記録から、レースの序盤・中盤・終盤のフォームを、アシックスの仕組みと担当者がまとめる有料のレポート、1回 5,500円、2022年10月開始）、③Google Pixel Watch の「Visualize performance」（走りを通してフォームがどう変わったかを見る。崩れた時刻を自動で出すかは未確認）、の3つ。上半身の姿勢（胸の前傾・頭の前出）の時間の変化を出す製品は見つからなかった。

## 2. 製品ごとの表

「一次」＝公式、「二次」＝レビュー・報道・掲示板。日付は情報の日付（分かるものだけ）。値段は分かった国の通貨のまま。

### 2-1. 時計と胸ベルト・腰のセンサー

| 製品 | 走ったあとのフォームの項目 | 見せ方 | 崩れた場面の検出 | 機器と料金 | 出典 |
|---|---|---|---|---|---|
| **Garmin Connect**（アプリ・ウェブ） | ピッチ・歩幅・上下動・上下動比・接地時間・接地時間の左右バランス。HRM 600＋Forerunner 970 では Step Speed Loss（着地で落ちる速さ）と、それを使う Running Economy | 走りの中の**色付きのグラフ**（ほかのランナーの分布で紫＝上位5%〜赤＝下位5%）。Running Economy は長い期間の傾向（1本ごとのグラフではない）。Running Tolerance は週ごとの負荷で、フォームではない | **なし**。グラフを自分で読む。有料の Connect+（月 $6.99・年 $69、2025年3月〜、二次）の Performance dashboard・AI のまとめにもランニングダイナミクスの話は見当たらない（二次） | 手首だけでも一部。左右バランスは HRM 600・HRM-Pro・Running Dynamics Pod などが要る。HRM 600 は US$169.99（一次、2025-05-15）。Pod の今の値段は未確認 | 一次：[色のゲージ](https://www8.garmin.com/manuals/webhelp/GUID-2C274FD2-F0C3-445C-B0AC-700FECCE12E9/EN-US/GUID-EE9E7F6F-49BE-4452-82E6-B40371D0AEC1.html)、[fēnix 7 の Running Dynamics（「colored graphs」）](https://www8.garmin.com/manuals-apac/webhelp/fenix7series/EN-SG/GUID-DE1BEB52-8839-4ED3-84A4-B98E0F23A907-636.html)、[FR970 Running Economy](https://www8.garmin.com/manuals-apac/webhelp/forerunner970/EN-SG/GUID-EFC0AECE-FDBC-4052-9945-593D4E0DA7BC-344.html)、[FR970 Running Tolerance](https://www8.garmin.com/manuals-apac/webhelp/forerunner970/EN-SG/GUID-2D5E32B8-C760-431F-8CD2-5C769CD86062-6776.html)、[HRM 600 の発表](https://www.garmin.com/en-US/newsroom/press-release/sports-fitness/garmin-unveils-the-hrm-600-heart-rate-monitor-with-more-ways-to-capture-and-improve-training/)。二次：[the5krunner：Connect+（2026-04）](https://the5krunner.com/2026/04/20/garmin-connect-plus-review/)、[Q1 2026 の更新](https://the5krunner.com/2026/02/24/garmin-q1-2026-feature-update/) |
| **COROS**（アプリ・EvoLab・Training Hub） | 接地時間・左右バランス・Stride Height（上下動）・歩幅・Stride Ratio。Running Form Test では Skill（接地・着地の角度・Stride Ratio）・Strength（脚のバネ・地面を押す力の山）・Balance | 1本ごとは要約の数字（二次）。グラフとラップの表があるとの記述は二次。**Running Form Test**（約10分：5分のウォームアップ＋閾値のペースで5分。腰の POD が条件）で点数、項目ごとに Elite〜Qualified の5段階（同じくらいの走力の人と比べる）、Ground Runner／Aerial Runner の型、強み・弱み・けがの危険のまとめ。練習の助言は別の記事 | **なし**。公式の記事が「長い走りの後半で接地時間が増えたら崩れのしるし」「上下動が急に増えたら疲れ」と書くだけで、読むのは本人 | POD 2 は US$99（一次、2026-11-16）。手首だけでも一部 | 一次：[Running Form Test（2024-01-29）](https://coros.com/stories/coros-metrics/c/running-form-test)、[テストから練習へ（2024-02-29）](https://coros.com/stories/coros-metrics/c/running-form-test-from-data-to-action)、[Running Dynamics（2025-09-24）](https://coros.com/us/stories/coros-metrics/c/running-dynamics)、[POD 2](https://coros.com/pod2)。二次：[DC Rainmaker（2022）](https://dcrainmaker.com/2022/10/review-missed-opportunity.html)、[Tom's Guide](https://tomsguide.com/wellness/fitness-trackers/i-tested-the-coros-pod-2-to-see-if-it-could-improve-my-running-heres-what-happened) |
| **Polar Flow** | 自社のフォームの項目（接地時間・上下動など）は見つからない。手首のランニングパワーのグラフ（パワーと心拍・坂・ペース） | パワーのグラフ。Stryd をつないでも Flow に出るのはパワー・ペース・高さ・ピッチ・距離で、接地時間などは Stryd の PowerCenter で見る | 対象外（フォームの項目がない） | 未確認 | 一次：[手首のパワー（Vantage M3 の説明書）](https://support.polar.com/e_manuals/vantage-m3/polar-vantage-m3-user-manual-english/running-power-from-the-wrist.htm)、[Stryd との連携](https://support.polar.com/en/polar-vantage-m-vantage-v-with-stryd-running-power-meter) |
| **Suunto**（アプリ） | 接地時間・上下動（Race 2・Vertical 2、版 2.48.16、2025-11-10 から順に） | 記録の要約に平均だけ。「Technique にはグラフも詳しいものもない」という利用者の声（二次） | なし | Vertical 2 は $599（二次）。Race 2 は未確認 | 一次：[Race 2 の更新内容](https://www.suunto.com/en-gb/Support/Software-updates/Release-notes/suunto-race-2-software-updates/)。二次：[Suunto の掲示板](https://forum.suunto.com/post/182950)、[Notebookcheck（2025-11-12）](https://www.notebookcheck.net/Suunto-adds-two-new-running-metrics-to-smartwatches-in-update.1161455.0.html) |
| **Apple Watch**（フィットネス・ヘルスケア） | 上下動・接地時間・歩幅・ランニングパワー（屋外ランニングだけ） | ワークアウトの詳細に平均。走りの中のグラフはパワーだけ確かめられた（二次）。接地時間などは平均だけという記述（二次）。公式に走ったあとの見せ方を書いたページは見つからない | なし | Series 6 以降（二次）。値段は未確認 | 一次：[ワークアウトの表示とランの指標](https://support.apple.com/guide/watch/apd1f24d4d35/watchos)、[watchOS 27 の新機能（フォームの追加なし）](https://support.apple.com/en-ae/guide/watch/apdb93ea3872/watchos)。二次：[MacRumors](https://www.macrumors.com/how-to/add-running-form-metrics-apple-watch/)、[iMore（2023-11-10）](https://www.imore.com/health-fitness/apple-watch/how-to-make-sense-of-your-apple-watchs-running-metrics)。反対の情報：watchOS 27 で接地時間などが出なくなったという掲示板の報告（[MacRumors Forums、2026-09〜10](https://forums.macrumors.com/threads/watch-os27-removing-workout-data.2490375/)、二次） |
| **Google Pixel Watch 3・4・5**（Google Health） | ピッチ・接地時間・上下動・上下動比・歩幅。区間（split・segment）ごとのペース・ピッチ、上下動比の区間ごとの変化 | 走りの要約の「**Visualize performance**」で「走りを通してフォームがどう進んだか」を見る（一次）。区間ごとの値。Premium では、似た区間どうしを比べたフォームの助言（10本以上で本人の範囲を作る） | **一部**。公式は「区間で、走りの中でフォームが変わったかを確かめられる」と書く。崩れた時刻を自動で示すか、グラフか地図かは未確認 | Pixel Watch 3 以降。助言は Google Health Premium（値段は未確認、国によっては使えない・英語だけのことあり） | 一次：[Google ヘルプ（日付なし、©2026）](https://support.google.com/fitbit/answer/15400594?hl=en-GB) |
| **Huawei Health＋S-TAG** | 13項目（腰：バランス・上下動、足＋腰：上下動比、足：ピッチ・歩幅・着地・接地時間・滞空時間・接地と滞空の比・足首の曲がり・振り出しの角度・負荷の速さ） | 走りの中の「**フォームの変化の曲線**」と平均（歩き・止まりは除く） | なし（曲線を自分で読む）。点数・助言は確かめられなかった | S-TAG（腰か足、両方も）。値段は未確認 | 一次：[S-TAG（日本）](https://consumer.huawei.com/jp/wearables/s-tag/)、[Running form monitoring（日付なし）](https://consumer.huawei.com/en/support/content/en-us15907640) |
| **Zepp／Amazfit** | 接地時間・上下動（Active 2・Bip 6・T-Rex 3 は 2025年の更新で。T-Rex 3 は上下動比も）。Stryd をつなぐとその項目 | Zepp アプリでの見せ方（グラフ・点数）は未確認。Stryd の項目は Stryd 側で見る | 未確認 | 未確認 | 一次：[Stryd との連携](https://help.stryd.com/en/articles/12702410-getting-started-with-amazfit-and-stryd)。二次：[Gadgets & Wearables（2025-10）](https://gadgetsandwearables.com/2025/10/20/amazfit-active-2-running-form-metrics/) |

### 2-2. 足・腰・耳のフォーム専用の機器

| 製品 | 走ったあとのフォームの項目 | 見せ方 | 崩れた場面の検出 | 機器と料金 | 出典 |
|---|---|---|---|---|---|
| **Stryd**（足のポッド・PowerCenter） | パワー・Form Power・脚のバネ（LSS）・接地時間・上下動・衝撃の速さ（Impact Loading Rate）・Duty Factor。Duo（両足）で接地時間・LSS・衝撃の左右 | 1秒ごとに読めるグラフ、全項目のラップの表（CSV で出せる）。PowerCenter で項目を選んでグラフ。**Footpath**：足の軌跡の 3D（横・上・後ろ）で、2本の走り、または同じ走りの左右を重ねる。Run Form & Shoe Analytics：月ごと・速さで絞って比べ、同じ年代・性別の分布 | **グラフを読むだけ**。宣伝の記事は「走りが進むにつれての小さな変化」「疲れの始まりを特定」とうたうが、ヘルプには1本の中の区間を選ぶ説明がない。疲れの目安（LSS が1割下がる・接地時間が 15ms 増える）は記事で本人に読ませる。Duo の記事では、筆者が19マイルの走りの4マイルごろから左右差が出たのをグラフで見つけ、「診断ではなく点検に使って」と書く | ポッド $199〜、Duo $399〜（2025-10）。会員 月 $14.99・年 $129、日本は 2025-11-07 から月 2,200円・年 18,933円。Footpath は会員＋新しいポッド | 一次：[Footpath の発表（2024-10-08）](https://blog.stryd.com/2024/10/08/a-closer-look-stryd-footpath-available-on-next-gen-stryd/)、[Run Form & Shoe Analytics（2024-09-26）](https://help.stryd.com/en/articles/9927525-understanding-and-using-stryd-s-run-form-shoe-analytics)、[Footpath と Duo（2025-12-18）](https://help.stryd.com/en/articles/8538788-how-to-use-stryd-footpath-with-stryd-duo)、[疲れの記事（2025-06-17）](https://blog.stryd.com/2025/06/17/is-fatigue-killing-your-race/)、[Duo を疲れの合図に（2026-05-12）](https://blog.stryd.com/2026/05/12/using-stryd-duo-data-as-a-fatigue-signal/)、[走ったあとの画面（2020-10-14）](https://blog.stryd.com/2020/10/14/closer-look-post-run/)、[会員の料金](https://help.stryd.com/en/articles/12474550) |
| **Runmetrix**（カシオ・アシックス、腰のセンサー） | 約20項目（ピッチ・歩幅・接地時間・上下動・骨盤の回旋と傾きなど）、6分野の点数 | 6軸の点数（レーダー）、フォームの**アニメーション**と助言、筋トレ・ストレッチの動画のプログラム、ペースの地図。「ラップ詳細」でラップごとの平均と左右（カシオの FAQ、検索の要約だけ）。ウェブの ASICS Running Data Manager で「期間・ペース・局面ごと」の変化と、ほかの人との比べ（「局面」が走りの区切りか、1歩の中の局面かは書いていない） | アプリでの自動の検出は確かめられない。ラップの表を自分で読む | センサー 14,080円（2021、二次）。センサーが「生産完了」との記述は検索の要約だけ（カシオのページは 403 で読めず、未確認）。アプリは 2026-11 にも更新あり | 一次：[アプリの説明](https://runmetrix.casio.com/jp/application/)、[ASICS Running Data Manager](https://data-viewer.asics.com)。二次：getnavi（2021-03-30、URL は控えていない） |
| **ASICS RACE REPORT**（Runmetrix のセンサーで） | 20以上のフォームの項目、ペースの推移と配分 | レースの**序盤・中盤・終盤**ごとのフォーム、今後の助言と練習の提案。ブラウザのレポート | **あり（ただし3つの区切り）**。アシックスの仕組みと担当者がまとめる。自動でその場に出るものではない | 1レース 5,500円。CMT-S20R-AS と OneASICS の ID。2026年に申し込めるかは未確認 | 二次：[Impress Watch（2022-10-24）](https://www.watch.impress.co.jp/docs/news/1449966.html)。一次の [カシオのページ](https://www.casio.com/jp/run-walk/arr/) は 403 で読めず、検索の要約で「スタートからゴールまでのフォームとペースの変化を振り返る」とだけ見た |
| **StrideCoach**（Beflex、AirPods） | ピッチ・接地・上下動・衝撃・頭の角度・左右バランス・安定性・フォームの点数（0〜100） | 走りの要約（8項目を色分け、自分の平均と比べる）、週・月の傾向、AI の助言。版 1.4（2025-07-19）で「網かけのグラフ」を足した（何のグラフかは書いていない） | 見当たらない。km ごと・区間ごとの分け方の記述もない（未確認） | AirPods。無料は7日分の記録。Pro は米国で月 $5.99・年 $44.99（日本は月 800円・年 5,000円、2026-10 の `docs/competitors.md`） | 一次：[App Store（米国）](https://apps.apple.com/us/app/-/id6746169274)、[公式サイト](https://stridecoach-beflex.web.app) |
| **RunScribe** | 効率・衝撃・動き・左右・パワーの5群（ピッチ・接地・滞空・着地の型・プロネーション・衝撃・ブレーキ）、全部に左右。骨盤の角度の時間のグラフ | 傾向・シューズの比べ | 記述なし | **事実上、販売していない**：公式が「関税の問題で在庫がなく、入荷の予定もない」（2026-11-16 に確認）。App Store のアプリは 2021-07-26 が最後の更新 | 一次：[公式サイト](https://runscribe.com) |
| **NURVV Run**（中敷き） | ― | ― | ― | **終わったとみてよい**：NURVV Group Ltd は 2023-08-17 に清算を決議、NURVV Limited は 2025-01-19 に解散（英国の登記）。nurvv.com は 2026-11-16 に開けなかった。サポート終了の告知は見つからない | 一次：[Companies House 11453898](https://find-and-update.company-information.service.gov.uk/company/11453898)、[09679849](https://find-and-update.company-information.service.gov.uk/company/09679849) |
| **ORPHE TRACK**（靴のセンサー、国内） | 1歩ごとの着地の型・プロネーション・接地時間・歩幅と足の高さ・ピッチ・着地の衝撃 | ピッチは「ランニングを通して変化を確認できます」（グラフかは書いていない）。走っている最中の声のコーチもある | なし（自分で見る） | アプリは無料。CSV の書き出しは月 5,000円。センサーの今の値段は未確認。**旧アプリは 2026-12-31 で終了**し、記録は引き継げない。「データ分析に特化した新しい ORPHE TRACK」に替わる。研究・医療向けに、センサー単体で長い時間を1秒ごとに残す ORPHE ANALYTICS LD（2025-11 発表、二次） | 一次：[ORPHE TRACK（2026-11-16 に確認）](https://orphe.io/track)、[ランニング向け](https://orphe.io/for-running) |

### 2-3. 記録を集めて分析するサイト

| 製品 | 走ったあとのフォームの項目 | 見せ方 | 崩れた場面の検出 | 料金 | 出典 |
|---|---|---|---|---|---|
| **Strava** | ランでは**なし**。ピッチのグラフは自転車だけ（公式ヘルプ、2026-08-17） | 高さ・ペース・心拍、ラップ。AI のまとめ（Athlete Intelligence）はペース・心拍が対象で、ピッチは対象外と明記（2026-09-18） | なし | 米国 月 $11.99・年 $79.99（料金ページの検索の要約、2025-07）。日本は未確認 | 一次：[アクティビティの見方](https://support.strava.com/en-us/articles/15401981-viewing-activities)、[Athlete Intelligence](https://support.strava.com/hc/en-us/articles/26786795557005-Athlete-Intelligence-on-Strava) |
| **Runalyze** | ピッチ・歩幅・上下動・上下動比・接地時間・接地時間の左右・滞空時間・滞空比 | 要約の値と、項目ごとのタブ（走りの中のグラフと見られるが、表示まで確かめられず未確認）。1kmごとの表にはフォームの項目がない。Trend Analysis で走りをまたいだ傾向（中央値・10/90%・傾きの線）。地図をピッチ・歩幅で色分け（Premium、検索の要約だけで未確認） | フォームではなし。心拍とペースのずれ（Aerobic Decoupling）を前半と後半で比べ、Premium では1本の中の時間の推移と、好きな区間どうしの比べ（2022-02-21） | 無料。Supporter 月 €2.50、Premium 月 €5.50・年 €60 | 一次：[料金](https://runalyze.com/pricing)、[Decoupling](https://runalyze.com/glossary/aerobic-decoupling?_locale=en)、[Decoupling の推移（2022-02-21）](https://blog.runalyze.com/features/premium-feature-aerobic-decoupling-view/)、[Trend Analysis](https://runalyze.com/help/article/trendanalysis?_locale=en)、[共有された記録の例](https://runalyze.com/shared/8w8wn?_locale=en) |
| **intervals.icu** | 2026-08-31 から12の時系列（接地時間・その割合・左右・上下動・上下動比・上下の速さ・歩幅・脚のバネ・衝撃の速さ・滞空時間・滞空比・ストライド）と、走り・インターバル・ラップごとの平均9つ | 走りのグラフ、インターバルどうしの比べ、シーズンの傾向、条件での検索（「平均の接地時間が 260ms を超えた走り」など） | **なし**。作者の投稿は「インターバルの中で接地時間が増えるのはよい疲れの合図」と書くが、それを出す指標はない。心拍とパワーのずれはある | 無料。Supporter 月 $4。フォームの項目に課金の区別は書いていない。どこまで出るかは機器しだい（Garmin＋HRM-Pro で全部、COROS・Suunto・Apple は一部） | 一次：[新しいランの指標（作者の投稿、2026-08-31）](https://forum.intervals.icu/t/new-running-metrics/132173)、[料金](https://www.intervals.icu/pricing/) |
| TrainingPeaks・SportTracks・Golden Cheetah | 接地時間・上下動を時間・距離・ペースに対してグラフにできる（TrainingPeaks、検索の要約だけ）。SportTracks・Golden Cheetah は一次で確かめられず | グラフ | 見つからない | 未確認 | [TrainingPeaks のヘルプ](https://help.trainingpeaks.com/hc/en-us/articles/115006085128)（403、検索の要約だけ） |

### 2-4. 動画の解析・施設向け（軽く）

| 製品 | 中身 | 長い走りの崩れ | 出典 |
|---|---|---|---|
| **Ochy** | 横・後ろの短い動画（外でもよい）から約60秒で、ピッチ・接地・滞空・関節の角度・着地と離地・上下動・脚の回り方。骨格を動画に重ね、コマ送り、その人向けの運動と毎日の練習の計画。料金はアプリ内で多くの形（米国で月 $5.99〜29.99 など。どれが今のものかは未確認） | 短い1本だけなので、長い走りの時間の流れはない | 一次：[App Store](https://apps.apple.com/us/app/-/id1531481638)、[ochy.io](https://www.ochy.io/) |
| **Peloton Run Analysis** | トレッドミル（Tread Vision など）のカメラで、ピッチ・上下動・歩幅。走ったあとに Running Efficiency Score（1〜100）と助言。2026-10-01 から。走っている最中は直さない（二次） | トレッドミルのワークアウト単位 | 一次：[Peloton の発表（2026-09-22）](https://www.onepeloton.com/blog/whats-new-2026-treadmill-updates) |
| **Runeasi**（理学療法向け） | 腰の後ろのセンサー1個で、安定性・衝撃・左右から 0〜100 の質の点数。終わったら自動でレポート | 「疲れで質が落ちる時と場所を傾向で示す」という検索の要約を見たが、ページには書いておらず未確認 | 一次：[Runeasi](https://runeasi.ai/what-runeasi-does-download/) |

研究では、体に付けたセンサーで疲れた走りを見分ける報告がある（例：[外の走りでの機械学習、Sensors 2021](https://www.mdpi.com/1424-8220/21/10/3451)、[ハーフマラソンの現場の測定、Biomechanics 2025](https://doi.org/10.3390/biomechanics5040101)、アシックス系の [マラソン序盤のセンサーの値から後半の失速を予測、Frontiers 2025（題だけ読んだ）](https://www.frontiersin.org/articles/10.3389/fspor.2025.1681444/full)）。これを使った消費者向けの製品は見つからなかった。

## 3. 見せ方の型

| 型 | 持っている製品 | 気づいたこと |
|---|---|---|
| 走りの平均の数字 | ほぼ全部（Apple・Suunto はこれが中心） | いちばんありふれている |
| 走りの中の時間のグラフ | Garmin、Stryd、Huawei（変化の曲線）、intervals.icu、Pixel Watch（Visualize performance）、ORPHE（ピッチ）、Runalyze（未確認）、COROS（二次）、Apple（パワーだけ、二次） | 読むのは本人。どこが崩れかの印は付かない |
| ラップ・km・区間ごとの表 | Stryd（全項目）、intervals.icu（インターバル・ラップ）、Pixel Watch（split・segment）、Runmetrix（ラップ詳細、検索の要約だけ） | Runalyze の 1km の表にはフォームが入らない。Garmin の表にフォームが入るかは未確認 |
| 長い走りを区切ったまとめ | **ASICS RACE REPORT**（序盤・中盤・終盤、有料・人の手が入る） | 見つかった中で、長い走りの流れをはっきり区切って見せる唯一のもの |
| 疲れ・崩れの始まりの自動の検出 | 確かめられたものは**なし**。Stryd は宣伝でうたう、Pixel Watch は似た区間で比べる助言、Runeasi は未確認 | 研究はあるが製品になっていない |
| 疲れを読む目安を記事で教える | Stryd（LSS −10%・接地 +15ms）、COROS（後半の接地時間の増え、上下動の急な増え） | 本人がグラフに当てはめる |
| 心拍とペース（パワー）のずれ | Runalyze（1本の中の推移も）、intervals.icu | フォームではなく持久力の見方。長い走りの「どこから」に近い形はここにある |
| ほかのランナーと比べた色・等級 | Garmin（紫〜赤の5色）、COROS（Elite〜Qualified）、Stryd（同じ年代・性別の分布）、Runmetrix（ほかの人と比べる） | このアプリの方針（その日の本人と正しいフォームが基準）とは違う |
| 自分の過去と比べた傾向 | StrideCoach（自分の平均、週・月）、Runalyze、intervals.icu、Stryd（月ごと・速さで絞る）、Garmin（Running Economy）、Pixel Watch（10本で本人の範囲）、Runmetrix のウェブ | 速さをそろえて比べるのは Stryd（月ごと）と Pixel（似た区間）だけ見つかった |
| 点数・型分け | COROS（Running Form Score、Ground／Aerial Runner）、Runmetrix（6分野）、StrideCoach（0〜100）、Peloton（1〜100）、Runeasi（0〜100） | |
| アニメ・3D・骨格 | Runmetrix（アニメーション）、Stryd Footpath（足の軌跡の 3D）、Ochy（動画に骨格） | 体全体の姿勢を外の長い走りの中で動かして見せるものは見つからない |
| 左右差 | Garmin（付属品）、COROS（腰の POD）、Stryd Duo、Runmetrix、StrideCoach、Huawei、RunScribe、intervals.icu | Stryd Duo の記事は、長い走りで左右差が出始めたところをグラフで探す使い方を紹介 |
| 地図の上の色分け | フォームでの色分けは確かめられたものなし（Runalyze の Premium は検索の要約だけ） | |
| 助言・練習の提案 | Runmetrix（筋トレ・ストレッチのプログラム）、COROS（記事）、StrideCoach（AI）、Ochy（運動と計画）、Peloton、RACE REPORT | 次に何をするかの形はよくある |
| 決まった手順で測るテスト | COROS（Running Form Test） | 毎回の走りがばらばらなのを、条件をそろえて比べる |

## 4. このアプリが、いま走ったあとに見せているもの（2026-11-16 のコード）

### カメラ版（トレッドミル。`src/screens/Result.tsx`・`src/modes/camera/screens/Posture.tsx`）

- 声なしで保てた時間（主役。前回との差）
- 良い姿勢で走れた時間の割合（前回との差）と、走りのひとこと（「○分から崩れ始めました。声をかけるたびに戻せています」など。`camera/summary.ts`）
- 走る前の立ち姿勢（くわしく、にたたむ）
- よい例との差：項目ごとに、走っていた間の平均を、その速さのよい例の範囲・声の線と比べる。次に意識する1つ
- 走りの数字：ピッチ・上下動・腰の高さ・腕振り（1歩ずつの値の真ん中。声はかけない）
- 姿勢スコアの推移：1分ごとの点数の線、声なしで見守った時間の帯、声をかけた時刻、崩れ始めの縦線
- 崩れ始め（5分平均の点数が序盤より15点下がった最初の時刻、`core/engine.ts` の `breakdownMinute`。10分以上のとき）と前回の値
- 声をかけた回数（前半・後半）、最近の声4つ
- あなたの走り姿：良い・ふつう・悪いの1歩を、正しいフォーム（速さのよい例）や次の一歩と重ねて見る
- センサーがずれた分（いっしょに使ったとき）、記録の送り状態

### スマホ版（腰。`src/modes/phone/screens/PhoneResult.tsx`）

- 付け方の注意（腰以外・ゆるい・ずれた）、いっしょに使ったセンサーのずれ
- 声なしで保てた時間、良い走りの割合（走り始めの自分と比べて）
- ピッチの推移（走り始めの基準の点線、声の時刻）
- ピッチ・上下動・着地のブレーキの平均と走り始めの基準、外で速さのために判定を止めた時間
- 崩れ始め（リズムと揺れ方から）、知らせた回数（声とメトロノーム）
- いつもと違う度合いの推移（1分ごと。リズムのそろい方・揺れの割合・接地の長さを走り始めの自分と比べてまとめた値。線 2 を3分続けて超えた始まりを崩れ始めにする。線と長さは仮、`FATIGUE`）
- 走り始めからの変化（上下動・ブレーキ・有効接地時間の1分ごとの線。良し悪しは言わない）
- ピッチを上げる練習・フォームのテストの回のカード、最近の知らせ

### センサーラン（外。`src/modes/sensor/screens/SensorResult.tsx`）

- 走っていた時間
- 振動で知らせた回数：背中が丸まった（胸）・頭が前に出た（頭）・接地が長い・接地の左右差・足が体より前に着いた
- 体を大きく曲げて知らせなかった回数、1時間の上限に達して知らせなかった回数
- ベルトの速さで足首の速さの式を合わせたか
- 胸・頭のセンサーがずれた分、立ち姿勢が取れなかった、つながらなかった・途切れた場所と秒、アプリが止まった回数

**センサーランには、時間の流れの図・崩れ始め・測った値（胸と頭の傾き、接地時間、ピッチ、左右差の大きさ）の数字がまだない。** 記録には値が入っている（60秒ごとに端末へ書き出し、2時間を超えると分けて送る）が、画面は回数とつながりの様子だけ。
位置は速さと高さだけ残し、緯度・経度は残さない（家の場所が分かるため、`src/modes/sensor/gps.ts`）。地図の上で色分けするには、この決めを見直す必要がある。
Mac 側の `npm run merge`・`npm run compare:sensor` などは開発の確かめ用で、本人向けのふり返りの画面ではない。

## 5. 空いているところ（調べた結果からの見立て）

ここは、上の調べから考えた見立てで、確かめた事実ではない。「見つからなかった」は「ない」と言い切れるものではない（調べた範囲は上の製品と出典まで）。

1. **長い走りの「どこから崩れたか」を自動で示す。** 消費者向けで確かめられたものはなかった。多くはグラフを置いて本人に読ませ、Stryd・COROS は「この値がこれだけ変わったら疲れ」を記事で教えるだけ。区切って見せる ASICS RACE REPORT は、序盤・中盤・終盤の3つで、有料・人の手が入る。このアプリはカメラ版とスマホ版で「崩れ始め」をすでに自動で出しているので、ここは伸ばしやすい。
2. **上半身の姿勢の時間の変化。** 胸の前傾・頭の前出・猫背を、長い走りの中で並べて見せるものは見つからなかった（StrideCoach の頭の角度も要約と傾向だけ）。時計・胸ベルト・足のセンサーは、どれも上半身の姿勢を測っていない。
3. **知らせと、そのあとのつながり。** 走っている最中に知らせた時刻と、そのあと戻ったか・何分もったかを、走ったあとに見せるものは見つからなかった。このアプリのカメラ版の「声なしで保てた時間」「声のたびに戻せた」は、この形の芽。センサーランにはまだない。
4. **同じ速さ・同じ坂どうしでの比べ。** 外の長い走りでは、速さ・坂・信号での止まりでフォームの値が動き、疲れと混ざる。1本の中でこれを分けて見せるものは見つからなかった（速さで絞るのは Stryd の月ごとの比べ、似た区間で比べるのは Pixel Watch の Premium の助言だけ）。このアプリは「よい例は速さごと」を持っているので、速さを合わせた比べを出せる余地がある。
5. **体の複数の場所を同じ時間の軸で並べる。** 頭・胸・足首・腰を同時に測り、「胸が落ちた少しあとに接地が伸びた」のように並べて見せるものは見つからなかった。ほかの製品は付ける場所が1つ（胸ベルト・腰・足・耳）か2つ（Huawei・Stryd Duo の両足）。
6. **比べる基準。** 多くはほかのランナーの分布（Garmin・COROS・Stryd）か、過去の自分の平均。その日の立ち方・走り出しを基準に、そこからのずれを1本の中で見せるものは、このアプリ（カメラ版・スマホ版）のほかには見つからなかった（Pixel Watch の本人の範囲は10本の走りから作る）。
7. **弱いと言えないところ。** 平均の数字・週や月の傾向・点数・助言・左右差は、どこもやっている。ここを足しても差にはなりにくい。地図の色分けは確かめられた製品がないが、このアプリは位置を残さない方針なので、出すなら決め直しが要る。

## 6. 確かめられなかったこと

- Garmin：ラップの表に接地時間・上下動が入るか、地図をフォームの値で色分けできるか、Running Dynamics Pod の今の値段と販売
- COROS：フォームの項目それぞれに、走りの中のグラフがあるか（二次の記述だけ）
- Apple Watch：接地時間・上下動・歩幅の走りの中のグラフがあるか、ヘルスケアでの傾向の見せ方、値段
- Suunto：グラフの有無、手首だけで出るか、Race 2 の値段
- Polar・Stryd 以外の時計の値段
- Pixel Watch：Visualize performance がグラフか地図か、崩れた時刻を自動で示すか、Premium の値段
- Huawei：変化の曲線が何を描くか、点数・助言の有無、S-TAG の値段
- Zepp／Amazfit：Zepp アプリでのフォームの見せ方
- Runmetrix：センサーが生産完了か（カシオのページが 403）、「ラップ詳細」の中身（検索の要約だけ）、Running Data Manager の「局面」の意味
- ASICS RACE REPORT：2026年に申し込めるか、序盤・中盤・終盤以外の区切りがあるか（一次のページは 403）
- StrideCoach：網かけのグラフが何を描くか、区間ごとの見せ方
- Runalyze：走りの中のフォームのグラフの表示と課金の区別、地図の色分け
- RunScribe の値段、ORPHE のセンサーの今の値段と新しいアプリの中身
- SportTracks・Golden Cheetah・WKO・Final Surge（一次で読めず）、Plantiga・Kinetyx（見つからず）
- Strava の日本の値段
- 日本のほかの製品（Epson・セイコー・ミズノなど）：検索1回で外の走りのフォームのふり返りは見つからなかったが、調べ尽くしてはいない
