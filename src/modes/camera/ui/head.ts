// 撮る画面の骨格の、頭の丸の位置と大きさ（見た目だけ。判定は耳と肩などの点で測り、これは使わない）。
// 中心を「耳と鼻の真ん中」にすると丸が顔の前に出て、頭が前に突き出たように見えた（2026-11-06 本人のスクショ：丸が顔の前半分にかかり、後頭部が丸の外）。
// 頭の中心は耳より後ろ・上にあるので、耳から「耳→鼻と反対向き」に back × d、上に up × d ずらす（d＝耳と鼻の距離。画面の上が y の小さい側）
export const HEAD_DRAW = { back: 0.15, up: 0.35, radius: 1.0 }

export function headCircle(ear: { x: number; y: number }, nose: { x: number; y: number }): { x: number; y: number; r: number } {
  const dx = nose.x - ear.x
  const dy = nose.y - ear.y
  const d = Math.hypot(dx, dy)
  if (d === 0) return { x: ear.x, y: ear.y, r: 0 }
  return { x: ear.x - (dx / d) * HEAD_DRAW.back * d, y: ear.y - (dy / d) * HEAD_DRAW.back * d - HEAD_DRAW.up * d, r: HEAD_DRAW.radius * d }
}
