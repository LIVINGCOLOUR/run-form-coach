// 振動を足す手順書（docs/manual-haptic.pdf）の工程4：振動モーターと INT1 の線を確かめる
//
// 1. 起動したら、モーターを短く3回鳴らす（トランジスタの回路の確認。センサーがまだ無くても鳴る）
// 2. センサーが見つかったら、チップの「ウェイクアップ」検知（加速度の急な変化）を INT1 に出すように設定する
// 3. INT1 が立ち上がったら（着地のような衝撃）、LED を点けて、モーターを短く鳴らす
//
// 確かめ方：tools/monitor.sh を開き、基板を机に軽く打ちつける（または手首・足首に付けて足踏みする）
// シリアルからの文字：b = 1回鳴らす、l = 2秒続けて鳴らす、+ / - = しきい値を 0.25 g ずつ上げ下げ
//
// 配線（docs/manual-haptic.pdf）
//   モーター：XIAO D7 → 1kΩ → 2SC1815 のベース。エミッタ → GND。コレクタ → モーターの −（黒）。モーターの ＋（赤）→ 3V3
//   10µF：3V3 と GND の間
//   センサー：3V3・GND・SDA(D4)・SCL(D5) は 02 / 03 と同じ。INT1 → XIAO D1
//
// モーター（LBV10B-009）は中に駆動IC（FD216）があり、電源を入れると回る。PWM で強さは変えない（毎回起動し直す）。
// 強さではなく、鳴らす長さと回数で表す（docs/haptic.md）

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>
#include <Wire.h>

constexpr uint8_t MOTOR_PIN = 7;  // D7（P1.12）。基板の配置で、トランジスタのすぐ隣のピン
constexpr uint8_t INT1_PIN = 1;   // D1（P0.03）← センサーの INT1

constexpr uint32_t BUZZ_MS = 80;        // 1回の振動の長さ
constexpr uint32_t GAP_MS = 150;        // 起動時の3回の間
constexpr uint32_t REFRACTORY_MS = 300; // 1回反応したら、この間は次を受けない（モーター自身の振動で鳴り続けないように）
float thresholdG = 2.0f;                // ウェイクアップのしきい値（g）。0.25 g きざみ、最大 15.75 g

constexpr uint8_t LSM6_ADDR_GND = 0x6A;
constexpr uint8_t LSM6_ADDR_VCC = 0x6B;
uint8_t lsm6_addr = 0;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1 = 0x10;
constexpr uint8_t REG_CTRL2 = 0x11;
constexpr uint8_t REG_CTRL6 = 0x15;
constexpr uint8_t REG_CTRL8 = 0x17;
constexpr uint8_t REG_WAKE_UP_SRC = 0x45;
constexpr uint8_t REG_FUNCTIONS_ENABLE = 0x50;
constexpr uint8_t REG_INACTIVITY_DUR = 0x54;
constexpr uint8_t REG_TAP_CFG0 = 0x56;
constexpr uint8_t REG_WAKE_UP_THS = 0x5B;
constexpr uint8_t REG_WAKE_UP_DUR = 0x5C;
constexpr uint8_t REG_MD1_CFG = 0x5E;

volatile bool int1Fired = false;
bool sensorReady = false;
uint32_t motorOffAt = 0;   // 0 なら止まっている
uint32_t lastHit = 0;
uint32_t hits = 0;

void writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(lsm6_addr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(lsm6_addr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(lsm6_addr, (uint8_t)1);
  return Wire.read();
}

bool found(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// ---- モーター ----
void motorOn(uint32_t ms) {
  digitalWrite(MOTOR_PIN, HIGH);
  motorOffAt = millis() + ms;
  if (motorOffAt == 0) motorOffAt = 1;
}

void motorUpdate() {
  if (motorOffAt != 0 && (int32_t)(millis() - motorOffAt) >= 0) {
    digitalWrite(MOTOR_PIN, LOW);
    digitalWrite(LED_BUILTIN, HIGH); // LED も消す（この LED は HIGH で消える）
    motorOffAt = 0;
  }
}

void buzzBlocking(uint8_t times) {
  for (uint8_t i = 0; i < times; i++) {
    digitalWrite(MOTOR_PIN, HIGH);
    digitalWrite(LED_BUILTIN, LOW);
    delay(BUZZ_MS);
    digitalWrite(MOTOR_PIN, LOW);
    digitalWrite(LED_BUILTIN, HIGH);
    delay(GAP_MS);
  }
}

// ---- センサー ----
uint8_t thresholdCode() {
  int code = (int)(thresholdG / 0.25f + 0.5f); // 1 = 0.25 g（下の INACTIVITY_DUR の設定）
  if (code < 1) code = 1;
  if (code > 63) code = 63;
  return (uint8_t)code;
}

bool lsm6_init() {
  if (found(LSM6_ADDR_GND)) lsm6_addr = LSM6_ADDR_GND;
  else if (found(LSM6_ADDR_VCC)) lsm6_addr = LSM6_ADDR_VCC;
  else return false;
  if (readReg(REG_WHO_AM_I) != 0x70) return false;

  writeReg(REG_CTRL1, 0b00001001); // 加速度：高性能モード、960Hz（03_ble_imu と同じ）
  writeReg(REG_CTRL2, 0b00001001); // ジャイロ：高性能モード、960Hz
  writeReg(REG_CTRL6, 0b00000100); // ジャイロの範囲：±2000 dps
  writeReg(REG_CTRL8, 0b10000011); // 加速度の範囲：±16 g（03_ble_imu と同じ）

  // ウェイクアップ（加速度の急な変化）を INT1 に出す。データシート DS13510 の 9.53〜9.65
  writeReg(REG_INACTIVITY_DUR, 0b01010100); // しきい値の 1 = 250 mg（WU_INACT_THS_W = 101）。残りは初期値のまま
  writeReg(REG_WAKE_UP_THS, thresholdCode()); // しきい値
  writeReg(REG_WAKE_UP_DUR, 0x00);          // 1サンプル越えたら反応
  writeReg(REG_TAP_CFG0, 0b00010001);       // SLOPE_FDS=1（ハイパスフィルターを通した値で判定）、LIR=1（読むまで INT1 を HIGH のまま）
  writeReg(REG_FUNCTIONS_ENABLE, 0b10000000); // INTERRUPTS_ENABLE
  writeReg(REG_MD1_CFG, 0b00100000);        // INT1_WU：ウェイクアップを INT1 へ
  delay(10);
  readReg(REG_WAKE_UP_SRC); // 起動直後にたまったものを消す
  return true;
}

void onInt1() { int1Fired = true; }

void printStatus() {
  Serial.print("threshold ");
  Serial.print(thresholdG, 2);
  Serial.print(" g, hits ");
  Serial.print(hits);
  Serial.print(", INT1 pin ");
  Serial.println(digitalRead(INT1_PIN));
}

void setup() {
  // P0.14 を LOW にする（Seeed の注意。HIGH のまま充電すると P0.31 が壊れるおそれ）。ほかのことより先に
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  pinMode(INT1_PIN, INPUT);
  Serial.begin(115200);
  Wire.begin();
  delay(300);

  buzzBlocking(3); // 1. まず3回
  Serial.println("buzz x3");

  sensorReady = lsm6_init();
  if (sensorReady) {
    Serial.print("LSM6DSV16X found. address: 0x");
    Serial.println(lsm6_addr, HEX);
    attachInterrupt(digitalPinToInterrupt(INT1_PIN), onInt1, RISING);
    printStatus();
  } else {
    Serial.println("LSM6DSV16X not found（センサーをつなぐ前なら、それで正常。振動だけ確かめられる）");
  }
}

void loop() {
  motorUpdate();
  uint32_t now = millis();

  // シリアルからの文字
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'b') { buzzBlocking(1); Serial.println("buzz"); }
    if (c == 'l') {  // 長く2秒（短い 80 ms で回り始めないモーターかを見分ける）
      digitalWrite(MOTOR_PIN, HIGH); digitalWrite(LED_BUILTIN, LOW);
      delay(2000);
      digitalWrite(MOTOR_PIN, LOW); digitalWrite(LED_BUILTIN, HIGH);
      Serial.println("long buzz");
    }
    if (sensorReady && (c == '+' || c == '-')) {
      thresholdG += (c == '+') ? 0.25f : -0.25f;
      if (thresholdG < 0.25f) thresholdG = 0.25f;
      if (thresholdG > 15.75f) thresholdG = 15.75f;
      writeReg(REG_WAKE_UP_THS, thresholdCode());
      printStatus();
    }
  }

  if (!sensorReady) {
    // センサーなし：1秒ごとに探し直す（あとからつないだときのため）。LED はゆっくり点滅
    static uint32_t lastTry = 0;
    if (now - lastTry >= 1000) {
      lastTry = now;
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      sensorReady = lsm6_init();
      if (sensorReady) {
        Serial.println("LSM6DSV16X found");
        attachInterrupt(digitalPinToInterrupt(INT1_PIN), onInt1, RISING);
        printStatus();
      }
    }
    return;
  }

  // INT1：割り込みを取りこぼしても、ピンが HIGH のままなら拾う（ラッチしているので、読むまで HIGH）
  if (int1Fired || digitalRead(INT1_PIN) == HIGH) {
    int1Fired = false;
    uint8_t src = readReg(REG_WAKE_UP_SRC); // 読むとラッチが消えて INT1 が LOW に戻る
    if (now - lastHit >= REFRACTORY_MS) {
      lastHit = now;
      hits++;
      digitalWrite(LED_BUILTIN, LOW); // 点ける
      motorOn(BUZZ_MS);
      Serial.print("INT1 #");
      Serial.print(hits);
      Serial.print("  WAKE_UP_SRC=0x");
      Serial.println(src, HEX);
    }
  }

  static uint32_t lastPrint = 0;
  if (now - lastPrint >= 5000) {
    lastPrint = now;
    printStatus();
  }
  delay(1);
}
