import { LAB, DRILL, readMarks, TEST1 } from './compare'
import type { PhoneLog } from './log'
import type { PhoneMeasure } from './signal'
import { waistGait } from '../sensor/waistSit'
import { WAIST_SIT } from '../sensor/params'

// 答えつきの記録（/lab/ の腰スマホ1台の走り。drill.ts の labPlan）と崩しの撮影の、区間ごとの値の表。採点（scripts/treadmill-grade.mjs）から使う。
// Mac の drill の記録がなくても、スマホの記録の区間の印（protocol:<key>:start / end）から区間を作れる（sectionsFromMarks）。
//
// 1秒ごとの値：
//   記録の1秒ごとの値（アプリが出した、直近4秒の窓）：ピッチ・有効接地時間・上下動・ブレーキ・腰の沈み込み（sinkCm・sinkCt）・GPS の速さ
//   記録の生の値から出し直す値（センサーランの腰の iPhone の腰落ちと同じ見方。sensor/waistSit.ts の waistGait、窓は WAIST_SIT.window 秒）：
//     接地の割合（有効接地時間 ÷ 1歩の時間）・1歩ごとの上下の加速度の山（重力を含む、g）
// 比べる相手（基準）：最初の「ふつう」（normal1）の、走り始めの BASE_SKIP 秒を除いた秒の真ん中。
//   見分けの値（index）は WaistSit と同じ式：((接地の割合 ÷ 基準 − 1) ÷ sdD − (山 ÷ 基準 − 1) ÷ sdP) ÷ sdC。
//   ばらつき（sdD・sdP・sdC）は、基準の秒が WAIST_SIT.sdMinN 以上あればその走りから（決めた値の半分が下限）、なければ決めた値（WaistSit の setRef と同じ）
// 区間の始めの settle 秒は除く（窓が区間の値に入れ替わる時間と、合図から崩し始めるまで）

export const LAB_SETTLE = 8 // 区間の始めに除く秒（窓6秒 ＋ 合図から崩すまで約2秒）
export const BASE_SKIP = 60 // 最初のふつうの始めに除く秒（走り始めは速さとフォームが落ち着かない）

// 区間（時刻はふつうの時刻 ms）。kind は Mac の drill の記録（scripts/treadmill/plan.mjs）と同じ名前
export interface LabSection {
  key: string
  kind: string // normal・drill・gap（ふつうに戻す）・jump・prep など
  name: string
  start: number
  end: number
  after?: string // gap のとき、前の崩しの key
}

const unwrap = (x: unknown): PhoneLog => ((x as { log?: PhoneLog }).log ?? x) as PhoneLog

const NAMES = [...DRILL, ...LAB, ...TEST1]
const nameOf = (key: string) => (key === 'jump1' || key === 'jump2' ? 'その場でジャンプ' : key === 'still' ? 'じっと立つ' : NAMES.find((s) => s.key === key)?.name ?? key)
const kindOf = (key: string) => (key === 'jump1' || key === 'jump2' ? 'jump' : key === 'still' ? 'prep' : /^normal\d*$/.test(key) ? 'normal' : key === 'back' ? 'gap' : 'drill')

// スマホの記録の区間の印から、採点の区間を作る（Mac の drill の記録の代わり）。印がなければ sections は空
export function sectionsFromMarks(file: unknown): { sections: LabSection[]; startedAt: number; jumpAt: number | null; done: boolean; stoppedAt: number | null; endedAt: number; kind: string | null } {
  const log = unwrap(file)
  const marks = readMarks(log)
  const it = log.columns.indexOf('wallMs')
  const lastRow = log.rows[log.rows.length - 1]
  const endedAt = lastRow && it >= 0 ? (lastRow[it] as number) : log.startedAt
  const T = (t: number) => log.clock.epochMs + t * 1000 - log.clock.perfMs
  const ev = (text: string) => log.events.find(([, x]) => x === text)
  const stopped = ev('protocol:stopped')
  const sections: LabSection[] = []
  let prevRun: string | undefined
  for (const m of marks) {
    const kind = kindOf(m.key)
    const s: LabSection = { key: m.key, kind, name: nameOf(m.key), start: Math.round(m.start * 1000), end: m.end === null ? endedAt : Math.round(m.end * 1000) }
    if (kind === 'gap') s.after = prevRun
    if (kind === 'drill') prevRun = m.key
    sections.push(s)
  }
  const jump = sections.find((s) => s.key === 'jump1')
  return {
    sections,
    startedAt: log.startedAt,
    jumpAt: jump ? jump.start : null,
    done: !!ev('protocol:done'),
    stoppedAt: stopped ? T(stopped[0]) : null,
    endedAt,
    kind: log.events.find(([, x]) => x.startsWith('kind:'))?.[1] ?? null,
  }
}

