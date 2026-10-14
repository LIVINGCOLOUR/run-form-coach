// 手順6：センサーの値を Bluetooth（BLE）で送る
// 1秒に100回（SAMPLE_HZ を 50 にすると50回）、時刻と、ジャイロ3軸・加速度3軸を測り、
// 何回分かをまとめて1回の通知で送る。Mac の Chrome で viewer/viewer.html を開いて受ける
//
// なぜまとめるか：Mac は接続の間隔（数十ミリ秒）ごとに少ししか受け取らないので、
// 1回に1件ずつ送ると 1秒に約16回で頭打ちになる。測ったものはリングバッファにためて、取りこぼさない
//
// 送る中身（1回の通知、すべてリトルエンディアン）
//   0-1 : 先頭のサンプルの通し番号（uint16、1サンプルごとに1増える。飛んだら抜け）
//   2-5 : 先頭のサンプルの時刻（XIAO が起動してからのミリ秒、uint32）
//   6-  : サンプルを N 件、1件13バイト
//           +0     : 先頭のサンプルからの時刻の差（uint8、ミリ秒）
//           +1..6  : ジャイロ x, y, z（int16、1 = 0.07 dps）
//           +7..12 : 加速度 x, y, z（int16、1 = 0.000244 g）
//   N =（通知の長さ - 6）/ 13。MTU が 23 のままなら N = 1、247 なら最大 18
//   通知の中のサンプルは通し番号が1ずつ続いている（k 件目の番号 = 先頭の番号 + k）
//
// センサーの設定と配線は 02_check_lsm6dsv と同じ

#include <Adafruit_TinyUSB.h>
#include <Arduino.h>
#include <Wire.h>
#include <bluefruit.h>

const char* DEVICE_NAME = "RFC-IMU-1"; // 2個目を作るときは RFC-IMU-2 などに変える
constexpr uint32_t SAMPLE_HZ = 100;    // 1秒に測る回数。50 か 100
constexpr uint32_t MAX_WAIT_MS = 30;   // いちばん古いサンプルがこれだけ待ったら、満杯でなくても送る

constexpr uint8_t LSM6_ADDR_GND = 0x6A;
constexpr uint8_t LSM6_ADDR_VCC = 0x6B;
uint8_t lsm6_addr = 0;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1 = 0x10;
constexpr uint8_t REG_CTRL2 = 0x11;
constexpr uint8_t REG_CTRL6 = 0x15;
constexpr uint8_t REG_CTRL8 = 0x17;
constexpr uint8_t REG_OUTX_L_G = 0x22;

constexpr uint16_t HEADER_LEN = 6;
constexpr uint16_t SAMPLE_LEN = 13;
constexpr uint16_t MAX_PAYLOAD = 244; // MTU 247 - 3

BLEService imuService(0xFFE0);
BLECharacteristic imuChar(0xFFE1);

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
  writeReg(REG_CTRL8, 0b10000010); // 加速度の範囲：±8 g
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

  startAdvertising();
  Serial.print("BLE advertising as ");
  Serial.print(DEVICE_NAME);
  Serial.print(", ");
  Serial.print(SAMPLE_HZ);
  Serial.println(" Hz");

  xTaskCreate(sampleTask, "imu", 512, NULL, TASK_PRIO_NORMAL, NULL);
}

// 送る係
void loop() {
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
  uint32_t perPacket = (payload - HEADER_LEN) / SAMPLE_LEN; // MTU 23 なら 20 バイト：1件ちょうど入る

  const Sample& first = ring[tail % RING_SIZE];
  if (avail < perPacket && (uint32_t)(millis() - first.t) < MAX_WAIT_MS) {
    delay(2); // もう少しためてから送る
    return;
  }

  uint8_t pkt[MAX_PAYLOAD];
  memcpy(pkt, &first.seq, 2);
  memcpy(pkt + 2, &first.t, 4);
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
