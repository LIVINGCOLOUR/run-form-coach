// 手順5：センサー（秋月 AE-LSM6DSV16X）が XIAO nRF52840 とつながっているかを確かめる
//
// 秋月電子通商の動作確認プログラム（check_AE-LSM6DSV16X.ino、MIT License、
// Copyright (c) 2025 AKIZUKI DENSHI TSUSHO CO.,LTD.）をもとに、XIAO 用に少し変えたもの
//   - Serial を使うため Adafruit_TinyUSB.h を読み込む
//   - 見つからないときも、止まらずに1秒ごとに知らせる
//
// 配線（I2C）：XIAO 3V3 → センサー 3V3、GND → GND、D4(SDA) → SDA、D5(SCL) → SCL
// センサー基板のジャンパー J1（プルアップ）と J3（アドレス 0x6A）を、はんだでふさいでおくこと
// 5V にはつながないこと（センサーが壊れる）

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>
#include <Wire.h>

constexpr uint8_t LSM6_ADDR_GND = 0x6A; // J3 をふさいだとき
constexpr uint8_t LSM6_ADDR_VCC = 0x6B; // J2 をふさいだとき
uint8_t lsm6_addr = 0;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1 = 0x10;
constexpr uint8_t REG_CTRL2 = 0x11;
constexpr uint8_t REG_CTRL6 = 0x15;
constexpr uint8_t REG_CTRL8 = 0x17;
constexpr uint8_t REG_OUTX_L_G = 0x22;

void writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(lsm6_addr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void readRegs(uint8_t startReg, uint8_t* buf, uint8_t len) {
  Wire.beginTransmission(lsm6_addr);
  Wire.write(startReg);
  Wire.endTransmission(false);
  Wire.requestFrom(lsm6_addr, len);
  for (uint8_t i = 0; i < len; i++) { buf[i] = Wire.read(); }
}

bool found(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool lsm6_init() {
  uint8_t who;
  readRegs(REG_WHO_AM_I, &who, 1);
  Serial.print("WHO_AM_I = 0x");
  Serial.println(who, HEX); // 0x70 なら LSM6DSV16X
  if (who != 0x70) { return false; }

  writeReg(REG_CTRL1, 0b00001001); // 加速度：高性能モード、960Hz
  writeReg(REG_CTRL2, 0b00001001); // ジャイロ：高性能モード、960Hz
  writeReg(REG_CTRL6, 0b00000100); // ジャイロの範囲：±2000 dps
  writeReg(REG_CTRL8, 0b10000010); // 加速度の範囲：±8 g
  delay(10);
  return true;
}

void setup() {
  Wire.begin();
  Serial.begin(115200);
  while (!Serial) delay(10); // シリアルモニタを開くまで待つ
  delay(100);
  Serial.println("\n\nStart!");

  while (lsm6_addr == 0) {
    if (found(LSM6_ADDR_GND)) lsm6_addr = LSM6_ADDR_GND;
    else if (found(LSM6_ADDR_VCC)) lsm6_addr = LSM6_ADDR_VCC;
    else {
      Serial.println("LSM6DSV16X not found. 配線とジャンパー（J1・J3）を確かめてください");
      delay(1000);
    }
  }
  Serial.print("LSM6DSV16X found. address: 0x");
  Serial.println(lsm6_addr, HEX);

  if (!lsm6_init()) {
    Serial.println("LSM6DSV16X init error! WHO_AM_I が 0x70 ではありません");
    while (1) delay(1000);
  }
  Serial.println("LSM6DSV16X initialized.");
  Serial.println("ax[g], ay[g], az[g], gx[dps], gy[dps], gz[dps]");
}

void loop() {
  uint8_t buf[12];
  readRegs(REG_OUTX_L_G, buf, 12);
  int16_t v[6];
  for (int i = 0; i < 6; i++) { v[i] = (int16_t)(buf[i * 2 + 1] << 8 | buf[i * 2]); }
  float gx = v[0] * 0.07f, gy = v[1] * 0.07f, gz = v[2] * 0.07f;             // 70 mdps/LSB
  float ax = v[3] * 0.000244f, ay = v[4] * 0.000244f, az = v[5] * 0.000244f; // 0.244 mg/LSB

  Serial.print(ax); Serial.print(", ");
  Serial.print(ay); Serial.print(", ");
  Serial.print(az); Serial.print(", ");
  Serial.print(gx); Serial.print(", ");
  Serial.print(gy); Serial.print(", ");
  Serial.println(gz);
  delay(100);
}
