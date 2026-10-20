// 仮想実験の材料（着地）：研究データの3次元の点と床反力から、着地の本当の値を出す
//   着地（接地の始まり）は床反力の上下の力（板の合計）が 50N を超えた瞬間。どちらの足かは、そのとき低いほうの足。
//   Riglet はトレッドミルの力の板の値が記録されていないので、記録の中のイベント（Foot Strike）を使う（ブレーキは出せない）
//   本当の値（その足の着地の瞬間、前後と上下の面で）：
//     かかと・足首が腰より前にある距離（腰は左右の股関節の真ん中。脚の長さに対する割合）、重心より前（Riglet だけ）、
//     すねの角度（膝→足首の線と鉛直。足首が膝より前で正）、膝の曲がり、両膝の前後の開き、脚の角度（腰→足首と鉛直）
//   ブレーキ：その接地の前後の力のうち、体を後ろへ押す側の山（体重の倍）と力積（体重 × 秒）。体重は上下の力の平均
// 座標は sim/rbds.ts と同じ（X が前、Y が上、Z が右、mm）。床の高さは、かかと・つま先の低いほうから2%の高さを0にする
// データ：RBDS（Fukuchi 2017、150Hz、床反力 300Hz）、Riglet 2024（100Hz、床反力 1000Hz、重心 CentreOfMass）、
//         Van Hooren 2024（100Hz、床反力 1000Hz。ふつう 3.33m/s・ピッチを下げる lowfreq・上げる highfreq・上体を前に倒す trunklean）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTrial, table, type V3 } from './rbds'
import type { Source } from './longrun'

// ---- C3D（点・アナログ・イベント）を読む。sim/c3d.ts と同じ読み方に、床反力とイベントを足したもの ----

export interface C3DFull {
  rate: number
  frames: number
  labels: string[]
  point: (label: string) => V3[] | null // 見えていないコマは NaN
  analogRate: number
  analog: (label: string) => Float32Array | null
  events: { context: string; label: string; time: number }[] // time：秒（記録の最初のコマが 0）
}

