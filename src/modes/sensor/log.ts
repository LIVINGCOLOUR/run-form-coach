import type { SensorLog } from '../../core/types'
import { A_SCALES, G_SCALE, HEADER_LEN, type ImuSample, type Vec3 } from './parse'
import { SENSOR_LOG } from './params'

// 走った記録（RunLog の sensors）に入れるセンサーの値。場所ごとに SENSOR_LOG.rates の every 件に1件（mean なら、その間の平均）を、
// センサーごとに約1秒ずつ1つのかたまり（ブロック）にして base64 で残す。形は core/types.ts の SensorLog。
// 上限は置かない。走っている間は、カメラ版の記録といっしょに少しずつ端末へ書き出し（blocks・sec の中身はそのとき手元から消える。core/logChunks.ts）
const ITEM_LEN = 14

interface Open {
  t: number
  range: number
  lastSeq: number
  lastT: number
  bytes: number[]
}

// 平均をとっている途中の窓（通し番号が every で割り切れる件から）
interface Acc {
  key: number // 窓の先頭の通し番号
  t: number // 窓の最初の件のセンサーの時刻（ms）
  at: number // 窓の最初の件が届いた t
  range: number
  n: number
  sum: number[] // ジャイロ xyz・加速度 xyz の生の値の合計
}

const toB64 = (bytes: number[]) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000))
  return btoa(s)
}

const int16s = (raw: Uint8Array): number[] => {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  return [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(i * 2, true))
}
const rawOf = (xs: number[]): number[] => {
  const out: number[] = []
  for (const x of xs) {
    const k = Math.max(-32768, Math.min(32767, Math.round(x))) & 0xffff
    out.push(k & 0xff, k >> 8)
  }
  return out
}

export class SensorRecorder {
  log: SensorLog
  private open: (Open | null)[]
  private acc: (Acc | null)[]
  private readonly every: number[]
  private readonly mean: boolean[]
  private readonly opts: typeof SENSOR_LOG

  constructor(nodes: { place: string; name: string }[], opts: typeof SENSOR_LOG = SENSOR_LOG) {
    this.opts = opts
    const rate = nodes.map((n) => opts.rates[n.place] ?? opts.fallback)
    this.every = rate.map((r) => Math.max(1, Math.round(r.every)))
    this.mean = rate.map((r, i) => r.mean && this.every[i] > 1)
    // stride：前の読み手のための値（足首の間隔）。場所ごとの値は strides
    this.log = { version: 1, nodes: nodes.map((n) => ({ ...n })), stride: opts.fallback.every, strides: [...this.every], mean: [...this.mean], blocks: [], cues: [] }
    this.open = nodes.map(() => null)
    this.acc = nodes.map(() => null)
  }

  // node 番目のセンサーから、t に届いたサンプル
  add(node: number, t: number, range: number, samples: ImuSample[]) {
    if (node < 0 || node >= this.open.length) return
    const every = this.every[node]
    for (const s of samples) {
      if (!this.mean[node]) {
        if (s.seq % every === 0) this.put(node, t, range, s.seq, s.t, Array.from(s.raw))
        continue
      }
      // 平均：通し番号が every で割り切れる件から、次に割り切れる件の前まで（抜けた件は数えない）
      const key = s.seq - (s.seq % every)
      let a = this.acc[node]
      if (a && (a.key !== key || a.range !== range || s.t - a.t > every * 20)) {
        this.emit(node)
        a = null
      }
      if (!a) {
        a = { key, t: s.t, at: t, range, n: 0, sum: [0, 0, 0, 0, 0, 0] }
        this.acc[node] = a
      }
      const v = int16s(s.raw)
      for (let i = 0; i < 6; i++) a.sum[i] += v[i]
      a.n++
    }
  }

  private emit(node: number) {
    const a = this.acc[node]
    this.acc[node] = null
    if (!a || !a.n) return
    this.put(node, a.at, a.range, a.key, a.t, rawOf(a.sum.map((x) => x / a.n)))
  }

  // 残す1件（seq・センサーの時刻 ms・12バイト）
  private put(node: number, t: number, range: number, seq: number, st: number, raw: number[]) {
    let b = this.open[node]
    const dseq = b ? (seq - b.lastSeq) & 0xffff : 0
    const dt = b ? st - b.lastT : 0
    // 1秒たった・間があきすぎて1バイトに入らない・範囲が変わった：新しいブロックにする
    if (b && (t - b.t >= this.opts.block || dseq > 255 || dt < 0 || dt > 255 || range !== b.range)) {
      this.flush(node)
      b = null
    }
    if (!b) {
      b = { t, range, lastSeq: seq, lastT: st, bytes: [] }
      this.open[node] = b
      b.bytes.push(seq & 0xff, seq >> 8, st & 0xff, (st >>> 8) & 0xff, (st >>> 16) & 0xff, (st >>> 24) & 0xff, range, 0, 0, ...raw)
    } else {
      b.bytes.push(dseq, dt, ...raw)
    }
    b.lastSeq = seq
    b.lastT = st
  }

  private flush(node: number) {
    const b = this.open[node]
    this.open[node] = null
    if (!b) return
    this.log.blocks.push([Math.round(b.t * 100) / 100, node, toB64(b.bytes)])
  }

  // 走り終わり：まとめかけのブロックを入れる
  finish() {
    for (let i = 0; i < this.open.length; i++) {
      if (this.mean[i]) this.emit(i)
      this.flush(i)
    }
  }

  // 1秒ごとのまとめ（cols の並び）
  second(cols: string[], row: (number | null)[]) {
    this.log.secCols ??= cols
    ;(this.log.sec ??= []).push(row)
  }

  // 電池の電圧（V）
  battery(t: number, node: number, v: number) {
    ;(this.log.bat ??= []).push([Math.round(t * 10) / 10, node, Math.round(v * 1000) / 1000])
  }

  // 体を曲げたとみなした（胸の傾き）
  bend(t: number, tilt: number) {
    ;(this.log.bends ??= []).push([Math.round(t * 100) / 100, Math.round(tilt * 10) / 10])
  }

  // 知らせた記録。part：胸（猫背）か頭（前に出る）
  cue(t: number, tilt: number, buzzed: boolean, part: 'chest' | 'head' = 'chest') {
    const c: [number, number, number] = [Math.round(t * 100) / 100, Math.round(tilt * 10) / 10, buzzed ? 1 : 0]
    if (part === 'head') (this.log.head ??= { cues: [] }).cues.push(c)
    else this.log.cues.push(c)
  }
}

// node 番目の場所の、記録に残した値の回数（Hz）。場所ごとに変える前の記録は stride（なければ 2）
export const nodeHz = (log: Pick<SensorLog, 'stride' | 'strides'>, node: number) => 100 / (log.strides?.[node] ?? log.stride ?? 2)

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
