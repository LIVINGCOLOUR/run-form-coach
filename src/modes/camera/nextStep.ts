import type { FormGroup, FormResult, ItemKey, Session } from '../../core/types'
import { ALL, STEPS, startPhrase, type Progress } from '../../core/level'
import { LEVEL } from '../../core/params'
import { FOCUS } from '../../core/phrases'
import { FORM, GOOD, SETUP } from './params'
import { formOver } from './form'

// 今日の意識・次の一歩：1つだけ選ぶ。
//   1. 正しいフォームの線（params.ts の FORM。画面では「声をかける線」）の外にいた項目があれば、そのうち一番外れていたもの
//   2. なければ、よい例の範囲（params.ts の GOOD）から一番離れていた項目。差が GOOD の near より小さいもの（よい例とほぼ同じ）は選ばない。
//      頭は、スマホが前側から撮っていたように見えた走り（headMaybeLarge）では選ばない（実際より大きく出ているかもしれないため）
// 離れ方は、外れた量を、その項目の0点までの幅（FORM.span）で割って比べる（項目ごとにぶれの大きさが違うため）
// 見出し（title）は、走り出す前に言う言葉（phrases.ts の FOCUS）と同じことを言う
export const NEXT_TEXT: Record<ItemKey, { title: string; reason: string }> = {
  head: { title: '耳を肩の真上に', reason: '声をかける線から一番外れていたのは、頭の位置です' },
  trunk: { title: '胸のライトで前を照らす', reason: '声をかける線から一番外れていたのは、上体の前かがみです' },
  trunkBack: { title: '上体を少しだけ前に', reason: '声をかける線から一番外れていたのは、上体の後ろへの傾きです' },
  body: { title: '倒れすぎず、上から吊られるように', reason: '声をかける線から一番外れていたのは、体全体の倒れすぎです' },
  bodyBack: { title: '足首から、少しだけ前に体を預ける', reason: '声をかける線から一番外れていたのは、体全体の起きすぎです' },
  hip: { title: '上から吊られるように、腰を高く', reason: '腰の高さを保ちます' },
}

// 項目の名前（結果の画面・次の一歩）
export const GROUP_LABEL: Record<FormGroup, string> = { body: '体全体の前傾', trunk: '上体の前傾', head: '頭の位置' }

// よい例より離れていた向きの言い方（前回の走りのことを言うときは、past で「〜いました」に）
const GAP_WORD: Record<ItemKey, string> = { head: '前に出ています', trunk: '前に傾いています', trunkBack: '起きています', body: '前に倒れています', bodyBack: '起きています', hip: '下がっています' }
const past = (w: string) => w.replace(/います$/, 'いました')

// 角度の見せ方：小数1桁まで（線の 5.5° や、よい例との 0.8° の差のように、整数に丸めると誤解を招く値があるため。
// 整数になる値は整数で書く）。後ろへの傾きは「後ろ」を付ける
export const deg1 = (x: number) => {
  const r = Math.round(x * 10) / 10
  return r < 0 ? `後ろ${-r}°` : `${r}°`
}

// 正しいフォームの線（声をかける線）の見せ方。頭は、両方を越えたら声をかける
export function rangeText(g: FormGroup): string {
  if (g === 'head') return `首${deg1(FORM.head.neck)}と頭の位置${deg1(FORM.head.headLean)}`
  const r = FORM[g]
  return `${deg1(r.min)}〜${deg1(r.max)}`
}

// よい例の範囲の見せ方。頭は前に出た側だけを見るので、上の端
export function goodText(g: FormGroup): string {
  if (g === 'head') return `首${deg1(GOOD.head.neck.max)}・頭の位置${deg1(GOOD.head.headLean.max)}まで`
  const r = GOOD[g]
  return `${deg1(r.min)}〜${deg1(r.max)}`
}

// その走りの値の見せ方（頭は、首の角度と頭の位置そのもの）。画面では数字だけを数字の字体にするので、名前と数字に分けて返す
export function valueParts(r: Pick<FormResult, 'group' | 'value' | 'value2'>): { label: string; value: string }[] {
  if (r.group !== 'head') return [{ label: '', value: deg1(r.value) }]
  return [{ label: '首', value: deg1(r.value) }, ...(r.value2 === undefined ? [] : [{ label: '頭の位置', value: deg1(r.value2) }])]
}
export const valueText = (r: Pick<FormResult, 'group' | 'value' | 'value2'>) => valueParts(r).map((p) => p.label + p.value).join('・')

// よい例の範囲からの差。gap は範囲の外にいた量（度。内側なら 0）、key は離れていた側（内側なら、近いほうの端の側）。
// 頭は前に出た側だけを見て、首の角度と頭の位置そのものが越えた量の、小さいほう（正しいフォームの線と同じ考え方。
// 頭の位置がない記録は、首の角度だけ）
export function goodGap(r: Pick<FormResult, 'group' | 'value' | 'value2'>): { key: ItemKey; gap: number } {
  if (r.group === 'head') {
    const neck = r.value - GOOD.head.neck.max
    const lean = r.value2 === undefined ? neck : r.value2 - GOOD.head.headLean.max
    return { key: 'head', gap: Math.max(0, Math.min(neck, lean)) }
  }
  const g = GOOD[r.group]
  const fwd = r.value - g.max
  const back = g.min - r.value
  const key: ItemKey = r.group === 'body' ? (fwd >= back ? 'body' : 'bodyBack') : fwd >= back ? 'trunk' : 'trunkBack'
  return { key, gap: Math.max(0, fwd, back) }
}

