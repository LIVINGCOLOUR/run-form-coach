import type { Frame } from '../../../core/types'
import { L } from '../landmarks'
import { nearIsLeft } from './figure'

// 1歩の始まりを「近い側の足が一番前に出た瞬間」にそろえる。別々の1歩を同じタイミングで重ねるため
export function alignStride(frames: Frame[]): Frame[] {
  if (!frames.length) return frames
  const ankle = nearIsLeft(frames) ? L.leftAnkle : L.rightAnkle
  let best = 0
  for (let i = 1; i < frames.length; i++) if (frames[i][ankle].x > frames[best][ankle].x) best = i
  return frames.slice(best).concat(frames.slice(0, best))
}
