import type { SensorLog } from '../../core/types'
import { CHEST, HEAD_PLACE } from './params'

// 走ったあとの結果の画面に出す「センサーがずれたようです」の文（記録の slips・head.slips から）。走っている間は画面を見られないので、知らせはここで出す。
// 分は、走り出した（立った姿勢を覚えた）ときから数える。ずれていなければ空
export function slipNotes(s: SensorLog | undefined): string[] {
  if (!s) return []
  const parts = [
    { place: CHEST, slips: s.slips, from: s.stand?.t },
    { place: HEAD_PLACE, slips: s.head?.slips, from: s.head?.stand?.t ?? s.stand?.t },
  ]
  return parts
    .filter((x) => x.slips?.length)
    .map((x) => {
      const mins = [...new Set(x.slips!.map(([t]) => Math.max(0, Math.round((t - (x.from ?? x.slips![0][0])) / 60))))]
      return `${x.place}のセンサーが${mins.join('分・')}分ごろにずれたようです。次は付け直してください`
    })
}
