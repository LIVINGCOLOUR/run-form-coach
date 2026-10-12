# スマホ版の測り方と声かけ：研究の材料

腰（ランニングベルト）・胸（ベスト）に付けた慣性センサー（スマホを含む）で走りを測る研究と、走っている最中の声・音での声かけの研究をまとめる。
今の測り方（`run-form-coach-phone/src/modes/phone/signal.ts`・`params.ts`）と比べて、直すべきところを出す。

- DOI はすべて Crossref（`api.crossref.org/works`）で実在を確かめ、数字は PubMed の要旨（一部は Europe PMC の本文）から取った。
- 「本文で確かめていない」「見つからなかった」ものは、そう書いた（最後の節にまとめた）。
- 調べた日：2026-10-12

---

## 0. 先に結論

**直すべき測り方（上から順に大事）**

1. **速さで割り戻さずに比べている。** ピッチ・上下動・ブレーキは、どれも走る速さで変わる。いまは速さを見ずに走り始めの自分と比べているので、ペースを落とした・上り坂に入っただけで「崩れ」の声が出る。GPS の速さを使って「同じくらいの速さのときの自分」と比べるか、速さが基準から外れているときは判定を止める。
2. **ブレーキの測り方は、研究で確かめられた方法ではない。** 腰の前後の加速度を積分する考え方は力学的には正しい（前後の速さの落ち込み＝体重あたりのブレーキの力積）。ただし、腰のセンサーだけでこれを測って力の板と比べた研究は見つからなかった。いちばん近い研究（Baker 2025）は、骨盤1個から機械学習で前後の力を出していて、誤差は体重の 6.4%（本人のデータで調整すると 3.0%）だった。加えて、1歩の中で骨盤が前後に傾くと、重力が前後の軸に漏れ込む。ジャイロ（Core Motion の姿勢）で1コマごとに向きを直すか、実機で確かめるまでは、ブレーキで単独の声をかけない。
3. **声かけの線の根拠が「下げたとき」ではなく「上げたとき」の研究である。** Heiderscheit 2011 で負担がはっきり増えたのは、ピッチを **10% 下げた**とき。5% 上げると膝の負担が減ったが、「5% 下がったら崩れ」は直接の根拠ではない。線（5%）は測れる差（約 2.5 歩/分）よりは十分大きいので測り方としては使えるが、「この線を越えたら体に悪い」とは言えない。
4. **走り始めの基準区間（30〜180秒）が早すぎるかもしれない。** 走り始めの数分はまだ体が温まらず走りが落ち着かない。マラソン中の変化を腰のセンサーで見た Clermont 2019 は、4〜14km を「いつもの走り」としていた。
5. **新しく足せる項目は「接地時間（有効接地時間）」だけ。** 上下の加速度が重力（1g）を上回っている時間を数えるだけの方法で、誤差は 22ms 以下（Patoz 2021）。左右差・着地の衝撃（負荷率）・ランニングパワーは、腰のスマホで測れるという根拠がない（2章）。

**声かけのおすすめ**

- ピッチはメトロノームの音で導く。目標は自分のピッチの +5〜10%（Willy 2016 は +7.5% で外を走りながら直し、30日後も保てた。Bramah 2019 は +10% を1回教えただけで3か月後も保てた）。
- 同じ言葉を何度も言うより、**音を変えて知らせる**ほうが研究の形に近い。外れたときだけ音楽に雑音をかぶせる（Van den Berghe 2022、すねの衝撃 −25.5%）、メトロノームのテンポを気づかないくらい（1〜3%）ずつ上げる（Van Dyck 2015）。
- 知らせる回数は、だんだん減らす。効果が1か月〜1年続いた研究は、どれも8回（2週間）の練習の後半4回で知らせを減らしていた（Crowell 2011、Bowser 2018）。
- 上下動とブレーキの声は「小刻みに」「静かに走る」にまとめられる。ピッチを上げるとブレーキの力積も上下動も減る（Anderson 2022 のメタ分析、Napier 2019）。上下動を減らす合図は着地の衝撃を減らすが、ブレーキは減らさない（Adams 2018）。
- 「たとえの言葉」には、効くものと効かないものがある。「静かに走って」は着地の衝撃と負荷率を下げた（Phan 2017）。一方で、着地の足の角度という特定の形を変えるには、体に向けた言葉（内的な焦点）のほうが効いた（Moore 2019）。

---

## 1. 測り方：項目ごと

### 1-1. ピッチ（ケイデンス）

**おすすめの測り方**：今のやり方（腰の上下の加速度の自己相関で1歩の周期を出し、1歩ずつの切れ目の間隔の平均にする）でよい。研究の標準（Moe-Nilssen & Helbostad 2004）どおり。

- スマホの置き場所によっては、自己相関の「1歩」と「2歩（1周期）」の山の大きさが入れ替わる。van Oeveren 2018 は 10 か所の置き場所で比べ、山が本当に2歩かを確かめる手順（シルベスターの判定）を足すと、ふつうの自己相関 87.3±13.5% に対して 98.9±0.2% が正しく数えられた。今のコードは探す範囲を 120〜240 歩/分 に絞っているので2歩の山を拾うことはないが、胸ポケット・片側に寄ったベルトなど、左右で揺れが違う置き方では1歩の山が弱くなる。実機で `regularity` が低く出る置き方がないか確かめる。
- ピッチは速さで変わり、速さとピッチの関係は人によって違う（van Oeveren 2019）。だから「同じ速さのときの自分」と比べる。

**精度**

| 置き場所 | 基準と比べた誤差 | 出典 |
|---|---|---|
| 腰（腰椎） | 平均の差 −3.45 歩/分（95%信頼区間 −16.28〜9.39）。くり返したときのばらつき（CV）4.4% 未満 | Horsley 2021（メタ分析） |
| 胸のストラップ（Garmin） | ICC 0.931、測れる最小の変化（MDC95）2.53 歩/分 | Adams 2016 |
| 腰の慣性センサー | 歩・1周期の長さの一致 ±0.02 秒 | Lee 2010 |

