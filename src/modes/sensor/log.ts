import type { SensorLog } from '../../core/types'
import { A_SCALES, G_SCALE, HEADER_LEN, type ImuSample, type Vec3 } from './parse'
import { SENSOR_LOG } from './params'

// 走った記録（RunLog の sensors）に入れるセンサーの値。届いた値のうち SENSOR_LOG.stride 件に1件を、センサーごとに約1秒ずつ
// 1つのかたまり（ブロック）にして base64 で残す。形は core/types.ts の SensorLog。上限を超えたら値は残さない
const ITEM_LEN = 14

interface Open {
  t: number
  range: number
  lastSeq: number
  lastT: number
  bytes: number[]
}

const toB64 = (bytes: number[]) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000))
  return btoa(s)
}

export class SensorRecorder {
  log: SensorLog
  private open: (Open | null)[]
  private chars = 0
  private readonly opts: typeof SENSOR_LOG

  constructor(nodes: { place: string; name: string }[], opts: typeof SENSOR_LOG = SENSOR_LOG) {
    this.opts = opts
    this.log = { version: 1, nodes: nodes.map((n) => ({ ...n })), stride: opts.stride, blocks: [], cues: [] }
    this.open = nodes.map(() => null)
  }

  // node 番目のセンサーから、t に届いたサンプル
  add(node: number, t: number, range: number, samples: ImuSample[]) {
    if (this.log.cappedAt !== undefined || node < 0 || node >= this.open.length) return
    for (const s of samples) {
      if (s.seq % this.opts.stride !== 0) continue
      let b = this.open[node]
      const dseq = b ? (s.seq - b.lastSeq) & 0xffff : 0
      const dt = b ? s.t - b.lastT : 0
      // 1秒たった・間があきすぎて1バイトに入らない・範囲が変わった：新しいブロックにする
      if (b && (t - b.t >= this.opts.block || dseq > 255 || dt < 0 || dt > 255 || range !== b.range)) {
        this.flush(node)
        if (this.log.cappedAt !== undefined) return
        b = null
      }
      if (!b) {
        b = { t, range, lastSeq: s.seq, lastT: s.t, bytes: [] }
        this.open[node] = b
        b.bytes.push(s.seq & 0xff, s.seq >> 8, s.t & 0xff, (s.t >>> 8) & 0xff, (s.t >>> 16) & 0xff, (s.t >>> 24) & 0xff, range, 0, 0, ...s.raw)
      } else {
        b.bytes.push(dseq, dt, ...s.raw)
      }
      b.lastSeq = s.seq
      b.lastT = s.t
    }
  }

  private flush(node: number) {
    const b = this.open[node]
    this.open[node] = null
    if (!b) return
    const text = toB64(b.bytes)
    if (this.chars + text.length > this.opts.maxChars) {
      this.log.cappedAt = b.t
      this.open = this.open.map(() => null)
      return
    }
    this.chars += text.length
    this.log.blocks.push([Math.round(b.t * 100) / 100, node, text])
  }

  // 走り終わり：まとめかけのブロックを入れる
  finish() {
    for (let i = 0; i < this.open.length && this.log.cappedAt === undefined; i++) this.flush(i)
  }

  cue(t: number, tilt: number, buzzed: boolean) {
    this.log.cues.push([Math.round(t * 100) / 100, Math.round(tilt * 10) / 10, buzzed ? 1 : 0])
  }
}

// 記録のブロックを、サンプルの並び（通し番号・センサーの時刻 ms・ジャイロ dps・加速度 g）に戻す。形が合わなければ空
export function decodeBlock(b64: string): { seq: number; t: number; g: Vec3; a: Vec3 }[] {
  const bin = atob(b64)
  const v = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer)
  if (v.byteLength < HEADER_LEN + ITEM_LEN || (v.byteLength - HEADER_LEN) % ITEM_LEN !== 0) return []
  const aScale = A_SCALES[v.getUint8(6)]
  if (!aScale) return []
  let seq = v.getUint16(0, true)
  let t = v.getUint32(2, true)
  const out = []
  for (let o = HEADER_LEN; o < v.byteLength; o += ITEM_LEN) {
    seq = (seq + v.getUint8(o)) & 0xffff
    t += v.getUint8(o + 1)
    const r = (i: number, s: number) => v.getInt16(o + 2 + i * 2, true) * s
    out.push({ seq, t, g: [r(0, G_SCALE), r(1, G_SCALE), r(2, G_SCALE)] as Vec3, a: [r(3, aScale), r(4, aScale), r(5, aScale)] as Vec3 })
  }
  return out
}
