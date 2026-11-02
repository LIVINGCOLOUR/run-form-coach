import { BATTERY_CURVE } from './params'

// 電池の電圧（V）を、残りの目安（0〜100 %）にする
export function batteryPercent(v: number): number {
  const c = BATTERY_CURVE
  if (v >= c[0][0]) return 100
  if (v <= c[c.length - 1][0]) return 0
  for (let i = 1; i < c.length; i++) {
    const [v1, p1] = c[i]
    const [v0, p0] = c[i - 1]
    if (v >= v1) return Math.round(p1 + ((v - v1) / (v0 - v1)) * (p0 - p1))
  }
  return 0
}