// 1秒ごとの値
export interface LabSecond {
  T: number // ふつうの時刻 ms
  cadence: number | null
  contactMs: number | null
  bounceCm: number | null
  brakingMs: number | null
  sinkCm: number | null
  sinkCt: number | null
  kmh: number | null // GPS のならした速さ（外だけ）
  duty: number | null // 接地の割合（生の値から WAIST_SIT.window 秒の窓で出し直した値）
  peakG: number | null // 1歩ごとの上下の加速度の山（g、同じ窓）
}

export function labSeconds(file: unknown): LabSecond[] {
  const log = unwrap(file)
  const c = log.columns
  const [it, ix, iy, iz, gx, gy, gz] = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'].map((n) => c.indexOf(n))
  const raw: PhoneMeasure[] = log.rows.map((r) => ({ t: r[it] as number, ax: r[ix] as number, ay: r[iy] as number, az: r[iz] as number, gx: r[gx] ?? undefined, gy: r[gy] ?? undefined, gz: r[gz] ?? undefined }))
  const sc = log.secondColumns
  const k = (n: string) => sc.indexOf(n)
  const [st, sw, scad, sct, sbo, sbr, ssk, sskt, ssp] = ['t', 'wallMs', 'cadence', 'contactMs', 'bounceCm', 'brakingMs', 'sinkCm', 'sinkCt', 'speed'].map(k)
  const val = (r: (number | null)[], i: number) => (i < 0 ? null : r[i] ?? null)
  const out: LabSecond[] = []
  let a = 0
  let b = 0
  for (const r of log.seconds) {
    const t = r[st] as number
    // 直近 window 秒の生の値
    while (b < raw.length && raw[b].t <= t) b++
    while (a < b && raw[a].t < t - WAIST_SIT.window) a++
    const g = b - a > 50 ? waistGait(raw.slice(a, b)) : null
    const kmh = val(r, ssp)
    out.push({
      T: r[sw] as number,
      cadence: val(r, scad),
      contactMs: val(r, sct),
      bounceCm: val(r, sbo),
      brakingMs: val(r, sbr),
      sinkCm: val(r, ssk),
      sinkCt: val(r, sskt),
      kmh: kmh === null ? null : kmh * 3.6,
      duty: g?.duty ?? null,
      peakG: g?.peakG ?? null,
    })
  }
  return out
}