export function readC3DFull(path: string, wantPoints: string[], wantAnalog: string[]): C3DFull {
  const b = readFileSync(path)
  const pblock = b[0]
  const first = b.readUInt16LE(6)
  const last = b.readUInt16LE(8)
  const p0 = (pblock - 1) * 512
  if (b[p0 + 3] !== 84) throw new Error('Intel 以外の C3D は読めません')
  const groups = new Map<number, string>()
  const raw: { gid: number; name: string; type: number; dims: number[]; at: number }[] = []
  let i = p0 + 4
  for (;;) {
    const nlen = b.readInt8(i)
    const gid = b.readInt8(i + 1)
    if (nlen === 0) break
    const name = b.toString('latin1', i + 2, i + 2 + Math.abs(nlen)).trim()
    const off = i + 2 + Math.abs(nlen)
    const next = b.readInt16LE(off)
    if (gid < 0) groups.set(-gid, name)
    else {
      let j = off + 2
      const type = b.readInt8(j)
      const nd = b[j + 1]
      const dims = Array.from({ length: nd }, (_, k) => b[j + 2 + k])
      j += 2 + nd
      raw.push({ gid, name, type, dims, at: j })
    }
    if (next === 0) break
    i = off + next
  }
  const params = new Map(raw.map((p) => [`${groups.get(p.gid) ?? p.gid}:${p.name}`, p]))
  const get = (key: string) => params.get(key)
  const nums = (key: string): number[] => {
    const p = get(key)
    if (!p) return []
    const n = p.dims.reduce((a, x) => a * x, 1)
    const size = p.type === 4 ? 4 : p.type === 2 ? 2 : 1
    return Array.from({ length: n }, (_, k) => (p.type === 4 ? b.readFloatLE(p.at + k * size) : p.type === 2 ? b.readInt16LE(p.at + k * size) : b.readInt8(p.at + k)))
  }
  const num = (key: string, d = 0) => nums(key)[0] ?? d
  const strs = (key: string) => {
    const p = get(key)
    if (!p) return []
    const w = p.dims[0]
    const n = p.dims.slice(1).reduce((a, x) => a * x, 1)
    return Array.from({ length: n }, (_, k) => b.toString('latin1', p.at + k * w, p.at + (k + 1) * w).trim())
  }
  const multi = (key: string) => [...strs(key), ...strs(key + '2'), ...strs(key + '3'), ...strs(key + '4')]
  const used = num('POINT:USED')
  const labels = multi('POINT:LABELS').slice(0, used)
  if (num('POINT:SCALE') >= 0) throw new Error('整数の C3D は読めません')
  const rate = num('POINT:RATE')
  const start = num('POINT:DATA_START')
  const analogUsed = num('ANALOG:USED')
  const analogRate = num('ANALOG:RATE', rate)
  const per = Math.round(analogRate / rate)
  const aLabels = multi('ANALOG:LABELS').slice(0, analogUsed)
  const aScale = nums('ANALOG:SCALE')
  const aOffset = nums('ANALOG:OFFSET')
  const gen = num('ANALOG:GEN_SCALE', 1)
  const frames = last - first + 1
  const pIdx = new Map<number, string>()
  for (const w of wantPoints) {
    const k = labels.indexOf(w)
    if (k >= 0) pIdx.set(k, w)
  }
  const aIdx = new Map<number, string>()
  for (const w of wantAnalog) {
    const k = aLabels.indexOf(w)
    if (k >= 0) aIdx.set(k, w)
  }
  const pts = new Map<string, V3[]>([...pIdx.values()].map((w) => [w, [] as V3[]]))
  const ana = new Map<string, Float32Array>([...aIdx.values()].map((w) => [w, new Float32Array(frames * per)]))
  let at = (start - 1) * 512
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < used; k++) {
      const w = pIdx.get(k)
      if (w) {
        const res = b.readFloatLE(at + 12)
        pts.get(w)!.push(res < 0 ? [NaN, NaN, NaN] : [b.readFloatLE(at), b.readFloatLE(at + 4), b.readFloatLE(at + 8)])
      }
      at += 16
    }
    for (let s = 0; s < per; s++) {
      for (let k = 0; k < analogUsed; k++) {
        const w = aIdx.get(k)
        if (w) ana.get(w)![f * per + s] = (b.readFloatLE(at) - (aOffset[k] ?? 0)) * (aScale[k] ?? 1) * gen
        at += 4
      }
    }
  }
  const ctx = multi('EVENT:CONTEXTS')
  const lab = multi('EVENT:LABELS')
  const tm = [...nums('EVENT:TIMES'), ...nums('EVENT:TIMES2'), ...nums('EVENT:TIMES3')]
  const nev = num('EVENT:USED')
  const events = Array.from({ length: Math.min(nev, ctx.length, lab.length, tm.length / 2) }, (_, k) => ({ context: ctx[k], label: lab[k], time: tm[2 * k] * 60 + tm[2 * k + 1] - (first - 1) / rate }))
  return { rate, frames, labels, point: (l) => pts.get(l) ?? null, analogRate, analog: (l) => ana.get(l) ?? null, events }
}

// ---- 研究データ1本（着地を見るためのもの） ----

export type Side = 'R' | 'L'
export interface Contact {
  side: Side
  on: number // 秒
  off: number
}
export interface LandingTrial extends Source {
  subject: string
  cond: string // 速さ・条件（rbds: 25/35/45、riglet: 楽/速い、vh: 333/lowfreq/highfreq/trunklean）
  dataset: 'rbds' | 'riglet' | 'vh'
  contacts: Contact[]
  forceRate: number
  fz: Float32Array // 上下の力（N、上向きが正）
  fap: Float32Array // 前後の力（N）。体を後ろへ押す向きが負になるように、接地の前半の平均で向きをそろえた
  bw: number // 体重（N）。走っている間の上下の力の平均
  com?: V3[] // 重心（Riglet）
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const mid = (a: V3, b: V3): V3 => sc(add(a, b), 0.5)
const norm = (a: V3): V3 => sc(a, 1 / Math.hypot(...a))
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const okV = (p: V3 | undefined) => !!p && p.every(Number.isFinite)

// 床の高さを0にする（かかと・つま先の低いほうから2%）
function ground(joints: Source['joints']) {
  const ys = [...joints.heelR!, ...joints.heelL!, ...joints.toeR!, ...joints.toeL!].map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b)
  const g = ys[Math.floor(ys.length * 0.02)]
  for (const k of Object.keys(joints) as (keyof Source['joints'])[]) joints[k] = joints[k]!.map((p) => [p[0], p[1] - g, p[2]] as V3)
  return g
}

