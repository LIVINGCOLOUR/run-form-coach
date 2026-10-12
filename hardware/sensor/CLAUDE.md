# センサーの機器（ランフォームコーチのセンサー版の試作）

両手首・両足首・首・胸の6か所に付ける IMU トラッカーを自作する。1個目の作り方は `docs/manual.pdf`（元は `docs/manual.html`）。

- 構成：Seeed XIAO nRF52840（無印、技適 211-220207）＋ 秋月 AE-LSM6DSV16X（I2C、ジャンパー J1・J3 をふさぐ）。小さくするときは白猫屋の LSM6DSV 基板（ピンの並びと I2C 対応をショップに確かめてから）
- 無線：BLE でスマホ（今は Mac の Chrome）に送る。XIAO の技適の範囲で使う。SlimeVR の Smol Slime の独自無線（ESB）は技適の面でグレーなので使わない
- 送る形（16バイト）：時刻 uint32 ms、ジャイロ xyz int16（0.07 dps）、加速度 xyz int16（0.000244 g）。サービス 0xFFE0、キャラクタリスティック 0xFFE1。`firmware/03_ble_imu`
- 書き込みは `tools/flash.sh <名前>`（Mac の Arduino IDE は、Rosetta と python の問題で止まる可能性が高いので使わない）
- 進め方：1個 → 2個（胸と首の差で猫背）→ 電池（402030 型 200mAh、保護回路・PSE 付き）→ 小さくする → 6個

## アプリとのつなぎ

アプリ側のセンサー版は `src/modes/sensor/`（いまは仕様だけ。`docs/sensor-mode.md`）。つなぐのは、センサーが動いてから。入り口の足し方は `docs/modes.md`。