出典
- Moe-Nilssen R, Helbostad JL. Estimation of gait cycle characteristics by trunk accelerometry. *J Biomech* 2004;37:121-126. doi:10.1016/s0021-9290(03)00233-1
- van Oeveren BT, de Ruiter CJ, Beek PJ, Rispens SM, van Dieën JH. An adaptive, real-time cadence algorithm for unconstrained sensor placement. *Med Eng Phys* 2018;52:49-58. doi:10.1016/j.medengphy.2017.12.007
- van Oeveren BT, de Ruiter CJ, Hoozemans MJM, Beek PJ, van Dieën JH. Inter-individual differences in stride frequencies during running obtained from wearable data. *J Sports Sci* 2019;37:1996-2006. doi:10.1080/02640414.2019.1614137
- Horsley BJ, Tofari PJ, Halson SL, et al. Does Site Matter? Impact of Inertial Measurement Unit Placement on the Validity and Reliability of Stride Variables During Running: A Systematic Review and Meta-analysis. *Sports Med* 2021;51:1449-1489. doi:10.1007/s40279-021-01443-8
- Adams D, Pozzi F, Carroll A, Rombach A, Zeni J. Validity and Reliability of a Commercial Fitness Watch for Measuring Running Dynamics. *J Orthop Sports Phys Ther* 2016;46:471-476. doi:10.2519/jospt.2016.6391
- Lee JB, Mellifont RB, Burkett BJ. The use of a single inertial sensor to identify stride, step, and stance durations of running gait. *J Sci Med Sport* 2010;13:270-273. doi:10.1016/j.jsams.2009.01.005

### 1-2. 接地と離地のタイミング、接地時間・滞空時間

**おすすめの測り方**：**有効接地時間**（Patoz 2021）。

- 腰の上下の加速度（重力を含む、上向きを正）が 1g を上回っている間を「有効接地」、下回っている間を「有効滞空」とする。上下の加速度が 1g を上回る＝地面から体重より大きい力を受けている、という力学そのものなので、決めごとが少ない。
- 足が地面に触れている本当の接地時間とは別物で、本当の接地時間より短く出る。比べるのは自分の走り始めとの差だけにする。
- 腰で本当の接地・離地を見分ける方法もある（Lee 2010 の方法：骨盤の前後の加速度の山で着地を見る。Benson 2019 がこれを自動化して、トレッドミル・トラック・芝・歩道で確かめた）。ただし誤差は大きめ。

**精度**

| 方法 | 誤差 | 出典 |
|---|---|---|
| 有効接地・有効滞空（仙骨の上下の加速度） | 100人、時速 9・11・13km。二乗平均誤差 22ms 以下（14% 以下）、かたより 20ms 以下 | Patoz 2021 |
| 上の値を線形回帰で補正（速さ・ピッチ・体重を足す） | 接地時間・滞空時間・接地の割合の誤差が、補正前よりはっきり小さくなった。線形回帰で十分（ニューラルネットと差がない） | Patoz 2023 |
| 腰の加速度で着地・離地（Benson 2019 の自動化版） | 着地は力の板より約 50ms 遅く、離地は約 20〜30ms 遅く出る→接地時間は短く出る。95% 一致限界の幅は 着地 58ms・離地 78ms。サンプリング 50/100/200Hz でほとんど差がない | Benson 2019 |
| 腰（Lee の方法）、11人・1歩ずつ | 着地 6±5ms、離地 20±8ms（絶対値の平均） | Mo & Chow 2018 |
| 腰椎、メタ分析 | 平均の差 −48.74ms（95%信頼区間 −120.33〜22.85） | Horsley 2021 |
| 胴体（胸）の加速度計 | 接地時間は速いほど合う（かたより 6ms 未満） | Watari 2016 |
| 腰の市販品（SPEEDSIG） | ICC 0.83（妥当性）、0.91（再現性） | Weber 2024 |
| 仙骨、フィルタの影響 | 接地時間は 5Hz のローパスがいちばん合う（r=0.656） | Day 2021 |

- 疲れると接地時間・滞空時間は長くなる傾向（Apte 2021 のまとめ）。
- 接地時間を短くすること自体が良いとは言えない。接地の割合が大きい人と小さい人で、走りの効率に差はなかった（Lussiana 2019）。**接地時間は声かけの項目にせず、疲れの見分けに使う材料にとどめる**のがよい。

出典
- Patoz A, Lussiana T, Breine B, Gindre C, Malatesta D. Estimating effective contact and flight times using a sacral-mounted inertial measurement unit. *J Biomech* 2021;127:110667. doi:10.1016/j.jbiomech.2021.110667
- Patoz A, Lussiana T, Breine B, Gindre C, Malatesta D. Comparison of different machine learning models to enhance sacral acceleration-based estimations of running stride temporal variables and peak vertical ground reaction force. *Sports Biomech* 2025;24:825-841（オンライン 2023）. doi:10.1080/14763141.2022.2159870
- Benson LC, Clermont CA, Watari R, Exley T, Ferber R. Automated Accelerometer-Based Gait Event Detection During Multiple Running Conditions. *Sensors* 2019;19:1483. doi:10.3390/s19071483
- Mo S, Chow DHK. Accuracy of three methods in gait event detection during overground running. *Gait Posture* 2018;59:93-98. doi:10.1016/j.gaitpost.2017.10.009
- Watari R, Hettinga B, Osis S, Ferber R. Validation of a Torso-Mounted Accelerometer for Measures of Vertical Oscillation and Ground Contact Time During Treadmill Running. *J Appl Biomech* 2016;32:306-310. doi:10.1123/jab.2015-0200
- Weber JA, Hart NH, Rantalainen T, Connick M, Newton RU. Assessment of Ground Contact Time in the Field: Evaluation of Validity and Reliability. *J Strength Cond Res* 2024;38:e34-e39. doi:10.1519/JSC.0000000000004682
- Day EM, Alcantara RS, McGeehan MA, Grabowski AM, Hahn ME. Low-pass filter cutoff frequency affects sacral-mounted inertial measurement unit estimations of peak vertical ground reaction force and contact time during treadmill running. *J Biomech* 2021;119:110323. doi:10.1016/j.jbiomech.2021.110323
- Lussiana T, Patoz A, Gindre C, Mourot L, Hébert-Losier K. The implications of time on the ground on running economy: less is not always better. *J Exp Biol* 2019;222:jeb192047. doi:10.1242/jeb.192047

### 1-3. 上下動と上下動比

**おすすめの測り方**：今のやり方（上下の加速度を1歩ずつ切って、平均を引いて2回積分）でよい。Zijlstra & Hof 2003 の考え方で、Gullstrand 2009 が走りで確かめている。

- 腰の1点の上下動は、体全体の重心の上下動と、かたよりで 0〜1.5mm しか違わない。1人の中のばらつきは約 7mm。加速度計は速くなるほどばらつく（Gullstrand 2009）。
- 胴体の加速度計は、胴体の上下動としては正確（一致度 0.97 超）。ただし重心の上下動（力の板から計算したもの）より 16〜18mm 大きく出る（Watari 2016）。
- 市販の機械どうしでも値がそろわない（胸のストラップは大きめ、足のものは小さめに出る。すべて再現性は高い：ICC 0.948 以上）（Smith 2022）。→ **他の人や他の機械の値と比べず、自分の走り始めとだけ比べる**今の方針は研究と合っている。
- 上下動は速さとピッチで変わる。ピッチを 5.7% 上げると、重心の上下動は 7.7cm → 6.9cm に減った（Wang 2020）。
- **上下動比（vertical ratio＝上下動÷歩幅）**：Garmin などの機械が出している値だが、査読つきの研究で、けがや効率との関係を確かめたものは見つからなかった。速さの影響を減らす割り算として使うのは筋が通るが、根拠のある線はない。
- 走りの効率との関係：接地中の骨盤の上下動（身長で割ったもの）は、ほかの2つの項目と合わせて、走りのエネルギーの使い方のばらつきの 39% を説明した（Folland 2017）。
- 疲れとの関係：疲れると重心の上下動が増えるのは初心者だけで、慣れたランナーでは増えなかった（Zandbergen 2023 のメタ分析）。