// 上下の力が 50N を超えた区間を接地とし、そのときに低いほうの足を、その接地の足とする。
// 前後の力は、前後の2つの向き（ap1・ap2）のうち接地中に大きく振れるほうを選び、接地の前半（最初の3割）の平均が負になる向きにそろえる
function contactsOf(fz: Float32Array, apA: Float32Array, apB: Float32Array | null, rate: number, joints: Source['joints'], fps: number) {
  const cs: { on: number; off: number }[] = []
  let s = -1
  for (let j = 0; j < fz.length; j++) {
    if (fz[j] > 50 && s < 0) s = j
    if (fz[j] <= 50 && s >= 0) {
      if ((j - s) / rate > 0.08 && s > 0) cs.push({ on: s / rate, off: j / rate })
      s = -1
    }
  }
  const lowAt = (t: number, side: Side) => {
    const i = Math.min(joints.heelR!.length - 1, Math.max(0, Math.round(t * fps)))
    const h = side === 'R' ? joints.heelR![i] : joints.heelL![i]
    const to = side === 'R' ? joints.toeR![i] : joints.toeL![i]
    return Math.min(h[1], to[1])
  }
  const contacts: Contact[] = cs
    .filter((c) => Math.round(c.off * fps) < joints.heelR!.length)
    .map((c) => {
      const t = c.on + 0.02
      return { side: lowAt(t, 'R') <= lowAt(t, 'L') ? 'R' : 'L', on: c.on, off: c.off }
    })
  // 前後の力：接地中の振れ（二乗平均）が大きいほう
  const rms = (a: Float32Array) => {
    let ss = 0
    let n = 0
    for (const c of contacts) for (let j = Math.round(c.on * rate); j < Math.round(c.off * rate); j++) (ss += a[j] * a[j]), n++
    return n ? Math.sqrt(ss / n) : 0
  }
  let ap = apA
  if (apB && rms(apB) > rms(apA)) ap = apB
  let early = 0
  for (const c of contacts) {
    const j0 = Math.round(c.on * rate)
    const j1 = Math.round((c.on + 0.3 * (c.off - c.on)) * rate)
    for (let j = j0; j < j1; j++) early += ap[j]
  }
  const fap = early > 0 ? ap.map((x) => -x) : ap.slice()
  // 体重：最初と最後の接地の間の、上下の力の平均（一定の速さで走っていれば体重に等しい）
  let bw = 0
  if (contacts.length >= 2) {
    const j0 = Math.round(contacts[0].on * rate)
    const j1 = Math.round(contacts[contacts.length - 1].on * rate)
    let ssum = 0
    for (let j = j0; j < j1; j++) ssum += fz[j]
    bw = ssum / Math.max(1, j1 - j0)
  }
  return { contacts, fap, bw }
}

// 上下の力の向き：接地中に大きいほうを正にする（力の板によって下向きが正のことがある）
function upward(fz: Float32Array) {
  const s = [...fz].sort((a, b) => Math.abs(b) - Math.abs(a))
  const top = s.slice(0, Math.max(1, Math.floor(s.length * 0.05)))
  const m = top.reduce((a, x) => a + x, 0)
  return m < 0 ? fz.map((x) => -x) : fz
}
const sum2 = (a: Float32Array | null, b: Float32Array | null) => {
  if (!a) throw new Error('床反力がありません')
  if (!b) return a
  return a.map((x, i) => x + b[i])
}

// RBDS：秒速 2.5・3.5・4.5m。床反力は1枚（X が前後、Y が上下）
export function loadRbdsLanding(dir: string, id: string, speed: string): LandingTrial {
  const tr = loadTrial(dir, id, speed)
  const joints = tr.joints as Source['joints']
  ground(joints)
  const f = table(join(dir, `${id}runT${speed}forces.txt`))
  const col = (n: string) => Float32Array.from(f.rows.map((r) => r[f.col(n)]))
  const fz = upward(col('Fy'))
  const { contacts, fap, bw } = contactsOf(fz, col('Fx'), col('Fz'), 300, joints, tr.fps)
  return { id: `${id}-${speed}`, subject: id, cond: speed, dataset: 'rbds', fps: tr.fps, frames: joints.hipR!.length, joints, contacts, forceRate: 300, fz, fap, bw }
}

