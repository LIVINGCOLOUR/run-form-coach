// スマホの加速度センサーから、画面上の本当の鉛直を求める。
// 返すのは「画面の真下」から重力の向きが何度回っているか（時計回りが正）。
// 機種による符号の違いは、重力が画面の下向き寄りになる向きを選ぶことで吸収する
let roll = 0
let available = false

export function gravityRoll(): number {
  return available ? roll : 0
}
export function gravityAvailable(): boolean {
  return available
}

export async function startGravity(): Promise<boolean> {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent
  try {
    if (DME?.requestPermission) {
      const r = await DME.requestPermission()
      if (r !== 'granted') return false
    }
  } catch {
    return false
  }
  window.addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity
    if (!g || g.x === null || g.y === null) return
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180
    // 端末の座標（x 右、y 上）を画面の座標（x 右、y 下）に直す
    let dx = g.x
    let dy = -(g.y as number)
    const sx = dx * Math.cos(angle) + dy * Math.sin(angle)
    const sy = -dx * Math.sin(angle) + dy * Math.cos(angle)
    dx = sx
    dy = sy
    if (dy < 0) {
      dx = -dx
      dy = -dy
    }
    const r = (Math.atan2(dx, dy) * 180) / Math.PI
    if (Math.abs(r) > 25) return // 大きく傾いているときは使わない
    roll = roll * 0.9 + r * 0.1
    available = true
  })
  return true
}