**精度**：測れる最小の変化（MDC95）0.45cm（胸のストラップ、Adams 2016）。今の線（+2cm で声）はこれより十分大きい。ただし、ベルトのスマホでのばらつきは測られていない。

出典
- Zijlstra W, Hof AL. Assessment of spatio-temporal gait parameters from trunk accelerations during human walking. *Gait Posture* 2003;18:1-10. doi:10.1016/s0966-6362(02)00190-x
- Gullstrand L, Halvorsen K, Tinmark F, Eriksson M, Nilsson J. Measurements of vertical displacement in running, a methodological comparison. *Gait Posture* 2009;30:71-75. doi:10.1016/j.gaitpost.2009.03.001
- Smith CP, Fullerton E, Walton L, Funnell E, Pantazis D, Lugo H. The validity and reliability of wearable devices for the measurement of vertical oscillation for running. *PLoS One* 2022;17:e0277810. doi:10.1371/journal.pone.0277810（著者は比べた機械の1つ INCUS NOVA の会社の社員）
- Wang J, Luo Z, Dai B, Fu W. Effects of 12-week cadence retraining on impact peak, load rates and lower extremity biomechanics in running. *PeerJ* 2020;8:e9813. doi:10.7717/peerj.9813
- Folland JP, Allen SJ, Black MI, Handsaker JC, Forrester SE. Running Technique is an Important Component of Running Economy and Performance. *Med Sci Sports Exerc* 2017;49:1412-1423. doi:10.1249/MSS.0000000000001245
- Zandbergen MA, Marotta L, Bulthuis R, Buurke JH, Veltink PH, Reenalda J. Effects of level running-induced fatigue on running kinematics: A systematic review and meta-analysis. *Gait Posture* 2023;99:60-75. doi:10.1016/j.gaitpost.2022.09.089

### 1-4. 歩幅と速さ

**おすすめの測り方**：歩幅＝速さ ÷（ピッチ/60）。速さはスマホの GPS から。

- 腰のセンサーだけで歩幅を出す方法は、メタ分析にできるほどの研究がなかった（Horsley 2021 で歩幅をまとめられたのは足に付けた場合だけ）。
- スマホの GPS の速さは、そのままだとゆれが大きい。低い周波数だけを通すフィルタで、距離の誤差を 70%、インターバル走での速さの誤差を最大 80% 減らせた（Biernacki 2023、基準は高精度の GNSS 受信機）。
- **速さはこのアプリで一番足りていない材料**。ピッチ・上下動・ブレーキのどれも速さで変わるので、「崩れ」と「ペースを落としただけ」を分けるのに要る（3章）。

出典
- Biernacki P. Software Correction of Speed Measurement Determined by Phone GNSS Modules in Applications for Runners. *Sensors* 2023;23:2678. doi:10.3390/s23052678
- Gløersen Ø, Kocbach J, Gilgien M. Tracking Performance in Endurance Racing Sports: Evaluation of the Accuracy Offered by Three Commercial GNSS Receivers Aimed at the Sports Market. *Front Physiol* 2018;9:1425. doi:10.3389/fphys.2018.01425（スポーツ用 GNSS の精度。要旨の数字は確かめていない）

### 1-5. 左右差（接地時間のバランス）

**おすすめ**：**腰のスマホでは出さない。**

- 腰の加速度で、その1歩が右足か左足かを見分けると、1942歩のうち 322〜377歩（17〜19%）を取り違えた（Benson 2019）。これでは左右差は測れない。
- 有効接地時間から「着地と蹴り出しの非対称」を出す方法は、かたよりを引けば **集団の平均としては** 正しく出たが、1人ずつでは保証されていない（Patoz 2021）。
- ジャイロ（骨盤の回り方）を使えば左右の見分けは良くなるかもしれないが、それを確かめた研究は見つけていない。

### 1-6. 着地の衝撃と負荷率

**おすすめ**：**腰のスマホでは負荷率を出さない。** 上下の力の山（体重の何倍か）なら、ある程度出せる。

- 腰の上下の加速度×体重で出した力の山は、力の板との相関が r=0.638（10Hz のローパスのとき）。中くらいの一致にとどまる（Day 2021）。
- 速さ・ピッチ・体重も入れた回帰にすると、力の山の誤差は約 4%（二乗平均誤差 0.139 体重倍）、接地時間は 3.5%（Alcantara 2021、仙骨、37人、トレッドミル、秒速 3.8〜5.4m）。
- 負荷率（着地の直後の力の立ち上がりの速さ）を腰から出して確かめた研究は見つからなかった。負荷率はすねのセンサーで測るのが研究の主流（Crowell 2011、Van den Berghe 2022）。
- そもそも、地面からの力の値は、すねの骨にかかる負担とあまり連動しない（多くの人で r<0.8、Matijevich 2019）。力の値を「骨の負担」として伝えるのは避ける。
- 負荷率とけがの関係：前向きの研究で、けがをした女性ランナーは上下の衝撃の負荷率が高かった（Davis 2016）。けがの種類によって関係の強さが違う（Johnson 2020）。

出典
- Alcantara RS, Day EM, Hahn ME, Grabowski AM. Sacral acceleration can predict whole-body kinetics and stride kinematics across running speeds. *PeerJ* 2021;9:e11199. doi:10.7717/peerj.11199
- Matijevich ES, Branscombe LM, Scott LR, Zelik KE. Ground reaction force metrics are not strongly correlated with tibial bone load when running across speeds and slopes: Implications for science, sport and wearable tech. *PLoS One* 2019;14:e0210000. doi:10.1371/journal.pone.0210000
- Davis IS, Bowser BJ, Mullineaux DR. Greater vertical impact loading in female runners with medically diagnosed injuries: a prospective investigation. *Br J Sports Med* 2016;50:887-892. doi:10.1136/bjsports-2015-094579
- Johnson CD, Tenforde AS, Outerleys J, Reilly J, Davis IS. Impact-Related Ground Reaction Forces Are More Strongly Associated With Some Running Injuries Than Others. *Am J Sports Med* 2020;48:3072-3080. doi:10.1177/0363546520950731

