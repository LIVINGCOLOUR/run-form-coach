# スマホで GPS と心拍計を使うランのアプリ：ほかの製品がしていること（2026-11-17 調べ）

スマホで GPS を取り、Bluetooth の心拍計（Fitbit Charge 6 の「心拍数をブロードキャスト」や胸ベルト）をスマホにつないで、走りの分析やコーチをするアプリを並べ、このアプリと比べた。
いちばん知りたいのは、**心拍とフォームの値（胸・頭の傾き、ピッチ、接地時間、左右差、腰のスマホ）を組み合わせて使っている製品があるか**。「心拍 × フォーム」の機能を作るかを決める材料にする。

- 確かめ方：公式のヘルプ・製品のページ・App Store を一次情報とし、レビュー記事・掲示板・検索の要約は「二次」と書いた。どのアプリも実際には使っていない
- 「未確認」は、調べたが出典で確かめられなかったこと。推測では埋めていない。App Store の版の日付は年が出ないものがあり、そのときは「年なし」と書いた
- フォームの機能そのものは `docs/research/phone-competitors.md`（2026-10-12）、走ったあとのフォームのふり返りは `docs/research/post-run-review.md`（2026-11-16）。ここは心拍・GPS・ペース・効率・コーチに寄せた

## 1. 要約

心拍計をスマホにつなげるアプリは多い（Strava・Runna・ASICS Runkeeper・Wahoo・iSmoothRun・Runmeter・Apple のフィットネス など）。ただ、**心拍を見て走っている最中に声で指示するもの**は少なく、大手では Runkeeper（今の心拍とゾーンを読み上げる）と Polar Flow（ゾーンが変わったら言う、Polar の心拍計だけ）くらい。「ゾーンから外れたらペースを上げて／落として」と言うのは、RunBeat・Cardio Zones・Runmeter・Heart Alert のような小さなアプリだった。Runna の「スピードを上げて／落として」はペースが基準で、心拍では言わない（心拍は表示だけ、計画にも使わないと明記）。Apple の Workout Buddy は日本語に対応しておらず、心拍にも触れない。日本の会社のアプリで、心拍で声をかけるものは見つからなかった。
走ったあとの心拍の見せ方は、ゾーンごとの時間・心拍のグラフ・区間の表がふつうで、Strava の有料版は負荷と疲れ（Fitness & Freshness）、坂の補正ペース（GAP）まで出す。**効率（速さ÷心拍）や後半の心拍のずれ（decoupling）をスマホのランのアプリで出すものは見つからず**、出すのは記録を読み込むサイト（Runalyze・intervals.icu）だった。
**心拍とフォームを1つの判定にまとめて、走っている最中に声で言う製品は見つからなかった。** 近いのは、①Garmin の Running Economy（時計＋HRM 600 の胸ベルト。心拍・速さ・接地・上下動・ブレーキを使うが、数本の走りから出す長い目の数字で、最中の声ではない）、②StrideCoach（AirPods でフォームの声、Apple Watch で心拍ゾーンの声を同時に。ただし別々に言う）、③StrideCue・PaceJoy（「心拍が上がっています、少し緩めましょう」「ピッチが落ちています」と言う個人開発のアプリ。どう組み合わせるかは書いていない）、④FMP Fatigue Monitor（心拍のずれと歩幅の縮みの2つで疲れを見る。時計のアプリと見られ、最中か後かは未確認）。上半身の姿勢と心拍を組み合わせたものはなかった。

## 2. 機能の比較

◎＝はっきりできる（一次で確かめた）、○＝できる、△＝条件つき・一部、×＝できない・見つからない、？＝未確認。
「最中の心拍の声」は、心拍の値やゾーンを声で言うか、外れたら声で知らせるか。「効率・ずれ」は、速さ÷心拍（Efficiency Factor）・後半の心拍のずれ（decoupling）・心拍のドリフトを出すか。
「標準の心拍計」は、Bluetooth の標準の Heart Rate Profile の心拍計をスマホのアプリに直接つなげるか（Charge 6 は「心拍数をブロードキャスト」が同じ形）。料金は日本の App Store の表示（なければ米国）。

### 2-1. ランの記録とコーチのアプリ（大手）

