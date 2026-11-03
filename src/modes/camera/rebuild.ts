// 前の作り方で記録した走り姿（決まった1.2秒。Stride.sec が無い）を、端末に残っている調整用の記録（骨格の点）から作り直す。
// 前の作り方は走り出しのゆっくりした数分からも取っていて、表示で1周に直しても、歩いているような走り姿のままだったため。
// 記録のコマを、走っていたときと同じ Coach に流し込み、走り姿だけを取り出す（声や点数は記録のまま変えない）
import type { Frame, RunLog, Session } from '../../core/types'
import { activeItems } from '../../core/level'
import { RUNNING } from '../../core/params'
import { loadLog, saveSession } from '../../core/storage'
import { Coach } from './coach'
import { measure } from './geometry'

// 記録の行から、走っている間のコマを Coach に流し込んで、走り姿を作る（作れなければ空）
export function replayStrides(log: RunLog, s: Pick<Session, 'focus'>): Session['strides'] {
  const run = log.phases.indexOf('run')
  const base = log.columns.indexOf('...points(x,y,v)')
  const col = (name: string) => log.columns.indexOf(name)
  const [cVis, cMov] = [col('visible'), col('moving')]
  if (run < 0 || base < 0 || cVis < 0 || cMov < 0) return {}
  const coach = new Coach({ pause: RUNNING.pauseEnabled, items: s.focus ? activeItems(s.focus.step) : undefined })
  for (const r of log.rows) {
    if (r[1] !== run) continue
    let frame: Frame | undefined
    if (r.length > base) {
      frame = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
      log.points.forEach((p, k) => (frame![p] = { x: r[base + 3 * k], y: r[base + 3 * k + 1], v: r[base + 3 * k + 2] }))
    }
    const visible = r[cVis] === 1 && !!frame
    coach.update({ t: r[0], present: visible, moving: r[cMov] === 1, m: visible ? measure(frame!) : undefined, frame: visible ? frame : undefined })
  }
  return coach.finish().strides
}

// 前の作り方の走り姿を持つ記録を、端末の調整用の記録から作り直して保存する。作り直した記録があれば、新しい一覧を返す
export async function rebuildOldStrides(sessions: Session[]): Promise<Session[] | null> {
  let changed = false
  const out: Session[] = []
  for (const s of sessions) {
    const old = Object.values(s.strides ?? {}).some((x) => x && x.sec === undefined)
    if (!old || !s.logId) {
      out.push(s)
      continue
    }
    try {
      const log = await loadLog(s.logId)
      const strides = log ? replayStrides(log, s) : {}
      if (!Object.keys(strides).length) {
        out.push(s)
        continue
      }
      const next = { ...s, strides }
      await saveSession(next)
      out.push(next)
      changed = true
    } catch {
      out.push(s)
    }
  }
  return changed ? out : null
}
