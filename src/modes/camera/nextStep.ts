import type { FormGroup, FormResult, ItemKey, Session } from '../../core/types'
import { FORM } from './params'
import { formOver } from './form'

// 今日の意識・次の一歩：正しいフォーム（params.ts の FORM）から一番離れていた項目を1つだけ選ぶ。
// 離れ方は、線から外れた量を、その項目の0点までの幅（FORM.span）で割って比べる（項目ごとにぶれの大きさが違うため）
export const NEXT_TEXT: Record<ItemKey, { title: string; reason: string }> = {
  head: { title: '顎を引いて、頭を肩の上に', reason: '正しいフォームから一番離れていたのは、頭の位置です' },
  trunk: { title: '胸のライトで前を照らす', reason: '正しいフォームから一番離れていたのは、上体の前かがみです' },
  trunkBack: { title: '上体を少しだけ前に', reason: '正しいフォームから一番離れていたのは、上体の後ろへの傾きです' },
  body: { title: '倒れすぎず、上から吊られるように', reason: '正しいフォームから一番離れていたのは、体全体の倒れすぎです' },
  bodyBack: { title: '足首から、少しだけ前に体を預ける', reason: '正しいフォームから一番離れていたのは、体全体の起きすぎです' },
  hip: { title: '上から吊られるように、腰を高く', reason: '腰の高さを保ちます' },
}

// 項目の名前（結果の画面・次の一歩）
export const GROUP_LABEL: Record<FormGroup, string> = { body: '体全体の前傾', trunk: '上体の前傾', head: '頭の位置（首の角度）' }

// 角度の見せ方（後ろへの傾きは「後ろ」を付ける）
export const deg = (x: number) => (Math.round(x) < 0 ? `後ろ${Math.abs(Math.round(x))}°` : `${Math.round(x)}°`)

// 正しいフォームの範囲の見せ方
export function rangeText(g: FormGroup): string {
  if (g === 'head') return `${FORM.head.neck}°まで`
  const r = FORM[g]
  return `${deg(r.min)}〜${deg(r.max)}`
}

export interface Next {
  item: ItemKey
  group: FormGroup
  from: number // いまの値（度。頭は首の角度）
  to: number // 正しいフォームの線（いちばん近い線）
}

// 一番良かった回（良い姿勢の割合が最大）
export function bestSession(sessions: Session[]): Session | undefined {
  return sessions.filter((s) => s.strides.good).reduce<Session | undefined>((a, b) => (!a || b.share.good > a.share.good ? b : a), undefined)
}

// 線の外にいた項目のうち、一番離れていたもの
function pick(rs: FormResult[]): Next | undefined {
  const out = rs.filter((r) => r.judged && r.over > 0)
  if (!out.length) return undefined
  const top = out.reduce((a, b) => (b.over / FORM[b.group].span > a.over / FORM[a.group].span ? b : a))
  const to = top.key === 'body' ? FORM.body.max : top.key === 'bodyBack' ? FORM.body.min : top.key === 'trunk' ? FORM.trunk.max : top.key === 'trunkBack' ? FORM.trunk.min : FORM.head.neck
  return { item: top.key, group: top.group, from: top.value, to }
}

// 正しいフォームから一番離れていた項目。その走りの比べ（Session.form）があればそれで、なければ（前の版の記録）
// 良い姿勢の1歩の平均の上体・体全体で見る。全部が正しい範囲なら undefined
export function nextItem(s: Session): Next | undefined {
  if (s.form?.length) return pick(s.form)
  const avg = s.strides.good?.avg
  if (!avg) return undefined
  const v = { trunk: avg.trunk, body: avg.body, neck: 0, headLean: 0 }
  const rs: FormResult[] = (['body', 'trunk'] as FormGroup[]).map((g) => {
    const o = formOver(g, v)
    return { group: g, key: o.key, value: g === 'body' ? avg.body : avg.trunk, over: o.over, inside: 0, cues: 0, fixed: false, judged: true }
  })
  return pick(rs)
}
