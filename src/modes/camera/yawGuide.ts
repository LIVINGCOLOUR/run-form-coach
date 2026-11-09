import { PHRASES } from '../../core/phrases'
import { SETUP } from './params'

// 置く間の、真横からのずれの見方と案内（Live.tsx）。数字は params.ts の SETUP（yawCenter・yawPerDeg・yawIn・yawOut・yawFar）。
// 前側から撮っている（値が正）ときは、スマホが体より前にある。スマホをトレッドミルの後ろのほうへずらすと真横に近づく。
// 体を見る向きはスマホの位置で決まり、回すだけでは体が画面の端に寄るだけなので、「回して」ではなく「ずらして」と言う
// （仮想実験の向き sim/camera.ts も、スマホを体のまわりに回り込ませたもの。回すだけの置き方は試していない）

// 前側・後ろ側の値（geometry の yawSign を SETUP.yawSmooth 秒ならしたもの）から、真横からのずれの目安（度。前側が正）
export const yawOffDeg = (yaw: number) => (yaw - SETUP.yawCenter) / SETUP.yawPerDeg

// 真横の線の内側か。入るときは yawIn 度以内、一度入ったら yawOut 度を越えるまでは内側とみる（線の際で入ったり出たりしないため）
export const yawInside = (deg: number, wasInside: boolean) => Math.abs(deg) <= (wasInside ? SETUP.yawOut : SETUP.yawIn)

export type YawSide = 'front' | 'behind'
export type YawLevel = 'far' | 'mid' | 'near'

// どちら向きに、どれくらいずれているか（内側なら null）
export function yawHint(deg: number, wasInside: boolean): { side: YawSide; level: YawLevel } | null {
  if (yawInside(deg, wasInside)) return null
  const a = Math.abs(deg)
  return { side: deg > 0 ? 'front' : 'behind', level: a > SETUP.yawFar ? 'far' : a > SETUP.yawOut ? 'mid' : 'near' }
}

export const YAW_PHRASE: Record<YawSide, Record<YawLevel, string>> = {
  front: { far: PHRASES.guideFrontFar, mid: PHRASES.guideFront, near: PHRASES.guideFrontNear },
  behind: { far: PHRASES.guideBehindFar, mid: PHRASES.guideBehind, near: PHRASES.guideBehindNear },
}

// 真横の案内の言葉なら、その向き。同じ向きの案内は「大きく／少し／あと少し」が変わっても同じ案内として扱う（言い直しの間隔を hintRepeat にして連呼しない）
export function yawSideOf(msg: string | null | undefined): YawSide | null {
  for (const side of ['front', 'behind'] as const) if (Object.values(YAW_PHRASE[side]).includes(msg ?? '')) return side
  return null
}
