// トレッドミルの検証の採点（scripts/treadmill-grade.mjs）で使う：記録を、いまの判定のコードにもう一度通す。
// アプリ本体（src/）は読むだけで変えない。線の上書き（--set）は、params.ts の入れ物をこの中で書き換えて行う
// （判定は入れ物を毎回読むので、書き換えたあとに作ったコーチに効く）。grade から rolldown で1つにまとめて読む
//
// カメラ版：記録の1コマごとの値（見えているか・走る動きか・首／上体／体全体の角度・腰の高さ・向き）を、
//   撮ったときと同じ順で Coach に渡す。骨格を取らなかったコマ（記録にない）は、撮ったときと同じく時間だけ進める。
//   限り：ふだんの記録では、撮ったときに骨格を取らなかったコマ（安定して走っている間は10秒のうち3秒だけ取る）は記録にないので、
//   線を変えて「もっと細かく見たはず」になっても、その分の値は足せない。
//   全コマ記録（?full=1 で撮った、log.full のある記録）は走っている間の毎コマがあるので、この限りはない。
//   thin を付けると、全コマの記録をふだんの間引き（Live.tsx と同じく、コーチが要ると言ったコマだけ見る）に通し直せる。
//   記録の moving 列は1コマずつの判定なので、走り始め・止まりは撮ったときと同じく Coach の中で直近のコマの割合から決め直す。
//   running: 'steps' を付けると、1コマずつの判定を歩数（ピッチ RUNNING.runSpm 以上）だけにする（記録の by 列が steps のコマだけ走っている）。
//   その場で走るフリの見分け（RUNNING.inPlaceForTesting）を入れて撮った記録を、いまの判定（切っている）で通すため
// スマホ版：記録の生の加速度・角速度（届いたコマすべて）を、PhoneRun にそのまま渡す（撮ったときとほぼ同じになる）
import { Coach } from '../../src/modes/camera/coach'
import { LIMITS, REL_LIMITS, HEAD_ABS } from '../../src/modes/camera/params'
import { ABSENCE, CUE as CUE_P, HIP_REF, POWER, PRAISE, QUIET, RUNNING, SCORE } from '../../src/core/params'
import { CUE, RECOVER, SAY, PHRASES } from '../../src/core/phrases'
import { activeItems } from '../../src/core/level'
import type { ItemKey, RunLog, Session } from '../../src/core/types'
import type { Measure } from '../../src/modes/camera/types'
import { PhoneRun } from '../../src/modes/phone/session'
import { PHONE_CUE } from '../../src/modes/phone/analyzer'
import { MOUNT, PHONE_LIMITS } from '../../src/modes/phone/params'
import type { PhoneLog } from '../../src/modes/phone/log'
import type { DrillOptions } from '../../src/modes/phone/drill'

// --set で書き換えられる入れ物
export const PARAMS: Record<string, Record<string, unknown>> = {
  LIMITS, REL_LIMITS, HEAD_ABS, CUE: CUE_P, QUIET, PRAISE, POWER, RUNNING, ABSENCE, SCORE, HIP_REF, PHONE_LIMITS, MOUNT,
}
// 短い名前 → 入れ物の場所
export const ALIASES: Record<string, string> = {
  head: 'LIMITS.head.cue', // 頭が前に出た量（度）。走り始めの自分との差
  trunk: 'LIMITS.trunk.cue', // 上体の前傾（基準ができる前の決まった線、度）
  body: 'LIMITS.body.cue', // 体全体の前傾（基準ができる前の決まった線、度）
  hip: 'LIMITS.hip.cue', // 腰の下がり（%）
  trunkRel: 'REL_LIMITS.trunk.cue', // 上体：走り始めの自分からの増え（度）
  bodyRel: 'REL_LIMITS.body.cue', // 体全体：走り始めの自分からの増え（度）
  headAbs: 'HEAD_ABS.line', // 最初から頭が前に出ている（度）
  window: 'CUE.window', // 声をかける窓（秒）
  cadence: 'PHONE_LIMITS.cadence.cue', // スマホ：ピッチの下がり（%）
  bounce: 'PHONE_LIMITS.bounce.cue',
  braking: 'PHONE_LIMITS.braking.cue',
}

