// 手順2：XIAO nRF52840 だけで、書き込みができるかを確かめる
// 基板の小さなLEDが1秒ごとに点いたり消えたりし、シリアルモニタに数字が出れば成功

#include <Adafruit_TinyUSB.h> // Seeed nRF52 Boards で Serial を使うために要る

int count = 0;

void setup() {
  // 電池をつないだときのため：P0.14 を LOW にしておく（Seeed の注意。HIGH のまま充電すると P0.31 が壊れるおそれ）
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
  Serial.print("XIAO is alive: ");
  Serial.println(count++);
}