### 1-7. ブレーキ（前後の減速）

**今のやり方**：前後の加速度を1歩ずつ1回積分し、速さの振れ幅（m/s）を出す。一定の速さなら、これは体重あたりのブレーキの力積と同じもの（力積 ÷ 体重 ＝ 速さの変化）。

**研究から言えること**

- ブレーキはけがと関係がある。女性の市民ランナー65人を15週追うと、地面からの力の項目の中で、けがを予測したのは**ブレーキの力の山だけ**だった。いちばん大きい3分の1（体重の 0.27 倍より大きい）の人は、真ん中の3分の1より 5.08 倍、いちばん小さい3分の1より 7.98 倍けがをしやすかった（Napier 2018）。
- ただし、腰の加速度の積分でブレーキの力積を出して、力の板と比べた研究は**見つからなかった**。
- いちばん近い研究（Baker 2025）：骨盤・太もも・すね・足の慣性センサーから、機械学習で前後の力の波形を出した。**骨盤だけ**だと、トレッドミルで学ばせた共通のモデルで二乗平均誤差 体重の 6.42±0.93%、本人の8歩分のデータで調整すると 3.02±0.54%。4か所すべて使うと 4.40% → 2.41%。外を走ったときも、調整したモデルのほうが「速いほどブレーキの力積が大きい」というあるべき関係に合った。
- ブレーキは速さで大きくなる（Baker 2025）。下り坂でも大きくなるはず（研究で数字は確かめていない）。
- ピッチを上げると、ブレーキの力積は減る（Anderson 2022 のメタ分析：限られた根拠、効果量 0.64）。ブレーキを知らせて直してもらうと、ランナーは自分でピッチを 7% 上げ、歩幅を 6% 縮め、ブレーキの力の山が 15% 減った（Napier 2019）。

**腰のスマホでの問題（力学から。数字は確かめていない）**

- 走っている間、骨盤は1歩ごとに前後に傾く。今のコードは数歩の平均の向きを「上」に決めて固定しているので、骨盤が θ だけ傾くと、重力 × sinθ（1° で約 0.17 m/s²）が前後の軸に漏れ込む。この漏れは1歩の周期でくり返すので、速さの振れ幅にそのまま足される。骨盤の前後の傾きの幅（数度）を考えると無視できない大きさになりうる。
- ベルトの中でスマホが揺れると、さらに混ざる。

出典
- Napier C, MacLean CL, Maurer J, Taunton JE, Hunt MA. Kinetic risk factors of running-related injuries in female recreational runners. *Scand J Med Sci Sports* 2018;28:2164-2172. doi:10.1111/sms.13228
- Baker LM, Weigend FC, Swaminathan K, Kim D, Chin A, Lieberman DE, Walsh CJ. Estimating braking and propulsion forces during overground running in and out of the lab. *PLoS One* 2025;20:e0330042. doi:10.1371/journal.pone.0330042
- Baker LM, Yawar A, Lieberman DE, Walsh CJ. Predicting overstriding with wearable IMUs during treadmill and overground running. *Sci Rep* 2024;14:6347. doi:10.1038/s41598-024-56888-4（脚の角度から足の着き過ぎを出し、ブレーキの力の山のばらつきの 80〜88% を説明。脚のセンサーが要る）
- Anderson LM, Martin JF, Barton CJ, Bonanno DR. What is the Effect of Changing Running Step Rate on Injury, Performance and Biomechanics? A Systematic Review and Meta-analysis. *Sports Med Open* 2022;8:112. doi:10.1186/s40798-022-00504-0
- Napier C, MacLean CL, Maurer J, Taunton JE, Hunt MA. Real-Time Biofeedback of Performance to Reduce Braking Forces Associated With Running-Related Injury: An Exploratory Study. *J Orthop Sports Phys Ther* 2019;49:136-144. doi:10.2519/jospt.2019.8587

### 1-8. 上体の前傾（ベスト・胸）

**今のやり方**：立って止まったときの重力の向きと、走っているときの数歩の平均の重力の向きの差。考え方は研究のふつうのやり方（加速度を重力の向きにそろえる：Moe-Nilssen 1998）と同じ。

- 疲れると体幹は前に曲がる傾向（Apte 2021 のまとめ）。**疲れのサインとしては使える。**
- ただし、前傾が増えること自体は悪いとは限らない。体幹を前に傾けて走ると、膝のお皿の関節の負担はむしろ**下がった**（自然な前傾 7.3°、前傾 14.1°、起こした 4.0°。前傾で負担が減り、起こすと増えた：Teng & Powers 2014）。
- 胸のスマホの前傾と、カメラで見る体幹の角度を比べた研究は見つからなかった。
- 一定の速さで走っていれば、数歩の平均の加速度は重力だけになる。速さが変わっている間（加速・減速）は、その分だけ傾きが混ざる（0.1 m/s² の加速で約 0.6°。力学からの計算）。

出典
- Moe-Nilssen R. A new method for evaluating motor control in gait under real-life environmental conditions. Part 1: The instrument. *Clin Biomech* 1998;13:320-327. doi:10.1016/s0268-0033(98)00089-8
- Apte S, Prigent G, Stöggl T, et al. Biomechanical Response of the Lower Extremity to Running-Induced Acute Fatigue: A Systematic Review. *Front Physiol* 2021;12:646042. doi:10.3389/fphys.2021.646042
- Teng HL, Powers CM. Sagittal Plane Trunk Posture Influences Patellofemoral Joint Stress During Running. *J Orthop Sports Phys Ther* 2014;44:785-792. doi:10.2519/jospt.2014.5249
- Teng HL, Powers CM. Influence of Trunk Posture on Lower Extremity Energetics during Running. *Med Sci Sports Exerc* 2015;47:625-630. doi:10.1249/MSS.0000000000000436（要旨は確かめていない）

### 1-9. 疲れによる変化の見分け

**おすすめ**：項目を1つずつ線と比べるのに加えて、**いくつかの項目をまとめた「いつもと違う度合い」**を自分の基準区間と比べる。

