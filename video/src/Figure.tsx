import React from 'react'
import { useMemo } from 'react'
import { demoStride, lerpFrame, paths } from '../../src/modes/camera/ui/figure'
import { C, jp } from './theme'

// アプリと同じ描き方の、走る骨格。描画座標（350×470）を transform で置く
// 実際のピッチ（毎分177歩）のままだと忙しく見えるので、紹介動画では半分の速さで流し、スローであることを表示する
// （遅く流していると分からないと、早歩きに見える）。コマの間はなめらかにつなぐ
const SLOW = 0.5
export function Figure({
  frame,
  lean,
  head,
  upper,
  transform,
  ghost,
  ghostColor = C.accent,
  drop,
  legColor = C.limb,
  over = 0,
}: {
  frame: number
  lean: number
  head: number
  upper: string
  transform: string
  ghost?: { lean: number; head: number }
  ghostColor?: string
  drop?: number
  legColor?: string
  over?: number
}) {
  const strides = useMemo(() => demoStride({ lean, head, drop: drop ?? (lean > 12 ? 6 : 0), over }), [lean, head, drop, over])
  const ghostStrides = useMemo(() => (ghost ? demoStride({ lean: ghost.lean, head: ghost.head, drop: 0 }) : null), [ghost])
  const t = frame * SLOW
  const n = strides.length
  const i = Math.floor(t) % n
  const k = t - Math.floor(t)
  const p = paths(lerpFrame(strides[i], strides[(i + 1) % n], k), true)
  const g = ghostStrides ? paths(lerpFrame(ghostStrides[i], ghostStrides[(i + 1) % n], k), true) : null
  return (
    <g transform={transform}>
      <path d="M20 434H340" stroke={C.line} strokeWidth={3} />
      <text x={340} y={462} textAnchor="end" fill={C.faint} fontSize={15} fontFamily={jp} fontWeight={700}>
        スロー再生（1/2）
      </text>
      <g stroke={C.limbBack} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d={p.legBack} strokeWidth={20} />
        <path d={p.armBack} strokeWidth={16} />
      </g>
      <path d={p.legFront} stroke={legColor} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={p.trunk} stroke={upper} strokeWidth={26} strokeLinecap="round" fill="none" />
      <path d={p.neck} stroke={upper} strokeWidth={16} strokeLinecap="round" fill="none" />
      <circle cx={p.hx} cy={p.hy} r={26} fill={upper} />
      <path d={p.armFront} stroke="#5A646F" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {g && (
        <g stroke={ghostColor} strokeWidth={4} strokeDasharray="8 7" fill="none" strokeLinecap="round">
          <path d={g.trunk} />
          <path d={g.neck} />
          <circle cx={g.hx} cy={g.hy} r={26} />
        </g>
      )}
    </g>
  )
}
