import { PHRASES } from '../../core/phrases'
import { SETUP } from './params'

// 置く間の、真横からのずれの見方と案内（Live.tsx）。数字は params.ts の SETUP（yawCenter・yawPerDeg・yawIn・yawOut・yawFar）。
// 前側から撮っている（値が正）ときは、スマホが体より前にある。スマホを高さはそのままで後ろのほうへ動かすと真横に近づく。
// 体を見る向きはスマホの位置で決まり、回すだけでは体が画面の端に寄るだけなので、「回して」ではなく「動かして」と言う
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

// 置く間に画面に出す、スマホを動かす向きの矢印（Live.tsx の YawArrow）。画面を見ている人が、スマホを画面の左右どちらへ動かすか。
// 背面カメラの映像は左右を反転せずに出している（Live.tsx の mirror は前面カメラのときだけ）ので、画面の左右は、スマホの後ろから見た実際の左右と同じ。
// 骨格の点（frame の x）も反転しない元の映像のもの。前面カメラは映像を鏡のように反転して見せるので、走る人の向きも画面では逆になる。
//   face：走る人の顔が、元の映像で右（+1）・左（−1）のどちらを向いているか（geometry の facing を FACE_SURE の割合でそろえたもの）。分からなければ null
//   front（スマホが前すぎる）＝スマホを走る人の背中の側へ＝画面では顔の向きと反対。behind＝顔の向きと同じ
export type ArrowDir = 'left' | 'right'
export function yawArrowDir(side: YawSide, face: 1 | -1 | null, mirror = false): ArrowDir | null {
  if (face === null) return null
  const shown = mirror ? -face : face // 画面で顔が向いている向き
  const dir = side === 'front' ? -shown : shown
  return dir > 0 ? 'right' : 'left'
}

// 1コマずつの顔の向き（+1・−1。鼻と耳が見えないコマは入れない）を、直近でそろえる。FACE_SURE 以上の割合で同じ向きなら、その向き。
// 骨格の推定は、横向きの顔の鼻と耳の前後をときどき取り違えるので、1コマだけでは決めない（取り違えると矢印が逆を指し、外れた案内になる）
export const FACE_SURE = 0.8
export function faceOf(signs: number[]): 1 | -1 | null {
  if (signs.length < 3) return null
  const n = signs.length
  return signs.filter((s) => s > 0).length >= FACE_SURE * n ? 1 : signs.filter((s) => s < 0).length >= FACE_SURE * n ? -1 : null
}
