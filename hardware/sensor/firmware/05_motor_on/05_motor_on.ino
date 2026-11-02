// 振動しないときの配線チェック用：D7 を HIGH にしたままにして、モーターを回し続ける
//
// 回っている間、LED（赤）を点けたままにする。LED が点いているのに回らなければ、D7 からモーターまでのどこかが切れている
// テスターで当たる場所（docs/manual-haptic.pdf）：
//   D7 と GND の間 ≒ 3.3V。トランジスタのベース（E3）と GND の間 ≒ 0.7V
//   モーターの ＋（F8）と GND の間 ≒ 3.3V。モーターの −（F6）と GND の間 ≒ 0V に近い（トランジスタが ON）
// 終わったら 04_haptic_check か 03_ble_imu を書き込み直す

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>

constexpr uint8_t MOTOR_PIN = 7;  // D7（P1.12）

void setup() {
  // P0.14 を LOW にする（Seeed の注意。HIGH のまま充電すると P0.31 が壊れるおそれ）。ほかのことより先に
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);  // 点ける（XIAO の LED は LOW で点く）
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, HIGH);
}

void loop() {}