| アプリ | 最中の心拍の声 | ペースの声 | フォームの声 | 走ったあとの心拍の分析 | 効率・ずれ | 標準の心拍計 | 料金 |
|---|---|---|---|---|---|---|---|
| **Strava** | ×（声は区間・距離の区切り・セグメントだけ） | △（区切りの時間。2026-03 から有料版のワークアウトは声で手順） | × | 心拍のグラフ（無料）、ゾーンの分布・Relative Effort・Fitness & Freshness（疲れ・体力）・Fitness Score は有料。GAP あり | × | ◎（アプリの「センサーを追加」。Charge 6 は Google の確かめた一覧に入っている） | 無料。有料 月1,090円・年7,800円。Runna とのセット 年15,980円 |
| **Runna**（2025 年に Strava が買った） | ×（心拍は表示だけ、計画にも使わないと明記） | ◎（決めたペースから外れたら「スピードを上げて／落として」。外だけ） | × | ？（走ったあとの心拍の見せ方は確かめられず） | × | ◎（「ほとんどの Bluetooth の心拍計」） | 単体で年11,900円（Strava のストアの表示）。最初の1週間は無料 |
| **Nike Run Club** | ×（選べるのは時間・距離・ペース） | ◎ | × | ？ | × | △（iPhone では「設定」でつないでヘルスケア経由と読める。検索の要約だけで未確認） | 無料 |
| **adidas Running**（旧 Runtastic） | ？（声のコーチは有料、心拍を言うかは未確認） | △（有料版で1kmごと・時間ごと） | × | △（有料版でゾーンを変えられる） | × | ○（Bluetooth Smart、有料の機能とするヘルプがある。検索の要約） | 無料。有料版の日本の値段は未確認 |
| **ASICS Runkeeper** | ◎（iPhone で今の心拍・平均の心拍・ゾーンを読み上げ。外れたら言う機能は見つからない） | ◎（ペース・区間のペースなど） | ×（ピッチも対象外） | ゾーンの詳しい内訳（有料の Go、2025-05 ごろ） | × | ◎（BTLE の規格の心拍計なら。心拍は GPS の点にひもづくので外だけ） | 無料。Go は月約1,100〜2,000円・年約4,500〜6,000円（ストアの表示の幅） |
| **TATTA**（RUNNET） | × | △（1kmごとの読み上げ。レビューの記述だけ、二次） | ×（ピッチも測らないとするレビュー、二次） | 平均の心拍をヘルスケアから取り込む。2025-10 からコンディションの点数・タイムの予測（時計なしでも点数を出す） | × | ×（ストアに記載なし） | 無料 |
| **Pacer** | × | ○（ペース・距離・時間） | × | △（Apple Watch の心拍をヘルスケアから、有料） | × | ×（見つからない） | 有料版 月1,000円・年4,000円 |

### 2-2. 心拍計・センサーの会社のアプリと、スマホで記録できないもの

| アプリ | 最中の心拍の声 | ペースの声 | フォームの声 | 走ったあとの心拍の分析 | 効率・ずれ | 標準の心拍計 | 料金 |
|---|---|---|---|---|---|---|---|
| **Polar Flow**（スマホで記録） | ◎（ゾーンが変わったとき・ラップ・目標の段階を言う） | ×（声の一覧にない） | × | ゾーンなど | × | △（一覧は Polar の H9・H10・OH1+・Verity Sense だけ。ほかの会社のものは書いていない） | 無料 |
| **Polar Beat**（終わっていない。2025-09 も更新） | ○（目標に向けた声の案内。ゾーン・体力テストなどは Polar の心拍計のときだけ） | ？ | ×（ピッチと歩幅は Polar Stride のセンサーのときだけ表示） | ゾーン、Running Index | × | △（ほかの会社の心拍計は今の心拍だけ） | 無料 |
| **Wahoo**（旧 Wahoo Fitness。名前だけ変わった） | △（今の心拍・ラップの平均の心拍を読み上げ。ゾーンで言うかは未確認。サポートのページは読めず検索の要約） | ○（ペース・速さ） | × | ？ | × | ◎（Bluetooth Smart） | 無料。Core 800円・Wahoo 3,000円（アプリ内の課金） |
| **Zones for Training**（日本語名「Zones 心拍トレーニング」） | ×（Apple Watch の振動。声ではない） | × | × | ゾーンの時間、心拍とペースのグラフ、2分の心拍の戻り。**watchOS のフォームの値（歩幅・接地時間・上下動・パワー）も同じ画面に並ぶ** | × | ×（Apple Watch が要る。スマホだけでは記録しない） | 無料。PRO 1,300円 |
| **iSmoothRun** | ◎（決めた時間・距離ごとに心拍を読み上げ。ゾーンが変わったら言うとするレビューは二次） | ◎ | △（ピッチを読み上げ。メトロノームあり） | 区間・ピッチ・心拍・週と月の負荷 | × | ◎（Bluetooth Smart の心拍計・足のセンサー・Stryd） | 800円＋Pro 年2,400円。最後の日付のある更新は 2024-02 |
| **Zombies, Run!** | ？（ストアに心拍計の記載なし） | ？ | × | ？ | × | ？ | 無料＋会員。2025 年に持ち主の会社がほぼ全員を解雇し、2025-11 に作者が買い戻した |
| **Garmin Connect** | ― | ― | ― | ― | ― | ―（時計なしでスマホだけで記録できるとする公式の記載はない。HRM 600 はアプリから始めてベルトに記録できるとする説明書があるが、中身は未確認） | ― |
| **Stryd**（スマホで記録） | × | ？（声は Apple Watch のアプリだけ記載） | × | ― | ×（パワーの会社だが心拍は使えない） | ×（「iPhone と Android の Stryd のアプリは Bluetooth の心拍計につながらない」と公式に明記、2025-08-12） | 会員 2,200円・2,500円 |
| **COROS** | ― | ― | ― | ― | ― | ―（COROS のアプリは記録しないとサポートが案内。検索の要約で、ページは読めず） | ― |
| **Kinetic** | ランのアプリとしては見つからなかった | | | | | | |