const median = (xs: (number | null)[]) => {
  const s = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((p, q) => p - q)
  if (!s.length) return null
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const sdOf = (xs: number[]) => {
  const m = xs.reduce((p, q) => p + q, 0) / xs.length
  return Math.sqrt(xs.reduce((p, q) => p + (q - m) ** 2, 0) / xs.length)
}

// 比べる相手（基準）
export interface LabBase {
  from: string // 何から作ったか
  n: number
  cadence: number | null
  contactMs: number | null
  bounceCm: number | null
  brakingMs: number | null
  sinkCm: number | null
  kmh: number | null
  duty: number | null
  peakG: number | null
  sdD: number
  sdP: number
  sdC: number
  fixedSd: boolean
}

const inside = (secs: LabSecond[], s: LabSection, skipSec: number) => secs.filter((x) => x.T >= s.start + skipSec * 1000 && x.T < s.end)

export function labBase(secs: LabSecond[], sections: LabSection[]): LabBase | null {
  const n1 = sections.find((s) => s.key === 'normal1')
  const xs = n1 ? inside(secs, n1, Math.min(BASE_SKIP, (n1.end - n1.start) / 2000)) : sections.filter((s) => s.kind === 'normal').flatMap((s) => inside(secs, s, LAB_SETTLE))
  if (!xs.length) return null
  const duty = median(xs.map((x) => x.duty))
  const peakG = median(xs.map((x) => x.peakG))
  const P = WAIST_SIT
  const both = xs.filter((x) => x.duty !== null && x.peakG !== null)
  const enough = duty !== null && peakG !== null && both.length >= P.sdMinN
  let sdD = P.sdDuty
  let sdP = P.sdPeak
  let sdC = P.sdComb
  if (enough) {
    const dr = both.map((x) => x.duty! / duty! - 1)
    const pr = both.map((x) => x.peakG! / peakG! - 1)
    sdD = Math.max(sdOf(dr), P.sdDuty / 2)
    sdP = Math.max(sdOf(pr), P.sdPeak / 2)
    sdC = Math.max(sdOf(dr.map((d, i) => d / sdD - pr[i] / sdP)), 0.5)
  }
  return {
    from: n1 ? `最初のふつう（始めの${Math.round(Math.min(BASE_SKIP, (n1.end - n1.start) / 2000))}秒を除く）` : 'ふつうの区間すべて',
    n: xs.length,
    cadence: median(xs.map((x) => x.cadence)),
    contactMs: median(xs.map((x) => x.contactMs)),
    bounceCm: median(xs.map((x) => x.bounceCm)),
    brakingMs: median(xs.map((x) => x.brakingMs)),
    sinkCm: median(xs.map((x) => x.sinkCm)),
    kmh: median(xs.map((x) => x.kmh)),
    duty,
    peakG,
    sdD,
    sdP,
    sdC,
    fixedSd: !enough,
  }
}

// その秒の見分けの値と、決まり（WAIST_SIT の line、または接地の割合 dutyPct 以上かつ山 peakPct 以下）を満たしたか
const indexOf = (x: LabSecond, b: LabBase) =>
  x.duty === null || x.peakG === null || b.duty === null || b.peakG === null ? null : ((x.duty / b.duty - 1) / b.sdD - (x.peakG / b.peakG - 1) / b.sdP) / b.sdC
const ruleOf = (x: LabSecond, b: LabBase) => {
  const i = indexOf(x, b)
  if (i === null) return null
  const d = (x.duty! / b.duty! - 1) * 100
  const p = (x.peakG! / b.peakG! - 1) * 100
  return i >= WAIST_SIT.line || (d >= WAIST_SIT.dutyPct && p <= WAIST_SIT.peakPct)
}

export interface LabRow {
  label: string
  kind: string
  sec: number // 区間の長さ
  n: number // 値を見た秒
  v: Omit<LabBase, 'from' | 'n' | 'sdD' | 'sdP' | 'sdC' | 'fixedSd'> & { sinkCt: number | null }
  index: number | null // 見分けの値の真ん中
  rule: number | null // 決まりを満たした秒の割合
  near: { duty: number | null; peakG: number | null; sinkCm: number | null } | null // 前後のふつう（戻し）の真ん中
}

const valuesOf = (xs: LabSecond[]) => ({
  cadence: median(xs.map((x) => x.cadence)),
  contactMs: median(xs.map((x) => x.contactMs)),
  bounceCm: median(xs.map((x) => x.bounceCm)),
  brakingMs: median(xs.map((x) => x.brakingMs)),
  sinkCm: median(xs.map((x) => x.sinkCm)),
  sinkCt: median(xs.map((x) => x.sinkCt)),
  kmh: median(xs.map((x) => x.kmh)),
  duty: median(xs.map((x) => x.duty)),
  peakG: median(xs.map((x) => x.peakG)),
})
const rowOf = (label: string, kind: string, sec: number, xs: LabSecond[], b: LabBase | null, nearXs: LabSecond[] | null): LabRow => {
  const idx = b ? xs.map((x) => indexOf(x, b)) : []
  const rules = b ? xs.map((x) => ruleOf(x, b)).filter((r): r is boolean => r !== null) : []
  const nv = nearXs && nearXs.length ? valuesOf(nearXs) : null
  return {
    label,
    kind,
    sec,
    n: xs.length,
    v: valuesOf(xs),
    index: median(idx),
    rule: rules.length ? rules.filter(Boolean).length / rules.length : null,
    near: nv ? { duty: nv.duty, peakG: nv.peakG, sinkCm: nv.sinkCm } : null,
  }
}

const SHOWN = ['normal', 'drill', 'gap', 'speed', 'moved']

// 区間ごとの行と、同じ崩し（key）をまとめた行
export function labRows(secs: LabSecond[], sections: LabSection[], settle = LAB_SETTLE): { base: LabBase | null; rows: LabRow[]; groups: LabRow[] } {
  const base = labBase(secs, sections)
  const shown = sections.filter((s) => SHOWN.includes(s.kind))
  const rows = shown.map((s, i) => {
    const xs = inside(secs, s, Math.min(settle, (s.end - s.start) / 2000))
    // 崩しの前後のふつう（戻し・ふつう）。外では道や速さが少しずつ変わるので、近くのふつうとも比べる
    let near: LabSecond[] | null = null
    if (s.kind === 'drill') {
      const prev = shown.slice(0, i).reverse().find((x) => x.kind === 'gap' || x.kind === 'normal')
      const next = shown.slice(i + 1).find((x) => x.kind === 'gap' || x.kind === 'normal')
      near = [prev, next].filter((x): x is LabSection => !!x).flatMap((x) => (x.key === 'normal1' ? inside(secs, { ...x, start: Math.max(x.start, x.end - 60_000) }, 0) : inside(secs, x, Math.min(settle, (x.end - x.start) / 2000))))
    }
    const label = s.kind === 'gap' ? `${s.name}（${s.after ? nameOf(s.after) : ''}のあと）` : s.name
    return rowOf(label, s.kind, (s.end - s.start) / 1000, xs, base, near)
  })
  // 同じ崩しをまとめる（繰り返した区間の秒を合わせる）。ふつう・戻しは1つにまとめる
  const keys: string[] = []
  for (const s of shown) {
    const k = s.kind === 'drill' ? s.key : 'ふつう'
    if (!keys.includes(k)) keys.push(k)
  }
  const groups = keys.map((k) => {
    const ss = shown.filter((s) => (k === 'ふつう' ? s.kind !== 'drill' : s.kind === 'drill' && s.key === k))
    const xs = ss.flatMap((s) => (s.key === 'normal1' && base ? inside(secs, s, Math.min(BASE_SKIP, (s.end - s.start) / 2000)) : inside(secs, s, Math.min(settle, (s.end - s.start) / 2000))))
    const label = k === 'ふつう' ? 'ふつう（ふつう・戻しすべて）' : `${nameOf(k)}（${ss.length}回）`
    return rowOf(label, k === 'ふつう' ? 'normal' : 'drill', ss.reduce((a, s) => a + (s.end - s.start) / 1000, 0), xs, base, null)
  })
  return { base, rows, groups }
}

// ---- 表（Markdown） ----

const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d))
const pc = (x: number | null, b: number | null | undefined) => (x === null || b === null || b === undefined || !b ? '—' : `${x / b - 1 >= 0 ? '+' : '−'}${Math.abs((x / b - 1) * 100).toFixed(1)}%`)
const sg = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`)
const df = (x: number | null, b: number | null | undefined, d = 2) => (x === null || b === null || b === undefined ? '—' : `${x - b >= 0 ? '+' : '−'}${Math.abs(x - b).toFixed(d)}`)
const KIND_NAME: Record<string, string> = { normal: 'ふつう', drill: '崩し', gap: '戻し', speed: '速さを変える', moved: '動かしたあと' }

export function labReport(file: unknown, sections: LabSection[], opts: { settle?: number; title?: string } = {}): string {
  const settle = opts.settle ?? LAB_SETTLE
  const log = unwrap(file)
  const secs = labSeconds(file)
  const { base, rows, groups } = labRows(secs, sections, settle)
  const out: string[] = []
  const p = (s = '') => out.push(s)
  const outdoor = log.where === 'outdoor'
  const hasSink = secs.some((x) => x.sinkCm !== null)
  p(`## ${opts.title ?? '区間ごとの値（スマホ版。腰の沈み込み・接地・上下の加速度の山・ブレーキ・上下動・ピッチ）'}`)
  p()
  p(`値は区間の中の1秒の値の真ん中。区間の始めの ${settle} 秒は除いた（\`--settle\`）。` +
    `ピッチ・有効接地時間・上下動・ブレーキ・腰の沈み込みは、アプリが記録した1秒ごとの値（直近4秒の窓）。` +
    `接地の割合（有効接地時間 ÷ 1歩の時間）と上下の加速度の山（重力を含む、1歩ごとのいちばん大きい値の真ん中、g）は、生の値から ${WAIST_SIT.window} 秒の窓で出し直した値（センサーランの腰の iPhone の腰落ち〔WAIST_SIT〕と同じ見方）。` +
    `${outdoor ? '外の記録なので、GPS の速さ（km/h）も出す。速さが基準から大きく違う区間は、ほかの値も速さで変わっている。' : 'トレッドミル（速さは一定とみなす）の記録。'}` +
    `${hasSink ? '' : '腰の沈み込みは、2026-11-17 より前の記録にはない。'}`)
  p()
  if (!base) {
    p('比べる相手（ふつうの区間）の値がない。')
    p()
  } else {
    p(`比べる相手（基準）：${base.from}の ${base.n} 秒。ピッチ ${f(base.cadence)} 歩/分・有効接地時間 ${f(base.contactMs, 0)} ms・接地の割合 ${f(base.duty, 3)}・山 ${f(base.peakG, 2)} g・腰の沈み込み ${f(base.sinkCm)} cm・上下動 ${f(base.bounceCm)} cm・ブレーキ ${f(base.brakingMs, 2)} m/s${outdoor ? `・速さ ${f(base.kmh)} km/h` : ''}。` +
      `見分けの値のばらつき ${base.fixedSd ? `は決めた値（基準の秒が ${WAIST_SIT.sdMinN} より少ない）` : 'はこの走りの基準から'}：接地の割合 ${f(base.sdD * 100)}%・山 ${f(base.sdP * 100)}%・合わせて ${f(base.sdC, 2)}。` +
      `決まり：見分けの値 ≥ ${WAIST_SIT.line}、または接地の割合 +${WAIST_SIT.dutyPct}% 以上かつ山 ${WAIST_SIT.peakPct}% 以下（WAIST_SIT。記録だけで、声にはしていない）`)
    p()
  }
  p('### 値（真ん中）')
  p()
  p(`| 区間 | 種類 | 長さ | 秒 | ${outdoor ? '速さ km/h | ' : ''}ピッチ 歩/分 | 有効接地時間 ms | 接地の割合 | 山 g | 腰の沈み込み cm | 沈み込みの接地 ms | 上下動 cm | ブレーキ m/s |`)
  p(`|---|---|---|---|${outdoor ? '---|' : ''}---|---|---|---|---|---|---|---|`)
  for (const r of rows) p(`| ${r.label} | ${KIND_NAME[r.kind] ?? r.kind} | ${f(r.sec, 0)}秒 | ${r.n} | ${outdoor ? `${f(r.v.kmh)} | ` : ''}${f(r.v.cadence)} | ${f(r.v.contactMs, 0)} | ${f(r.v.duty, 3)} | ${f(r.v.peakG, 2)} | ${f(r.v.sinkCm)} | ${f(r.v.sinkCt, 0)} | ${f(r.v.bounceCm)} | ${f(r.v.brakingMs, 2)} |`)
  p()
  const changeTable = (title: string, list: LabRow[], withNear: boolean) => {
    p(title)
    p()
    p(`| 区間 | 秒 | ${outdoor ? '速さ | ' : ''}接地の割合 | 山 | 見分けの値 | 決まりを満たした秒 | 腰の沈み込み | 有効接地時間 | 上下動 | ブレーキ m/s | ピッチ |${withNear ? ' 前後のふつうから：接地の割合・山・沈み込み |' : ''}`)
    p(`|---|---|${outdoor ? '---|' : ''}---|---|---|---|---|---|---|---|---|${withNear ? '---|' : ''}`)
    for (const r of list) {
      const nb = r.near
      const near = withNear ? ` ${nb ? `${pc(r.v.duty, nb.duty)}・${pc(r.v.peakG, nb.peakG)}・${pc(r.v.sinkCm, nb.sinkCm)}` : ''} |` : ''
      p(`| ${r.label} | ${r.n} | ${outdoor ? `${pc(r.v.kmh, base?.kmh)} | ` : ''}${pc(r.v.duty, base?.duty)} | ${pc(r.v.peakG, base?.peakG)} | ${sg(r.index)} | ${r.rule === null ? '—' : `${Math.round(r.rule * 100)}%`} | ${pc(r.v.sinkCm, base?.sinkCm)} | ${pc(r.v.contactMs, base?.contactMs)} | ${pc(r.v.bounceCm, base?.bounceCm)} | ${df(r.v.brakingMs, base?.brakingMs)} | ${pc(r.v.cadence, base?.cadence)} |${near}`)
    }
    p()
  }
  if (base) {
    changeTable('### 基準からの変わり（区間ごと）', rows, true)
    changeTable('### 基準からの変わり（同じ崩しをまとめて）', groups, false)
    p('見分けの値：腰落ちで正（接地の割合が増え、山が下がる）、弾むで負。ブレーキは基準との差（m/s）。「前後のふつうから」は、その崩しのすぐ前と後のふつう（戻し）の真ん中からの変わり（外で道や速さが少しずつ変わっても比べられるように）')
    p()
  }
  return out.join('\n')
}
