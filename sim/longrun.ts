// 仮想実験の材料：研究データの短い走り（30秒〜2分）から、長い走り（10分以上）を作り、崩しを足す
//   長い走り：1歩き（右足が一番前に出てから次に出るまで）ごとに切り、続いた8歩き（約6秒）をひとかたまりにして、
//   かたまりを乱数で並べ直す（ブロック・ブートストラップ）。つなぎ目の位置のずれは、その1歩きの間に0へ戻す。
//   数分かけてゆっくり変わる揺れ（疲れなど）は、元の記録が短いので入らない
//   崩し：3次元の点を、前後と上下の面で動かして作る（データに、その崩しの条件はない）
import type { Body } from './camera'
import type { V3 } from './rbds'
import { rng } from './camera'

export type BodyKey = keyof Body
export interface Source {
  id: string
  fps: number
  frames: number
  joints: Partial<Record<BodyKey, V3[]>>
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const lerp = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

const keysOf = (s: Source) => Object.keys(s.joints) as BodyKey[]

// 右足が一番前に出たコマ（腰から見た足首の前後の位置の山）。前は +X
export function strides(s: Source): number[] {
  const a = s.joints.ankleR!.map((p, i) => p[0] - s.joints.pelvis![i][0])
  const half = Math.round(0.25 * s.fps)
  const m = mean(a)
  const out: number[] = []
  for (let i = half; i < a.length - half; i++) {
    if (a[i] <= m) continue
    let top = true
    for (let k = i - half; k <= i + half && top; k++) if (a[k] > a[i]) top = false
    if (top && (!out.length || i - out[out.length - 1] > 0.45 * s.fps)) out.push(i)
  }
  return out
}

// 1歩き（st[k]〜st[k+1]）ごとに、走っているか：長さが 0.45〜1.4 秒で、足首の前後の振れがその記録の大きいほう（上から1割）の半分以上。
// 記録の始めのベルトに乗る前・速さが上がるまでの間や、記録の終わりの値が0のままのところを、走りとして並べ直さないため
// （Van Hooren のデータには、始めの十数秒の立っている間と、終わりの値のない間がある）
export function runningStrides(s: Source, st: number[]): boolean[] {
  const a = s.joints.ankleR!.map((p, i) => p[0] - s.joints.pelvis![i][0])
  const swing = st.slice(0, -1).map((f, k) => {
    const xs = a.slice(f, st[k + 1])
    return Math.max(...xs) - Math.min(...xs)
  })
  const big = [...swing].sort((x, y) => x - y)[Math.floor(swing.length * 0.9)] ?? 0
  return swing.map((w, k) => {
    const sec = (st[k + 1] - st[k]) / s.fps
    return sec >= 0.45 && sec <= 1.4 && w >= big * 0.5
  })
}

// 長い走りのひとこま分：どの記録の、どのコマから何コマか、つなぎ目のずれ（この区間の中で0へ戻す）
interface Piece {
  src: Source
  f0: number
  n: number
  t0: number // 長い走りの中の始まり（秒）
  d: Partial<Record<BodyKey, V3>>
}

export class LongRun {
  pieces: Piece[] = []
  get duration() {
    const p = this.pieces[this.pieces.length - 1]
    return p ? p.t0 + p.n / p.src.fps : 0
  }

  // sec 秒ぶん、src のかたまりを乱数で並べて足す。かたまりは、走っている1歩きだけが続いたところから選ぶ
  append(src: Source, sec: number, seed: number, block = 8) {
    const st = strides(src)
    const ok = runningStrides(src, st)
    const starts = st.slice(0, -block).flatMap((_, b) => (ok.slice(b, b + block).every(Boolean) ? [b] : []))
    if (!starts.length) throw new Error(`${src.id}: 走っている歩きが足りません（${ok.filter(Boolean).length}）`)
    const r = rng(seed)
    const end = this.duration + sec
    while (this.duration < end) {
      const b = starts[Math.floor(r.u() * starts.length)]
      for (let k = b; k < b + block && this.duration < end; k++) this.push(src, st[k], st[k + 1] - st[k])
    }
  }