// 「名前=値」を入れ物に書き込む。戻り値は書き込んだ場所と、前の値
export function setParam(spec: string): { path: string; before: unknown; after: number } {
  const i = spec.indexOf('=')
  if (i < 0) throw new Error(`--set は 名前=値 の形で渡してください（${spec}）`)
  const name = spec.slice(0, i).trim()
  const value = Number(spec.slice(i + 1))
  if (!Number.isFinite(value)) throw new Error(`--set の値が数ではありません（${spec}）`)
  const path = ALIASES[name] ?? name
  const keys = path.split('.')
  let obj: Record<string, unknown> | undefined = PARAMS[keys[0]]
  for (const k of keys.slice(1, -1)) obj = obj?.[k] as Record<string, unknown> | undefined
  const last = keys[keys.length - 1]
  if (!obj || keys.length < 2 || typeof obj[last] !== 'number') {
    throw new Error(`--set の名前が分かりません（${name}）。短い名前: ${Object.keys(ALIASES).join(', ')}。または ${Object.keys(PARAMS).join('・')} の中の場所（例 LIMITS.head.cue）`)
  }
  const before = obj[last]
  obj[last] = value
  return { path, before, after: value }
}

// 話した言葉 → 項目。声かけでない言葉は null
export type Said = { item: string; kind: 'cue' | 'recover' | 'praise' | 'tone' | 'mount' } | null
const BY_TEXT = new Map<string, NonNullable<Said>>()
for (const [k, text] of Object.entries(CUE)) BY_TEXT.set(text, { item: k, kind: 'cue' })
for (const [k, text] of Object.entries(PHONE_CUE)) BY_TEXT.set(text, { item: k, kind: k === 'mount' || k === 'loose' || k === 'place' ? 'mount' : 'cue' })
for (const text of RECOVER) BY_TEXT.set(text, { item: 'recover', kind: 'recover' })
for (const text of [SAY.praise5, SAY.quietStart, SAY.quietDone, PHRASES.phonePraise5, PHRASES.phoneQuietDone]) BY_TEXT.set(text, { item: 'praise', kind: 'praise' })
export function classify(text: string): Said {
  const tone = /^tone:on:([^:]+)/.exec(text)
  if (tone) return { item: tone[1], kind: 'tone' }
  return BY_TEXT.get(text) ?? null
}

export interface Ev {
  T: number // ふつうの時刻（ms、その端末の時計）
  text: string
}

const unwrap = <T>(f: unknown): { log: T; session?: unknown } => {
  const o = f as { log?: T }
  return o && typeof o === 'object' && 'log' in o ? (o as { log: T; session?: unknown }) : { log: f as T }
}

export function isPhone(file: unknown): boolean {
  return (unwrap<{ mode?: string }>(file).log as { mode?: string }).mode === 'phone'
}

// 記録にある言葉（撮ったときのもの）を、ふつうの時刻に直して返す
export function loggedEvents(file: unknown): { events: Ev[]; clock: boolean } {
  const { log } = unwrap<RunLog | PhoneLog>(file)
  const c = log.clock
  const toT = (t: number) => (c ? c.epochMs + t * 1000 - c.perfMs : log.startedAt + t * 1000)
  return { events: log.events.map(([t, text]) => ({ T: toT(t), text })), clock: !!c }
}

