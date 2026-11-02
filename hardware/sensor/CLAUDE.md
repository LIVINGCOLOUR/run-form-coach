# センサーの機器（ランフォームコーチのセンサー版の試作）

両手首・両足首・首・胸の6か所に付ける IMU トラッカーを自作する。作り方は2つ。振動なし（1個目はブレッドボード、2個目からは空中配線・電池つき）は `docs/manual.pdf`、それに振動と電池のスイッチを足す（肌側に重ねる子基板と INT1 の線、6個まとめて）のは `docs/manual-haptic.pdf`。元はそれぞれ `.html` で、PDF は `tools/make_pdf.sh [manual-haptic]` で作り直す。

- 構成：Seeed XIAO nRF52840（無印、技適 211-220207）＋ 秋月 AE-LSM6DSV16X（I2C。基板の下のふちの印字「6A」と「I2C」をふさぐ。I2C は接点3つで、すき間2つとも。基板に J1 などの番号の印字はない）。小さくするときは白猫屋の LSM6DSV 基板（ピンの並びと I2C 対応をショップに確かめてから）
- 無線：BLE でスマホ（今は Mac の Chrome）に送る。XIAO の技適の範囲で使う。SlimeVR の Smol Slime の独自無線（ESB）は技適の面でグレーなので使わない
- 送る形：100Hz（`SAMPLE_HZ` で 50 にもできる）で測ってリングバッファにため、1回の通知にまとめる。先頭に通し番号 uint16、時刻 uint32 ms、加速度の範囲 uint8（g、8 か 16）、続けて1件13バイト（時刻の差 uint8 ms、ジャイロ xyz int16 0.07 dps、加速度 xyz int16 0.000061×範囲/2 g）を N 件。サービス 0xFFE0、キャラクタリスティック 0xFFE1。電池の電圧は 0xFFE2（uint16 mV、読み取り＋通知、10秒ごと）。振動は 0xFFE3 に書く（回数 uint8、長さ uint8 ×10ms）。つながらず動かない（ジャイロ約20 dps 未満）まま10分で眠り、加速度のウェイクアップ（0.5 g）を INT1 → D1 に出して、動いたら起きる。`firmware/03_ble_imu`。受ける側のパーサの確認は `node viewer/test_parse.mjs`
- 受け方は2つ。手で見るのは `tools/viewer.sh`（Chrome、6か所の枠で「つなぐ」を押す）。テストは `tools/coach.sh`（Mac の Python・bleak で自動でつなぎ、声で区切りを言い、猫背で胸を震わせ、`records/日時/` に imu.csv と summary.txt）。BLE は1台にしかつながらないので、両方を同時に開かない
- 書き換えは USB なら `tools/flash.sh 03_ble_imu <番号>`、無線なら `tools/ota.sh <番号>`（約1分半。Adafruit ブートローダーの古い形の DFU を bleak で送る。版は Device Information の Firmware Revision 0x2A26 で読める）。無線は、無線対応の 03_ble_imu（2026-11-02 版から）が入っている個体だけ
- 加速度の範囲は全部の個体で ±16g（足首の着地は 10g を超えうる）。ジャイロは ±2000dps
- 電池：XIAO の P0.14 はいつも LOW（Seeed の注意。HIGH のまま充電すると P0.31 が壊れるおそれ。ボードのパッケージは起動時に HIGH にするので、どのスケッチも setup() の最初で LOW に直す）。充電電流は P0.13 を触らず約 50mA のまま。03_ble_imu は10分つながらないと System OFF（リセットボタンか USB で起きる）。電池の赤は子基板のスライドスイッチ（SS12D01G4）経由で BAT+ へ。しまうときはスイッチを切る。切っていると USB でも充電されない
- 1件ずつ通知していたときは、Mac の Chrome に 1秒に約16回（接続の間隔ごとに1件）しか届かなかった。だからまとめて送る
- 書き込みは `tools/flash.sh <名前> [番号]`（`03_ble_imu 2` で RFC-IMU-2。`--compile-only` で書き込まずにコンパイルだけ）。Mac の Arduino IDE は、Rosetta と python の問題で止まる可能性が高いので使わない
- 知らせ方は**振動**（声ではない）。各ノードに振動モーター LBV10B-009（Fタイプ基板を切らずに使う子基板に 2SC1815・1 kΩ・10 µF・スイッチ、裏にモーター。XIAO D7 → 1 kΩ → ベース、電源は 3V3 をセンサー基板の 3V3・GND の穴の裏から取る）と、センサーの INT1 → XIAO D1 の線を足す。確認は `firmware/04_haptic_check`。モーターの候補、チップの中の反射（FSM/MLC）、設定の流し込み、道具、根拠、順番は `docs/haptic.md`
- 進め方：1個（ブレッドボード）→ 2個目から空中配線・電池つき（OCTelect 401030 110mAh、保護回路付き）。まず胸と首の2個で猫背 → 足首 → 手首で6個。振動は6個とも同じ形で足す（`docs/manual-haptic.pdf`、`docs/haptic.md` の「進め方」）

## アプリとのつなぎ

アプリ側は `src/modes/sensor/`（カメラ版の走りにセンサーをつなぎ、胸の傾きで猫背を見て胸を震わせる。iPhone は Web Bluetooth に対応した Bluefy で開く。仕様は `docs/sensor-mode.md`）。入り口の足し方は `docs/modes.md`。
