# スマホ1台で取り込める競合の機能（2026-10-12 調べ）

スマホアプリ・時計・体に付ける機器が、走りのフォームや質について持っている機能を洗い出し、
「無料版（スマホ1台を腰のベルト、またはベスト・胸に付ける）で取り込めるか」で分けた。

- 今の無料版で測れるもの：ピッチ・上下動・着地のブレーキ・（ベスト・胸なら）上体の前傾
- 確かめ方：公式の説明ページ・ストアのページ・レビュー記事・研究論文。どの機器も実際には使っていない
- 「未確認」と書いたものは、調べたが出典で確かめられなかったこと。推測では埋めていない

## 1. 機能の一覧

凡例 ― 時期：**最中**＝走っている最中に見せる・知らせる、**後**＝走った後に見る。
取り込み：**○**＝できる、**△**＝条件付き、**×**＝できない（理由は「2. 取り込めるかの理由」）。

### 1-1. リズム（ピッチ・歩幅）

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| ピッチの表示 | Apple Watch、Garmin、COROS、Pixel Watch、StrideCoach、Runmetrix、Stryd ほかほぼ全部 | 最中・後 | 手首／胸ベルト／腰／足／耳 | 画面 | ○（済） |
| ピッチが範囲を外れたら知らせる | Apple Watch（ワークアウトの通知）、Garmin（Alerts の Cadence）、COROS（Cadence Alert） | 最中 | 手首 | 画面＋音・振動（数字だけ） | ○ |
| メトロノームで目標のピッチを刻む | Runo、Cadence Coach、運動メトロノーム、TrailMix | 最中 | スマホ（測らないものもある） | 音 | ○ |
| 音楽のテンポを足に合わせる／決めたテンポで流す | Weav Run（100〜240歩/分）、RockMyRun、TrailMix | 最中 | スマホ | 音楽 | △ |
| 歩幅 | Apple Watch、Garmin、COROS、Pixel Watch、Runmetrix（身長比も）、NURVV、ORPHE | 最中・後 | 手首／胸／腰／足 | 画面 | △（速さが要る） |
| ペースに合わせたピッチと歩幅の目標（Pace Coach） | NURVV Run | 最中 | 中敷き | 声・画面・振動 | △ |

### 1-2. 弾み（上下動）

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| 上下動（cm） | Apple Watch、Garmin（手首・HRM-Pro・HRM 600）、COROS POD 2（腰）、Pixel Watch、Samsung、Suunto Race 2（後のみ）、Amazfit、Wahoo TICKR X（胸）、Stryd、Runmetrix（身長比も） | 最中・後 | 手首／胸／腰／足 | 画面 | ○（済） |
| 弾み（bounce）を声で直す | Lumo Run（販売終了）、StrideCoach（「上下動を抑えましょう」） | 最中 | 腰／耳 | 声・チャイム | ○（済） |
| 上下動比（上下動÷歩幅） | Garmin、Pixel Watch、COROS（Stride Ratio：優 6%未満〜悪 12%超）、Huawei | 最中・後 | 手首／胸／腰 | 画面・色 | △（速さが要る） |

### 1-3. 接地（時間・左右）

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| 接地時間（ms） | Apple Watch、Garmin、COROS、Pixel Watch、Samsung、Suunto Race 2（後）、Amazfit、Stryd、Runmetrix（接地時間率も）、StrideCoach、Huawei S-TAG | 最中・後 | 手首／胸／腰／足／耳 | 画面 | △ |
| 滞空時間 | Samsung（flight time）、RunScribe（Flight Ratio） | 後 | 手首／足 | 画面 | △ |
| 接地時間の左右バランス | Garmin（HRM-Pro・HRM 600 などの付属品が要る）、COROS POD 2、Huawei、StrideCoach（左右バランス）、Stryd Duo（2個）、ORPHE | 最中・後 | 胸／腰／足／耳 | 画面 | △ |
| 左右差（非対称）・規則性 | Samsung（asymmetry・regularity）、StrideCoach（ランニング安定性） | 後（Samsung）／最中（StrideCoach） | 手首／耳 | 画面・声 | ○（規則性）／△（左右） |
| 代償動作（けが明けの、かばう走り）を声で知らせる | StrideCoach | 最中 | 耳（AirPods） | 声 | △ |

