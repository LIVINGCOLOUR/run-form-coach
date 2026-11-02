// 03_ble_imu が送る1回の通知を、サンプルの並びに戻す（形はファームの先頭のコメントと同じ。hardware/sensor/viewer/viewer.html の parsePacket を移したもの）
//   0-1 先頭の通し番号 uint16 / 2-5 先頭の時刻 uint32 ms / 6 加速度の範囲 uint8 g（8 か 16）/ 7- 1件13バイト × N
//   1件：時刻の差 uint8 ms、ジャイロ xyz int16、加速度 xyz int16（すべてリトルエンディアン）
export const G_SCALE = 0.07 // dps / 1（±2000 dps）
export const HEADER_LEN = 7
export const SAMPLE_LEN = 13
// 加速度の 1 が何 g か（LSM6DSV16X のデータシート：±8g は 0.244 mg、±16g は 0.488 mg）
export const A_SCALES: Record<number, number> = { 8: 0.000244, 16: 0.000488 }

export type Vec3 = [number, number, number]

export interface ImuSample {
  seq: number // 通し番号（uint16。65535 の次は 0）
  t: number // センサーが起動してからのミリ秒
  g: Vec3 // ジャイロ（dps）
  a: Vec3 // 加速度（g）
  raw: Uint8Array // ジャイロ xyz・加速度 xyz の元の12バイト（記録に使う）
}

export interface Packet {
  seq: number
  range: number
  n: number
  samples: ImuSample[]
}

const vec = (v: DataView, o: number, scale: number): Vec3 => [v.getInt16(o, true) * scale, v.getInt16(o + 2, true) * scale, v.getInt16(o + 4, true) * scale]

export function parsePacket(v: DataView): Packet {
  const len = v.byteLength
  // 形が合わない（古いファームの通知など）ときは 0 件として扱い、でたらめな値を出さない
  if (len < HEADER_LEN + SAMPLE_LEN || (len - HEADER_LEN) % SAMPLE_LEN !== 0) return { seq: 0, range: 0, n: 0, samples: [] }
  const range = v.getUint8(6)
  const aScale = A_SCALES[range]
  if (!aScale) return { seq: 0, range, n: 0, samples: [] }
  const seq = v.getUint16(0, true)
  const t0 = v.getUint32(2, true)
  const n = (len - HEADER_LEN) / SAMPLE_LEN
  const samples: ImuSample[] = []
  for (let k = 0; k < n; k++) {
    const o = HEADER_LEN + k * SAMPLE_LEN
    samples.push({
      seq: (seq + k) & 0xffff,
      t: t0 + v.getUint8(o),
      g: vec(v, o + 1, G_SCALE),
      a: vec(v, o + 7, aScale),
      raw: new Uint8Array(v.buffer.slice(v.byteOffset + o + 1, v.byteOffset + o + 13)),
    })
  }
  return { seq, range, n, samples }
}

// 電池のキャラクタリスティック（0xFFE2）：uint16 ミリボルト → ボルト
export function parseBattery(v: DataView): number {
  return v.getUint16(0, true) / 1000
}