// Riglet：関節の中心（HJC・KJC・AJC・SJC）、かかと・つま先、頭の印、重心。sim/riglet.ts と同じ作り方に、重心と接地のイベントを足したもの
const RIG = ['RHJC', 'LHJC', 'RKJC', 'LKJC', 'RAJC', 'LAJC', 'RHEE', 'LHEE', 'RTOE', 'LTOE', 'RSJC', 'LSJC', 'RMAS', 'LMAS', 'RFHD', 'LFHD', 'RBHD', 'LBHD', 'GLAB', 'RASI', 'LASI', 'RPSI', 'LPSI', 'CentreOfMass']
const FORCES = ['Force.Fx1', 'Force.Fy1', 'Force.Fz1', 'Force.Fx2', 'Force.Fy2', 'Force.Fz2']
export function loadRigletLanding(path: string, subject: string, cond: string): LandingTrial {
  const c = readC3DFull(path, RIG, [])
  const M = Object.fromEntries(RIG.map((n) => [n, c.point(n)]))
  for (const n of RIG) if (!M[n]) throw new Error(`${subject}: ${n} がありません`)
  const ok = (f: number) => RIG.every((n) => M[n]![f].every(Number.isFinite))
  let best = [0, 0]
  for (let f = 0, s = -1; f <= c.frames; f++) {
    if (f < c.frames && ok(f)) {
      if (s < 0) s = f
    } else if (s >= 0) {
      if (f - s > best[1] - best[0]) best = [s, f]
      s = -1
    }
  }
  const [from, to] = best
  if (to - from < 200) throw new Error(`${subject}: 使えるコマが足りません`)
  let fx = 0
  let fy = 0
  for (let f = from; f < to; f++) {
    const d = sub(mid(M.RASI![f], M.LASI![f]), mid(M.RPSI![f], M.LPSI![f]))
    fx += d[0]
    fy += d[1]
  }
  const h = Math.hypot(fx, fy)
  const [cx, cy] = [fx / h, fy / h]
  const conv = (p: V3): V3 => [p[0] * cx + p[1] * cy, p[2], p[0] * cy - p[1] * cx]
  const J: Record<string, V3[]> = {}
  const push = (k: string, p: V3) => (J[k] ??= []).push(p)
  for (let f = from; f < to; f++) {
    const g = (n: string) => conv(M[n]![f])
    const front = mid(g('RFHD'), g('LFHD'))
    const back = mid(g('RBHD'), g('LBHD'))
    const fwd = sub(front, back)
    const fwdH: V3 = [fwd[0], 0, fwd[2]]
    const headFwd = sc(fwdH, 1 / Math.hypot(...fwdH))
    push('hipR', g('RHJC'))
    push('hipL', g('LHJC'))
    push('kneeR', g('RKJC'))
    push('kneeL', g('LKJC'))
    push('ankleR', g('RAJC'))
    push('ankleL', g('LAJC'))
    push('heelR', g('RHEE'))
    push('heelL', g('LHEE'))
    push('toeR', g('RTOE'))
    push('toeL', g('LTOE'))
    push('pelvis', mid(g('RHJC'), g('LHJC')))
    push('shR', g('RSJC'))
    push('shL', g('LSJC'))
    push('earR', add(g('RMAS'), sc(headFwd, 20)))
    push('earL', add(g('LMAS'), sc(headFwd, 20)))
    push('nose', g('GLAB'))
    push('com', g('CentreOfMass'))
  }
  const { com, ...rest } = J
  const joints = rest as Source['joints']
  const gnd = ground(joints)
  const comG = com.map((p) => [p[0], p[1] - gnd, p[2]] as V3)
  // 床反力：この記録のトレッドミルの力の板の値は、すべて0（記録されていない）。接地は記録の中のイベント（Foot Strike・Foot Off）を使う。
  // ブレーキは出せない
  const t0 = from / c.rate
  const t1 = to / c.rate
  const ev = c.events.filter((e) => e.time >= t0 && e.time < t1).sort((a, b) => a.time - b.time)
  const contacts: Contact[] = []
  for (const e of ev) {
    if (e.label !== 'Foot Strike') continue
    const side: Side = e.context === 'Right' ? 'R' : 'L'
    const off = ev.find((x) => x.label === 'Foot Off' && x.context === e.context && x.time > e.time)
    if (!off || off.time - e.time > 0.6) continue
    contacts.push({ side, on: e.time - t0, off: off.time - t0 })
  }
  const empty = new Float32Array(0)
  return { id: `${subject}-${cond}`, subject, cond, dataset: 'riglet', fps: c.rate, frames: to - from, joints, contacts, forceRate: c.analogRate, fz: empty, fap: empty, bw: 0, com: comG }
}