// よい例との差の分け方：in は範囲の内側、near は外だが差が GOOD の near より小さい（よい例とほぼ同じ）、off は離れている。
// 画面に出す数字（小数1桁）で分ける（「0°」の差を「起きています」と言わない。画面の数字と次の一歩の選び方を食い違わせない）
export function gapState(g: FormGroup, gap: number): 'in' | 'near' | 'off' {
  const shown = Math.round(gap * 10) / 10
  return shown <= 0 ? 'in' : shown < GOOD[g].near ? 'near' : 'off'
}

// 頭が実際より大きく出ているかもしれない：走っていた秒の前側・後ろ側の値の平均が、真横の置き方の線（SETUP.frontMax）を越えていた
export const headMaybeLarge = (r: Pick<FormResult, 'group' | 'yaw'>) => r.group === 'head' && r.yaw !== undefined && r.yaw > SETUP.frontMax

export interface Next {
  item: ItemKey
  group: FormGroup
  // line：声をかける線（正しいフォームの線）の外だった。good：線の内側だが、よい例の範囲から離れていた
  kind: 'line' | 'good'
  from: number // いまの値（度。頭は首の角度）
  to: number // 目指す値：line は声をかける線（いちばん近い線）、good はよい例の範囲の近いほうの端（頭は、首の角度を差だけ戻した値）
  gap: number // 離れていた量（度。line は線から、good はよい例の範囲から。頭は首の角度と頭の位置の小さいほう）
}

// 一番良かった回（良い姿勢の割合が最大）
export function bestSession(sessions: Session[]): Session | undefined {
  return sessions.filter((s) => s.strides.good).reduce<Session | undefined>((a, b) => (!a || b.share.good > a.share.good ? b : a), undefined)
}

const norm = (g: FormGroup, x: number) => x / FORM[g].span
const lineTo = (r: FormResult) =>
  r.key === 'body' ? FORM.body.max : r.key === 'bodyBack' ? FORM.body.min : r.key === 'trunk' ? FORM.trunk.max : r.key === 'trunkBack' ? FORM.trunk.min : r.value - r.over
const goodTo = (r: FormResult, key: ItemKey, gap: number) =>
  key === 'body' ? GOOD.body.max : key === 'bodyBack' ? GOOD.body.min : key === 'trunk' ? GOOD.trunk.max : key === 'trunkBack' ? GOOD.trunk.min : r.value - gap

// 線の外にいた項目のうち一番外れていたもの。なければ、よい例から一番離れていたもの（ほぼ同じのもの・大きく出ているかもしれない頭は除く）
function pick(rs: FormResult[]): Next | undefined {
  const out = rs.filter((r) => r.judged && r.over > 0)
  if (out.length) {
    const top = out.reduce((a, b) => (norm(b.group, b.over) > norm(a.group, a.over) ? b : a))
    return { item: top.key, group: top.group, kind: 'line', from: top.value, to: lineTo(top), gap: top.over }
  }
  const far = rs.filter((r) => r.judged && !headMaybeLarge(r)).map((r) => ({ r, ...goodGap(r) })).filter((x) => gapState(x.r.group, x.gap) === 'off')
  if (!far.length) return undefined
  const top = far.reduce((a, b) => (norm(b.r.group, b.gap) > norm(a.r.group, a.gap) ? b : a))
  return { item: top.key, group: top.r.group, kind: 'good', from: top.r.value, to: goodTo(top.r, top.key, top.gap), gap: top.gap }
}

// 次の一歩。その走りの比べ（Session.form）があればそれで、なければ（前の版の記録）良い姿勢の1歩の平均の上体・体全体で見る。
// 線の外の項目も、よい例から離れた項目もなければ undefined
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

// 結果の画面の「よい例との差」の1行（Result.tsx の FormCard が出す。言葉はここで決める）
export interface FormRow {
  group: FormGroup
  label: string // 項目の名前
  // in：よい例の範囲の内側、near：外だが差がわずか（GOOD の near より小さい。よい例とほぼ同じ）、off：よい例から離れている
  state: 'in' | 'near' | 'off'
  gap: string // よい例の範囲からの差（「0.8°」。内側なら空）
  word: string // 差の向き（「起きています」など。内側なら空）
  you: string // その走りの値（「6.2°」。頭は「首36°・頭の位置39.7°」）
  youParts: { label: string; value: string }[] // 同じものを、名前と数字に分けたもの（画面で数字だけ大きく出す）
  good: string // よい例の範囲（「7°〜9.6°」）
  line: string // 声をかける線との比べ（「声をかける線 5.5°〜15°：内側でした」）
  lineOut: boolean // 声をかける線の外だった
  note?: string // 頭：実際より大きく出ているかもしれない
}