### 2-3. スマホ・時計に付いているもの

| アプリ | 最中の心拍の声 | ペースの声 | フォームの声 | 走ったあとの心拍の分析 | 効率・ずれ | 標準の心拍計 | 料金 |
|---|---|---|---|---|---|---|---|
| **Apple のフィットネス（iPhone だけ）** | ×（Workout Buddy は心拍・ゾーンに触れない。英語とスペイン語だけ、iOS 27 以降・iPhone 15 Pro 以降） | △（Workout Buddy がペース・距離・時間の様子を言う。日本語では使えない） | × | 終わったあとのまとめ（ゾーン・区間を出すかは未確認） | × | ◎（AirPods Pro 3・Powerbeats Pro 2・ほかの会社の Bluetooth の心拍計。自分で組むワークアウトは Apple Watch が要る） | 無料 |
| **Google Health**（2026-05-19 に Fitbit のアプリから名前が変わった） | ？（Gemini のコーチは有料で計画を作る。走っている最中の声の記載はない） | ？ | × | GPS のある走りで VO2max | × | ？（「機器なしでスマホでワークアウトを始められる」。時計をつないでいると外す必要があることがあり、Charge 6 の心拍を使えるかは未確認） | 無料。Premium は日本で月1,580円からとする検索の要約だけ |

### 2-4. 心拍で声をかける小さなアプリ・心拍とフォームの両方を言うアプリ

