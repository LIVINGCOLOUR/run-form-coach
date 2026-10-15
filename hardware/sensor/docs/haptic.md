# 振動で直す（センサー版の知らせ方）と、チップの中の反射

センサー版では、崩れを**声ではなく振動**で知らせる（2026-10-15 に決めた。声は同じ内容でも「言われた」感が残り、イラっとすることがある。振動は何も言わずに気づかせられ、イヤホンも要らない）。カメラ版は体に何も付けないので声のまま。

各ノード（XIAO nRF52840 ＋ LSM6DSV16X）に振動モーターを足し、同じ粒が「感じて（IMU）・触れる（振動）」ようにする。判断はできるだけ下の層に置く。

## 層の分け方

| 層 | 置くもの | 速さ |
|---|---|---|
| センサーチップ（LSM6DSV16X の FSM / MLC） | 1ノードで決まる反射：着地、着地の強さ、ケイデンスの低下、腕振りの周期、1歩の間の回転角、「いつもの走り／崩れた走り」の2値分類 | 検知 1〜2 ms |
| XIAO（nRF52840） | 振動の制御（モーターのパルス、ケイデンス誘導の +2% のタイミング）、絶対の姿勢（SFLP の四元数）、ルールの受け取りと解釈、BLE | µs〜ms |
| スマホ／LLM | ノード間の比較（首と胸の角度差、左右差）、ルールを作って配る、記録 | 数十 ms〜 |

遅いのは**モーター**（回り始めて感じるまで数十 ms。ERM。LRA は速い）。だから反射をチップに置くか XIAO に置くかは、体感では差が出ない。チップに置く利点は電池（XIAO が眠れる）と、ルールをレジスタの書き込みの列として後から流し込めること。**XIAO 側（64 MHz）でも同じ検知は余裕でできる**ので、チップの反射は必須ではない。まず XIAO 側で作り、効くと分かってからチップに移す。

## 作るもの（ハード）

- 線を1本足す：センサー基板の **INT1 → XIAO の D1**（空いている D ピンならどれでも）。秋月 AE-LSM6DSV16X の回路図で INT1・INT2 はピンヘッダに出ている（R1〜R5 の 10 kΩ は I2C プルアップ・アドレス・CS 用で、INT には何も付いていない）。今の手順書（`manual.pdf`）では INT は未接続
- 振動モーター＋トランジスタ1個（GPIO 直では電流が足りない）。候補は秋月の円盤形 LBV10B-009（コパル、3 V、50〜75 mA、φ10、販売コード 106787）、YM-300（110788）、2 mm のミニ（116777）。贅沢するなら DRV2605L 基板（スイッチサイエンス、Adafruit 版 ¥1,705）で LRA
- 電池（110 mAh）の目安は計算だけ：75 mA のモーターを1歩ごとに 80 ms（180 spm なら 24%）鳴らすと平均 18 mA、崩れたときだけなら無視できる。実測はまだ
- まず **手首1個**で作る。走行中に振動を感じ取れる実績があるのは手首（下の「根拠」）。足首は自分で試す

## チップでできること（確認済み。出典は下）

