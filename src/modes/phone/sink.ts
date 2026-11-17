import { PHONE, SINK } from './params'
import { refineFreq, resample, stepCuts, stepPeriod, type PhoneMeasure, type Vec3 } from './signal'

// 腰の沈み込み：1歩ごとの「着地から、接地中のいちばん低いところまでの腰の下がり（cm）」。**記録だけ。**声・判定・画面の項目にはしない（数字は params.ts の SINK）
// 腰に付けたスマホ（腰スマホのモード・センサーランの腰の iPhone）の上下の加速度を、1歩ずつ2回積分して高さの波にし、
// 着地の高さから、接地中のいちばん低い高さを引く。
// 考え方は Runmetrix の「腰の沈み込み」（接地後に膝が曲がって腰の位置が下がる動き）と、カシオの特許 JP6508174B2
// （腰の機器の上下の加速度を2回積分して高さの波を出し、接地中のいちばん低いところを最大の沈み込みとする）。
//
// 長い積分のずれを避けるため、1歩ずつ切って、その中だけで積分する：
//   1歩の区切りの端は、となり合う接地の真ん中（stepCuts の切れ目。重心がいちばん低いあたり）の間（＝空中の真ん中あたり）。区切りの中に接地が1つ入る。
//   区切りの中で、加速度から一定の値を引いてから積分し（始めと終わりの速さが同じ）、速さから一定の値を引いてから積分する（始めと終わりの高さが同じ）。
//   一定の速さで走っていれば、空中の真ん中の速さと高さは歩ごとにそろうので、この2つの仮定が成り立つ（上下動 bounceCm と同じ考え）。
//   加速度に一定のずれ（重力の見積もりのずれ）があっても、平均を引くので消える
// 着地と離地は、上下の加速度（重力を含む）が、空中の値（自由落下でほぼ 0g）から立ち上がり始めたところ：1区切りの中の
//   いちばん小さい値と、接地の山の間の SINK.landFrac の高さを、山から前へ（着地）・後ろへ（離地）たどって最初に下回るところ。
//   床を押す力が 0 を超えた（足が着いた）ところにあたる。有効接地時間（1gを上回る時間。Patoz 2021、signal.ts の contactMs）の始まりは
//   それより遅く、そこまでに腰はもう大きく下がっている（2026-11-09 の腰の iPhone のふつうの走りで、1gを上回り始めてからの下がりは約 1cm、
//   立ち上がり始めからは約 4.5cm）ので使わない
// 空中がない走り（とてもゆっくり・深い腰落ち）では、空中の値が 0g まで下がらないので、着地がはっきりせず、沈み込みは小さく出る（推測）

export type SinkStep = { sinkCm: number; bounceCm: number; contactMs: number }
export type SinkEst = {
  sinkCm: number // 1歩ごとの沈み込みの真ん中（cm）
  steps: number // 使った歩の数
  bounceCm: number // 同じ区切りで出した、1歩の高さの振れ幅の真ん中（cm。上下動と比べるため）
  contactMs: number // 同じ見方（着地から離地まで）の接地時間の真ん中（ms）。有効接地時間（contactMs）とは別のもの。足首のセンサーの接地時間と比べて、着地の見つけ方を確かめるため
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export const medianOf = (xs: number[]) => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y)
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN
}

// 1区切りの上下の加速度（重力を引いた、上向き正。m/s²）を2回積分した高さ（m）。a の始めと終わりは同じ場面（次の区切りの始めのコマまで入れる）。
// 始めと終わりの速さ・高さが同じになるよう、加速度と速さから一定の値を引く。台形で積分する（毎秒50回の並べ直しで、1コマずつ足すだけの積分だと、
// 高さが加速度より約1コマ早くずれ、下がっている最中の着地の高さが約1cm低く出た。模擬の走りで確かめた）
export function stepHeight(a: number[], fs: number): number[] {
  const n = a.length - 1
  if (n < 1) return a.map(() => 0)
  let sa = 0
  for (let i = 1; i <= n; i++) sa += (a[i - 1] + a[i]) / 2
  const am = sa / n
  const v = [0]
  for (let i = 1; i <= n; i++) v.push(v[i - 1] + ((a[i - 1] + a[i]) / 2 - am) / fs)
  let sv = 0
  for (let i = 1; i <= n; i++) sv += (v[i - 1] + v[i]) / 2
  const vm = sv / n
  const h = [0]
  for (let i = 1; i <= n; i++) h.push(h[i - 1] + ((v[i - 1] + v[i]) / 2 - vm) / fs)
  return h
}