| アプリ | 最中の心拍の声 | ペースの声 | フォームの声 | 走ったあとの心拍の分析 | 効率・ずれ | 標準の心拍計 | 料金 |
|---|---|---|---|---|---|---|---|
| **Runmeter**（Abvio） | ◎（読み上げに心拍。目標から外れたら声で知らせる。「心拍が目標を超えたら聞こえる」は Apple Watch のアプリの説明） | ◎ | ×（ピッチは測る） | 区間・インターバル・ゾーン・グラフ | × | ◎ | 無料＋Elite（米国 $4.99〜29.99）。日本語あり |
| **RunBeat: HR Zone Audio Coach** | ◎（今の心拍を見て、ゾーンに収まるよう「スピードを上げて／落として」） | ◎（ペースのモードもある） | ×（記載なし） | ゾーンの時間・心拍のグラフ・本数ごとの区間・地図 | × | ◎（どの Bluetooth の心拍計も。Fitbit・Polar・Garmin・AirPods Pro 3・Apple Watch の名前も出す） | 最初の1回は無料、Pro は $9.99・$49.99。日本語なし。2026-11 も更新 |
| **Cardio Zones** | ◎（ゾーンを外れた・戻ったを声で。レビューの記述は 2020 年、二次） | ？ | × | ゾーンの時間・心拍の戻り・VO2max・ピッチ・地図に心拍 | × | ◎ | $49.99 の買い切り。日本語の画面あり |
| **Heart Alert** | ◎（範囲を外れた・戻ったを音・振動・声で） | × | × | ×（記録しない） | × | ◎（「Fitbit にはつながらない」と書く。Charge 6 のブロードキャストを考えていない書き方に見えるが推測） | 5回まで無料、$6.99 の買い切り |
| **StrideCoach**（Beflex、韓国） | ◎（Apple Watch があれば心拍ゾーンを外れたら声） | ○ | ◎（AirPods の動きのセンサーで、ピッチ・接地・上下動・衝撃・頭の角度・左右・ばらつきを声で直す） | フォームの8つの値は出すが、心拍の見せ方は書いていない | × | ×（心拍は Apple Watch だけ） | 無料で始められる。有料版あり（値段は未確認） |
| **StrideCue**（Dumo LLC） | ○（「心拍が上がっています。次の 400m は少し緩めましょう」の例） | ○ | ○（「ピッチが落ちています。小さく軽く」の例） | ？ | × | ×（Apple Watch。胸ベルトの記載なし） | 無料 |
| **PaceJoy** | ○（ゾーンの確認、1kmごとのまとめ） | ○ | △（「心拍・ピッチ・歩幅でフォームを見る」と書く。どのセンサーかは書いていない） | 声と文字のふり返り | × | ×（Apple Watch だけが出てくる） | 無料。2026-07 に出たばかりで評価なし |
| **ランフォームコーチ（今）** | ×（センサーランで心拍を記録だけ。2026-11-17 本人の決め） | × | ◎（カメラ版は声で姿勢、センサーランは振動で胸・頭・接地・左右、腰スマホは声でピッチ） | △（平均・最大・心拍のあった秒・切れた回数を1行。1秒ごとの心拍と RR 間隔は記録に残る） | ×（記録に心拍と GPS の速さ・高さはあるが、出していない） | ◎（センサーランだけ。Web Bluetooth なので iPhone は Bluefy。Charge 6 は Bluefy で出るか未確認） | テスト中。予定は、腰のスマホは無料・カメラ版は月額・センサーは別売り（`docs/competitors.md`） |

### 記録を読み込んで分析するサイト（スマホで記録するアプリではない）

効率・ずれを出すのはこちらだった。くわしくは `docs/research/post-run-review.md` の 2-3。
- **Runalyze**：前半と後半の心拍とペースのずれ（Aerobic Decoupling）。Premium では1本の中の推移と好きな区間の比べ。フォームの値（接地時間・上下動など）も同じ記録で見られる
- **intervals.icu**：心拍とパワーのずれ。2026-08-31 から接地時間など12のフォームの時系列も出す。両方を同じ走りのグラフに並べられるが、組み合わせた指標はない

## 3. 心拍とフォームを組み合わせている製品（いちばん大事）

**見つからなかったもの：** 走っている最中に、心拍とフォームの両方を見て、どちらを言うか（または何を言うか）を決める製品。上半身の姿勢（猫背・頭の前出・胸の前傾）と心拍を組み合わせる製品。

**近いもの（組み合わせの深さの順）：**

1. **Garmin の Running Economy**（Forerunner 970 ＋ HRM 600 の胸ベルト、2025 年）。説明書は「プロフィール・走りの歴史・心拍・速さ・ランニングダイナミクス（歩幅・接地時間・上下動・着地のブレーキ＝Step Speed Loss）を使う」と書く。心拍とフォームを1つの数字にまとめた唯一の例。ただし、**1本の走りではなく5〜7本の走りから出す長い目の推定**で、7段階の色で見せる。走っている最中の声ではなく、どの値がどれだけ効いたかも出さない。屋内とトレイルの走りは使わない。スマホだけでは使えない。
2. **FMP Fatigue Monitor**（英語と日本語のページ。説明に Connect IQ の制限とあるので Garmin の時計のアプリと見られる。推測）。疲れを2つに分ける：心臓の疲れ＝同じ速さに要る心拍の増え（DECOUP%）、筋肉と神経の疲れ＝歩幅の縮み（速さ×60÷ピッチで見積もる）。1つにはまとめず並べる。「筋肉と神経の指標は軽い疲れでも変わるが、心拍は中くらい以上の疲れでしか変わらない」と論文（Prigent 2022）を引いている（論文の本文は未確認）。走っている最中に知らせるかは書いていない。
3. **StrideCoach**。AirPods でフォームの声、Apple Watch で心拍ゾーンの声を「同時に」使うのがいちばんよいと書く。ただし、2つは別々の知らせで、どう順番を決めるかは書いていない。走ったあとのまとめはフォームの8つの値で、心拍は入っていない。
4. **StrideCue・PaceJoy**（2026 年の個人開発、Apple Watch）。例の言葉に「心拍が上がっています、緩めましょう」と「ピッチが落ちています」があり、PaceJoy は「心拍・ピッチ・歩幅でフォームを見る」と書く。どちらも、組み合わせ方は書いておらず、評価もほとんどない。
5. **並べて見せるだけのもの**：Zones for Training（心拍のグラフと watchOS のフォームの値を同じ画面に）、Runalyze・intervals.icu（同じ走りで心拍のずれとフォームの時系列）、Polar Beat（Polar Stride をつなぐとピッチと心拍）。1つの機器で心拍とフォームの両方を測る胸ベルトは Garmin HRM-Pro・HRM 600 と Wahoo TICKR X（走りの滑らかさ）があるが、TICKR X 2 は Wahoo の販売終了の一覧に入っている（検索の要約）。