### 1-4. 着地（ブレーキ・衝撃・足の向き）

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| 着地のブレーキ | Lumo Run（braking）、Runmetrix（減速量）、Garmin（Step Speed Loss と、その速さ比。**HRM 600 だけ**）、RunScribe（Braking Gs） | 最中・後 | 腰／胸／足 | 画面・声（Lumo） | ○（済） |
| 着地の衝撃 | Runmetrix（着地衝撃）、StrideCoach（衝撃）、RunScribe（Impact Gs）、Stryd（Impact Loading Rate、体重/秒） | 最中・後 | 腰／耳／足 | 画面・声 | △ |
| 横方向の衝撃 | Runmetrix | 後 | 腰 | 画面 | △ |
| 着地法（かかと・前足部）・プロネーション | NURVV（Footstrike Trainer で最中に表示）、ORPHE TRACK、RunScribe、Huawei S-TAG（足）、Stryd Footpath | 最中・後 | 足・中敷き・靴 | 画面・声（ORPHE） | × |

### 1-5. 骨盤・体幹・頭

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| 骨盤の回旋（と回旋のタイミング） | Lumo Run、Runmetrix | 最中（Lumo）・後 | 腰 | 声（Lumo）・画面 | △ |
| 骨盤の左右の傾き（pelvic drop） | Lumo Run、Runmetrix | 最中（Lumo）・後 | 腰 | 声（Lumo）・画面 | △ |
| 腰の沈み込み・骨盤の引き上げ | Runmetrix | 後 | 腰 | 画面 | △ |
| 体幹の後傾 | Runmetrix | 後 | 腰 | 画面 | △ |
| 上体の前傾 | （時計・腰のセンサーでは見当たらない） | ― | ― | ― | ○（胸なら・済） |
| 頭の角度 | StrideCoach | 最中 | 耳 | 声 | × |
| 腕振り | （手首の時計でも、フォームとして出すものは見当たらない） | ― | ― | ― | × |

### 1-6. バネ・パワー・効率・負荷

| 機能 | 競合 | 時期 | 機器と付ける場所 | 知らせ方 | 取り込み |
|---|---|---|---|---|---|
| 脚のバネ（stiffness） | Stryd（Leg Spring Stiffness）、Samsung（stiffness）、Runmetrix | 最中・後 | 足／手首／腰 | 画面 | △ |
| 蹴り出しの時間・加速度 | Runmetrix | 後 | 腰 | 画面 | △ |
| ランニングパワー | Apple Watch、Garmin（Forerunner 265・965 以降は手首だけで）、COROS、Polar（手首）、Stryd、Suunto・Amazfit（Stryd 経由） | 最中・後 | 手首／足 | 画面・範囲の通知・Stryd は声も（Apple Watch） | △ |
| Form Power（上下や横に使う分） | Stryd | 最中・後 | 足 | 画面 | △ |
| Running Economy（効率の点数） | Garmin（Forerunner 970 ＋ HRM 600） | 後 | 手首＋胸 | 画面 | × |
| 走りの滑らかさの点数（ピッチ・上下動・接地をまとめる） | Wahoo TICKR X（Running Smoothness） | 最中・後 | 胸 | 画面 | ○ |
| フォームの総合点・レーダー図 | Runmetrix（6分野＋総合）、StrideCoach（総合フォームスコア） | 最中（StrideCoach）・後 | 腰／耳 | 画面 | ○ |
| 走りの負荷の許容量（Running Tolerance・Impact Load） | Garmin（Forerunner 970） | 後 | 手首 | 画面 | △ |
| 走力の指数（RAI・Effort Pace） | Huawei（心拍と速さ）、COROS（坂の補正） | 後・最中 | 手首 | 画面 | × |

### 1-7. 走っている最中の知らせ方・コーチのしかた

