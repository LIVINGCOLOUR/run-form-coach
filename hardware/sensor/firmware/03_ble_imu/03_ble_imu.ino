// 手順6：センサーの値を Bluetooth（BLE）で送る
// 1秒に100回（SAMPLE_HZ を 50 にすると50回）、時刻と、ジャイロ3軸・加速度3軸を測り、
// 何回分かをまとめて1回の通知で送る。Mac の Chrome で viewer/viewer.html を開いて受ける
// 書き込みは tools/flash.sh 03_ble_imu <番号>（番号 2 なら RFC-IMU-2 という名前になる）
//
// なぜまとめるか：Mac は接続の間隔（数十ミリ秒）ごとに少ししか受け取らないので、
// 1回に1件ずつ送ると 1秒に約16回で頭打ちになる。測ったものはリングバッファにためて、取りこぼさない
//
// 送る中身（1回の通知、すべてリトルエンディアン）
//   0-1 : 先頭のサンプルの通し番号（uint16、1サンプルごとに1増える。飛んだら抜け）
//   2-5 : 先頭のサンプルの時刻（XIAO が起動してからのミリ秒、uint32）
//   6   : 加速度の範囲（uint8、g。8 か 16）。加速度の 1 が何 g かはこれで決まる（±8g は 0.000244、±16g は 0.000488）
//   7-  : サンプルを N 件、1件13バイト
//           +0     : 先頭のサンプルからの時刻の差（uint8、ミリ秒）
//           +1..6  : ジャイロ x, y, z（int16、1 = 0.07 dps）
//           +7..12 : 加速度 x, y, z（int16、1 = 0.000061 × 範囲/2 g）
//   N =（通知の長さ - 7）/ 13。MTU が 23 のままなら N = 1、247 なら最大 18
//   通知の中のサンプルは通し番号が1ずつ続いている（k 件目の番号 = 先頭の番号 + k）
//
// 電池の電圧は別のキャラクタリスティック 0xFFE2（読み取り＋通知、uint16、ミリボルト）で、10秒ごとに更新する
//
// センサーの設定と配線は 02_check_lsm6dsv と同じ

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>
#include <Wire.h>
#include <bluefruit.h>

// 何個目か。tools/flash.sh 03_ble_imu 2 のように番号を渡すと、ここが 2 になる（渡さなければ 1）
#ifndef IMU_ID
#define IMU_ID 1
#endif
// 加速度の範囲（g）。足首の着地は 10g を超えうるので、全部の個体で 16 にしている。8 にもできる
#ifndef ACCEL_RANGE_G
#define ACCEL_RANGE_G 16
#endif
static_assert(ACCEL_RANGE_G == 8 || ACCEL_RANGE_G == 16, "ACCEL_RANGE_G は 8 か 16");
#define STR2(x) #x
#define STR(x) STR2(x)

const char* DEVICE_NAME = "RFC-IMU-" STR(IMU_ID);
constexpr uint32_t SAMPLE_HZ = 100;    // 1秒に測る回数。50 か 100
constexpr uint32_t MAX_WAIT_MS = 30;   // いちばん古いサンプルがこれだけ待ったら、満杯でなくても送る
constexpr uint32_t BATTERY_EVERY_MS = 10000; // 電池の電圧を測る間隔
constexpr uint32_t AUTO_OFF_MIN = 10;  // だれともつながらないまま、これだけたったら眠る（0 なら眠らない）

constexpr uint8_t LSM6_ADDR_GND = 0x6A;
constexpr uint8_t LSM6_ADDR_VCC = 0x6B;
uint8_t lsm6_addr = 0;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1 = 0x10;
constexpr uint8_t REG_CTRL2 = 0x11;
constexpr uint8_t REG_CTRL6 = 0x15;
constexpr uint8_t REG_CTRL8 = 0x17;
constexpr uint8_t REG_OUTX_L_G = 0x22;

constexpr uint16_t HEADER_LEN = 7;
constexpr uint16_t SAMPLE_LEN = 13;
constexpr uint16_t MAX_PAYLOAD = 244; // MTU 247 - 3

BLEService imuService(0xFFE0);
BLECharacteristic imuChar(0xFFE1);
BLECharacteristic batChar(0xFFE2);
TaskHandle_t sampleTaskHandle = NULL;