**研究の材料（このアプリの方針の確かめに使える）：** 同じ速さでの心拍の上がり（心拍÷速さ）は気温でも上がる（体温が上がるため）。FMP のページは「フォームの変化のほうが心拍より早い」とする研究を引いている。どちらも今回は本文で確かめていない。

## 4. 空いているところ（調べた結果からの見立て）

ここは上の調べから考えた見立てで、確かめた事実ではない。「見つからなかった」は「ない」と言い切れるものではない（調べた範囲は上の製品と出典まで）。

1. **心拍とフォームの両方を見て、言うことを1つに選ぶ声。** 心拍で声をかけるアプリ（RunBeat・Runmeter・Runkeeper）と、フォームで声をかけるアプリ（StrideCoach など）はあるが、両方を見て「いまはどちらを言うべきか」を決めるものは見つからなかった。このアプリの「一度に意識できるのは1つ」と合う。たとえば、フォームが崩れ始めたときに心拍も上がっていれば、フォームを直す声より「ペースを落として」を先に言う、のような使い方が考えられる（案。線は記録を見てから）。
2. **崩れの理由を分けて見せる（走ったあと）。** 心拍のずれ（心臓の疲れ）とフォームの崩れ（筋肉の疲れ）を同じ時間の軸で並べ、「何分から心拍がずれ、何分から胸が落ちた」と出すもの。FMP Fatigue Monitor が歩幅だけでこの考えに近いが、上半身の姿勢・接地・左右差まで並べるものは見つからなかった。このアプリはセンサーランで、心拍・GPS の速さと高さ・胸と頭・接地を1秒ごとに同じ記録に持っているので、材料はそろっている。
3. **日本語で心拍の声をかける。** 心拍で声をかける小さなアプリは英語中心（RunBeat は日本語なし）。Apple の Workout Buddy は日本語に対応せず心拍にも触れない。日本の会社のアプリ（TATTA）は心拍計をつながない。Runmeter・Cardio Zones は日本語の画面があるが、声が日本語で出るかは未確認。
4. **Charge 6 を心拍計に使う。** Google が確かめたアプリの一覧でランのアプリは Strava だけ（ほかは室内の機器や Zwift など）。Charge 6 は同時に1つのアプリにしかつながらないので、このアプリでつなぐと Strava では心拍を取れない（Google のヘルプ）。ほかのアプリで「Charge 6 でつながった」という確かな報告は見つからなかった。
5. **差になりにくいところ。** ゾーンごとの時間・区間の表・心拍のグラフ・VO2max・負荷と疲れ（Strava の有料版）・GAP（Strava）はどこもやっている。ここを足しても差にはなりにくい。効率・ずれは大手のスマホのアプリにはないが、Runalyze・intervals.icu が出しており、Strava から記録を流せば手に入る。
6. **気をつけること。** 心拍は暑さ・脱水・坂で上がり、フォームの崩れと関係なく動く。手首の光学式（Charge 6）の心拍が走っている最中にどれだけ正確かは今回調べていない。心拍で声をかける線は、このアプリの決まりどおり、記録と研究で確かめてから決める必要がある。このアプリは緯度・経度を残さないので、地図に心拍やフォームを色で載せる見せ方はできない（坂は高さ、ペースは GPS の速さで足りる）。

## 5. 確かめられなかったこと

