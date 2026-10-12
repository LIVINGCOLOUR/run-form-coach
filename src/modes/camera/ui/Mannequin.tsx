import { useEffect, useState } from 'react'
import type { Frame } from '../../../core/types'
import { nearIsLeft, paths } from './figure'

interface Props {
  frames: Frame[]
  ghost?: Frame[]
  ghostColor?: string
  upperColor: string
  // 拡大率と位置（描画座標 0..350 × 0..470 を枠に合わせる）
  transform?: string
  viewBox?: string
  width: number
  height: number
  slow?: number // 1 = 実際の速さ（既定）。0.5 = 半分の速さ。見本を遅く流すと早歩きに見えるので、ふだんは 1
}

export function useFrameIndex(n: number, slow = 1) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!n) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      // rAF の時刻は t0 より少し前のことがあるので、マイナスにならないようにする
      setI(Math.floor((Math.max(0, now - t0) / 1000) * 30 * slow) % n)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n, slow])
  return i
}

export function Mannequin({ frames, ghost, ghostColor = 'var(--accent)', upperColor, transform, viewBox = '0 0 350 470', width, height, slow = 1 }: Props) {
  const i = useFrameIndex(frames.length, slow)
  if (!frames.length) return null
  const near = nearIsLeft(frames)
  const p = paths(frames[i % frames.length], near)
  const g = ghost && ghost.length ? paths(ghost[i % ghost.length], near) : null
  return (
    <svg width={width} height={height} viewBox={viewBox} aria-hidden="true">
      <g transform={transform}>
        <path d="M30 434H330" stroke="#262C33" strokeWidth={3} />
        <g stroke="#2E353D" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d={p.legBack} strokeWidth={20} />
          <path d={p.armBack} strokeWidth={16} />
        </g>
        <path d={p.legFront} stroke="#4A535D" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d={p.trunk} stroke={upperColor} strokeWidth={26} strokeLinecap="round" fill="none" />
        <path d={p.neck} stroke={upperColor} strokeWidth={16} strokeLinecap="round" fill="none" />
        <circle cx={p.hx} cy={p.hy} r={26} fill={upperColor} />
        <path d={p.armFront} stroke="#5A646F" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {g && (
          <g stroke={ghostColor} strokeWidth={3.5} strokeDasharray="7 6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={g.trunk} />
            <path d={g.neck} />
            <circle cx={g.hx} cy={g.hy} r={26} />
            <path d={g.armFront} opacity={0.6} />
            <path d={g.legFront} opacity={0.6} />
          </g>
        )}
      </g>
    </svg>
  )
}
