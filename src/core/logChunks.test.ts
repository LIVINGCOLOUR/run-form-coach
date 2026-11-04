import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { assembleLog, chunkId, LOG_CHUNK, LogSaver, logPieces, mergeParts, partCount, type LogChunk } from './logChunks'
import { packPieces } from './upload/pack'
import { joinPieces } from './upload/queue'
import type { RunLog, SensorLog } from './types'
import { SENSOR_LOG } from '../modes/sensor/params'

// 端末の入れ物の作り物（IndexedDB の代わり）。書いたかたまりと記録の頭を、書いたときの形で覚える（IndexedDB も書いたときに写しを取る）
class MemSink {
  chunks = new Map<number, LogChunk>()
  meta: RunLog | null = null
  fail = 0
  bytes = 0
  async write(meta: RunLog, chunk: LogChunk | null) {
    if (this.fail > 0) {
      this.fail--
      throw new Error('QuotaExceededError')
    }
    if (chunk) {
      const c = JSON.parse(JSON.stringify(chunk)) as LogChunk
      this.chunks.set(c.n, c)
      this.bytes += JSON.stringify(c).length
    }
    this.meta = JSON.parse(JSON.stringify(meta))
  }
  get = async (n: number) => this.chunks.get(n)
}

const newLog = (): RunLog => ({ id: 'log-1793790318421', startedAt: 1793790318421, width: 720, height: 1280, columns: ['t'], points: [], phases: ['setup', 'baseline', 'run'], rows: [], events: [] })
const sensors = (): SensorLog => ({ version: 1, nodes: [{ place: '胸', name: 'RFC-IMU-2' }], stride: 2, blocks: [], cues: [] })

describe('長い記録を少しずつ書き出す（LogSaver）', () => {
  it('書き出すと手元の配列は空になり、つなぐと元どおり。記録の頭（events など）はそのまま', async () => {
    const sink = new MemSink()
    const log = newLog()
    log.sensors = sensors()
    const saver = new LogSaver(log, sink)
    const all: number[][] = []
    for (let m = 0; m < 3; m++) {
      for (let i = 0; i < 5; i++) {
        const row = [m * 60 + i, 2]
        log.rows.push(row)
        all.push(row)
      }
      log.sensors.blocks.push([m, 0, `b${m}`])
      log.events.push([m, `e${m}`])
      await saver.flush()
      expect(log.rows).toEqual([])
      expect(log.sensors.blocks).toEqual([])
      expect(sink.meta!.recording).toBe(true)
    }
    log.rows.push([999, 2]) // 最後の書き出しの前に増えた分
    await saver.flush(true)
    expect(sink.meta!.recording).toBe(false)
    expect(sink.meta!.chunks).toEqual({ n: 4, paths: LOG_CHUNK.paths })
    const back = await assembleLog(JSON.parse(JSON.stringify(sink.meta)), sink.get)
    expect(back.rows).toEqual([...all, [999, 2]])
    expect(back.sensors!.blocks).toEqual([[0, 0, 'b0'], [1, 0, 'b1'], [2, 0, 'b2']])
    expect(back.events).toEqual([[0, 'e0'], [1, 'e1'], [2, 'e2']])
    expect(sink.chunks.get(0)!.id).toBe(chunkId(log.id, 0))
  })

  it('アプリが落ちても、書き出したところまでは残る（recording のまま）', async () => {
    const sink = new MemSink()
    const log = newLog()
    const saver = new LogSaver(log, sink)
    log.rows.push([1], [2])
    await saver.flush()
    log.rows.push([3]) // 書き出す前に落ちた
    const back = await assembleLog(JSON.parse(JSON.stringify(sink.meta)), sink.get)
    expect(back.rows).toEqual([[1], [2]])
    expect(back.recording).toBe(true)
  })

  it('書き出せなかった（入れ物がいっぱい）ときは、手元に戻して次にもう一度書く。並びも変わらない', async () => {
    const sink = new MemSink()
    const log = newLog()
    const saver = new LogSaver(log, sink)
    log.rows.push([1])
    await saver.flush()
    sink.fail = 1
    log.rows.push([2])
    await saver.flush()
    expect(saver.failures).toBe(1)
    expect(log.rows).toEqual([[2]])
    log.rows.push([3])
    await saver.flush(true)
    const back = await assembleLog(JSON.parse(JSON.stringify(sink.meta)), sink.get)
    expect(back.rows).toEqual([[1], [2], [3]])
    expect(back.chunks!.n).toBe(2)
  })

  it('前の形の記録（chunks がない）は、そのまま読める・送れる', async () => {
    const log = { ...newLog(), rows: [[1, 2]] }
    expect(await assembleLog(log, async () => undefined)).toBe(log)
    expect(partCount(log)).toBe(1)
    const text = await joinPieces(logPieces(log, { id: 's' }, async () => undefined))
    expect(JSON.parse(text)).toEqual({ log, session: { id: 's' } })
  })
})