// ---- リングバッファ（測る係が入れ、送る係が出す。係は1人ずつなので鍵は要らない）----
struct Sample {
  uint16_t seq;
  uint32_t t;
  uint8_t raw[12]; // ジャイロ xyz → 加速度 xyz
};
constexpr uint32_t RING_SIZE = 256; // 100Hz で約2.5秒ぶん
Sample ring[RING_SIZE];
volatile uint32_t ringHead = 0; // 次に入れる位置（測る係だけが進める）
volatile uint32_t ringTail = 0; // 次に出す位置（送る係だけが進める）

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
  // 加速度の範囲：下の2ビットが 10 なら ±8 g、11 なら ±16 g（上の 100 はフィルターの設定で、前と同じ）
  writeReg(REG_CTRL8, ACCEL_RANGE_G == 16 ? 0b10000011 : 0b10000010);
  delay(10);
  return true;
}

// 測る係：loop() とは別の、優先度の高いタスクで、決まった間隔で測る。
// 送る係（loop）が Bluetooth の空き待ちで止まっても、測るのは止まらない。
// I2C（Wire）は setup() の後はこのタスクしか使わない
void sampleTask(void*) {
  uint16_t seq = 0;
  uint32_t n = 0;
  TickType_t base = xTaskGetTickCount();
  for (;;) {
    // n 回目を測る時刻。タイマーの刻みは 1/1024 秒なので、毎回足し算せず掛け算で出して誤差をためない
    TickType_t due = base + (TickType_t)(((uint64_t)n * configTICK_RATE_HZ) / SAMPLE_HZ);
    int32_t wait = (int32_t)(due - xTaskGetTickCount());
    if (wait > 0) vTaskDelay(wait);
    if (wait < -(int32_t)configTICK_RATE_HZ) { // 1秒以上遅れた（ふつうは起きない）：今から数え直す
      base = xTaskGetTickCount();
      n = 0;
    }

    Sample s;
    s.seq = seq++;
    s.t = millis();
    readRegs(REG_OUTX_L_G, s.raw, 12);

    uint32_t head = ringHead;
    if (head - ringTail < RING_SIZE) {
      ring[head % RING_SIZE] = s;
      __DMB(); // 中身を書き終えてから位置を進める
      ringHead = head + 1;
    }
    // 満杯なら捨てる。通し番号は進むので、受ける側で抜けが分かる
    n++;
  }
}

// ---- 電池 ----
// XIAO の電池の電圧は、1MΩ と 510kΩ で分けて P0.31 で読む。P0.14 を LOW にすると読める。
// Seeed の資料：P0.14 を HIGH にしたまま充電すると P0.31 が 3.6V の上限に届いて壊れるおそれがあるので、
// いつも LOW にしておく（ボードのパッケージは起動時に HIGH にするので、setup() の最初で LOW に直す）
void batteryInit() {
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  analogReadResolution(12); // 0〜4095
  analogSampleTime(40);     // 抵抗が大きい（約340kΩ）ので、長めに取り込む
}

uint16_t batteryMillivolts() {
  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(PIN_VBAT);
  // 0〜4095 が 0〜3.6V（内部の基準 0.6V × 6）。分けた電圧を元に戻すため ×(1000+510)/510
  return (uint16_t)((sum / 8.0f) * 3600.0f / 4096.0f * 1510.0f / 510.0f);
}

void batteryUpdate() {
  uint16_t mv = batteryMillivolts();
  batChar.write16(mv);
  if (Bluefruit.connected() && batChar.notifyEnabled()) batChar.notify16(mv);
}

// 眠る：センサーを止めてから、nRF52840 を System OFF にする。
// 起きるのは、リセットボタンを1回押したとき、または USB をつないだとき（起きると最初から動く）
void sleepNow() {
  vTaskSuspend(sampleTaskHandle); // I2C を使う係を止めてから、センサーに書く
  writeReg(REG_CTRL1, 0);         // 加速度を止める
  writeReg(REG_CTRL2, 0);         // ジャイロを止める
  digitalWrite(LED_BUILTIN, HIGH); // LED を消す（この LED は HIGH で消える）
  Serial.println("sleep");
  delay(100);
  sd_power_system_off();
}