// 記録にあるか（1コマごとの値）を調べる
export function inventory(file: unknown): { kind: 'camera' | 'phone'; frames: number; measures: number; points: number; clock: boolean; columns: string[]; spanSec: number; full: boolean } {
  const { log } = unwrap<RunLog | PhoneLog>(file)
  if (isPhone(file)) {
    const l = log as PhoneLog
    const rows = l.rows ?? []
    return { kind: 'phone', frames: rows.length, measures: (l.seconds ?? []).length, points: 0, clock: !!l.clock, columns: [...l.columns], spanSec: rows.length ? (Number(rows[rows.length - 1][0]) - Number(rows[0][0])) : 0, full: true }
  }
  const l = log as RunLog
  const ci = (n: string) => l.columns.indexOf(n)
  const ineck = ci('neck')
  const off = l.columns.length - 1
  const rows = l.rows ?? []
  return {
    kind: 'camera',
    frames: rows.length,
    measures: ineck < 0 ? 0 : rows.filter((r) => r[ineck] !== -999).length,
    points: rows.filter((r) => r.length >= off + (l.points?.length ?? 0) * 3 && (l.points?.length ?? 0) > 0).length,
    clock: !!l.clock,
    columns: l.columns,
    spanSec: rows.length ? rows[rows.length - 1][0] - rows[0][0] : 0,
    full: !!l.full,
  }
}

// ---- カメラ版：記録を Coach にもう一度通す ----
export interface ReplayOut {
  events: Ev[] // しくみが話した言葉（ふつうの時刻）
  items: string[] // 声をかける項目
  warnings: string[]
  runStartT: number | null // 走り始めた（しくみが running になった）時刻
  // 走り始めの自分の基準（HIP_REF の区間）を作った時刻（ふつうの時刻）と、その値。カメラ版だけ。基準ができなければ null
  ref?: { from: number; to: number; neck: number; trunk: number; body: number; headLean: number; hipRatio: number | null } | null
}