describe('7時間の走り（マラソン）をそのまま残す', () => {
  // センサー5か所（params.ts の SENSOR_LOG の速さ）・カメラの骨格の行（間引いて約8行/秒、1行 73個の数。11-04 の記録と同じくらい）・1秒ごとのまとめ
  const HOURS = 7
  const places = ['頭', '胸', '左手首', '左足首', '右足首']
  // 1秒のブロックの base64 の長さ（ブロックの頭 9バイト + 1件14バイト）
  const b64Len = (place: string) => Math.ceil(((9 + (100 / SENSOR_LOG.rates[place].every) * 14) * 4) / 3 / 4) * 4
  const blockText = Object.fromEntries(places.map((p) => [p, 'A'.repeat(b64Len(p))]))
  const row = Array.from({ length: 73 }, (_, i) => 100 + i + 0.5)

  it(
    '1分ごとに書き出し、手元は1分ぶんより大きくならない。2時間ごとの4つのファイルに分けて送り、Mac でつなぐと全部そろう',
    async () => {
      const sink = new MemSink()
      const log = newLog()
      log.sensors = { ...sensors(), nodes: places.map((place) => ({ place, name: 'x' })), sec: [], secCols: ['t'] }
      const saver = new LogSaver(log, sink)
      let maxHeld = 0
      let rows = 0
      let blocks = 0
      const minutes = HOURS * 60
      for (let m = 0; m < minutes; m++) {
        for (let s = 0; s < 60; s++) {
          const t = m * 60 + s
          for (let k = 0; k < 8; k++) log.rows.push([t, ...row])
          places.forEach((p, i) => log.sensors!.blocks.push([t, i, blockText[p]]))
          log.sensors!.sec!.push([t, 1, 14.2, 13.9, 6.1, 6.0, 0, 0.372, 270, 275, 9.1, 168])
          rows += 8
          blocks += places.length
        }
        maxHeld = Math.max(maxHeld, log.rows.length + log.sensors!.blocks.length)
        await saver.flush(m === minutes - 1)
      }
      // 手元に持つのは1分ぶん（8行 × 60 + 5 × 60）まで
      expect(maxHeld).toBe(60 * 8 + 60 * places.length)
      expect(log.rows.length + log.sensors!.blocks.length).toBe(0)
      // 1つのかたまり（IndexedDB の1件）は 1MB より小さい
      for (const c of sink.chunks.values()) expect(JSON.stringify(c).length).toBeLessThan(1_000_000)
      const meta = sink.meta!
      expect(meta.chunks!.n).toBe(minutes)
      expect(meta.recording).toBe(false)
      // 端末に書いた大きさ：約22MB/時（センサー 約12MB・骨格 約10MB）
      const perHour = sink.bytes / HOURS / 1e6
      expect(perHour).toBeGreaterThan(18)
      expect(perHour).toBeLessThan(26)

      // 送る：2時間ごとに分ける（7時間なら4つ）。1つのファイルは縮める前でも送り先の上限 64MB より小さい
      const parts = partCount(meta)
      expect(parts).toBe(4)
      const files: { part?: [number, number]; log: RunLog; session?: unknown }[] = []
      for (let k = 0; k < parts; k++) {
        const text = await joinPieces(logPieces(meta, { id: 'session-1', samples: [] }, sink.get, k))
        expect(text.length).toBeLessThan(64 * 1024 * 1024)
        files.push(JSON.parse(text))
      }
      expect(files.map((f) => f.part)).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])
      expect(files[0].session).toEqual({ id: 'session-1', samples: [] })
      expect(files[1].session).toBeUndefined()
      // Mac（npm run logs）でつなぐ：順番が入れ替わって届いても、全部そろう
      const merged = mergeParts([files[2], files[0], files[3], files[1]])
      expect(merged.log.rows.length).toBe(rows)
      expect(merged.log.sensors!.blocks.length).toBe(blocks)
      expect(merged.log.sensors!.sec!.length).toBe(HOURS * 3600)
      expect(merged.log.rows[0][0]).toBe(0)
      expect(merged.log.rows[rows - 1][0]).toBe(HOURS * 3600 - 1)
      expect(merged.session).toEqual({ id: 'session-1', samples: [] })
    },
    120_000,
  )
})