- Clermont 2019：腰に付けるセンサーで、ピッチ・ブレーキ・上下動・骨盤の回り・骨盤の落ち・接地時間を、マラソンの間ずっと測った（27人）。4〜14km を「いつもの走り」として、2km ごとに「いつもと違う度合い」をまとめた値を出すと、20〜22km から高くなった。走力の高い人ほど崩れが小さかった。**「その人の走り始めと比べる」という製品の方針とそのまま合う研究。**
- 疲れの出方は人によって大きく違うので、集団の平均より1人ずつで見るべき（Zandbergen 2023）。
- 腰の加速度で疲れを見る指標（追加の計算はわずか）：疲れると、前後と左右の揺れの割合（3方向の揺れの強さの比）が増え、前後の揺れの1歩ごとのそろい方（自己相関）が下がり、前後の揺れが読みにくくなる（Schütte 2015、20人、トレッドミル）。200人ほどを6か月追った研究では、走り始めの状態で、上下の揺れの割合が大きく前後の割合が小さい人が、すねの使いすぎのけがをしやすかった（Aristizábal Pla 2021）。
- 機械学習：8か所のセンサーでは疲れの3段階を 90.5% 当てた。1か所ならすねがいちばんで 76.1%。骨盤だけの数字は論文に書かれていなかった（Marotta 2021、8人、トラック）。腕時計の値（接地時間・ピッチ・歩幅・上下動・心拍）から、きつさの感じ（ボルグの尺度）を、他人のデータだけで学ばせると誤差 1.8 点、本人のデータを 10% 入れると 0.66 点で当てた（Pirscoveanu 2024）。→ **本人のデータで調整すると大きく良くなる**というのは、ブレーキ（Baker 2025）でも同じ。

出典
- Clermont CA, Benson LC, Edwards WB, Hettinga BA, Ferber R. New Considerations for Wearable Technology Data: Changes in Running Biomechanics During a Marathon. *J Appl Biomech* 2019;35:401-409. doi:10.1123/jab.2018-0453
- Schütte KH, Maas EA, Exadaktylos V, Berckmans D, Venter RE, Vanwanseele B. Wireless Tri-Axial Trunk Accelerometry Detects Deviations in Dynamic Center of Mass Motion Due to Running-Induced Fatigue. *PLoS One* 2015;10:e0141957. doi:10.1371/journal.pone.0141957
- Aristizábal Pla G, Hollville E, Schütte K, Vanwanseele B. The Use of a Single Trunk-Mounted Accelerometer to Detect Changes in Center of Mass Motion Linked to Lower-Leg Overuse Injuries: A Prospective Study. *Sensors* 2021;21:7385. doi:10.3390/s21217385
- Marotta L, Buurke JH, van Beijnum BJF, Reenalda J. Towards Machine Learning-Based Detection of Running-Induced Fatigue in Real-World Scenarios: Evaluation of IMU Sensor Configurations to Reduce Intrusiveness. *Sensors* 2021;21:3451. doi:10.3390/s21103451
- Pirscoveanu CI, Oliveira AS. Prediction of instantaneous perceived effort during outdoor running using accelerometry and machine learning. *Eur J Appl Physiol* 2024;124:963-973. doi:10.1007/s00421-023-05322-0
- Reenalda J, Maartens E, Homan L, Buurke JHJ. Continuous three dimensional analysis of running mechanics during a marathon by means of inertial magnetic measurement units to objectify changes in running mechanics. *J Biomech* 2016;49:3362-3367. doi:10.1016/j.jbiomech.2016.08.032

### 1-10. ランニングパワー

**おすすめ**：**出さない。**

- 市販の5つを比べると、くり返しても同じ値が出て酸素の使い方とも合ったのは、足に付ける Stryd だけ（ばらつき 4.3% 以下、酸素摂取量と r≥0.911）。胸のストラップ（Garmin）などは、くり返したときのばらつきが大きかった（Cerezuela-Espejo 2021）。
- Stryd でも、パワーの値そのものは小さく出る（Imbach 2020）。
- 腰のスマホで出したパワーを確かめた研究は見つからなかった。

出典
- Cerezuela-Espejo V, Hernández-Belmonte A, Courel-Ibáñez J, Conesa-Ros E, Mora-Rodríguez R, Pallarés JG. Are we ready to measure running power? Repeatability and concurrent validity of five commercial technologies. *Eur J Sport Sci* 2021;21:341-350. doi:10.1080/17461391.2020.1748117
- Imbach F, Candau R, Chailan R, Perrey S. Validity of the Stryd Power Meter in Measuring Running Parameters at Submaximal Speeds. *Sports* 2020;8:103. doi:10.3390/sports8070103

### 1-11. スマホならではの問題

- **スマホそのものでの研究がほとんどない。** 走りを腰・ベルトのスマホで測って基準の機械と比べた研究は、見つけられなかった。スマホでの研究はほとんどが歩き。研究は専用のセンサー（仙骨にテープで留める）で行われていて、ベルトの中で揺れるスマホより条件が良い。研究の精度は「上限」として読む。
- **研究の多くは室内のトレッドミル。** 231本のうち 72% が室内で、67% は1歩〜200m 未満しか見ていない（Benson 2022）。131本のまとめでも、多くが室内・トレッドミル（Mason 2023）。
- **取れる回数**：着地・離地の見分けは 50・100・200Hz でほとんど差がなかった（Benson 2019）。今の 50Hz に並べ直すやり方で足りる。力の山を見るなら、ローパスは 10Hz、接地時間なら 5Hz が合った（Day 2021）。
- **向き**：研究では、平均の重力の向きに合わせて上下・前後・左右に回す（Moe-Nilssen 1998、Benson 2019）。今のコードも同じ考え方。前後と左右は、1歩ごとの揺れの強さで分けている（これを確かめた研究はない）。前後の向き（前か後ろか）を決める今の仮定は、実機で確かめていない。
- **ジャイロ**：1コマごとに向きを直すとブレーキの漏れ込みが減るはず（1-7）。Core Motion が出す重力の向き（センサーを組み合わせて出したもの）が、走っている激しい動きの中でどれくらい正しいかは、確かめた研究を見つけていない。
- **置き場所ごとの違い**：機械どうしで値がそろわないこと（Smith 2022）、置き場所で精度が変わること（Horsley 2021）からも、決まった線より自分の基準と比べるほうがよい。

出典
- Benson LC, Räisänen AM, Clermont CA, Ferber R. Is This the Real Life, or Is This Just Laboratory? A Scoping Review of IMU-Based Running Gait Analysis. *Sensors* 2022;22:1722. doi:10.3390/s22051722
- Mason R, Pearson LT, Barry G, et al. Wearables for Running Gait Analysis: A Systematic Review. *Sports Med* 2023;53:241-268. doi:10.1007/s40279-022-01760-6

---

## 2. 今の測り方（signal.ts）と比べて直すところ

