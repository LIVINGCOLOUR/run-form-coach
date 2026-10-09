import type { Frame, Measure } from './types'
import { L } from './landmarks'

// 調整用の記録。映像は残さず、骨格の点と判定の数字だけを、取れたコマごとに残す
// 書き出したファイルを見て、走っているかの判定やフォームの線を実際の動きに合わせる
export const LOG_POINTS = [
  L.nose, L.leftEar, L.rightEar, L.leftShoulder, L.rightShoulder, L.leftElbow, L.rightElbow, L.leftWrist, L.rightWrist,
  L.leftHip, L.rightHip, L.leftKnee, L.rightKnee, L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel, L.leftFoot, L.rightFoot,
]
export const LOG_COLUMNS = ['t', 'phase', 'visible', 'moving', 'by', 'cadence', 'neck', 'trunk', 'body', 'hipRatio', 'sideDeg', 'still', 'pitch', 'yaw', 'headLean', '...points(x,y,v)']
const PHASES = ['setup', 'baseline', 'run'] as const
const BY = [null, 'steps', 'inPlace'] as const

export interface RunLog {
  id: string
  startedAt: number
  width: number
  height: number
  columns: string[]
  points: number[]
  phases: readonly string[]
  rows: number[][]
  events: [number, string][] // [t, 話した言葉や段階の切り替え]
  sessionId?: string
}

const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

export class LogRecorder {
  log: RunLog
  constructor() {
    const now = Date.now()
    this.log = { id: `log-${now}`, startedAt: now, width: 0, height: 0, columns: LOG_COLUMNS, points: LOG_POINTS, phases: PHASES, rows: [], events: [] }
  }

  frame(
    t: number,
    phase: string,
    w: number,
    h: number,
    frame: Frame | null,
    o: { visible: boolean; moving: boolean; by: 'steps' | 'inPlace' | null; cadence: number | null; m?: Measure; sideDeg: number; still: number; pitch?: number },
  ) {
    const p = PHASES.indexOf(phase as (typeof PHASES)[number])
    if (p < 0) return
    this.log.width = w
    this.log.height = h
    const m = o.m
    const row = [
      r2(t), p, o.visible ? 1 : 0, o.moving ? 1 : 0, BY.indexOf(o.by), o.cadence === null ? -1 : Math.round(o.cadence),
      m ? r1(m.neck) : -999, m ? r1(m.trunk) : -999, m ? r1(m.body) : -999, m ? r2(m.hipRatio) : -999, Math.round(o.sideDeg), Math.min(99, r1(o.still)), r1(o.pitch ?? 0),
      m ? r2(m.yaw) : -999, m ? r1(m.headLean) : -999,
    ]
    if (frame) for (const i of LOG_POINTS) row.push(r1(frame[i].x), r1(frame[i].y), r2(frame[i].v))
    this.log.rows.push(row)
  }

  event(t: number, text: string) {
    this.log.events.push([r2(t), text])
  }
}