void onConnect(uint16_t conn_hdl) {
  BLEConnection* conn = Bluefruit.Connection(conn_hdl);
  if (!conn) return;
  // Mac に、大きく・こまめに受け取ってもらうよう頼む（決めるのは Mac。断られても、まとめて送るので動く）
  conn->requestPHY();
  conn->requestDataLengthUpdate();
  conn->requestMtuExchange(247);
  conn->requestConnectionParameter(12); // 15ミリ秒（単位 1.25ミリ秒。Apple の決まりで 15 より短くは頼まない）
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
  batteryInit(); // P0.14 を LOW にする（上の説明）。ほかのことより先に
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200); // Mac につないでいなくても動く（シリアルを待たない）
  Wire.begin();
  delay(100);

  while (!lsm6_init()) {
    Serial.println("LSM6DSV16X not found. 02_check_lsm6dsv で配線を確かめてください");
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); // 速く点滅して知らせる
    delay(200);
  }

  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX); // MTU 247 まで。1回の接続の間に何通も送れるように
  Bluefruit.begin();
  Bluefruit.setName(DEVICE_NAME);
  Bluefruit.Periph.setConnInterval(12, 24); // 希望：15〜30ミリ秒（単位 1.25ミリ秒）
  Bluefruit.Periph.setConnectCallback(onConnect);

  imuService.begin();
  imuChar.setProperties(CHR_PROPS_NOTIFY);
  imuChar.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  imuChar.setMaxLen(MAX_PAYLOAD);
  imuChar.begin();

  batChar.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  batChar.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  batChar.setFixedLen(2);
  batChar.begin();
  batteryUpdate();

  startAdvertising();
  Serial.print("BLE advertising as ");
  Serial.print(DEVICE_NAME);
  Serial.print(", ");
  Serial.print(SAMPLE_HZ);
  Serial.print(" Hz, accel +-");
  Serial.print(ACCEL_RANGE_G);
  Serial.print(" g, battery ");
  Serial.print(batteryMillivolts());
  Serial.println(" mV");

  xTaskCreate(sampleTask, "imu", 512, NULL, TASK_PRIO_NORMAL, &sampleTaskHandle);
}

// 送る係
void loop() {
  static uint32_t lastBattery = 0;
  static uint32_t lastConnected = 0;
  uint32_t now = millis();
  if (now - lastBattery >= BATTERY_EVERY_MS) {
    lastBattery = now;
    batteryUpdate();
  }
  if (Bluefruit.connected()) lastConnected = now;
  else if (AUTO_OFF_MIN > 0 && now - lastConnected >= AUTO_OFF_MIN * 60000UL) sleepNow();

  bool subscribed = Bluefruit.connected() && imuChar.notifyEnabled();
  if (!subscribed) {
    ringTail = ringHead; // だれも受けていない間のぶんは捨てる（つないだ直後に古い値を送らない）
    delay(5);
    return;
  }

  uint32_t tail = ringTail;
  uint32_t avail = ringHead - tail;
  if (avail == 0) {
    delay(2);
    return;
  }

  BLEConnection* conn = Bluefruit.Connection(Bluefruit.connHandle());
  if (!conn) return;
  uint16_t payload = conn->getMtu() - 3;
  if (payload > MAX_PAYLOAD) payload = MAX_PAYLOAD;
  uint32_t perPacket = (payload - HEADER_LEN) / SAMPLE_LEN; // MTU 23 なら 20 バイト：1件ちょうど入る（7 + 13 = 20）

  const Sample& first = ring[tail % RING_SIZE];
  if (avail < perPacket && (uint32_t)(millis() - first.t) < MAX_WAIT_MS) {
    delay(2); // もう少しためてから送る
    return;
  }

  uint8_t pkt[MAX_PAYLOAD];
  memcpy(pkt, &first.seq, 2);
  memcpy(pkt + 2, &first.t, 4);
  pkt[6] = ACCEL_RANGE_G;
  uint16_t len = HEADER_LEN;
  uint32_t taken = 0;
  while (taken < avail && taken < perPacket) {
    const Sample& s = ring[(tail + taken) % RING_SIZE];
    uint32_t dt = s.t - first.t;
    if (dt > 255) break;                               // 時刻の差が1バイトに入らない：次の通知へ
    if ((uint16_t)(s.seq - first.seq) != taken) break; // 抜けをまたがない：次の通知へ
    pkt[len] = (uint8_t)dt;
    memcpy(pkt + len + 1, s.raw, 12);
    len += SAMPLE_LEN;
    taken++;
  }

  // 送る口に空きがなければ notify は最大100ミリ秒待つ。その間も測る係はためつづける。
  // 送れなかったら、同じサンプルを次の回にもう一度送る
  if (imuChar.notify(pkt, len)) {
    ringTail = tail + taken;
  }
}