// fromMs：この時刻（その端末の時計、ms）より前のコマは通さない（歩いている間にしくみが走り始めていても、基準をジョグで作り直すため）
// thin：全コマ記録を、ふだんの間引きに通し直す（コーチが要らないと言ったコマは、撮ったときの onSkip と同じく時間だけ進める）
export function replayCamera(file: unknown, opts: { items?: 'all' | 'logged'; fromMs?: number; thin?: boolean; running?: 'logged' | 'steps' } = {}): ReplayOut {
  const { log, session } = unwrap<RunLog>(file)
  const s = session as Session | undefined
  const warnings: string[] = []
  const col = (n: string) => {
    const i = log.columns.indexOf(n)
    if (i < 0) throw new Error(`カメラ版の記録に列 ${n} がありません`)
    return i
  }
  const [it, ip, iv, imov, ineck, itrunk, ibody, ihip, iyaw, ilean] = ['t', 'phase', 'visible', 'moving', 'neck', 'trunk', 'body', 'hipRatio', 'yaw', 'headLean'].map(col)
  // by 列：0 = 走っていない、1 = 歩数で走っている、2 = その場で走るフリ（src/modes/camera/log.ts の BY）
  const iby = opts.running === 'steps' ? col('by') : -1
  const BY_STEPS = 1
  const runPhase = log.phases.indexOf('run')
  const c = log.clock
  if (!c) warnings.push('記録に時計の対応（clock）がありません（動画で試した記録）。時刻は startedAt から数えます')
  const toT = (t: number) => (c ? c.epochMs + t * 1000 - c.perfMs : log.startedAt + t * 1000)
  // 撮ったときの「声をかける項目」（ランナーのレベル）。記録になければすべて
  let items: ItemKey[] | undefined
  if (opts.items !== 'all' && s?.focus) items = activeItems(s.focus.step)
  else if (opts.items !== 'all') warnings.push('結果（session）に「注意した項目」（focus）がないので、すべての項目で声をかけるとして通しました')
  const coach = new Coach({ pause: RUNNING.pauseEnabled, items })
  const events: Ev[] = []
  let runStartT: number | null = null
  // 走り始めの基準にためた最初の秒・最後の秒の時刻（基準ができる前に止まって作り直したら、数え直す）
  let refFrom: number | null = null
  let refTo: number | null = null
  let refCount = 0
  const rows = log.rows.filter((r) => r[ip] === runPhase && (opts.fromMs === undefined || toT(r[it]) >= opts.fromMs)).sort((a, b) => a[it] - b[it])
  if (!rows.length) warnings.push('走る段（phase=run）のコマがありません')
  let lastT: number | null = null
  let lastPresent = true
  let lastMoving = false
  let ended = false
  const handle = (ev: ReturnType<Coach['update']>, t: number) => {
    const n = coach.refSeconds
    if (n < refCount || n === 0) refFrom = null
    if (n > refCount) {
      refFrom ??= toT(t)
      refTo = toT(t)
    }
    refCount = n
    for (const e of ev) {
      if (e.type === 'speak') events.push({ T: toT(t), text: e.text })
      if (e.type === 'state' && e.state === 'running' && runStartT === null) runStartT = toT(t)
      if (e.type === 'state' && e.state === 'ended') ended = true
    }
  }
  if (opts.thin && !log.full) warnings.push('間引いて撮った記録なので、--thin は効きません（もともと間引かれています）')
  const thin = !!opts.thin && !!log.full
  // 骨格を取らなかったコマの代わり：時間だけ進める（撮ったときは毎コマ onSkip が呼ばれていた）。
  // 全コマ記録では骨格を取らなかったコマがない（行のすき間は、骨格の推定が間に合わなかったコマで、撮ったときも何も呼ばれていない）
  const SKIP = 1 / 15
  for (const r of rows) {
    if (ended) break
    const t = r[it]
    if (lastT !== null && !log.full) for (let u = lastT + SKIP; u < t - SKIP / 2; u += SKIP) handle(coach.update({ t: u, present: lastPresent, moving: lastMoving }), u)
    if (ended) break
    // ふだんの間引き（Live.tsx の want）：見えていて、コーチが要らないと言ったコマは骨格を取らない
    if (thin && lastPresent && !coach.wantsDetail()) {
      handle(coach.update({ t, present: lastPresent, moving: lastMoving }), t)
      lastT = t
      continue
    }
    const visible = r[iv] === 1
    const moving = opts.running === 'steps' ? r[iby] === BY_STEPS : r[imov] === 1
    const m: Measure | undefined = visible && r[ineck] !== -999 ? { neck: r[ineck], trunk: r[itrunk], body: r[ibody], hipRatio: r[ihip], yaw: r[iyaw], headLean: r[ilean], dir: 1 } : undefined
    handle(coach.update({ t, present: visible, moving, m }), t)
    lastT = t
    lastPresent = visible
    lastMoving = moving
  }
  const lr = coach.leanRef
  const hipRef = (coach as unknown as { analyzer: { hipRef: number | null } }).analyzer.hipRef
  const ref = lr && refFrom !== null && refTo !== null ? { from: refFrom, to: refTo, neck: lr.neck, trunk: lr.trunk, body: lr.body, headLean: lr.headLean, hipRatio: hipRef } : null
  return { events, items: items ?? ['head', 'trunk', 'body', 'hip'], warnings, runStartT, ref }
}