| # | 場所 | 今 | 直すこと | 根拠 |
|---|---|---|---|---|
| 1 | `analyzer.ts` の比べ方 | 速さを見ずに、走り始めの自分と比べる | GPS の速さ（低い周波数だけ通したもの）を取り、基準の速さから ±x% を外れた秒は判定しない。または速さごとの基準を持つ。x は実機で決める | ピッチ・上下動・ブレーキは速さで変わる（van Oeveren 2019、Baker 2025、Wang 2020） |
| 2 | `signal.ts` 5（ブレーキ） | 数歩の平均の向きで前後を固定し、前後の加速度を積分 | (a) ジャイロ／Core Motion の姿勢で1コマごとに向きを直して比べる。(b) 確かめるまでは、ブレーキ単独で声をかけず、ピッチの声とまとめる（ピッチを上げるとブレーキは減る）。(c) 下り坂では止める（気圧計の高さの変化で見分ける案。研究の根拠はない） | 腰だけで確かめた研究がない。骨盤だけの機械学習でも誤差 体重の 6.4%（Baker 2025） |
| 3 | `params.ts` の `PHONE_LIMITS.cadence` の説明 | 「5% 上げると負担が減った → 5% 下がったら声」 | 説明を正しくする。負担がはっきり増えたのは 10% 下げたとき。5% はけがの線ではなく「自分の走りが変わった」線と書く | Heiderscheit 2011 |
| 4 | `HIP_REF = 30〜180秒` | 走り始め 2.5 分の平均を基準 | 基準をもっと後ろに（例：走り始め 5〜15 分）。または最初は仮の基準で、あとから置き換える。短いランで基準ができない問題と天秤にかける | Clermont 2019 は 4〜14km を基準 |
| 5 | 新しい項目 | なし | 有効接地時間（上下の加速度＞1g の時間）と接地の割合を、記録と疲れの見分けに使う。声かけの項目にはしない | Patoz 2021、Lussiana 2019 |
| 6 | 新しい項目 | 上下の自己相関（`regularity`）だけ | 前後の自己相関と、3方向の揺れの割合も出して、疲れの「いつもと違う度合い」に使う | Schütte 2015、Clermont 2019、Aristizábal Pla 2021 |
| 7 | 上体の前傾の声 | 前傾が増えたら「崩れ」 | 「疲れのサイン」として扱う。前傾そのものは膝の負担をむしろ減らすので、「体を起こして」という声の根拠は弱い | Teng & Powers 2014、Apte 2021 |
| 8 | 上下動の線 | +2cm（根拠なし） | 研究の線はない。速さで割る（上下動比）と速さの影響を減らせるが、上下動比にも根拠のある線はない。測れる最小の変化（0.45cm、胸のストラップ）よりは大きいので、測り方としては使える | Adams 2016、Wang 2020 |
| 9 | ピッチ | 自己相関 + 1歩ずつの切れ目 | このままでよい。置き場所で1歩の山が弱くなる場合の確かめを足す | Moe-Nilssen 2004、van Oeveren 2018 |
| 10 | 上下動 | 1歩ずつ2回積分 | このままでよい（研究どおり）。値は重心の上下動より大きめに出るので、自分の基準との差だけを使う今の方針を続ける | Gullstrand 2009、Watari 2016 |

足さないもの：左右差（1-5）、負荷率（1-6）、ランニングパワー（1-10）。

---

## 3. 線の根拠

### ピッチ

| 研究 | 何をしたか | 結果 |
|---|---|---|
| Heiderscheit 2011（45人、トレッドミル、同じ速さ） | ピッチを ±5%・±10% | +5%・+10% で膝の吸収エネルギーが減った。+10% で股関節も減った。**−10% で全部の関節の吸収エネルギーがはっきり増えた**。ピッチを上げると歩幅・重心の上下動・ブレーキの力積も減った |
| Lenhart 2014（30人） | 90・100・110% | 110% で膝のお皿の関節の力の山が 14% 減った |
| Anderson 2022（メタ分析、37本） | ピッチを上げる・下げる | 上げると膝の曲がり（強い根拠）、歩幅・股関節の内転・膝の伸ばす力（中くらいの根拠）、ブレーキの力積・膝のお皿の関節の負担（限られた根拠）が減る。下げると接地時間・ブレーキの力積が増える（限られた根拠）。上げるときつく感じ、ぎこちなく感じる |
| Doyle 2022（ランダム化試験のメタ分析） | ピッチを直す練習 | ピッチが上がり、平均の負荷率が下がった（中くらいの確かさ） |

- 「何%上げると負担が減るか」：**+5% から効き始め、+10% でより広く効く**というのが研究のまとまった姿。けがを減らしたかを確かめた研究は少ない（Anderson 2022 では膝の前の痛みの2本だけ）。
- 「何%下がったら崩れか」：**下げる向きで負担が増えるとはっきり示されたのは −10%**。−5% の効果は Heiderscheit 2011 の要旨には書かれていない（本文で確かめていない）。
- 測れる最小の変化は約 2.5 歩/分（Adams 2016）。170 歩/分の人の 5% は 8.5 歩/分なので、線としては測れる大きさ。

### 上下動・接地時間・ブレーキ

- **上下動**：けがの線はない。上下動を減らすように言うと、負荷率と力の山が減った（Adams 2018）。効率との関係はある（Folland 2017）。
- **接地時間**：けがの線も効率の線もない。短いほど良いとは言えない（Lussiana 2019）。
- **ブレーキ**：力の山が体重の 0.27 倍を超える人はけがが多い（Napier 2018）。ただしこれは力の板の値で、スマホで出した「速さの落ち込み」とは単位も精度も違う。つなげるには、トレッドミル（力の板つき）か、最低でもカメラで確かめる必要がある。

出典（この章だけのもの）
- Heiderscheit BC, Chumanov ES, Michalski MP, Wille CM, Ryan MB. Effects of Step Rate Manipulation on Joint Mechanics during Running. *Med Sci Sports Exerc* 2011;43:296-302. doi:10.1249/MSS.0b013e3181ebedf4
- Lenhart RL, Thelen DG, Wille CM, Chumanov ES, Heiderscheit BC. Increasing Running Step Rate Reduces Patellofemoral Joint Forces. *Med Sci Sports Exerc* 2014;46:557-564. doi:10.1249/MSS.0b013e3182a78c3a
- Doyle E, Doyle TLA, Bonacci J, Fuller JT. The Effectiveness of Gait Retraining on Running Kinematics, Kinetics, Performance, Pain, and Injury in Distance Runners: A Systematic Review With Meta-analysis. *J Orthop Sports Phys Ther* 2022;52:192-206. doi:10.2519/jospt.2022.10585
- Adams D, Pozzi F, Willy RW, Carrol A, Zeni J. Altering cadence or vertical oscillation during running: effects on running related injury factors. *Int J Sports Phys Ther* 2018;13:633-642. doi:10.26603/ijspt20180633
- Schubert AG, Kempf J, Heiderscheit BC. Influence of Stride Frequency and Length on Running Mechanics: A Systematic Review. *Sports Health* 2014;6:210-217. doi:10.1177/1941738113508544（要旨は確かめていない）
- Moore IS. Is There an Economical Running Technique? A Review of Modifiable Biomechanical Factors Affecting Running Economy. *Sports Med* 2016;46:793-807. doi:10.1007/s40279-016-0474-4（要旨は確かめていない）

