// 検証用の「全コマ記録」：走っている間も間引かず、毎コマ骨格を取って、そのすべてを記録に残す。
// 開くときに URL へ ?full=1 を付けたときだけ（例 https://…/?full=1）。付けずに開けば、ふだんどおり間引く
// （安定して走っている間は src/core/params.ts の POWER のとおり、10秒のうち3秒だけ取る。電池と熱のため）。
// 声かけの判定の線や言葉は変わらない。毎コマの値が判定に入るので、走り始めの10秒や崩れかけたときと同じ細かさで見る
export function fullFrames(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('full') === '1'
}