- FSM は **8本**、MLC（決定木）は **4本**。FSM の更新は 15/30/60/120/240/480/**960 Hz**（FSM_ODR 5Fh）、MLC は 15〜**240 Hz**（MLC_ODR 60h）。今の加速度の 960 Hz と同じ速さで反射を回せる
- FSM の入力：加速度・ジャイロ（それぞれ大きさ V 付き）、Qvar、外部センサー、長カウンタ、MLC で作ったフィルタ済みの値や特徴量、**ジャイロを積分した角度**（CONFIG_B の ANGLE。DELTAT に FSM の周期を入れる）
- FSM の条件：しきい値（GNTH1/GNTH2/LNTH1/LNTH2/GLTH1/LLTH1/GRTH1/LRTH1）、タイマー（TI1〜TI4）、ゼロ交差（PZC/NZC）、CHKDT。命令：STOP/CONT/CONTREL/OUTC/SETR（レジスタを書き換えて自分で設定を変える）など。1本のプログラムは最大 256 バイト
- 割り込み：FSM_INT1（0Bh、埋め込み機能ページ）の INT1_FSMn と、メインページの MD1_CFG の INT1_EMB_FUNC の**両方**を 1 にすると INT1 に出る。MLC は MLC_INT1（0Dh）。既定はパルス（長さは速いほうの ODR の 1 周期、最短 1/960 s ≈ 1 ms）。PAGE_RW（17h）の EMB_FUNC_LIR でラッチにもできる（FSM_STATUS_MAINPAGE 4Ah を読むと消える）
- **SFLP（姿勢の四元数・重力・ジャイロのバイアス）は FSM の入力にならない。** FIFO からしか読めない（15〜480 Hz、3.5〜112 µA）。絶対の姿勢（猫背の角度）は XIAO で読む
- 2ノードの比較（首と胸、左右）はチップではできない。XIAO かスマホ

## 設定の流し込み

ST の設定ファイルは「レジスタに値を書く」の列なので、今の `writeReg` の for ループで流し込める。

- 新しい形式（`.h`）：`struct mems_conf_op { type, address, data }` の配列。`type` は WRITE のほかに READ / DELAY（ms）/ POLL_SET / POLL_RESET がある。LSM6DSV16X の shake の例は **53 行すべて WRITE**。先頭は `0x10←0x00, 0x11←0x00`（加速度・ジャイロを止める）、`0x01←0x80`（埋め込み機能ページへ）、……、最後に `0x10←0x44`（加速度を再開）
- 古い形式（`.ucf`）：`Ac 10 00` のような行（`Ac アドレス 値`、16進）。同じ内容
- MEMS Studio からは `.json`（レジスタのアドレスと値の列）と `.h` で保存できる
- 読み方は ST の Arduino 例 `LSM6DSV16X_MLC_I2C` がそのまま手本（配列を for で `Write_Reg`、INT1 の立ち上がりで `Get_MLC_Status` → `Get_MLC_Output`、MLC は最初の窓が要るので 3 秒待つ）

## 道具

- **MEMS Studio**（ST、無料、Windows / macOS / Linux）：FSM はブロックで組んで保存、MLC はログ → 特徴量（ARFF）→ 決定木（AutoML）→ 設定。ST のチュートリアルはすべて ST のボード接続前提で書かれていて、**ボードなしで使えるかは未確認**（入れて「Device を選べるか」を見る）
- **Unico GUI**（MEMS Studio の前身、まだ落とせる）：「*Communication with the motherboard* のチェックを外すとオフライン（HW 不要）で FSM / MLC の設定を作れる」と公式に書いてある。ただし 2023 年に「Unico 9.13 の FSM をオフラインで開くと .ucf を読んでも画面に反映されない」という報告があり、ST の回答はない
- ST の例：FSM は `st-mems-finite-state-machine/examples/<例>/lsm6dsv16x/`（shake、motion_stationary、wrist_tilt、peak_tracking、tilt、free_fall など）、MLC は `st-mems-machine-learning-core/examples/`（activity、gym、head_gestures、tilt_angle、yoga_pose など）。各 `.json` と `.h`。`git clone --depth 1 https://github.com/STMicroelectronics/st-mems-finite-state-machine.git`（MLC も同じ形）
- ST 公式の Python `tools/decision_tree_generator/python/mlc_utils.py`：ARFF → scikit-learn の決定木 → ST 向けのテキスト。最終の設定ファイルを作るのは GUI。CLI や公式の Python で設定ファイルまで作る道は見つかっていない
- MLC の学習データは、ST の手順ではProfiMEMS（STEVAL-MKI109D）＋ STEVAL-MKI227KA、または NUCLEO-F401RE ＋ X-NUCLEO-IKS4A1（LSM6DSV16X 搭載、数千円）、SensorTile.box PRO で取る。自作ノードのログを取り込めるかは未確認
- 「言葉 → ルール」（LLM が「着地が外に流れたら右足首を叩いて」をルールに直す）は、**XIAO が解釈する JSON ルール**（信号・軸・しきい値・長さ・振動のパターン）で先に作る。チップの FSM まで通すには、AN5882 の命令表をもとに小さなアセンブラを自作する必要がある

## 確かめたこと（2026-10-15）

- ST の Arduino ライブラリ（stm32duino/LSM6DSV16X 2.1.1、`architectures=*`）の例を、`Seeeduino:nrf52:xiaonRF52840` でコンパイル：`LSM6DSV16X_MLC_I2C`（`INT_1` を `PA4` → `D1` に変更）はフラッシュ 50,728 B・RAM 7,760 B、`LSM6DSV16X_Sensor_Fusion_I2C`（SFLP を FIFO から読む）は 51,776 B・7,720 B。`attachInterrupt(D1, …, RISING)` もそのまま通る。実機ではまだ
- 遅さの内訳：FSM の検知 ≤ 1 ms ＋ 割り込みパルス ≥ 1 ms、XIAO の割り込み数 µs、モーター数十 ms（ERM）。実測はまだ

## 根拠（走行中に振動を感じ取れるか）

- 手首：Garmin のメトロノームは走行中に振動で刻む設定を公式に持つ。Wong・Sheerin・Wyatt（AUT、ISBS 2021）は手首の振動ユニットでケイデンスを指示し、ランナー10人が屋外で3回の練習をして「使える・分かりやすい」。ステップレートの精度は実験室の方法と最大 1.1% 差
- Demircan（ROBOMECH 2020）：6人が触覚フィードバックで体幹の傾き・ケイデンス・接地を変え、膝の屈曲モーメントを 30〜85% に下げた（装置の位置は本文が読めず不明）
- 足首：歩行では足首の合図が好まれるという報告（Wearable Haptics for Remote Social Walking）はあるが、**走行中の足首は研究が見つからない**。自分で試す
- 振動で姿勢を直すウェアの先行例：Nadi X（ヨガパンツ、腰・膝・足首が振動）。ランでは製品を知らない

## 進め方

1. INT1 の線を足し、ST の例（motion_stationary か shake）の `.h` を流し込み、INT1 で LED が光るのを見る（チップの中で検知が動く確認。半日）
2. 手首のノードにモーター＋トランジスタを足し、XIAO 側のしきい値で「着地 → 振動」（1日）
3. 走って、手首・胸・足首のどこなら感じ取れるかを確かめる。ここが最大の未知数
4. 感じ取れたら、ケイデンス誘導（実際の着地に位相を合わせ、2% だけ速く叩く。Garmin のメトロノームは手首で一定のビートを刻むだけなので、ここが違い）と、「崩れたら1回叩く」
5. その後、MEMS Studio か Unico で FSM 版に移す／MLC で自分の崩れを学習させる（ラベルはコーチの声。`docs/validation-plan.md` と同じ方針）
6. 「言葉 → ルール」は XIAO の JSON ルールで作る。チップへは後

## まだ確かめていないこと

- MEMS Studio がボードなしで設計・保存できるか
- 自作ノードのログを MLC の学習に使えるか
- 走行中に、手首・胸・足首で振動を感じ取れるか（モーターの強さも）
- モーターを足したときの電池の持ち（上は計算だけ）
- BLE でノードへルールを書き込むキャラクタリスティック（まだ作っていない。今は 0xFFE1 の通知と 0xFFE2 の電圧だけ）

## 踏んだ罠

- ST のサイト（st.com）からデータシート・AN5763・AN5882・UM3233 の PDF が落ちてこないことがある。SparkFun の CDN に同じものがある：
  [データシート](https://cdn.sparkfun.com/assets/4/1/8/e/2/lsm6dsv16x.pdf) ·
  [AN5763（機能全般）](https://cdn.sparkfun.com/assets/0/a/c/c/9/an5763-lsm6dsv16x-6axis-imu-with-embedded-sensor-fusion-ai-qvar-for-highend-applications-stmicroelectronics.pdf) ·
  [AN5882（FSM）](https://cdn.sparkfun.com/assets/5/3/b/3/6/an5882-lsm6dsv16x-finite-state-machine-stmicroelectronics.pdf)。`pdftotext -layout` で文字にできる
- ST の古い GitHub リポ（STMems_Finite_State_Machine / STMems_Machine_Learning_Core）は 2025-07 で保守終了。新しいのは st-mems-finite-state-machine / st-mems-machine-learning-core
- ST の Arduino 例は INT ピンが STM32 の `PA4`。XIAO では `D1` などに書き換える
- arduino-cli は、スケッチのフォルダ名と `.ino` の名前が同じでないと「main file missing」で止まる。例をコピーするときはフォルダごと

## 出典

- [LSM6DSV16X データシート](https://cdn.sparkfun.com/assets/4/1/8/e/2/lsm6dsv16x.pdf)（FSM_ODR Table 326、MLC_ODR Table 328）
- [AN5763](https://cdn.sparkfun.com/assets/0/a/c/c/9/an5763-lsm6dsv16x-6axis-imu-with-embedded-sensor-fusion-ai-qvar-for-highend-applications-stmicroelectronics.pdf)（第5章 割り込み、6.5 SFLP、埋め込み機能レジスタ）
- [AN5882](https://cdn.sparkfun.com/assets/5/3/b/3/6/an5882-lsm6dsv16x-finite-state-machine-stmicroelectronics.pdf)（FSM の入力 3.2.1、割り込み 第4章、角度 7.4、命令 第8章）
- [st-mems-finite-state-machine](https://github.com/STMicroelectronics/st-mems-finite-state-machine) · [st-mems-machine-learning-core](https://github.com/STMicroelectronics/st-mems-machine-learning-core) · [stm32duino/LSM6DSV16X](https://github.com/stm32duino/LSM6DSV16X)
- [MEMS Studio](https://www.st.com/en/development-tools/mems-studio.html) · [Unico GUI](https://www.st.com/en/development-tools/unico-gui.html) · [Unico のオフライン FSM の不具合報告](https://community.st.com/mems-sensors-48/possible-bug-in-unico-gui-v9-13-0-0-17753)
- [秋月 AE-LSM6DSV16X](https://akizukidenshi.com/catalog/g/g130950/)（[回路図](https://akizukidenshi.com/goodsaffix/%E5%9B%9E%E8%B7%AF%E5%9B%B3_20250113.pdf)）· [秋月 LBV10B-009](https://akizukidenshi.com/catalog/g/g106787/) · [秋月 振動モーター一覧](https://akizukidenshi.com/catalog/c/cvibratio/) · [スイッチサイエンス DRV2605L](https://www.switch-science.com/products/2178)
- [Garmin: Using the Metronome](https://www8.garmin.com/manuals/webhelp/instinct/EN-US/GUID-7C3A8FE0-035D-43D2-8E5E-6B0FC75DD00C.html) · [Wong, Sheerin, Wyatt 2021（ISBS）](https://commons.nmu.edu/isbs/vol39/iss1/41) · [Demircan 2020（ROBOMECH）](https://doaj.org/article/299c007a98bb4f8d905bf55417581766) · [Wearable Haptics for Remote Social Walking](https://arxiv.org/html/2001.03899v2)
