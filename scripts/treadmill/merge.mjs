// トレッドミルの突き合わせ（scripts/treadmill-merge.mjs）の計算。ファイルも画面も持たない（テストは merge.test.mjs）。
// 3台の記録（Mac の区間の指示、横のスマホのカメラ版、腰のスマホのセンサーラン）を、それぞれの時計（ふつうの時刻 ms）で並べ、
// ジャンプの「はい」で時計のずれを確かめてから、区間ごとの値と知らせをまとめる

// 「はい」を聞いてから跳ぶまでの目安（秒）。0.3〜0.8秒ほど（treadmill-grade.mjs の時計の表と同じ見方）
export const REACT = 0.5
// ジャンプが目立つ（ばらつきの STRONG 倍以上）端末は、どれも「動いた時刻 −（はい + REACT）」をその端末の時計のずれとして引く。
// どの端末も同じジャンプにそろうので、端末どうしの合わせは跳ぶまでの遅れによらない（Mac との合わせだけが、遅れの揺れ ±0.3秒ほど粗い）。
// 目立たない・見つからない端末は、端末の時計のまま（ネットの時刻に合わせたもの）
export const STRONG = 10

export const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x !== -999
export const median = (xs) => {
  const s = xs.filter(finite).sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// 時計のずれ（ms。その端末の時刻 − Mac の時刻）を決める。manual（秒）があればそれ。
// jump：{ T, strength }（その端末の時計で、大きく動き始めた時刻）、haiMs：Mac の「はい」
export function clockOffset(jump, haiMs, manual) {
  if (manual !== undefined) return { off: manual * 1000, how: 'manual', lag: jump ? (jump.T - haiMs) / 1000 : null }
  if (!jump || haiMs === null || haiMs === undefined) return { off: 0, how: 'clock', lag: null }
  const lag = (jump.T - haiMs) / 1000
  if (jump.strength >= STRONG) return { off: Math.round((lag - REACT) * 1000), how: 'jump', lag }
  return { off: 0, how: 'clock', lag }
}

// 加速度の大きさで、ジャンプの「はい」の前後に大きく動き始めた時刻（ふつうの時刻 ms）。samples：[{ T, a: [x, y, z] }]（時刻順）。
// 見方は replay.ts の findJump と同じ（いちばん大きく動いた値の半分を越えた最初の値。strength は動きの大きさ ÷ ふだんのばらつき、999 まで）
export function findAccJump(samples, nearMs, beforeMs = 2000, afterMs = 8000) {
  const pts = samples.filter((s) => s.T >= nearMs - beforeMs && s.T <= nearMs + afterMs).map((s) => ({ T: s.T, v: Math.hypot(s.a[0], s.a[1], s.a[2]) }))
  if (pts.length < 10) return null
  const vs = pts.map((p) => p.v).sort((a, b) => a - b)
  const med = vs[vs.length >> 1]
  const mad = vs.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[vs.length >> 1] || 1e-6
  const dev = (q) => Math.abs(q.v - med)
  const peak = Math.max(...pts.map(dev))
  const best = pts.find((q) => dev(q) >= peak / 2)
  return { T: best.T, strength: Math.min(999, peak / mad) }
}

// 区間（Mac の時計）ごとに、その間の値の真ん中と知らせを集める。
//   cam：[{ T, trunk, neck, headLean, body }]（カメラのコマ。骨格の値があるコマだけ）、sec：[{ T, run, chest, chestRef, head, waist, wHz, v }]（センサーの1秒ごと）、
//   voices：[{ T, item }]（カメラ版の声）、buzz：[{ T, item }]（センサーの振動）。時刻はすべて Mac の時計にそろえたもの
//   pair：胸 − カメラの上体（1秒ごとに、その秒の前後 0.5秒のカメラのコマの上体の真ん中と組にする。走っている秒だけ）
export function sectionRows(sections, { cam = [], sec = [], voices = [], buzz = [] }) {
  return sections.map((s) => {
    const inS = (x) => x.T >= s.start && x.T < s.end
    const cs = cam.filter(inS)
    const ss = sec.filter(inS)
    const pairs = []
    for (const q of ss) {
      if (!q.run || !finite(q.chest)) continue
      const near = cs.filter((c) => Math.abs(c.T - q.T) <= 500)
      if (near.length < 2) continue
      pairs.push(q.chest - median(near.map((c) => c.trunk)))
    }
    const lenSec = (s.end - s.start) / 1000
    const waistN = ss.filter((q) => finite(q.waist)).length
    return {
      s,
      camN: cs.length,
      trunk: median(cs.map((c) => c.trunk)),
      neck: median(cs.map((c) => c.neck)),
      headLean: median(cs.map((c) => c.headLean)),
      body: median(cs.map((c) => c.body)),
      chest: median(ss.map((q) => q.chest)),
      chestRef: median(ss.map((q) => q.chestRef)),
      head: median(ss.map((q) => q.head)),
      waist: median(ss.map((q) => q.waist)),
      waistShare: ss.length ? waistN / Math.max(1, Math.round(lenSec)) : 0,
      wHz: median(ss.map((q) => q.wHz)),
      v: median(ss.map((q) => q.v)),
      pair: median(pairs),
      pairN: pairs.length,
      pairs,
      voices: voices.filter(inS),
      buzz: buzz.filter(inS),
    }
  })
}

// センサーの events の振動 → 項目。知らせでないもの（覚えた・ずれ・待たせた など）は null
export function buzzItem(text) {
  if (/^sensor:hunch /.test(text)) return '胸'
  if (/^sensor:head /.test(text)) return '頭'
  const m = /^sensor:contact (sit|longL|longR|stride)/.exec(text)
  return m ? { sit: '接地', longL: '左右差', longR: '左右差', stride: '大また' }[m[1]] : null
}