- Fitbit Charge 6 を Runna・Nike Run Club・Runkeeper・adidas Running・Runmeter・RunBeat・iSmoothRun・Wahoo のアプリにつないだ確かな報告（標準の形なのでつながるはずだが推測）。Google の一覧の「Wahoo」が Wahoo のアプリか室内の機器か
- Nike Run Club が iPhone でアプリに直接心拍計をつなぐか（ヘルスケア経由と読めるヘルプは検索の要約だけ）、走ったあとの心拍の見せ方
- adidas Running が心拍・ゾーンを声で言うか、有料版の日本の値段
- Runna の走ったあとの心拍の見せ方
- Wahoo のアプリの声の一覧の全部（ゾーンで言うか）、TICKR X の滑らかさを今のアプリが出すか
- Polar Flow がほかの会社の心拍計を受け付けるか、Polar Beat がペースを声で言うか
- Zombies, Run! が心拍計をつなぐか
- Apple のフィットネス（iPhone だけ）で走ったあとにゾーン・区間が出るか、ゾーンで知らせるか。Workout Buddy が Apple Watch なしで動くか
- Google Health：スマホだけの走りで GPS の道・Bluetooth の心拍計・Charge 6 の心拍・声が使えるか、Premium の日本の値段
- Runmeter の目標の知らせと Runkeeper の心拍の読み上げが有料か。Runmeter・Cardio Zones の声が日本語で出るか
- StrideCoach の有料版の値段と、走ったあとに心拍をどう出すか。StrideCue・PaceJoy が心拍とピッチをどう組み合わせるか
- FMP Fatigue Monitor の動く機器・料金・走っている最中に知らせるか。引いている Prigent 2022 の本文
- Garmin の Running Economy が今どの時計で使えるか（今回は Forerunner 970 と HRM 600 の組み合わせだけ）
- 効率（速さ÷心拍）・後半の心拍のずれをスマホのランのアプリで出すもの（見つからなかった）
- いくつかの App Store の版の年（表示に年がない）
- 「Kinetic」という名前のランのアプリ（見つからなかった）

## 出典