| 機能 | 競合 | 機器 | 中身 | 取り込み |
|---|---|---|---|---|
| フォームを声で直す | StrideCoach（例「ストライドを少し短く」「ケイデンス維持、いい感じです」）、Lumo Run、ORPHE TRACK（ペースと着地）、NURVV | AirPods／腰／靴／中敷き | 直し方を言葉で言う | ○（済） |
| 良い・悪いのチャイム、音のオン・オフ | Lumo Run | 腰＋スマホ＋イヤホン | 目標の内側か外側かを音で | ○ |
| 1回に1項目、少しずつの目標（5%ずつ） | Lumo Run | 腰 | 走り始めを基準に、1項目ずつ5%の改善を狙う | ○（考え方は済） |
| 範囲を外れたら数字で知らせる | Apple Watch（ペース・パワー・ピッチ・心拍）、Garmin、COROS | 手首 | 画面＋音・振動。直し方は言わない | ○ |
| 区切りごとの音声（ペース・心拍・距離） | Runkeeper（ピッチは対象外）、Apple Watch の Workout Buddy（AI の声。フォームには触れない） | スマホ／手首＋イヤホン | 決めた時間・距離ごと | ○ |
| 付け方がおかしいと知らせる | Huawei（付けた位置と動きが合わないと、1回の走りで1回警告） | 腰・足のセンサー | 警告して、その記録に印を付ける | ○ |

### 1-8. 走った後

| 機能 | 競合 | 中身 | 取り込み |
|---|---|---|---|
| 一般の目安と比べた色の評価 | Garmin（色のゲージ）、COROS（Stride Ratio の5段階） | 人と比べる | ○（ただし方針と合わない） |
| フォームのテスト（決まった手順で測る） | COROS（Running Form Test、腰に付けるのが条件） | 定期的な健康診断 | ○ |
| 改善プログラム・補強の提案 | Runmetrix（直近90日から課題と目標、3Dの動き、ストレッチと筋トレ）、Lumo Run（補強の運動） | 次に何をやるか | ○ |
| 疲れでフォームが崩れ始めたところ | Stryd（Footpath で疲れの始まりを見る）、COROS（Stride Ratio の上がり方） | 崩れ始めの時刻 | ○（済） |
| 足の軌跡の3D・シューズの比べ | Stryd Footpath、Run Form & Shoe Analytics | 靴ごとの違い | × |
| レベル判定と練習計画 | Samsung Running Coach（12分走って10段階）、Runna、Garmin | 計画 | 範囲外 |

### 見つからなかったもの

- **Nike Run Club・Runkeeper・Strava・Runna**：フォームを測る機能は見つからなかった（Runkeeper の音声はペース・距離・心拍で、ピッチは対象外）。
- **Polar**：手首のランニングパワーはあるが、上下動・接地時間などのフォームの指標は見つからなかった（Stryd をつなげば出る）。
- **Ochy**：撮った動画の解析だけで、走っている最中のモードや声は見つからなかった。
- **Samsung Running Coach** の「最中の助言」はペースと励ましで、フォームの助言かは確かめられなかった。

## 2. 取り込めるかの理由

### できる（○）

- **ピッチの範囲・メトロノーム・規則性・滑らかさの点数・総合点**：どれも腰の加速度の歩ごとの山から出せる。今のピッチの延長。
- **付け方の確認**：重力の向きで、スマホが立っているか・前後どちら向きかが分かる。歩の山の左右の交互さで、ベルトが横にずれているかも見当が付く。Huawei が同じ警告を出している。
- **フォームのテスト・補強の提案・崩れ始め**：測るものは今と同じで、見せ方と中身の追加。

### 条件付き（△）

