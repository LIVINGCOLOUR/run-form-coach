import { LOG_CHUNK, LogSaver, logPieces, partCount } from '../../core/logChunks'
import { deleteLog, loadLogStamps, logChunkReader, persistStorage, SENSOR_LOGS, writeLogChunk } from '../../core/storage'
import type { RunLog } from '../../core/types'
import type { UploadPayload } from '../../core/upload/queue'
import type { SensorRunner } from './runner'

// カメラなしで使ったセンサーの記録（センサーラン、腰スマホといっしょ）。形はカメラ版と同じ RunLog（rows は空、mode: 'sensor'）で、
// センサーの値（sensors.blocks）と1秒ごとのまとめ（sensors.sec）を、走っている間 60秒ごとに端末へ少しずつ書き出す（core/logChunks.ts。7時間でも残す）。
// 入れ物は SENSOR_LOGS。Mac へは runs/sensor/rfc-sensor-年月日-時分_<id>.json で送る（2時間より長ければ分けて送り、npm run logs がつなぐ）
export const SENSOR_LOG_PATHS = ['sensors.blocks', 'sensors.sec', 'sensors.waistRaw']

export class SensorRunLog {
  readonly log: RunLog
  private readonly saver: LogSaver
  private timer: ReturnType<typeof setInterval> | null = null
  private runner: SensorRunner | null = null

  // clock：同じ瞬間の performance.now()（ms）と Date.now()（ms）。t は performance.now() の秒
  constructor(clock: { perfMs: number; epochMs: number }, withMode?: 'phone') {
    this.log = { id: `sensor-log-${clock.epochMs}`, startedAt: clock.epochMs, mode: 'sensor', clock, width: 0, height: 0, columns: [], points: [], phases: [], rows: [], events: [] }
    if (withMode) this.log.with = withMode
    this.saver = new LogSaver(this.log, { write: (meta, chunk) => writeLogChunk(meta, chunk, SENSOR_LOGS) }, SENSOR_LOG_PATHS)
    void persistStorage().then((st) => {
      if (st) this.log.storage = st
    })
  }

  event = (t: number, text: string) => {
    this.log.events.push([Math.round(t * 100) / 100, text])
  }

  // 走っている間、LOG_CHUNK.every 秒ごとに書き出す
  start(runner: SensorRunner) {
    this.runner = runner
    void this.saver.flush() // 記録の頭を先に書いておく（すぐ落ちても、走ったことは残る）
    this.timer = setInterval(() => {
      const cur = runner.current()
      if (cur) this.log.sensors = cur
      this.summarize()
      void this.saver.flush()
    }, LOG_CHUNK.every * 1000)
  }

  // 知らせた回数（項目ごと）・上限に達した回数・ずれの回数（session.ts の counts）と、位置情報の様子も残す
  private summarize() {
    const r = this.runner
    if (!r) return
    const c = r.session.counts
    this.log.summary = { runSec: Math.round(r.runSec), gaps: r.gaps, stood: r.stoodAt !== null, trunk: r.trunk, cues: { ...c.cues }, capped: { ...c.capped }, slips: { ...c.slips }, ...(r.gpsStatus && { gps: r.gpsStatus }) }
  }

  // 走り終わり：センサーを止めて、残りを書く
  async finish(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const s = this.runner?.finish()
    if (s) this.log.sensors = s
    this.summarize()
    await this.saver.flush(true).catch(() => {})
  }
}

export const sensorLogMeta = (id?: string) => logChunkReader(id, SENSOR_LOGS).then((r) => r?.meta)
export const loadSensorLogStamps = () => loadLogStamps(Date.now(), SENSOR_LOGS)
export const deleteSensorLog = (id: string) => deleteLog(SENSOR_LOGS, id)

export function sensorLogName(startedAt: number): string {
  const d = new Date(startedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `rfc-sensor-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

// Mac へ送る記録の中身（{ log }。session はない）
export async function sensorLogPayload(logId?: string): Promise<UploadPayload | undefined> {
  const r = await logChunkReader(logId, SENSOR_LOGS)
  if (!r) return undefined
  const parts = partCount(r.meta)
  return { name: sensorLogName(r.meta.startedAt), parts, pieces: (k) => logPieces(r.meta, undefined, r.get, parts > 1 ? k : undefined) }
}

// センサーランの結果の画面に出す数（記録の頭から数える。センサーの値そのものは読まない）。
// 接地の回数は、まとめ（summary.cues）があればそこから、なければ（前の記録）events から数える
export function sensorRunCounts(log: RunLog) {
  const s = log.sensors
  const ev = log.events.map((e) => e[1])
  const c = log.summary?.cues
  const capped = log.summary?.capped
  return {
    runMin: (log.summary?.runSec ?? 0) / 60,
    chest: s?.cues.length ?? 0,
    head: s?.head?.cues.length ?? 0,
    sit: c?.sit ?? ev.filter((e) => e.startsWith('sensor:contact sit')).length,
    side: c ? c.longL + c.longR : ev.filter((e) => e.startsWith('sensor:contact long')).length,
    stride: c?.stride ?? ev.filter((e) => e.startsWith('sensor:contact stride')).length,
    capped: capped ? Object.values(capped).reduce((a, b) => a + b, 0) : ev.filter((e) => e.startsWith('sensor:capped')).length,
    bends: s?.bends?.length ?? 0,
    gaps: log.summary?.gaps ?? 0,
    stood: log.summary?.stood ?? !!s?.stand,
    trunk: log.summary?.trunk ?? true,
  }
}