describe('切れはしのまま縮める（packPieces）', () => {
  it('gzip をほどくと、つないだ JSON と同じ', async () => {
    const log = newLog()
    log.rows = Array.from({ length: 2000 }, (_, i) => [i, i * 2])
    const sink = new MemSink()
    const saver = new LogSaver(log, sink)
    await saver.flush(true)
    const meta = sink.meta!
    const p = await packPieces(() => logPieces(meta, undefined, sink.get))
    expect(p.gzip).toBe(true)
    const text = gunzipSync(Buffer.from(await p.body.arrayBuffer())).toString('utf8')
    expect(text).toBe(await joinPieces(logPieces(meta, undefined, sink.get)))
    expect(JSON.parse(text).log.rows.length).toBe(2000)
  })

  it('縮められないときは、縮めずに切れはしを並べる', async () => {
    const p = await packPieces(
      async function* () {
        yield '{"a":'
        yield '[1,2]}'
      },
      { compress: false },
    )
    expect(p.gzip).toBe(false)
    expect(JSON.parse(await p.body.text())).toEqual({ a: [1, 2] })
  })
})

describe('スマホ版の記録も同じしくみで少しずつ書き出す（phone/storage.ts の PHONE_LOG_PATHS）', () => {
  it('生の値・1秒ごとの値・GPS を分けて書き、つなぐと元どおり。前の上限（40万行）を越えても切らない', async () => {
    const { PhoneLogRecorder } = await import('../modes/phone/log')
    const { PHONE_LOG_PATHS } = await import('../modes/phone/storage')
    const rec = new PhoneLogRecorder({ perfMs: 0, epochMs: 1_000 }, { userAgent: 'test', intervalMs: 16 }, 'outdoor')
    const sink = new MemSink()
    const saver = new LogSaver(rec.log, sink as never, PHONE_LOG_PATHS)
    const want = { rows: 0, gps: 0 }
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 150_000; i++) {
        rec.raw({ t: want.rows / 60, ax: 0, ay: 0, az: 9.8 }, 'running')
        want.rows++
      }
      rec.gps({ t: c, accuracy: 5, speed: 3, altitude: null, altitudeAccuracy: null } as never, { stepM: 3, raw: 3, speed: 3, used: true } as never)
      want.gps++
      await saver.flush()
      expect(rec.log.rows.length).toBe(0) // 手元には残さない
    }
    await saver.flush(true)
    const full = JSON.parse(await joinPieces(logPieces(sink.meta!, undefined, async (n) => sink.chunks.get(n))))
    expect(full.log.rows).toHaveLength(450_000)
    expect(full.log.gps).toHaveLength(3)
    expect(full.log.truncated).toBeUndefined()
    expect(full.log.recording).toBe(false)
    expect(full.log.rows[449_999][0]).toBeCloseTo(449_999 / 60, 2)
  })
})
