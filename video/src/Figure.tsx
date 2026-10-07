import React from 'react'
import { useMemo } from 'react'
import { demoStride, paths } from '../../src/ui/figure'
import { C } from './theme'

// アプリと同じ描き方の、走る骨格。描画座標（350×470）を transform で置く
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
  const i = frame % strides.length
  const p = paths(strides[i], true)
  const g = ghostStrides ? paths(ghostStrides[i], true) : null
  return (
    <g transform={transform}>
      <path d="M20 434H340" stroke={C.line} strokeWidth={3} />
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