// Van Hooren：骨盤・脚・C7・胸骨の印。sim/vanhooren.ts と同じ作り方（股関節の中心は Bell の方法）。欠けたコマは前のコマで埋め、床反力とコマをそろえたままにする
const VHM = ['RASIS', 'LASIS', 'RPSIS', 'LPSIS', 'RLEK', 'LLEK', 'RLM', 'LLM', 'RHEE', 'LHEE', 'RMT2', 'LMT2', 'C7', 'JN']
export function loadVhLanding(path: string, subject: string, cond: string): LandingTrial {
  const c = readC3DFull(path, VHM, FORCES)
  const raw = (n: string): V3[] => {
    const p = c.point(n)
    if (!p) throw new Error(`${subject}: ${n} がありません`)
    return p.map(([x, y, z]) => [-y, z, -x])
  }
  const M = Object.fromEntries(VHM.map((n) => [n, raw(n)]))
  const J: Record<string, V3[]> = {}
  let last: Record<string, V3> | null = null
  let firstOk = -1
  for (let f = 0; f < c.frames; f++) {
    const g = (n: string) => M[n][f]
    if (VHM.some((n) => !okV(g(n)))) {
      if (last) for (const k of Object.keys(last)) J[k].push(last[k])
      continue
    }
    if (firstOk < 0) firstOk = f
    const asis = mid(g('RASIS'), g('LASIS'))
    const psis = mid(g('RPSIS'), g('LPSIS'))
    const right = norm(sub(g('RASIS'), g('LASIS')))
    let fwd = sub(asis, psis)
    fwd = norm(sub(fwd, sc(right, dot(fwd, right))))
    const up = cross(right, fwd)
    const pw = Math.hypot(...sub(g('RASIS'), g('LASIS')))
    const hjc = (s: 1 | -1) => add(add(add(asis, sc(fwd, -0.19 * pw)), sc(up, -0.3 * pw)), sc(right, 0.36 * pw * s))
    const neck = mid(g('C7'), g('JN'))
    const pelvis = mid(hjc(1), hjc(-1))
    const trunkUp = norm(sub(neck, pelvis))
    const shC = add(neck, [0, -30, 0])
    const ear = add(neck, sc(trunkUp, 170))
    const row: Record<string, V3> = {
      hipR: hjc(1),
      hipL: hjc(-1),
      kneeR: g('RLEK'),
      kneeL: g('LLEK'),
      ankleR: g('RLM'),
      ankleL: g('LLM'),
      heelR: g('RHEE'),
      heelL: g('LHEE'),
      toeR: g('RMT2'),
      toeL: g('LMT2'),
      pelvis,
      shR: add(shC, sc(right, 170)),
      shL: add(shC, sc(right, -170)),
      ear,
      nose: add(ear, sc(fwd, 100)),
    }
    for (const k of Object.keys(row)) (J[k] ??= []).push(row[k])
    last = row
  }
  if (firstOk < 0) throw new Error(`${subject}: 使えるコマがありません`)
  const joints = J as Source['joints']
  ground(joints)
  const per = Math.round(c.analogRate / c.rate)
  const cut = (a: Float32Array) => a.slice(firstOk * per, c.frames * per)
  const fz = upward(cut(sum2(c.analog('Force.Fz1'), c.analog('Force.Fz2'))))
  // 前後は −Y が前（点と同じ向き）。左右の X と比べて、接地中に大きく振れるほうを使う
  const apA = cut(sum2(c.analog('Force.Fy1'), c.analog('Force.Fy2')))
  const apB = cut(sum2(c.analog('Force.Fx1'), c.analog('Force.Fx2')))
  const { contacts, fap, bw } = contactsOf(fz, apA, apB, c.analogRate, joints, c.rate)
  return { id: `VH-${subject}-${cond}`, subject, cond, dataset: 'vh', fps: c.rate, frames: joints.hipR!.length, joints, contacts, forceRate: c.analogRate, fz, fap, bw }
}

// ---- 本当の値 ----