// ---- スマホ版：生の値を PhoneRun にもう一度通す ----
export function replayPhone(file: unknown, opts: { fromMs?: number } = {}): ReplayOut {
  const { log } = unwrap<PhoneLog>(file)
  const warnings: string[] = []
  const kindEv = log.events.find(([, text]) => text.startsWith('kind:'))?.[1]
  let kind: ConstructorParameters<typeof PhoneRun>[3]
  if (kindEv?.startsWith('kind:drill:')) {
    const [, , version, extra] = kindEv.split(':')
    kind = { kind: 'drill', drill: { version: version as DrillOptions['version'], extra: extra === 'extra', upper: extra === 'upper' } }
  } else if (kindEv) warnings.push(`練習・テストの記録（${kindEv}）は、ふつうの走りとして通しました`)
  if (log.where === 'outdoor') warnings.push('外の記録です。GPS の速さは通し直していません（トレッドミルとして通しました）')
  const run = new PhoneRun(log.clock, { userAgent: log.device.userAgent, intervalMs: log.device.intervalMs }, 'treadmill', kind)
  const ci = (n: string) => log.columns.indexOf(n)
  const [it, iax, iay, iaz, igx, igy, igz] = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'].map(ci)
  const num = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v)
  let last: number | null = null
  const c0 = log.clock
  const from = opts.fromMs === undefined ? -Infinity : (opts.fromMs - c0.epochMs + c0.perfMs) / 1000
  for (const r of log.rows) {
    const t = r[it] as number
    if (t < from) continue
    // 値が途切れた間は、タイマーの代わりに時間を進める（撮ったときは画面のタイマーが呼んでいた）
    if (last !== null && t - last > 0.5) for (let u = last + 0.25; u < t; u += 0.25) {
      run.tick(u)
      run.guide(u)
    }
    run.feed({ t, ax: r[iax] as number, ay: r[iay] as number, az: r[iaz] as number, gx: num(r[igx]), gy: num(r[igy]), gz: num(r[igz]) })
    if (run.drill && (last === null || Math.floor(t * 4) !== Math.floor(last * 4))) run.guide(t)
    last = t
    if (run.coach.state === 'ended') break
  }
  if (log.truncated) warnings.push('生の値が途中で止まっている記録です（MAX_RAW）')
  const c = log.clock
  const events = run.rec.log.events.map(([t, text]) => ({ T: c.epochMs + t * 1000 - c.perfMs, text }))
  return { events, items: ['cadence'], warnings, runStartT: null }
}

// 時計を合わせる手がかり：ジャンプの「はい」の前後で、大きく動き始めた時刻（ふつうの時刻 ms）。strength は動きの大きさ ÷ ふだんのばらつき（999 まで）
export function findJump(file: unknown, nearMs: number, beforeMs = 2000, afterMs = 8000): { T: number; strength: number } | null {
  const { log } = unwrap<RunLog | PhoneLog>(file)
  const c = log.clock
  if (!c) return null
  const toT = (t: number) => c.epochMs + t * 1000 - c.perfMs
  const pts: { T: number; v: number }[] = []
  if (isPhone(file)) {
    const l = log as PhoneLog
    const [it, iax, iay, iaz] = ['t', 'ax', 'ay', 'az'].map((n) => l.columns.indexOf(n))
    for (const r of l.rows) {
      const T = toT(r[it] as number)
      if (T < nearMs - beforeMs || T > nearMs + afterMs) continue
      pts.push({ T, v: Math.hypot(r[iax] as number, r[iay] as number, r[iaz] as number) })
    }
  } else {
    // 腰の高さ（y は下向きなので、跳ぶと小さくなる）。腰の点が見えているコマだけ
    const l = log as RunLog
    const off = l.columns.length - 1
    const it = l.columns.indexOf('t')
    const LH = l.points.indexOf(23)
    const RH = l.points.indexOf(24)
    if (LH < 0 || RH < 0) return null
    for (const r of l.rows) {
      const T = toT(r[it])
      if (T < nearMs - beforeMs || T > nearMs + afterMs || r.length < off + l.points.length * 3) continue
      if (r[off + LH * 3 + 2] < 0.5 || r[off + RH * 3 + 2] < 0.5) continue
      pts.push({ T, v: -(r[off + LH * 3 + 1] + r[off + RH * 3 + 1]) / 2 })
    }
  }
  if (pts.length < 10) return null
  const vs = pts.map((p) => p.v).sort((a, b) => a - b)
  const med = vs[vs.length >> 1]
  const mad = vs.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[vs.length >> 1] || 1e-6
  // いちばん大きく動いたコマの半分を越えた、最初のコマ（模擬や、跳び直したときに、あとのジャンプを拾わないように）
  const dev = (q: { v: number }) => Math.abs(q.v - med)
  const peak = Math.max(...pts.map(dev))
  const best = pts.find((q) => dev(q) >= peak / 2)!
  return { T: best.T, strength: Math.min(999, peak / mad) }
}
