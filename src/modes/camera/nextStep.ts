import type { ItemKey, Session } from '../../core/types'

// 次の一歩で選ぶ項目（起きすぎの側は、ベストの1歩の平均からは選ばない）
type NextKey = Exclude<ItemKey, 'trunkBack' | 'bodyBack'>

// 理想の目安（研究にもとづく値）
export const IDEAL = { head: 0, trunk: 7, body: 3, hipDrop: 0 }

export const NEXT_TEXT: Record<NextKey, { title: string; reason: string }> = {
  head: { title: '顎を引いて、頭を肩の上に', reason: 'あなたのベストから、次は頭の位置だけを直します' },
  trunk: { title: '胸のライトで前を照らす', reason: 'あなたのベストから、次は体幹だけを直します' },
  body: { title: '倒れすぎず、足首から少しだけ前へ', reason: 'あなたのベストから、次は体全体の傾きだけを直します' },
  hip: { title: '上から吊られるように、腰を高く', reason: 'あなたのベストから、次は腰の高さだけを直します' },
}

// 一番良かった回（良い姿勢の割合が最大）
export function bestSession(sessions: Session[]): Session | undefined {
  return sessions.filter((s) => s.strides.good).reduce<Session | undefined>((a, b) => (!a || b.share.good > a.share.good ? b : a), undefined)
}

// ベストの良い姿勢の1歩と理想の差から、次に直す項目を1つだけ選ぶ
export function nextItem(best: Session): { item: NextKey; from: number; to: number } | undefined {
  const avg = best.strides.good?.avg
  if (!avg) return undefined
  const gaps: { item: NextKey; gap: number; from: number; to: number }[] = [
    { item: 'head', gap: (avg.head - IDEAL.head) / 5, from: avg.head, to: IDEAL.head },
    { item: 'trunk', gap: (avg.trunk - IDEAL.trunk) / 5, from: avg.trunk, to: IDEAL.trunk },
    { item: 'body', gap: (avg.body - IDEAL.body) / 3, from: avg.body, to: IDEAL.body },
    { item: 'hip', gap: (avg.hipDrop - IDEAL.hipDrop) / 3, from: avg.hipDrop, to: IDEAL.hipDrop },
  ]
  const top = gaps.reduce((a, b) => (b.gap > a.gap ? b : a))
  return top.gap > 0.2 ? { item: top.item, from: top.from, to: top.to } : undefined
}
