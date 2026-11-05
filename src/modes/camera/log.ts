import type { Frame, RunLog } from '../../core/types'
import type { Measure } from './types'
import { L } from './landmarks'
import type { WorldAngles } from './world'

// 調整用の記録。映像は残さず、骨格の点と判定の数字だけを、取れたコマごとに残す
// 書き出したファイルを見て、走っているかの判定やフォームの線を実際の動きに合わせる
export const LOG_POINTS = [
  L.nose, L.leftEar, L.rightEar, L.leftShoulder, L.rightShoulder, L.leftElbow, L.rightElbow, L.leftWrist, L.rightWrist,
  L.leftHip, L.rightHip, L.leftKnee, L.rightKnee, L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel, L.leftFoot, L.rightFoot,
]
// yaw：前側・後ろ側の値（geometry の yawSign、小数3桁。÷ CAM_YAW.perDeg で見積もった向き（度））。
// roll：傾きセンサーのスマホの左右の傾き（度。分からなければ -999。分からない間は体全体・上体・着地を線と比べていない）。
// wYaw・wTrunk・wNeck・wHeadLean：worldLandmarks から出した体の向き（度、前側が正）と、体の横の面での上体・首・頭の位置（world.ts。記録だけ。無ければ -999）
export const LOG_COLUMNS = ['t', 'phase', 'visible', 'moving', 'by', 'cadence', 'neck', 'trunk', 'body', 'hipRatio', 'sideDeg', 'still', 'pitch', 'yaw', 'headLean', 'chin', 'roll', 'wYaw', 'wTrunk', 'wNeck', 'wHeadLean', '...points(x,y,v)']
const PHASES = ['setup', 'baseline', 'run'] as const
const BY = [null, 'steps', 'inPlace'] as const

const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

export class LogRecorder {
  log: RunLog
  // clock：t が performance.now() の秒のとき（カメラで撮るとき）に、同じ瞬間の performance.now() と Date.now() を渡す。
  //   スマホ版の記録と時刻を合わせるため（scripts/compare-runs.mjs）。動画で試すときは渡さない
  constructor(clock?: { perfMs: number; epochMs: number }) {
    const now = clock?.epochMs ?? Date.now()
    this.log = { id: `log-${now}`, startedAt: now, width: 0, height: 0, columns: LOG_COLUMNS, points: LOG_POINTS, phases: PHASES, rows: [], events: [] }
    if (clock) this.log.clock = clock
  }

  frame(
    t: number,
    phase: string,
    w: number,
    h: number,
    frame: Frame | null,
    o: { visible: boolean; moving: boolean; by: 'steps' | 'inPlace' | null; cadence: number | null; m?: Measure; sideDeg: number; still: number; pitch?: number; roll?: number | null; world?: WorldAngles | null },
  ) {
    const p = PHASES.indexOf(phase as (typeof PHASES)[number])
    if (p < 0) return
    this.log.width = w
    this.log.height = h
    const m = o.m
    const row = [
      r2(t), p, o.visible ? 1 : 0, o.moving ? 1 : 0, BY.indexOf(o.by), o.cadence === null ? -1 : Math.round(o.cadence),
      m ? r1(m.neck) : -999, m ? r1(m.trunk) : -999, m ? r1(m.body) : -999, m ? r2(m.hipRatio) : -999, Math.round(o.sideDeg), Math.min(99, r1(o.still)), r1(o.pitch ?? 0),
      m ? r3(m.yaw) : -999, m ? r1(m.headLean) : -999, m ? r1(m.chin) : -999,
      o.roll === null || o.roll === undefined ? -999 : r1(o.roll),
      ...(o.world ? [r1(o.world.yaw), r1(o.world.trunk), r1(o.world.neck), r1(o.world.headLean)] : [-999, -999, -999, -999]),
    ]
    if (frame) for (const i of LOG_POINTS) row.push(r1(frame[i].x), r1(frame[i].y), r2(frame[i].v))
    this.log.rows.push(row)
  }

  event(t: number, text: string) {
    this.log.events.push([r2(t), text])
  }
}
