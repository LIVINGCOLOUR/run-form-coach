import { describe, expect, it } from 'vitest'
import { parsePacket } from '../src/modes/sensor/parse'
import { decodeBlock, SensorRecorder } from '../src/modes/sensor/log'
import { bestThreshold, cadenceOf, cameraRows, coverage, decodeNodes, impactPeaks, runSpans } from './sensor-camera.mjs'

// センサーとカメラの比べ（scripts/compare-sensor-camera.mjs）の計算：記録のブロックを戻して時刻を合わせる、ピッチ、線の決め方、カメラの行の読み方

// ファームと同じ詰め方の通知（sensor.test.ts と同じ形）
function packet(seq: number, t0: number, n: number, a: (i: number) => number[]) {
  const v = new DataView(new ArrayBuffer(7 + n * 13))
  v.setUint16(0, seq, true)
  v.setUint32(2, t0, true)
  v.setUint8(6, 16)
  for (let k = 0; k < n; k++) {
    const o = 7 + k * 13
    v.setUint8(o, k * 10)
    a(seq + k).forEach((x, i) => v.setInt16(o + 7 + i * 2, x, true))
  }
  return parsePacket(v)
}

describe('センサーの記録を戻して、カメラの時計に合わせる', () => {
  it('届いた遅れがばらついても、いちばん遅れの少なかった件に合わせる。切れ目も見つける', () => {
    const rec = new SensorRecorder([{ place: '頭', name: 'RFC-IMU-1' }])
    const clock0 = 100 // センサーの時刻 5000 ms が、カメラの時計の 100 秒
    const lat = [0.08, 0.05, 0.02, 0.09, 0.06, 0.07, 0.04] // 7件で回るので、1秒ごとのブロックの先頭がいろいろな遅れになる
    let k = 0
    for (let seq = 0; seq < 1000; seq += 10) {
      if (seq >= 400 && seq < 700) continue // 3秒切れる
      const t0 = 5000 + seq * 10
      rec.add(0, clock0 + (t0 - 5000) / 1000 + lat[k++ % lat.length], 16, packet(seq, t0, 10, () => [0, 0, 2049]).samples)
    }
    rec.finish()
    const [n] = decodeNodes(rec.log, decodeBlock)
    // 1件おき（stride 2）で残る
    expect(n.samples.length).toBe(350)
    // どの件も、いちばん小さい遅れ（0.02 秒）だけずれた時刻になる（ブロックごとの遅れのばらつきは残らない）
    const s0 = n.samples[0]
    for (const s of n.samples) expect(Math.abs(s.tt - (clock0 + (s.seq * 10) / 1000) - 0.02)).toBeLessThan(1e-6)
    expect(Math.abs(s0.a[2] - 1)).toBeLessThan(0.001)
    const c = coverage(n.samples)
    expect(c.gaps.length).toBe(1)
    expect(c.gaps[0][1] - c.gaps[0][0]).toBeGreaterThan(2.9)
  })
})

describe('足首の加速度からピッチ', () => {
  it('片足の周期 0.72 秒（両足で 166.7 歩/分）を、自己相関と衝撃の山で出す', () => {
    const period = 0.72
    const samples = Array.from({ length: 500 }, (_, i) => {
      const tt = i / 50
      const ph = (tt % period) / period
      const g = 1 + (ph < 0.08 ? 4 * Math.sin((ph / 0.08) * Math.PI) : 0) + 0.3 * Math.sin(2 * Math.PI * tt * 3)
      return { tt, seq: i, a: [0, 0, g], g: [0, 0, 0] }
    })
    expect(Math.abs(cadenceOf(samples) - 120 / period)).toBeLessThan(2)
    const pk = impactPeaks(samples)
    expect(pk.length).toBe(Math.ceil(10 / period))
  })
})

describe('線の決め方', () => {
  it('崩れと崩れでないを分ける線と、一致率', () => {
    const xs = [1, 2, 3, 4, 5, 20, 21, 22, 6]
    const ls = [false, false, false, false, false, true, true, true, false]
    const f = bestThreshold(xs, ls)
    expect(f.threshold).toBe(13)
    expect(f.agree).toBe(1)
    expect(f.auc).toBe(1)
    // 答えがない値（null）は数えない
    expect(bestThreshold([1, 30], [null, true]).pos).toBe(1)
  })
})

describe('カメラの記録の行', () => {
  it('-999 と -1（ピッチ）は測れなかった値。走っていた区間は短いものを除く', () => {
    const log = {
      columns: ['t', 'phase', 'visible', 'moving', 'by', 'cadence', 'neck', 'trunk', 'body', 'hipRatio', 'sideDeg', 'still', 'pitch', 'yaw', 'headLean', 'chin', '...points(x,y,v)'],
      points: [0],
      phases: ['setup', 'baseline', 'run'],
      rows: [
        [10, 2, 1, 1, 1, -1, -999, 5, 7, 1, 90, 0, 0, 0, 30, 1, 100, 200, 0.9],
        ...Array.from({ length: 80 }, (_, i) => [20 + i * 0.1, 2, 1, 1, 1, 160, 40, 5, 7, 1, 90, 0, 0, 0, 30, 1]),
      ],
    }
    const rows = cameraRows(log)
    expect(rows[0].neck).toBeNaN()
    expect(rows[0].cadence).toBeNaN()
    expect(rows[0].pts[0]).toEqual({ x: 100, y: 200, v: 0.9 })
    expect(rows[1].pts).toBeUndefined()
    expect(runSpans(rows)).toEqual([[20, 20 + 79 * 0.1]])
  })
})
