// C3D（計測機器の記録の形式）から、印の3次元の位置を読む。必要なところだけの小さな読み込み
//   ヘッダ：パラメータの場所、印の数、最初と最後のコマ
//   パラメータ：POINT（LABELS・SCALE・RATE・DATA_START）、ANALOG（USED・RATE）
//   データ：コマごとに、印ごとの (x, y, z, 誤差) と、そのあとに同じコマのアナログ（床反力など）が並ぶ
// 浮動小数（SCALE が負）で、Intel の並び（プロセッサ番号 84）のファイルだけ読む
import { readFileSync } from 'node:fs'

export interface C3D {
  labels: string[]
  rate: number
  frames: number
  // points[i][f] = [x, y, z]（mm）。印が見えていないコマは NaN
  points: number[][][]
}

export function readC3D(path: string): C3D {
  const b = readFileSync(path)
  const pblock = b[0]
  const first = b.readUInt16LE(6)
  const last = b.readUInt16LE(8)
  const p0 = (pblock - 1) * 512
  if (b[p0 + 3] !== 84) throw new Error('Intel 以外の C3D は読めません')
  const groups = new Map<number, string>()
  const params = new Map<string, { type: number; dims: number[]; at: number }>()
  let i = p0 + 4
  for (;;) {
    const nlen = b.readInt8(i)
    const gid = b.readInt8(i + 1)
    if (nlen === 0) break
    const name = b.toString('latin1', i + 2, i + 2 + Math.abs(nlen)).trim()
    const off = i + 2 + Math.abs(nlen)
    const next = b.readInt16LE(off)
    if (gid < 0) groups.set(-gid, name)
    else {
      let j = off + 2
      const type = b.readInt8(j)
      const nd = b[j + 1]
      const dims = Array.from({ length: nd }, (_, k) => b[j + 2 + k])
      j += 2 + nd
      params.set(`${groups.get(gid) ?? gid}:${name}`, { type, dims, at: j })
    }
    if (next === 0) break
    i = off + next
  }
  // グループ名は、あとから出てくることがあるので、もう一度つなぎ直す
  const get = (key: string) => {
    for (const [k, v] of params) {
      const [g, n] = k.split(':')
      const gname = /^\d+$/.test(g) ? groups.get(Number(g)) : g
      if (`${gname}:${n}` === key) return v
    }
    return undefined
  }
  const num = (key: string, d = 0) => {
    const p = get(key)
    if (!p) return d
    if (p.type === 4) return b.readFloatLE(p.at)
    if (p.type === 2) return b.readInt16LE(p.at)
    return b.readInt8(p.at)
  }
  const strs = (key: string) => {
    const p = get(key)
    if (!p) return []
    const w = p.dims[0]
    const n = p.dims[1] ?? 1
    return Array.from({ length: n }, (_, k) => b.toString('latin1', p.at + k * w, p.at + (k + 1) * w).trim())
  }
  const used = num('POINT:USED')
  const labels = [...strs('POINT:LABELS'), ...strs('POINT:LABELS2')].slice(0, used)
  const scale = num('POINT:SCALE')
  if (scale >= 0) throw new Error('整数の C3D は読めません')
  const rate = num('POINT:RATE')
  const start = num('POINT:DATA_START')
  const analogUsed = num('ANALOG:USED')
  const analogRate = num('ANALOG:RATE', rate)
  const perFrameAnalog = analogUsed * Math.round(analogRate / rate)
  const frames = last - first + 1
  const points = labels.map(() => [] as number[][])
  let at = (start - 1) * 512
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < used; k++) {
      const x = b.readFloatLE(at)
      const y = b.readFloatLE(at + 4)
      const z = b.readFloatLE(at + 8)
      const res = b.readFloatLE(at + 12)
      at += 16
      if (k < labels.length) points[k].push(res < 0 ? [NaN, NaN, NaN] : [x, y, z])
    }
    at += perFrameAnalog * 4
  }
  return { labels, rate, frames, points }
}