export interface ContactTruth {
  side: Side
  t: number
  heel: number // かかと − 腰（左右の股関節の真ん中）の前後の距離 ÷ 脚の長さ
  ankle: number
  heelCom: number // かかと − 重心（Riglet だけ。ほかは NaN）
  shank: number // 度。足首が膝より前で正
  knee: number // 膝の曲がり（度、まっすぐで0）
  kneeGap: number // 着地する脚の膝 − もう一方の膝（前後、÷ 脚の長さ）
  legAng: number // 腰（左右の股関節の真ん中）→足首の線と鉛直の角度（度。足首が前で正）
  reach: number // 着地の前の 0.25 秒で、足首が腰より一番前に出た量（÷ 脚の長さ）
  brakePeak: number // ブレーキの力の山（体重の倍）
  brakeImp: number // ブレーキの力積（体重 × 秒）
  stance: number // 接地時間（秒）
}

export function legLengthOf(t: Source) {
  const j = t.joints
  const d = (a: V3, b: V3) => Math.hypot(...sub(a, b))
  const xs = j.hipR!.map((h, i) => d(h, j.kneeR![i]) + d(j.kneeR![i], j.ankleR![i])).filter(Number.isFinite)
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
export function jointAt(ps: V3[], fps: number, t: number): V3 {
  const x = t * fps
  const i = Math.min(ps.length - 2, Math.max(0, Math.floor(x)))
  return lerp3(ps[i], ps[i + 1], Math.min(1, Math.max(0, x - i)))
}
const DEG = 180 / Math.PI

export function truthOfContacts(tr: LandingTrial): ContactTruth[] {
  const leg = legLengthOf(tr)
  const j = tr.joints
  const out: ContactTruth[] = []
  for (const c of tr.contacts) {
    const s = c.side
    const at = (k: keyof Source['joints'], t = c.on) => jointAt(j[k]!, tr.fps, t)
    const hipC = mid(at('hipR'), at('hipL'))
    const heel = at(s === 'R' ? 'heelR' : 'heelL')
    const ankle = at(s === 'R' ? 'ankleR' : 'ankleL')
    const knee = at(s === 'R' ? 'kneeR' : 'kneeL')
    const kneeO = at(s === 'R' ? 'kneeL' : 'kneeR')
    const hip = at(s === 'R' ? 'hipR' : 'hipL')
    const th = [hip[0] - knee[0], hip[1] - knee[1]]
    const sh = [ankle[0] - knee[0], ankle[1] - knee[1]]
    const inner = (Math.acos((th[0] * sh[0] + th[1] * sh[1]) / (Math.hypot(th[0], th[1]) * Math.hypot(sh[0], sh[1]))) * DEG)
    let reach = -Infinity
    for (let t = c.on - 0.25; t <= c.on; t += 1 / tr.fps) {
      const a = jointAt(j[s === 'R' ? 'ankleR' : 'ankleL']!, tr.fps, t)
      const hc = mid(jointAt(j.hipR!, tr.fps, t), jointAt(j.hipL!, tr.fps, t))
      reach = Math.max(reach, (a[0] - hc[0]) / leg)
    }
    // ブレーキ：接地中の前後の力の負の側
    let peak = 0
    let imp = 0
    for (let k = Math.round(c.on * tr.forceRate); k < Math.round(c.off * tr.forceRate); k++) {
      const f = tr.fap[k]
      if (f < 0) {
        peak = Math.max(peak, -f)
        imp += -f / tr.forceRate
      }
    }
    out.push({
      side: s,
      t: c.on,
      heel: (heel[0] - hipC[0]) / leg,
      ankle: (ankle[0] - hipC[0]) / leg,
      heelCom: tr.com ? (heel[0] - jointAt(tr.com, tr.fps, c.on)[0]) / leg : NaN,
      shank: Math.atan2(ankle[0] - knee[0], knee[1] - ankle[1]) * DEG,
      knee: 180 - inner,
      kneeGap: (knee[0] - kneeO[0]) / leg,
      legAng: Math.atan2(ankle[0] - hipC[0], hipC[1] - ankle[1]) * DEG,
      reach,
      brakePeak: tr.bw ? peak / tr.bw : NaN,
      brakeImp: tr.bw ? imp / tr.bw : NaN,
      stance: c.off - c.on,
    })
  }
  return out
}