  private push(src: Source, f0: number, n: number) {
    const last = this.pieces[this.pieces.length - 1]
    const d: Piece['d'] = {}
    if (last) {
      // 前の区間がそのまま続いたときの位置（次のコマ）と、この区間の最初の位置の差
      const nextF = Math.min(last.src.frames - 1, last.f0 + last.n)
      for (const k of keysOf(src)) {
        const prev = last.src.joints[k]
        if (!prev) continue
        d[k] = sub(prev[nextF], src.joints[k]![f0])
      }
      // 同じ記録の続きのコマなら、ずれはない
      if (last.src === src && nextF === f0) for (const k of Object.keys(d) as BodyKey[]) d[k] = [0, 0, 0]
    }
    this.pieces.push({ src, f0, n, t0: this.duration, d })
  }

  at(t: number): Body {
    const ps = this.pieces
    let lo = 0
    let hi = ps.length - 1
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (ps[m].t0 <= t) lo = m
      else hi = m - 1
    }
    const p = ps[lo]
    const x = Math.min(p.n, Math.max(0, (t - p.t0) * p.src.fps))
    const i = Math.min(p.src.frames - 2, p.f0 + Math.floor(x))
    const u = p.f0 + x - i
    const fade = 1 - x / p.n
    const out: Partial<Body> = {}
    for (const k of keysOf(p.src)) {
      const js = p.src.joints[k]!
      let v = lerp(js[i], js[Math.min(js.length - 1, i + 1)], u)
      const d = p.d[k]
      if (d) v = add(v, sc(d, fade))
      out[k] = v
    }
    return out as Body
  }
}

// ---- 崩し（前後 = X、上下 = Y の面で動かす。amount は度、腰だけ脚の長さに対する%）----

// 点 p を、o を中心に前へ deg 度回す（上にある点ほど前に出る）
function tilt(p: V3, o: V3, deg: number): V3 {
  const r = (deg * Math.PI) / 180
  const x = p[0] - o[0]
  const y = p[1] - o[1]
  return [o[0] + x * Math.cos(r) + y * Math.sin(r), o[1] - x * Math.sin(r) + y * Math.cos(r), p[2]]
}
const headKeys: BodyKey[] = ['ear', 'earR', 'earL', 'nose']
const upperKeys: BodyKey[] = ['shR', 'shL', ...headKeys]
function tiltKeys(b: Body, keys: BodyKey[], o: V3, deg: number): Body {
  const out = { ...b }
  for (const k of keys) if (b[k]) (out[k] as V3) = tilt(b[k] as V3, o, deg)
  return out
}
const shoulderMid = (b: Body): V3 => (b.shR && b.shL ? lerp(b.shR, b.shL, 0.5) : [b.pelvis[0], b.pelvis[1] + 500, b.pelvis[2]])

export type DistortKind = 'head' | 'hunch' | 'trunk' | 'body' | 'sit'

export const DISTORT_LABEL: Record<DistortKind, string> = {
  head: '頭を前に（首の付け根で回す）',
  hunch: '猫背（背中の真ん中から上を前に丸める）',
  trunk: '上体を前に倒す（股関節から）',
  body: '体全体を前に傾ける（足首から）',
  sit: '腰を落とす（膝を曲げて沈む）',
}