ランの記録とコーチのアプリ
- Strava：[センサーのつなぎ方](https://support.strava.com/en-us/articles/15401744-pairing-sensors-with-the-strava-app)（検索の要約）、[声の知らせ](https://support.strava.com/en-us/articles/15402180-audio-announcements)、[心拍](https://support.strava.com/en-us/articles/15401762-heart-rate)、[Fitness & Freshness](https://support.strava.com/hc/en-us/articles/216918477-Fitness-Freshness)、[ランの用語（GAP、2026-08-17）](https://support.strava.com/hc/en-us/articles/216917157)、[新機能（2026-03-11）](https://stories.strava.com/articles/whats-new-on-strava-muscle-maps-new-sports-and-expanded-training-tools)、[App Store（日本）](https://apps.apple.com/jp/app/id426826309)、[2019 年の外しと 2020 年の戻し（bikeradar、二次）](https://www.bikeradar.com/news/strava-sensor-pairing)
- Runna：[心拍計と機器（2026-08-30）](https://support.runna.com/en/articles/10547417)、[声の案内（2026-08-30）](https://support.runna.com/en/articles/8159780)
- Nike Run Club：[設定](https://www.nike.com/gb/help/a/nrc-settings)、[App Store（日本）](https://apps.apple.com/jp/app/id387771637)
- adidas Running：[App Store（日本）](https://apps.apple.com/jp/app/id336599882)、help.runtastic.com（検索の要約。今は adidas の FAQ へ飛ぶ）
- ASICS Runkeeper：[対応する心拍計](https://help.runkeeper.com/en/hc/supported-heart-rate-monitors)、[声の読み上げの一覧](https://help.runkeeper.com/en/hc/the-audio-stat-guide)、[2025 年の更新](https://runkeeper.com/cms/2025-updates/)、[App Store（日本）](https://apps.apple.com/jp/app/id300235330)
- TATTA：[App Store（日本）](https://apps.apple.com/jp/app/tatta-gps-workout-tracker/id1087745245)、[練習の分析・計画（2025-10-02）](https://runnet.jp/topics/special/251002.html)、[レビュー（二次）](https://app-liv.jp/3020558/)
- Pacer：[App Store（日本）](https://apps.apple.com/jp/app/id600446812)、[歩きのアプリ（検索の要約）](https://www.mypacer.com/walking-app)

心拍計・センサーの会社
- Polar：[Beat でできること](https://support.polar.com/en/support/What_do_I_get_with_Polar_Beat)、[Beat](https://support.polar.com/za/beat)、[Flow での記録](https://support.polar.com/us-en/flow-app-training-recording)、[Flow の声の案内](https://support.polar.com/en/voice-guidance-in-polar-flow-app)、[Beat の App Store（日本）](https://apps.apple.com/jp/app/id555252645)、[Flow の App Store（日本）](https://apps.apple.com/jp/app/polar-flow/id717172678)、[Flow 7.38（二次、2026-11-09）](https://gadgetsandwearables.com/?p=18602551)
- Wahoo：[App Store（日本）](https://apps.apple.com/jp/app/wahoo/id391599899)、[声の知らせ（検索の要約）](https://support.wahoofitness.com/hc/en-us/articles/17219474421266)、[TICKR X（二次、2014）](https://www.dcrainmaker.com/2014/01/wahoo-fitness-tickr.html)
- Zones for Training：[App Store（日本）](https://apps.apple.com/jp/app/zones-for-training/id1139688415)
- iSmoothRun：[App Store（日本）](https://apps.apple.com/jp/app/ismoothrun/id410965399)
- Zombies, Run!：[App Store（日本）](https://apps.apple.com/jp/app/zombies-run/id503519713)、[会社について](https://zombiesrungame.com/about)、[買い戻し（二次）](https://www.pocketgamer.biz/novelist-naomi-alderman-reacquires-zombies-run-from-former-owner-olivex)
- Stryd：[スマホのアプリは心拍計につながらない（2025-08-12）](https://help.stryd.com/en/articles/9010614)、[App Store（日本）](https://apps.apple.com/jp/app/stryd/id938379154)
- Garmin：[Running Economy の紹介（2025-08-08）](https://www.garmin.com/en-PH/blog/running/garmins-new-chapter-in-running-science-a-full-introduction-to-the-running-economy-feature/)、[the5krunner：Running Economy（二次）](https://the5krunner.com/2025/05/19/garmin-running-economy-all-you-need-to-know/)
- COROS：support.coros.com の記事 20374746801684（検索の要約だけ）

スマホ・時計に付いているもの
- Apple：[iPhone のフィットネスでワークアウトを始める](https://support.apple.com/guide/iphone/start-a-workout-in-fitness-iph8475d8510/ios)、[ワークアウトを組む](https://support.apple.com/guide/iphone/customize-a-workout-iphbcd56be45/ios)、[Workout Buddy](https://support.apple.com/guide/iphone/use-workout-buddy-iphb64176039/ios)、[AirPods Pro 3 の心拍](https://support.apple.com/guide/airpods/dev1b40fb47d)、[MacStories（二次）](https://www.macstories.net/stories/watchos-26-the-macstories-review/3/)
- Google Health：[Fitbit のアプリから Google Health へ（2026-05-19）](https://support.google.com/googlehealth/answer/17068213)、[スマホでワークアウト](https://support.google.com/googlehealth/answer/14236404)、[Health Coach](https://support.google.com/googlehealth/answer/17055092)、[心拍の共有（Charge 6 の確かめた一覧）](https://support.google.com/fitbit/answer/14236705?hl=en)

心拍で声をかけるアプリ・心拍とフォーム
- [Runmeter の機能](https://runmeter.com/features)、[Runmeter の説明](https://runmeter.com/documentation/)、[Runmeter の App Store](https://apps.apple.com/app/id326498704)
- [RunBeat の App Store](https://apps.apple.com/app/id6760047155)、[Cardio Zones の App Store](https://apps.apple.com/us/app/cardio-zones/id1103232564)、[Heart Alert の App Store](https://apps.apple.com/app/id6581485724)、[MAF180 の App Store](https://apps.apple.com/us/app/maf180/id1542742088)、[Endomondo の終了（二次、2020-10-30）](https://the5krunner.com/2020/10/30/endomondo-retired-aka-shut-down-forever/)
- [StrideCoach の機能](https://stridecoach-beflex.web.app/features)、[StrideCoach の App Store](https://apps.apple.com/us/app/-/id6746169274)、[StrideCue](https://www.stridecue.com/)、[PaceJoy の App Store](https://apps.apple.com/app/id6789131729)
- [FMP Fatigue Monitor の説明](https://fmp.it.com/en/fatiguemonitor/details/)