---

## 4. 声かけの効果

### 4-1. 何が効いたか

| 研究 | 何を・どう知らせたか | 効いた大きさ | 続いたか |
|---|---|---|---|
| Willy 2016（30人、ランダム化） | 加速度計で測ったピッチを、外を走りながら知らせる。目標 +7.5%、8回 | ピッチ +8.6%、瞬間の負荷率 −17.9%、1歩あたりの膝の負担 −26.9% | 30日後も保てた。外で走るときもほとんどの人が目標を守れた |
| Bramah 2019（膝の前の痛み12人） | メトロノームで +10% を1回だけ。あとは GPS 時計とメトロノームで自分で確かめる | 骨盤の落ち −3.1°、股関節の内転 −4.0°、痛み・機能が良くなった | 3か月後も保てた |
| Wang 2020（24人、ランダム化） | +7.5% を12週 | 実際は +5.7%。着地の力の山 1.86→1.67 体重倍、平均の負荷率 91.6→77.3 | ― |
| Napier 2019（女性12人） | ブレーキの力をその場で見せる。8回 | ブレーキの力の山 −15%（ピッチ +7%、歩幅 −6% で自然に） | 練習の終わりには自分の走りになっていた |
| Adams 2018（20人） | 「ピッチを上げて」「上下動を減らして」 | どちらも負荷率が下がった。力の山は上下動のほうがよく下がった。ブレーキの力積を減らしたのはピッチだけ | ― |
| Eriksson 2011（18人） | 上下動とピッチを見せる・音で知らせる（目標つき） | ほとんどの人がその場で合わせられた | ― |
| Crowell 2011（10人） | すねの衝撃を見せる。8回、後半で減らす | すねの衝撃 約 −50%、負荷率 約 −30%、力の山 約 −20% | 1か月後も保てた |
| Bowser 2018（19人） | すねの衝撃を見せる。8回（2週間）、最後の4回で知らせを減らす | すねの衝撃 −32%、負荷率 −25〜27% | **1年後も**保てた |
| Chan 2018（320人、ランダム化） | 2週間、着地の衝撃を見せる | 1年間のけがが 16% 対 38%（けがの危険 62% 減） | 1年 |
| Van den Berghe 2022（20人） | 音楽を流し、すねの衝撃が基準の 70% 以上のときだけ雑音をかぶせる。だんだん減らす。外のトラックで | すねの衝撃 −25.5%、ピッチは変わらず | ― |
| Tate & Milner 2017（14人） | 足音の大きさを見せて「静かに」 | 着地の力の山 1.56→1.13 体重倍、負荷率 −34〜36% | ― |
| Phan 2017（男性26人） | 「静かに走って」と言うだけ | 力の山・負荷率が下がった。かかとから着く人が 85%→23% に減った | ― |
| Van Hooren 2024（220人、ランダム化） | インソールで測った値を走りながら知らせる | 実際に知らせを受けた人どうしで比べると、けがの危険 0.53 倍。ただし 33% の人が設定を間違えて知らせを受けていなかった | ― |

まとめの研究：Agresta & Brown 2015、Van Hooren 2020（知らせ方のまとめ）、Doyle 2022（メタ分析）。

### 4-2. 知らせ方のおすすめ

1. **ピッチはメトロノーム（音）で。** 言葉で「ピッチを上げて」より、目標のテンポを鳴らすほうが、研究で効いた形に近い（Bramah 2019、Willy 2016）。目標は自分の +5〜10%。外でも続けられた（Willy 2016）。
2. **気づかないくらいずつテンポを動かす。** 音楽のテンポを 1〜3% ずらすだけで、ランナーは気づかずにピッチを合わせた（Van Dyck 2015）。ふつうの人が気づくテンポの違いは約 4%。合わせる力は女性のほうが強かった。言葉なしでピッチを戻す方法になる。
3. **外れたときだけ知らせ、外れた度合いを音で表す。** 基準からの外れが線を越えたときだけ音を濁らせる（Van den Berghe 2022）。「外れた」ことだけを伝え、言葉を何度も言わない。製品の「声なしで保てた時間」と同じ考え方。
4. **だんだん減らす。** 効果が続いた研究は、どれも練習の後半で知らせを減らしていた（Crowell 2011、Bowser 2018）。知らせが多すぎると知らせに頼ってしまい、知らせがなくなると戻る、という運動学習の研究（Winstein & Schmidt 1990）と合う。具体的には「8回（2週間）で、後半の4回は知らせの割合を減らす」が研究でいちばん多い形。
5. **その場の知らせと、走った後のまとめを組み合わせる。** 何がいちばん効くかは項目と人で違い、組み合わせるのがいちばん効く（Van Hooren 2020）。
6. **1つに絞る。** 「ピッチを上げる」だけで、ブレーキ・上下動・負荷率がまとめて下がる（Anderson 2022、Napier 2019、Adams 2018）。スマホ版では、ブレーキと上下動の声をピッチの声にまとめるのが、研究からも、外れた声を減らす意味でも筋がよい。
7. **言葉の選び方。**
   - 「静かに走って」（音のたとえ）は負荷率を下げる（Phan 2017、Tate & Milner 2017）。
   - 体の外に注意を向けると、走りの効率が良かった（Schücker 2009、Wulf 2013 のまとめ）。
   - ただし、特定の形（着地の足の角度）を変えるには、体に向けた言葉のほうが効き、外に向けた言葉では変わらなかった。どの言葉でもきつさの感じは増えた（Moore 2019）。→ 「たとえで言う」方針は効率や衝撃には合うが、決まった形を直したいときは、体の部位を言うほうが効くこともある。
8. **設定を簡単に。** 大きなランダム化試験でも、3人に1人が設定を間違えて知らせを受けていなかった（Van Hooren 2024）。