// 1歩ずつの沈み込み
//   vert：上下の加速度（重力を引いた、上向き正。m/s²）
//   cuts：接地の真ん中のコマ（stepCuts）。両端の切れ目のまわりの歩は、区切りが片側しかないので使わない
//   landFrac：着地・離地を決める高さ（区切りの中のいちばん小さい値と山の間の割合）
export function stepSinks(vert: number[], cuts: number[], fs: number, landFrac = SINK.landFrac): SinkStep[] {
  const out: SinkStep[] = []
  for (let k = 1; k + 1 < cuts.length; k++) {
    const from = Math.round((cuts[k - 1] + cuts[k]) / 2)
    const to = Math.round((cuts[k] + cuts[k + 1]) / 2)
    if (to - from < 6) continue
    if (to >= vert.length) continue
    const a = vert.slice(from, to + 1)
    const h = stepHeight(a, fs)
    let p = 0
    for (let i = 1; i < a.length; i++) if (a[i] > a[p]) p = i
    const lo = Math.min(...a)
    const line = lo + landFrac * (a[p] - lo)
    let land = p
    while (land > 0 && a[land - 1] > line) land--
    let off = p
    while (off < a.length - 1 && a[off + 1] > line) off++
    // 区切りの端まで線の上なら（空中の真ん中まで接地が続いた）、着地が分からないので使わない
    if (land === 0 || off === a.length - 1) continue
    // 線を横切ったところを、前後のコマの間の直線で細かくする
    const wl = (line - a[land - 1]) / (a[land] - a[land - 1])
    const wo = (a[off] - line) / (a[off] - a[off + 1])
    const hLand = h[land - 1] + wl * (h[land] - h[land - 1])
    let low = hLand
    for (let i = land; i <= off; i++) low = Math.min(low, h[i])
    out.push({ sinkCm: (hLand - low) * 100, bounceCm: (Math.max(...h) - Math.min(...h)) * 100, contactMs: ((off + wo - (land - 1 + wl)) / fs) * 1000 })
  }
  return out
}

// 直近の値（腰のスマホの、重力を含む加速度）から、沈み込みの真ん中を出す。値が足りない・1歩の周期が見つからない・使える歩が SINK.minSteps より少なければ null
// 上向きは窓の平均の加速度の向き、1歩の周期と切れ目は見る役（signal.ts の estimate）と同じ出し方
export function hipSink(ms: PhoneMeasure[]): SinkEst | null {
  if (ms.length < 3 || ms[ms.length - 1].t - ms[0].t < PHONE.minWindow) return null
  const { t, acc } = resample(ms)
  const fs = PHONE.fs
  const g: Vec3 = [mean(acc.map((a) => a[0])), mean(acc.map((a) => a[1])), mean(acc.map((a) => a[2]))]
  const gn = Math.hypot(g[0], g[1], g[2])
  if (gn < PHONE.gravityMin || gn > PHONE.gravityMax) return null
  const up: Vec3 = [g[0] / gn, g[1] / gn, g[2] / gn]
  const vert = acc.map((a) => a[0] * up[0] + a[1] * up[1] + a[2] * up[2] - gn)
  const sp = stepPeriod(vert, fs)
  if (!sp) return null
  const f = refineFreq(t, vert, 1 / sp.period)
  const { cuts } = stepCuts(vert, fs / f)
  const steps = stepSinks(vert, cuts, fs)
  if (steps.length < SINK.minSteps) return null
  return {
    sinkCm: medianOf(steps.map((s) => s.sinkCm)),
    steps: steps.length,
    bounceCm: medianOf(steps.map((s) => s.bounceCm)),
    contactMs: medianOf(steps.map((s) => s.contactMs)),
  }
}

// 身長に対する割合（%）。Runmetrix は身長を100%とした比率で出す。身長が分からなければ null
export const sinkPct = (cm: number | null | undefined, heightCm: number | null | undefined) =>
  cm === null || cm === undefined || !Number.isFinite(cm) || !heightCm || !(heightCm > 0) ? null : (cm / heightCm) * 100