// legMm：脚の長さ（腰→膝→足首、mm）。sit で使う
export function distort(b: Body, kind: DistortKind, amount: number, legMm: number, groundY: number): Body {
  if (!amount) return b
  if (kind === 'head') {
    const sh = shoulderMid(b)
    return tiltKeys(b, headKeys, [sh[0], sh[1] + 50, sh[2]], amount)
  }
  if (kind === 'trunk') return tiltKeys(b, upperKeys, b.pelvis, amount)
  if (kind === 'hunch') return tiltKeys(b, upperKeys, lerp(b.pelvis, shoulderMid(b), 0.5), amount)
  if (kind === 'body') {
    // 足首から上を、床からの高さに比例して前へずらす（足は床に残る）
    const k = Math.tan((amount * Math.PI) / 180)
    const out = { ...b }
    for (const key of Object.keys(b) as BodyKey[]) {
      const p = b[key] as V3 | undefined
      if (p) (out[key] as V3) = [p[0] + (p[1] - groundY) * k, p[1], p[2]]
    }
    return out
  }
  // sit：腰から上を下げ、膝は太ももとすねの長さを保ったまま前に曲げる（足首から下はそのまま）
  const dy = (amount / 100) * legMm
  const out = { ...b }
  for (const key of ['hipR', 'hipL', 'pelvis', ...upperKeys] as BodyKey[]) {
    const p = b[key] as V3 | undefined
    if (p) (out[key] as V3) = [p[0], p[1] - dy, p[2]]
  }
  for (const s of ['R', 'L'] as const) {
    const hip = b[`hip${s}`]
    const knee = b[`knee${s}`]
    const ank = b[`ankle${s}`]
    // 前後と上下の面での長さ（左右のずれの分を除く。膝の左右の位置は変えないので、3次元の長さが保たれる）
    const t = Math.hypot(knee[0] - hip[0], knee[1] - hip[1])
    const sh = Math.hypot(ank[0] - knee[0], ank[1] - knee[1])
    const h2 = out[`hip${s}`]
    // 前後と上下の面で、腰と足首から膝を決める（左右の位置は元の膝のまま）
    const dx = ank[0] - h2[0]
    const dyy = ank[1] - h2[1]
    const L = Math.min(t + sh - 1, Math.hypot(dx, dyy))
    const a = (t * t - sh * sh + L * L) / (2 * L)
    const h = Math.sqrt(Math.max(0, t * t - a * a))
    const ux = dx / L
    const uy = dyy / L
    // 2つの解のうち、膝が前（+X）にあるほう
    const c1: V3 = [h2[0] + a * ux - h * uy, h2[1] + a * uy + h * ux, knee[2]]
    const c2: V3 = [h2[0] + a * ux + h * uy, h2[1] + a * uy - h * ux, knee[2]]
    out[`knee${s}`] = c1[0] >= c2[0] ? c1 : c2
  }
  return out
}

// ---- 本当の値（前後と上下の面で、アプリと同じ定義）----
const lean = (lo: V3, hi: V3) => (Math.atan2(hi[0] - lo[0], hi[1] - lo[1]) * 180) / Math.PI
export function truthOf(b: Body) {
  const sh = shoulderMid(b)
  const shR = b.shR ?? sh
  const earR = b.earR ?? b.ear ?? [sh[0] + 20, sh[1] + 230, sh[2]]
  const ank = lerp(b.ankleR, b.ankleL, 0.5)
  const stance = b.ankleR[1] <= b.ankleL[1] ? b.ankleR : b.ankleL
  const hipC = lerp(b.hipR, b.hipL, 0.5)
  return {
    neck: lean(shR, earR) - lean(b.hipR, shR),
    trunk: lean(b.pelvis, sh),
    body: lean(ank, sh),
    hip: hipC[1] - stance[1],
  }
}

export function legLengthMm(s: Source) {
  const j = s.joints
  const d = (a: V3, b: V3) => Math.hypot(...sub(a, b))
  return mean(j.hipR!.map((h, i) => d(h, j.kneeR![i]) + d(j.kneeR![i], j.ankleR![i])))
}

export function groundOf(s: Source) {
  const ys = [...s.joints.heelR!, ...s.joints.heelL!, ...s.joints.toeR!, ...s.joints.toeL!].map((p) => p[1]).sort((a, b) => a - b)
  return ys[Math.floor(ys.length * 0.02)]
}