export const HEAD_NOTE = 'スマホが少し前側から撮っていたようです。頭は実際より大きく出ているかもしれません'

export function formRows(form: FormResult[]): FormRow[] {
  return form.map((r) => {
    const { key, gap } = goodGap(r)
    const state = gapState(r.group, gap)
    const line = !r.judged
      ? '比べていません（斜めから撮っているように見えました）'
      : r.over > 0
        ? r.cues && !r.fixed
          ? '外でした（声をかけても、内側に入りませんでした）'
          : '外でした'
        : r.fixed
          ? '声をかけて、内側に入りました'
          : '内側でした'
    return {
      group: r.group,
      label: GROUP_LABEL[r.group],
      state,
      gap: state === 'in' ? '' : deg1(gap),
      word: state === 'in' ? '' : GAP_WORD[key],
      you: valueText(r),
      youParts: valueParts(r),
      good: goodText(r.group),
      line: `声をかける線 ${rangeText(r.group)}：${line}`,
      lineOut: r.judged && r.over > 0,
      ...(headMaybeLarge(r) ? { note: HEAD_NOTE } : {}),
    }
  })
}

// 行の言葉を1文に（記録の書き出しや、確かめの道具で使う）。例「よい例より 0.8° 起きています」
export const gapSentence = (row: FormRow) => (row.state === 'in' ? 'よい例の範囲です' : `よい例より ${row.gap} ${row.word}${row.state === 'near' ? '（ほぼ同じ）' : ''}`)

// 次の一歩の説明（結果の画面）
export function nextNote(n: Next): string {
  return n.kind === 'line'
    ? '声をかける線から一番外れていた項目です。次の走り出しで、まずここを整えます'
    : `どの項目も声をかける線の内側でした。よい例から一番離れていた項目です（よい例より ${deg1(n.gap)} ${GAP_WORD[n.item]}）。次の走り出しに、この1つを伝えます`
}

// 今日の意識：ホームに出す1つと、走り出す前に言う1つ（say）を、ここで決める（同じものにする。一度に意識できるのは1つ）
//   1. 段階が上がった次の走りは、新しく見る項目を伝える（level.ts。1回だけ）
//   2. 前回の走りに正しいフォームとの比べがあれば、その次の一歩（線の外の項目、なければよい例から一番離れていた項目）
//   3. なければ、注意する項目を広げている途中なら、その段階のこと
//   4. すべて見る段階なら、比べのない前の版の記録のベストの走りの次の一歩。それもなければ「すべての項目を見ます」
export interface Focus {
  item?: ItemKey // 選んだ項目（段階のことを言うときは無い）
  next?: Next // 項目を選んだときの次の一歩（ホームの走り姿の「今日のフォーム」も、この1つだけを変えて見せる）
  title: string // ホームの見出し
  reason: string // ホームの説明
  say: string // 走り出す前に言う言葉（「今日意識するのは…」）
}

export function todayFocus(sessions: Session[], p: Progress): Focus {
  const stage = (): Focus => {
    const say = startPhrase(p)
    if (p.step >= ALL) return { title: 'すべての項目を見ます', reason: p.justUp ? say : '崩れたときだけ声をかけます。走り出しに、正しいフォームの線へ整えます', say }
    const s = STEPS[p.step]
    const reason = p.justUp && s.up ? s.up : `${Math.round(LEVEL.minRunSec / 60)}分以上の走りで、これについて声がかからない走りが${LEVEL.advanceAfter}回続いたら、次へ進みます（いま ${p.clean}/${LEVEL.advanceAfter}回）`
    return { title: s.title, reason, say }
  }
  if (p.justUp) return stage()
  const last = sessions[0]
  const compared = !!last?.form?.length
  if (compared) {
    const n = nextItem(last)
    if (n) {
      const r = last.form!.find((x) => x.group === n.group)!
      const was = `前回は${n.group === 'head' ? '頭' : GROUP_LABEL[n.group]}が ${valueText(r)}`
      const reason =
        n.kind === 'line'
          ? `${was}（声をかける線 ${rangeText(n.group)}）。走り出しに、まずここを整えます`
          : `${was}（よい例 ${goodText(n.group)}）。声をかける線の内側ですが、よい例より ${deg1(n.gap)} ${past(GAP_WORD[n.item])}。この1つだけを意識します`
      return { item: n.item, next: n, title: NEXT_TEXT[n.item].title, reason, say: FOCUS[n.item] }
    }
  }
  if (p.step < ALL) return stage()
  const best = compared ? undefined : bestSession(sessions)
  const n = best ? nextItem(best) : undefined
  if (n) {
    const reason = n.kind === 'line' ? NEXT_TEXT[n.item].reason : `あなたのベストの走りで、よい例より ${deg1(n.gap)} ${past(GAP_WORD[n.item])}`
    return { item: n.item, next: n, title: NEXT_TEXT[n.item].title, reason, say: FOCUS[n.item] }
  }
  return stage()
}