出典（この章だけのもの）
- Willy RW, Buchenic L, Rogacki K, Ackerman J, Schmidt A, Willson JD. In-field gait retraining and mobile monitoring to address running biomechanics associated with tibial stress fracture. *Scand J Med Sci Sports* 2016;26:197-205. doi:10.1111/sms.12413
- Bramah C, Preece SJ, Gill N, Herrington L. A 10% Increase in Step Rate Improves Running Kinematics and Clinical Outcomes in Runners With Patellofemoral Pain at 4 Weeks and 3 Months. *Am J Sports Med* 2019;47:3406-3413. doi:10.1177/0363546519879693
- Eriksson M, Halvorsen KA, Gullstrand L. Immediate effect of visual and auditory feedback to control the running mechanics of well-trained athletes. *J Sports Sci* 2011;29:253-262. doi:10.1080/02640414.2010.523088
- Crowell HP, Davis IS. Gait retraining to reduce lower extremity loading in runners. *Clin Biomech* 2011;26:78-83. doi:10.1016/j.clinbiomech.2010.09.003
- Bowser BJ, Fellin R, Milner CE, Pohl MB, Davis IS. Reducing Impact Loading in Runners: A One-Year Follow-up. *Med Sci Sports Exerc* 2018;50:2500-2506. doi:10.1249/MSS.0000000000001710
- Chan ZYS, Zhang JH, Au IPH, et al. Gait Retraining for the Reduction of Injury Occurrence in Novice Distance Runners: 1-Year Follow-up of a Randomized Controlled Trial. *Am J Sports Med* 2018;46:388-395. doi:10.1177/0363546517736277
- Van den Berghe P, Derie R, Bauwens P, et al. Reducing the peak tibial acceleration of running by music-based biofeedback: A quasi-randomized controlled trial. *Scand J Med Sci Sports* 2022;32:698-709. doi:10.1111/sms.14123
- Tate JJ, Milner CE. Sound-Intensity Feedback During Running Reduces Loading Rates and Impact Peak. *J Orthop Sports Phys Ther* 2017;47:565-569. doi:10.2519/jospt.2017.7275
- Phan X, Grisbrook TL, Wernli K, Stearne SM, Davey P, Ng L. Running quietly reduces ground reaction force and vertical loading rate and alters foot strike technique. *J Sports Sci* 2017;35:1636-1642. doi:10.1080/02640414.2016.1227466
- Van Hooren B, Plasqui G, Meijer K. The Effect of Wearable-Based Real-Time Feedback on Running Injuries and Running Performance: A Randomized Controlled Trial. *Am J Sports Med* 2024;52:750-765. doi:10.1177/03635465231222464
- Van Hooren B, Goudsmit J, Restrepo J, Vos S. Real-time feedback by wearables in running: Current approaches, challenges and suggestions for improvements. *J Sports Sci* 2020;38:214-230. doi:10.1080/02640414.2019.1690960
- Agresta C, Brown A. Gait Retraining for Injured and Healthy Runners Using Augmented Feedback: A Systematic Literature Review. *J Orthop Sports Phys Ther* 2015;45:576-584. doi:10.2519/jospt.2015.5823
- Van Dyck E, Moens B, Buhmann J, et al. Spontaneous Entrainment of Running Cadence to Music Tempo. *Sports Med Open* 2015;1:15. doi:10.1186/s40798-015-0025-9
- Bood RJ, Nijssen M, van der Kamp J, Roerdink M. The Power of Auditory-Motor Synchronization in Sports: Enhancing Running Performance by Coupling Cadence with the Right Beats. *PLoS One* 2013;8:e70758. doi:10.1371/journal.pone.0070758（要旨は確かめていない）
- Winstein CJ, Schmidt RA. Reduced frequency of knowledge of results enhances motor skill learning. *J Exp Psychol Learn Mem Cogn* 1990;16:677-691. doi:10.1037/0278-7393.16.4.677（走りの研究ではない）
- Wulf G. Attentional focus and motor learning: a review of 15 years. *Int Rev Sport Exerc Psychol* 2013;6:77-104. doi:10.1080/1750984X.2012.723728
- Schücker L, Hagemann N, Strauss B, Völker K. The effect of attentional focus on running economy. *J Sports Sci* 2009;27:1241-1248. doi:10.1080/02640410903150467
- Moore IS, Phillips DJ, Ashford KJ, Mullen R, Goom T, Gittoes MRJ. An interdisciplinary examination of attentional focus strategies used during running gait retraining. *Scand J Med Sci Sports* 2019;29:1572-1582. doi:10.1111/sms.13490
- Davis IS, Futrell E. Gait Retraining: Altering the Fingerprint of Gait. *Phys Med Rehabil Clin N Am* 2016;27:339-355. doi:10.1016/j.pmr.2015.09.002（要旨は確かめていない）
- Willy RW. Innovations and pitfalls in the use of wearable devices in the prevention and rehabilitation of running related injuries. *Phys Ther Sport* 2018;29:26-33. doi:10.1016/j.ptsp.2017.10.003（要旨は確かめていない）

---

## 5. 確かめられなかったこと

推測で埋めず、ここに残す。

- **腰・ベルトのスマホで走りを測り、基準の機械と比べた研究**：見つからなかった。スマホの研究は歩きばかり。研究の精度は、テープで留めた専用センサーでの値。
- **腰の前後の加速度の積分で出すブレーキ（今の `brakingMs`）を、力の板と比べた研究**：見つからなかった。骨盤だけの機械学習（Baker 2025）がいちばん近い。
- **骨盤の前後の傾きが1歩の中でどれくらい振れ、前後の加速度にどれくらい漏れ込むか**：力学の式（重力 × sinθ）までで、走っているときの傾きの幅の数字は確かめていない。
- **Core Motion の重力の向きが、走っている間どれくらい正しいか**：研究は見つからなかった。
- **iPhone の Core Motion で安定して取れる最大の回数**：Apple の文書で上限を確かめていない。実機で測る。
- **上下動比（vertical ratio）の研究**：査読つきの研究で、けが・効率との関係を確かめたものは見つからなかった。出回っている目安（6〜8% など）は機械の会社やコーチの記事。
- **Heiderscheit 2011 の効いた大きさ（%）**：要旨には何%減ったかが書かれていない。本文は読んでいない。
- **Lee 2010 の方法の離地の見分け方の細かいところ**：Mo & Chow 2018 の要約（着地＝骨盤の前後の加速度の山）までしか確かめていない。
- **Clermont 2019 で使った腰のセンサーの機種**：測った項目（ピッチ・ブレーキ・上下動・骨盤の回り・骨盤の落ち・接地時間）は Lumo Run と同じだが、本文で機種名は確かめていない。Lumo Run そのものを確かめた論文は見つからなかった。
- **Marotta 2021 で骨盤だけ・胸だけのセンサーの正解率**：論文の本文に数字がなかった（図だけ）。
- **ジャイロを使って腰のセンサーで左右の足を見分けた精度**：見つからなかった。
- **ピッチを 5% 下げたときに負担が増えるか**：Heiderscheit 2011 の要旨では、はっきり増えたのは −10% だけ。
- **声かけで直した走りが、何も知らせない普段のランでどれだけ続くか（スマホ・音だけで）**：音だけで直した研究（Willy 2016 は腕時計、Bramah 2019 はメトロノーム＋時計）は1か月〜3か月まで。音声の言葉だけで直した長い研究は見つからなかった。
- **Van den Berghe らの6か月後の追跡**：Crossref では査読前の原稿（SportRxiv, doi:10.51224/srxiv.314）しか確かめられなかったので、上には入れていない。
