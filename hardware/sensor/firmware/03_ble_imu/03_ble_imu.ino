// 手順6：センサーの値を Bluetooth（BLE）で送る
// 1秒に50回、時刻と、ジャイロ3軸・加速度3軸を送る。Mac の Chrome で viewer/viewer.html を開いて受ける
//
// 送る中身（16バイト、すべてリトルエンディアン）
//   0-3  : 時刻（XIAO が起動してからのミリ秒、uint32）
//   4-9  : ジャイロ x, y, z（int16、1 = 0.07 dps）
//   10-15: 加速度 x, y, z（int16、1 = 0.000244 g）
//
// センサーの設定と配線は 02_check_lsm6dsv と同じ

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>
#include <Wire.h>
#include <bluefruit.h>

const char* DEVICE_NAME = "RFC-IMU-1"; // 2個目を作るときは RFC-IMU-2 などに変える
constexpr uint32_t SEND_EVERY_MS = 20;  // 20ミリ秒ごと＝1秒に50回

constexpr uint8_t LSM6_ADDR_GND = 0x6A;
constexpr uint8_t LSM6_ADDR_VCC = 0x6B;
uint8_t lsm6_addr = 0;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1 = 0x10;
constexpr uint8_t REG_CTRL2 = 0x11;
constexpr uint8_t REG_CTRL6 = 0x15;
constexpr uint8_t REG_CTRL8 = 0x17;
constexpr uint8_t REG_OUTX_L_G = 0x22;

BLEService imuService(0xFFE0);
BLECharacteristic imuChar(0xFFE1);

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
  if (found(LSM6_ADDR_GND)) lsm6_addr = LSM6_ADDR_GND;
  else if (found(LSM6_ADDR_VCC)) lsm6_addr = LSM6_ADDR_VCC;
  else return false;
  uint8_t who;
  readRegs(REG_WHO_AM_I, &who, 1);
  if (who != 0x70) return false;
  writeReg(REG_CTRL1, 0b00001001); // 加速度：高性能モード、960Hz
  writeReg(REG_CTRL2, 0b00001001); // ジャイロ：高性能モード、960Hz
  writeReg(REG_CTRL6, 0b00000100); // ジャイロの範囲：±2000 dps
  writeReg(REG_CTRL8, 0b10000010); // 加速度の範囲：±8 g
  delay(10);
  return true;
}

void startAdvertising() {
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(imuService);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true); // 切れたら、また見つけてもらえるようにする
  Bluefruit.Advertising.setInterval(32, 244);      // 単位は0.625ミリ秒
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0); // 0 = ずっと続ける
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200); // Mac につないでいなくても動く（シリアルを待たない）
  Wire.begin();
  delay(100);

  while (!lsm6_init()) {
    Serial.println("LSM6DSV16X not found. 02_check_lsm6dsv で配線を確かめてください");
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); // 速く点滅して知らせる
    delay(200);
  }

  Bluefruit.begin();
  Bluefruit.setName(DEVICE_NAME);

  imuService.begin();
  imuChar.setProperties(CHR_PROPS_NOTIFY);
  imuChar.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  imuChar.setFixedLen(16);
  imuChar.begin();

  startAdvertising();
  Serial.print("BLE advertising as ");
  Serial.println(DEVICE_NAME);
}

void loop() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last < SEND_EVERY_MS) return;
  last = now;

  uint8_t raw[12];
  readRegs(REG_OUTX_L_G, raw, 12); // ジャイロ xyz → 加速度 xyz の順に12バイト

  uint8_t pkt[16];
  memcpy(pkt, &now, 4);
  memcpy(pkt + 4, raw, 12);

  if (Bluefruit.connected() && imuChar.notifyEnabled()) {
    imuChar.notify(pkt, sizeof(pkt));
  }
}