| 機能 | 何があれば | 気をつけること |
|---|---|---|
| 歩幅・上下動比・ペース別の目標・パワー | GPS の速さ（スマホに GPS はある。トレッドミルでは使えない） | 歩幅＝速さ÷ピッチ なので、GPS の揺れがそのまま入る。パワーは体重と坂も要り、Garmin と Stryd でも数字が合わない（[gneta.app](https://www.gneta.app/blog/garmin-running-power-zones-2026)）。フォームを直す言葉にはつながりにくい |
| 接地時間・滞空時間 | ベルトがきつく締まって揺れないこと。サンプリングが十分に速いこと | 仙骨（腰の後ろ）の IMU で接地・滞空時間を出す研究はある（[Patoz ほか 2022](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8838733/)、誤差の数字は本文を読めず未確認）。腰のスマホの歩行の研究では、かかとの着地の時刻は良く合う（r=0.97〜0.98）が、つま先の離れる時刻まで要る区間は r=0.47〜0.70 に落ちる（[UMH](https://dspace.umh.es/handle/11000/32930?locale=en)。検索の要約で見た数字で、本文は読んでいない）。走りでスマホから接地時間を確かめた研究は見つからなかった。**仮想実験と実機の記録で確かめるまで、声はかけない** |
| 左右バランス・左右差・代償動作 | 腰の真ん中（背中側か前側）に固定。どちらの足の歩かを決める手がかり（骨盤の回る向きをジャイロで見る） | Garmin も手首ではこの指標を出さず、胸か付属品を要求している。左右を取り違えると逆のことを言う。歩ごとの差は小さいので、声より走った後の傾向に向く |
| 着地の衝撃・横方向の衝撃・脚のバネ・蹴り出し | 固定のきついベルト。走り始めの自分と比べる | ベルトのゆるみで山がつぶれる。足のセンサー（RunScribe）でも衝撃・ブレーキの値は実験室と合いにくかった（[Keele の検証](https://keele-repository.worktribe.com/output/424363)）。決まった線では判定しない |
| 骨盤の回旋・左右の傾き・沈み込み・体幹の後傾 | スマホを腰の後ろの真ん中に、ずれないように付ける（Lumo・Runmetrix と同じ場所） | ベルトの中でスマホが回るとそのまま「骨盤が回った」に見える。3個の仙骨センサー（RunScribe Sacral Gait Lab）は、上下動・前後傾・左右傾・回旋のどれもモーションキャプチャとの基準に届かなかった（[Ruiz-Malagón ほか 2023](https://digibug.ugr.es/handle/10481/81531)）。ベルトの前やポケットでは無理 |
| 音楽のテンポ合わせ | 音楽サービスとの連携 | 曲の権利と連携の手間。メトロノームで足りる |
| 負荷の許容量 | 毎回の衝撃の記録を数週間ためる | 走った後の情報で、声かけとは別の機能 |

### できない（×）

| 機能 | 理由 |
|---|---|
| 着地法・プロネーション・足の軌跡・シューズの比べ | 足の向きは腰から見えない。足・中敷き・靴のセンサーが要る（NURVV・ORPHE・RunScribe・Stryd はどれも足） |
| 頭の角度 | 頭の動きが要る（StrideCoach は AirPods）。胸のスマホでも首から上は見えない |
| 腕振り | 手首の動きが要る |
| Running Economy・RAI・Effort Pace | 心拍が要る。スマホ1台には心拍計がない（時計や胸ベルトをつなげば別） |

## 3. 取り込む価値が高い順の提案

選び方：ランナーにとっての意味 × 正確に測れる見込み ÷ 外れた声のリスク。
「外れた声は信頼を失う」ので、測れる見込みが低いものは声ではなく走った後に回すか、入れない。

### 1. 付け方の確認（走り始めと走っている最中）

- **意味**：無料版のすべての数字の前提。腰のベルトのずれ・向きの違い・ゆるみで、上下動とブレーキが変わる。
- **測れる見込み**：高い。重力の向きと、歩の山の形で分かる。
- **外れた声のリスク**：低い。外れても「付け方を確かめて」で済み、フォームを誤って直させない。
- **競合**：Huawei が「付けた位置と動きが合わない」と1回だけ警告し、その記録に印を付けている。この印の付け方もそのまま使える（印の付いた走りは結果の比較から外す）。

### 2. ピッチを上げる声＋外れたときだけのメトロノーム

- **意味**：ピッチを5〜10%上げると、上下動・ブレーキ・歩幅がそろって小さくなり、膝と股関節の負担が下がる（[Heiderscheit ほか 2011](https://pubmed.ncbi.nlm.nih.gov/20581720/)、45人のトレッドミル）。1つの声で、今測っている3項目（ピッチ・上下動・ブレーキ）がまとめて良くなる。
- **測れる見込み**：一番高い。腰の加速度で歩を数えるのは確か。
- **外れた声のリスク**：低い。ただし決まった数字（180など）は使わず、走り始めの自分のピッチ＋5%を目標にする。
- **競合との差**：Apple Watch・Garmin・COROS は範囲を外れると数字と振動で知らせるだけ。メトロノームのアプリは測らないものが多い。「崩れたときだけ数拍だけ刻み、戻ったら止める」は見当たらなかった。

### 3. 規則性（リズムの乱れ）を疲れの合図として使う

- **意味**：疲れると、体幹の加速度の前後の規則性が下がり、横と前後の揺れが増える（[Schütte ほか 2015](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4627812/)、20人、トレッドミル）。単一の体幹センサーの記録は、のちのすねのけがとも関係していた（[Aristizábal Pla ほか 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8588413)）。「崩れ始めた時刻」の手がかりを増やせる。
- **測れる見込み**：中〜高。自己相関で出せ、腰のスマホでも同じ量が取れる。ただし研究はトレッドミルで、外の路面でどこまで通じるかは研究側も「分からない」としている。
- **外れた声のリスク**：中。直し方を言いにくい（「リズムが乱れています」では何をすればいいか分からない）ので、**声ではなく走った後の「崩れ始め」と、次の声の時刻（いつも崩れる少し前）に使う**。
- **競合**：Samsung が走った後に regularity を出している。声で使っているものは見当たらなかった。

### 4. フォームのテスト（決まった手順で測る日）

- **意味**：毎回の走りは道・ペースがばらばらで、比べにくい。COROS の Running Form Test のように「平らな道を一定のペースで数分」を決めると、月ごとの変化が見える。
- **測れる見込み**：高い（条件をそろえるので）。
- **外れた声のリスク**：なし（声をかけない）。
- **注意**：COROS の手順の中身（距離・時間・ペース）は確かめられなかった。

### 5. 着地の衝撃（走り始めの自分と比べて増えたら）

- **意味**：けが（すねの疲労骨折など）を気にする人に分かりやすい。StrideCoach・Runmetrix・Stryd が出している。
- **測れる見込み**：中〜低。ベルトのゆるみで値が変わる。足のセンサーでも実験室と合いにくかった。
- **外れた声のリスク**：中。**まず走った後のグラフだけ**にし、実機の記録で走り始めとの差が安定して出ると確かめてから、声の候補にする。直す言葉は「静かに着地」で、ブレーキの声と重なる。

### 6. 左右差（走った後の傾向として）

- **意味**：けが明けの人や、片側だけ痛む人には大きい。StrideCoach は「代償動作」を声で知らせている。
- **測れる見込み**：低〜中。左右の取り違えと、ベルトの横ずれでの見かけの差が怖い。Garmin も手首では出していない。
- **外れた声のリスク**：高い。**声にはしない**。走った後に「左右の差が先週より大きい」程度の傾向だけ見せる案。

### 7. 骨盤の回旋・左右の傾き（腰の後ろに付けた人だけ）

- **意味**：Lumo Run が腰のセンサーで声をかけていた項目。ランナー膝や腸脛靭帯の痛みと結び付けて語られることが多い（ここでは研究を確かめていない）。
- **測れる見込み**：低い。専用の仙骨センサーでも基準に届かなかった。スマホはベルトの中で回る。
- **外れた声のリスク**：高い。**今は入れない**。センサー版（別売り）や、後ろの真ん中に固定できるベルトでの実機の記録があってから考える。Lumo Run が販売終了していることも、腰のセンサーだけでの声かけが続かなかった前例として見ておく。

### 入れないもの

- 歩幅・上下動比・パワー：GPS 頼みで、直す言葉につながらない。時計がすでに出している。
- 色の評価（人と比べる）：「走り始めの自分と比べる」方針と合わない。
- 着地法・頭・腕振り・効率の点数：スマホ1台では測れない。正直に「カメラやセンサーで見られる」と見せる側に入れる。

## 4. 同じ考えの試作

- [Form Coach](https://github.com/HW006-J/run)（GitHub、ハッカソンの試作）：スマホを手か腕のバンドに付け、ピッチ・弾み・左右差を測り、AirPods かスマホの声で1つずつ直す。崩れが8秒続いたら声、声の間は20秒以上、問題なければ黙る。AirPods なら頭の揺れも見る。作者自身が「線はすべて仮の値」と書いている。製品ではない。

## 5. 確かめられなかったこと

- Garmin Running Dynamics Pod を付ける場所（腰の後ろか）と、手首だけのときに出ない指標の正確な一覧（「手首は5つ」とは書いてある。左右バランスは付属品が要るように読めるが、明記は見ていない）。
- Garmin の色のゲージの区切り（何%ずつか）。
- Apple Watch の通知に、上下動・接地時間などのフォームの指標が使えるか（ペース・パワー・ピッチ・心拍は使える）。
- Runmetrix が走っている最中に声で助言するか（スマートウォッチの画面表示と、G-SHOCK でのフォームのずれの通知は記事にある。2021年ごろの記事）。センサーを付ける場所の公式の記載（記事では「腰」）。
- COROS POD 2 の腰と足で出る指標の正確な分け方と、Running Form Test の手順。公式サポートのページは読めなかった（403）。
- Lumo Run の各指標の定義・料金の詳細（2016年ごろの記事のみ。主なレビューは読めなかった）。
- NURVV Run・RunScribe の今の販売状況と料金（RunScribe Plus は 2017年に $250 という古い記事だけ）。
- Stryd・HRM-Pro Plus・HRM 600 の今の料金。
- Samsung Running Coach の「最中の助言」がフォームに触れるか。
- Amazfit の上下動・接地時間が走っている最中に見えるか。
- Huawei の手首だけでのフォームの指標（S-TAG などの付属品の説明しか確かめていない）。
- 仙骨の IMU で接地・滞空時間を出す研究（Patoz ほか 2022）の誤差の数字（本文を開けなかった）。
- 腰のスマホで、走っているときの接地時間を確かめた研究（見つからなかった）。

## 出典

時計・機器
- Apple Watch：[ユーザガイド（ワークアウトの表示）](https://support.apple.com/guide/watch/apd1f24d4d35/watchos)、[ユーザガイド（フォームの指標、watchOS 9）](https://support.apple.com/guide/watch/apd2a367064b/9.0/watchos/9.0)、[ワークアウトのストアのページ（通知の種類）](https://apps.apple.com/app/workout/id1584215851)、[DC Rainmaker：Workout Buddy](https://www.dcrainmaker.com/2025/07/apple-watchos-26-workout-beta-real-world.html)
- Garmin：[Running Dynamics（Forerunner 955 の説明書）](https://www8.garmin.com/manuals-apac/webhelp/forerunner955/EN-SG/GUID-16B503BA-936C-4A24-A8F2-9E3C07B49647-9193.html)、[HRM 600 の Running Dynamics（Step Speed Loss）](https://www8.garmin.com/manuals-apac/webhelp/hrm600/EN-SG/GUID-FDEA8064-4823-4745-996F-26D02D1AA612-8431.html)、[Activity Alerts（Cadence）](https://www8.garmin.com/manuals-apac/webhelp/forerunner165series/EN-SG/GUID-4643EFD8-62B6-43C8-941D-81CE31F6E2F1-2545.html)、[Forerunner 970 の新機能（Notebookcheck）](https://www.notebookcheck.net/Garmin-shares-more-details-about-new-running-features-for-Forerunner-970.1019463.0.html)、[the5krunner：HRM 600](https://the5krunner.com/2025/05/15/garmin-hrm-600-everything-you-need-to-know)、[手首のパワー（Forerunner 265・965）](https://events.triathlon.de/en/blogs/journal/neu-garmin-fr-965-265)
- COROS：[POD 2 Advanced Running Metrics](https://support.coros.com/hc/en-us/articles/45569234539540-POD-2-Advanced-Running-Metrics-Explained)、[POD 2 ガイド](https://coros.com/stories/coros-coaches/c/pod-2-guide)、[Running Dynamics の説明](https://coros.com/au/stories/coros-metrics/c/running-dynamics)、[Activity Alerts](https://support.coros.com/hc/en-us/articles/5232707375252)
- Polar：[Stryd との連携](https://support.polar.com/hk-en/polar-vantage-m-vantage-v-with-stryd-running-power-meter)、[Vantage V3 の手首のパワー（mezha）](https://mezha.ua/en/2023/10/12/a-new-smartwatch-for-600-polar-vantage-v3-has-been-announced/)
- Suunto：[Race 2 に上下動・接地時間（Notebookcheck）](https://www.notebookcheck.net/Suunto-adds-two-new-running-metrics-to-smartwatches-in-update.1161455.0.html)、[SuuntoPlus の Stryd（the5krunner）](https://the5krunner.com/2024/02/21/suunto-gets-advanced-stryd-running-dynamics-metrics-more)
- Amazfit：[Active 2・Bip 6 のフォームの指標](https://gadgetsandwearables.com/2025/10/20/amazfit-active-2-running-form-metrics/)、[Stryd との連携](https://help.stryd.com/en/articles/12702410-getting-started-with-amazfit-and-stryd)
- Huawei：[Running form monitoring](https://consumer.huawei.com/en/support/content/en-us15907640)、[RAI](https://consumer.huawei.com/uk/support/content/en-gb15886692)
- Samsung：[Galaxy Watch8 の Running Coach](https://news.samsung.com/global/galaxy-unpacked-2025-a-first-look-at-the-galaxy-watch8-series-streamlining-sleep-exercise-and-everything-in-between)、[Android Authority：advanced running metrics](https://www.androidauthority.com/samsung-advanced-running-metrics-3479928)
- Google Pixel Watch：[ランの指標（Google ヘルプ）](https://support.google.com/fitbit/answer/15400594?hl=en-GB)
- Wahoo TICKR X：[Running Smoothness（Wareable）](https://www.wareable.com/running/new-wahoo-tickr-x-7965)
- Stryd：[Impact Loading Rate などの解説](https://help.stryd.com/en/articles/9927525-understanding-and-using-stryd-s-run-form-shoe-analytics)、[Footpath と疲れ](https://blog.stryd.com/2024/10/08/a-closer-look-stryd-footpath-available-on-next-gen-stryd/)、[Duo の左右バランス](https://blog.stryd.com/2023/12/01/update-stryd-duo-balance-metrics-now-available-in-powercenter/)、[Suunto 向けの指標](https://blog.stryd.com/2024/02/20/suunto-update-2024/)
- RunScribe：[the5krunner：RunScribe Plus](https://the5krunner.com/2017/08/14/new-runscribe-plus-running-with-power-just-got-a-whole-lot-more-interesting/)、[Keele の検証](https://keele-repository.worktribe.com/output/424363)
- Runmetrix：[アプリの説明（公式）](https://runmetrix.casio.com/jp/application/)、[スマートウォッチ対応（Impress）](https://www.watch.impress.co.jp/docs/news/1334968.html)
- Lumo Run：[Active.com](https://www.active.com/running/articles/this-clip-on-wearable-wants-to-be-your-running-coach)、[Techlicious](https://www.techlicious.com/review/review-of-lumo-run/)、[販売開始のお知らせ](https://www.cyclizing.com/blog/lumo-bodytech-launches-general-availability-of-lumo-run-wearable-to-improve-running-form-and-performance)
- NURVV Run：[発表（Business Wire）](https://www.businesswire.com/news/home/20200206005997/en)、[iMore のレビュー](https://www.imore.com/nurvv-run-review)
- ORPHE TRACK：[スマートウォッチライフ](https://www.smartwatchlife.jp/11443)

アプリ
- StrideCoach：[App Store](https://apps.apple.com/jp/app/id6746169274)
- Runkeeper：[音声のキュー](https://runkeeper.com/cms/app/audio-cues-in-the-runkeeper-app/)
- Runna：[2026年の更新（endurance.biz）](https://endurance.biz/2026/industry-news/runna-updates-beginner-and-return-to-running-training-plans/)
- Ochy：[App Store](https://apps.apple.com/us/app/-/id1531481638)
- メトロノーム・音楽：[Weav Run](https://appfollow.io/ios/weav-run-1-running-music/1128018936?country=us)、[TrailMix Pro](https://apps.apple.com/app/id479650960)、[Cadence Coach](https://apps.apple.com/lc/app/cadence-coach-jogging-help/id1673143770)、[運動メトロノーム](https://apps.apple.com/jp/app/%E9%81%8B%E5%8B%95%E3%83%A1%E3%83%88%E3%83%AD%E3%83%8E%E3%83%BC%E3%83%A0/id6503328170)、[Runo](https://feedbagel.com/post/runo-a-metronome-app-for-runners-to-improve-pace-and-cadence)
- Form Coach：[GitHub](https://github.com/HW006-J/run)

研究
- [Heiderscheit ほか 2011：ピッチを上げると膝・股関節の負担が下がる](https://pubmed.ncbi.nlm.nih.gov/20581720/)
- [Schütte ほか 2015：体幹の加速度で疲れによる変化が分かる](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4627812/)
- [Aristizábal Pla ほか 2021：体幹のセンサー1個とすねのけが](https://pmc.ncbi.nlm.nih.gov/articles/PMC8588413)
- [Patoz ほか 2022：仙骨の IMU 1個で接地・滞空時間](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8838733/)
- [Ruiz-Malagón ほか 2023：仙骨のセンサーでの骨盤の動きの検証](https://digibug.ugr.es/handle/10481/81531)
- [腰のスマホでの歩行の着地・離地の検出（UMH）](https://dspace.umh.es/handle/11000/32930?locale=en)
