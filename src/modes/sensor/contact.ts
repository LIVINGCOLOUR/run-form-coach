import { CONTACT, STEP, type ContactParams, type StepParams } from './params'
import type { Vec3 } from './parse'

// 足首のセンサーで、1歩ごとの接地（着地 → 離地）を見つけ、接地時間・接地の割合（duty factor）・左右差を出す（数字は params.ts の STEP・CONTACT）。
// BLE も画面も持たないので、テストと仮想実験で値を流して確かめられる。時刻はセンサーの時計（ms → 秒）で数える（届いた時刻は Bluetooth の遅れでぶれるため）
//
// 見つけ方：すね（足首）のジャイロの、前後の面の回転の速さ（ω）を使う。
//   ・振り出し（スイング）で、すねは大きく前へ回る（ωの大きな山。走りでは 400〜800 dps）。
//     着地は、その山のあと ω が 0 を切ってから少しあと（Aminian 2002 などの、すねのジャイロの「山のあとの0・谷」で着地を見るやり方の一つ。
//     走りで力の板と比べた手法の一覧は Kiernan ら 2023 Sensors）。
//   ・接地の間、すねは後ろへ回り（ω が負）、離地のあとも後ろへ回り続けてから、次の振り出しで ω が 0 を上へ切る。
//     離地は、その 0 を上へ切る前の谷（立脚の終わりの、いちばん速く後ろへ回るところ）より少し前。
//   ずらす量（着地 +26ms、離地 −90ms）は、RBDS（Fukuchi 2017、トレッドミル 秒速2.5・3.5・4.5m、床反力つき。読めた22人）の
//   印から作ったすねの角速度を、床反力の接地と比べて決めた（sim/contact.sim.ts）。
// 向き：センサーの付け方は決めていないので、走り出してからのジャイロの主成分（いちばん大きく振れる軸）を前後の面の回転の軸とする。
//   符号は「振り出しの山が正」：正の側が短く（振り出しの間だけ）、高い。2つの見方が合わなければ、決めずに次の窓で取り直す
// 速さ：1歩き（同じ足の着地から次の着地まで）の、すねの前後の振れ幅（ω を積分した角度の幅）÷ 1歩きの時間 から見積もる（RBDS で r 0.91）。
//   接地の割合は速さで変わる（遅いほど長い）ので、線を速さで替えるのに使う。オーバーストライドの「同じ速さ」の見分けにも使う

export interface Step {
  ic: number // 着地（センサーの時計、秒）
  to: number // 離地
  ct: number // 接地時間（秒）
  stride: number // この着地から、同じ足の次の着地まで（秒）
  df: number // 接地の割合 = 接地時間 ÷ 1歩きの時間（duty factor）
  rom: number // 1歩きの、すねの前後の振れ幅（度）
  v: number // 速さの見積もり（km/h）
  impact: number // 着地の前後の加速度の大きさのいちばん大きい値（g）
  peak: number // 振り出しの山（dps）
}

interface Smp {
  t: number
  g: Vec3
  am: number // 加速度の大きさ（g）
  s: number // 前後の面の回転の速さ（dps、振り出しが正）。軸が決まる前は NaN
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// 3×3 の共分散のいちばん大きい固有ベクトル（べき乗法）
export function principalAxis(gs: Vec3[]): Vec3 | null {
  if (gs.length < 10) return null
  const m: Vec3 = [0, 0, 0]
  for (const g of gs) for (let i = 0; i < 3; i++) m[i] += g[i] / gs.length
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const g of gs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += (g[i] - m[i]) * (g[j] - m[j])
  let v: Vec3 = [0.57, 0.58, 0.59]
  for (let k = 0; k < 60; k++) {
    const n: Vec3 = [0, 1, 2].map((i) => C[i * 3] * v[0] + C[i * 3 + 1] * v[1] + C[i * 3 + 2] * v[2]) as Vec3
    const l = Math.hypot(...n)
    if (!(l > 1e-9)) return null
    v = [n[0] / l, n[1] / l, n[2] / l]
  }
  return v
}

// 軸の符号：振り出し（正）の側は、時間が短い（1歩きの約3分の1。RBDS で 0 を上へ切ってから下へ切るまで、1歩きの 33% ほど）。
// 正と負の時間がほぼ同じ（差が timeGap 未満）ときだけ、山の高さ（振り出しの山が高い）で決める。どちらでも決まらなければ null（決めない）
export function swingSign(s: number[], timeGap = 0.05, peakRatio = 1.2): 1 | -1 | null {
  if (!s.length) return null
  let pos = 0
  let mx = -Infinity
  let mn = Infinity
  for (const v of s) {
    if (v > 0) pos++
    mx = Math.max(mx, v)
    mn = Math.min(mn, v)
  }
  const f = pos / s.length
  if (Math.abs(f - 0.5) >= timeGap) return f < 0.5 ? 1 : -1
  if (mx >= -mn * peakRatio) return 1
  if (-mn >= mx * peakRatio) return -1
  return null
}

// 1つの足首。sample で値を渡し、steps で新しく決まった1歩を受け取る
export class StepDetector {
  axis: Vec3 | null = null // 前後の面の回転の軸（振り出しが正になる向き）
  running = false // 走っているか（カメラ版はカメラの「走っている」）。軸を決めるのは走っている間だけ
  private buf: Smp[] = []
  private learn: { t: number; g: Vec3; a: Vec3 }[] = []
  private learnFrom: number | null = null // 軸を決めるためにためはじめた時刻
  private lastPeak = -Infinity // 最後に見た振り出しの山の時刻
  private decided = -Infinity // ここまでの時刻は、山かどうかを決めた
  private prev: { ic: number; peak: number } | null = null // 前の振り出しから決めた着地
  private out: Step[] = []
  readonly p: StepParams

  constructor(p: StepParams = STEP) {
    this.p = p
  }

  // t：センサーの時計（秒）。g：ジャイロ（dps）、a：加速度（g）
  sample(t: number, g: Vec3, a: Vec3) {
    const last = this.buf[this.buf.length - 1]
    if (last && t <= last.t) {
      // 時計が戻った（センサーが起き直した）：最初からやり直す
      if (t < last.t - 1) this.reset()
      else return
    }
    const s = this.axis ? dot(g, this.axis) : NaN
    this.buf.push({ t, g, am: Math.hypot(a[0], a[1], a[2]), s })
    while (this.buf.length && t - this.buf[0].t > this.p.keep) this.buf.shift()
    if (!this.axis && this.running) {
      this.learnFrom ??= t
      this.learn.push({ t, g, a })
      if (t - this.learnFrom >= this.p.axisLearn) this.learnAxis()
    }
    if (this.axis) this.scan()
  }

  private reset() {
    this.buf = []
    this.lastPeak = -Infinity
    this.decided = -Infinity
    this.prev = null
  }

  // 走っている間のジャイロから、軸と符号を決める。振れが小さい（走っていない）・符号が決まらなければ、ためた値を捨てて取り直す
  private learnAxis() {
    const xs = this.learn
    this.learn = []
    this.learnFrom = null
    const ax = principalAxis(xs.map((x) => x.g))
    if (!ax) return
    const s = xs.map((x) => dot(x.g, ax))
    if (Math.max(...s.map(Math.abs)) < this.p.peakMin) return
    // 符号：両方の向きで、ためた値から1歩を見つけてみて、もっともらしい1歩（接地の割合などが範囲の中）が多いほうにする。
    // 差がつかなければ、形（振り出しの側は短く高い。swingSign）で決める。それでも決まらなければ取り直す
    const count = (sign: 1 | -1) => {
      const d = new StepDetector(this.p)
      d.axis = [ax[0] * sign, ax[1] * sign, ax[2] * sign]
      let n = 0
      for (const x of xs) {
        d.sample(x.t, x.g, x.a)
        n += d.steps().length
      }
      return n
    }
    const up = count(1)
    const down = count(-1)
    const sign = up >= this.p.axisSteps && up >= down * 2 ? 1 : down >= this.p.axisSteps && down >= up * 2 ? -1 : swingSign(s)
    if (sign === null || Math.max(up, down) < this.p.axisSteps) return
    this.axis = [ax[0] * sign, ax[1] * sign, ax[2] * sign]
    for (const x of this.buf) x.s = dot(x.g, this.axis)
  }

  // 新しく決まった1歩（古い順）。呼ぶと空になる
  steps(): Step[] {
    const o = this.out
    this.out = []
    return o
  }

  // 振り出しの山を探し、山ごとに着地を決め、前の着地から今の着地までを1歩きにする
  private scan() {
    const b = this.buf
    const p = this.p
    const tEnd = b[b.length - 1].t
    const half = p.peakSep / 2
    // 先を見る長さ（look ≥ peakSep/2）より古い件だけ、山かどうかを決める（決めたら変わらないので、次は続きから）
    const from = Math.max(this.lastPeak + half, this.decided)
    let i0 = 0
    while (i0 < b.length && b[i0].t <= from) i0++
    const sm = (i: number) => (b[Math.max(0, i - 1)].s + b[i].s + b[Math.min(b.length - 1, i + 1)].s) / 3
    for (let i = i0; i < b.length && b[i].t <= tEnd - p.look; i++) {
      const v = sm(i)
      if (!(v >= p.peakMin)) continue
      let top = true
      for (let j = i - 1; top && j >= 0 && b[i].t - b[j].t <= half; j--) if (sm(j) > v) top = false
      for (let j = i + 1; top && j < b.length && b[j].t - b[i].t <= half; j++) if (sm(j) >= v) top = false
      if (!top) continue
      this.lastPeak = b[i].t
      this.onPeak(i, v)
    }
    this.decided = tEnd - p.look
  }

  private onPeak(ip: number, peak: number) {
    const b = this.buf
    const p = this.p
    // 着地：山のあと、ω が 0 を下へ切ったところ + icDelay
    let ic = NaN
    for (let j = ip; j + 1 < b.length && b[j].t - b[ip].t <= p.icSearch; j++) {
      if (b[j].s > 0 && b[j + 1].s <= 0) {
        ic = b[j].t + ((b[j + 1].t - b[j].t) * b[j].s) / (b[j].s - b[j + 1].s) + p.icDelay
        break
      }
    }
    // 離地（前の着地の接地の終わり）：山の前で、ω が 0 を上へ切ったところ（z2）の前 troughWin 秒の谷 − toLead
    let z2 = NaN
    for (let j = ip; j > 0 && b[ip].t - b[j].t <= p.swingBack; j--) {
      if (b[j].s > 0 && b[j - 1].s <= 0) {
        z2 = b[j - 1].t + ((b[j].t - b[j - 1].t) * -b[j - 1].s) / (b[j].s - b[j - 1].s)
        break
      }
    }
    const prev = this.prev
    this.prev = Number.isFinite(ic) ? { ic, peak } : null
    if (!prev || !Number.isFinite(ic) || !Number.isFinite(z2)) return
    const from = Math.max(prev.ic + p.troughAfterIc, z2 - p.troughWin)
    let k = -1
    for (let j = 0; j < b.length && b[j].t <= z2; j++) if (b[j].t >= from && (k < 0 || b[j].s < b[k].s)) k = j
    if (k < 0) return
    const to = b[k].t - p.toLead
    const ct = to - prev.ic
    const stride = ic - prev.ic
    if (!(ct >= p.ctMin && ct <= p.ctMax && stride >= p.strideMin && stride <= p.strideMax)) return
    const df = ct / stride
    if (df > p.dfMax) return // 歩き（両足が着いている間がある）
    // 1歩きの、すねの振れ幅：ω を積分し、終わりが始まりに戻るように傾きを引いてから、いちばん上と下の差
    let ang = 0
    const angs: { t: number; a: number }[] = []
    let impact = 0
    for (let j = 1; j < b.length; j++) {
      const t = b[j].t
      if (t < prev.ic || t > ic) continue
      ang += ((b[j].s + b[j - 1].s) / 2) * (t - b[j - 1].t)
      angs.push({ t, a: ang })
    }
    for (const x of b) if (x.t >= prev.ic - p.impactBefore && x.t <= prev.ic + p.impactAfter) impact = Math.max(impact, x.am)
    if (angs.length < 3) return
    const a0 = angs[0]
    const a1 = angs[angs.length - 1]
    const slope = (a1.a - a0.a) / (a1.t - a0.t || 1)
    let lo = Infinity
    let hi = -Infinity
    for (const x of angs) {
      const d = x.a - a0.a - slope * (x.t - a0.t)
      lo = Math.min(lo, d)
      hi = Math.max(hi, d)
    }
    const rom = hi - lo
    const v = (p.speedA + (p.speedB * rom) / stride) * 3.6
    this.out.push({ ic: prev.ic, to, ct, stride, df, rom, v, impact, peak: prev.peak })
  }
}

// ---- 左右をまとめて、1秒ごとの判定の値にする ----

export interface ContactValues {
  df: number // 接地の割合（両足の真ん中の値）
  ct: number // 接地時間（秒、両足の真ん中の値）
  v: number // 速さの見積もり（km/h）
  cad: number // ピッチ（歩/分）
  line: number // その速さでの、接地の割合の線
  z: number // 接地の割合が、その速さの市民ランナーの平均から標準偏差いくつぶん上か
  ctL: number
  ctR: number
  ctSi: number // 接地時間の左右差（%、右が長いと正）。|右 − 左| ÷ 平均
  impL: number
  impR: number
  impSi: number // 着地の衝撃の左右差（%、右が重いと正）
  nL: number
  nR: number
  peakL: number // 振り出しの山（dps、足ごとの真ん中の値）
  peakR: number
  mountDiff: boolean // 両足の振り出しの山が違いすぎる：付け方が左右で違うとみて、左右差を使わない
  steady: boolean // 見積もった速さとピッチが変わっていない（接地の割合と左右差を判定してよい）
  steadyV: boolean // 見積もった速さが変わっていない（オーバーストライドを判定してよい。ピッチは見ない）
  // 足が体より前に着く（オーバーストライド）：同じ速さの走り出し（ref）より、ピッチが何 % 落ちたか。基準がない・速さが違うときは NaN
  cadDrop: number
  cadDropHeld: number // 直近 CONTACT.overHold 秒の cadDrop のいちばん小さい値（その間ずっと落ちていたか）。続けて測れた長さが足りなければ NaN
  ctRise: number // 同じく、接地時間が何 % のびたか（記録用）
  ref: { v: number; cad: number; ct: number } | null // 走り出しの基準（その速さの、ふつうのピッチと接地時間）
}

const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN
}

// 速さ v（km/h）での、市民ランナーの接地の割合の平均と標準偏差。表の間は直線でつなぎ、表の外は端の値のまま（研究の値がないので延ばさない）。
// 時速9kmより遅く走ると、本当の平均はもう少し高い（遅いほど接地が長い）ので、そのぶん知らせやすい側にずれる。
// 一方、見積もった速さは人によって ±1 km/h ほどずれる（自分には 2026-11-05 の時速9km で合わせた。params.ts の STEP.speedA）ので、延ばすと線が動きすぎる。端で止める
export function dfNorm(v: number, c: ContactParams = CONTACT): { mean: number; sd: number } {
  const T = c.norm
  if (v <= T[0][0]) return { mean: T[0][1], sd: T[0][2] }
  const last = T[T.length - 1]
  if (v >= last[0]) return { mean: last[1], sd: last[2] }
  let k = 0
  while (v > T[k + 1][0]) k++
  const [v0, m0, s0] = T[k]
  const [v1, m1, s1] = T[k + 1]
  const u = (v - v0) / (v1 - v0)
  return { mean: m0 + (m1 - m0) * u, sd: s0 + (s1 - s0) * u }
}

// 両足の1歩をためて、直近 win 秒から判定の値を出す
// オーバーストライド：ベルトの速さが同じなのに歩幅を大きくすると、ピッチが落ち、接地がのびる（2026-11-05 にわざとやった約15秒：
//   時速9kmのまま、ピッチ 170 → 146〜153、接地時間 255 → 330ms。見積もった速さは 7.7〜8.2 km/h で変わらなかった）。
//   走り出して速さが落ち着いた refSec 秒のピッチと接地時間の真ん中を、その速さの「ふつう」として覚え、
//   見積もった速さが sameV の割合の内にある間、ピッチがそこから何 % 落ちたかを出す。速さが relearn 秒より長く違ったら、新しい速さで覚え直す
export class ContactJudge {
  private steps: { L: Step[]; R: Step[] } = { L: [], R: [] }
  private now = { L: -Infinity, R: -Infinity } // 足ごとの、最後に届いた1歩の時刻（センサーの時計）
  private hist: { t: number; v: number; cad: number }[] = [] // 速さとピッチの移り変わり（判定した時刻の順）
  private ref: { v: number; cad: number; ct: number } | null = null
  private refBuf: { t: number; v: number; cad: number; ct: number }[] = []
  private away: number | null = null // 速さが基準と違い始めた t
  private drops: { t: number; d: number }[] = [] // 直近の cadDrop（同じ速さで測れた間だけ。途切れたら空にする）
  readonly c: ContactParams

  constructor(c: ContactParams = CONTACT) {
    this.c = c
  }

  add(side: 'L' | 'R', s: Step) {
    const xs = this.steps[side]
    xs.push(s)
    this.now[side] = Math.max(this.now[side], s.ic)
    while (xs.length && this.now[side] - xs[0].ic > this.c.keep) xs.shift()
  }

  // 走るのが途切れたら（止まった・歩いた）、ためた1歩を捨てる（走り出しの基準は残す。速さが違えば覚え直す）
  clear() {
    this.steps = { L: [], R: [] }
    this.hist = []
    this.refBuf = []
    this.drops = []
  }

  // t：判定する時刻（どの時計でもよい。速さが変わったかを見る間隔だけに使う）。
  // fresh(side)：その足の1歩が、いまも届いているか（切れた足の古い1歩で判定しない）
  values(t: number, fresh: { L: boolean; R: boolean }): ContactValues | null {
    const c = this.c
    const pick = (side: 'L' | 'R') => (fresh[side] ? this.steps[side].filter((s) => this.now[side] - s.ic <= c.win) : [])
    const L = pick('L')
    const R = pick('R')
    const okL = L.length >= c.minSide
    const okR = R.length >= c.minSide
    if (!okL && !okR) return null
    // 足ごとの真ん中の値を出してから、両足を平均する（付け方で足ごとの見積もりが少し違うので、2つを混ぜた真ん中の値は、混ざり方で跳ねる）
    const each = (f: (s: Step) => number) => {
      const l = okL ? median(L.map(f)) : NaN
      const r = okR ? median(R.map(f)) : NaN
      return { l, r, m: okL && okR ? (l + r) / 2 : okL ? l : r }
    }
    const V = each((s) => s.v)
    const v = V.m
    const cad = 120 / each((s) => s.stride).m
    const df = each((s) => s.df).m
    const ct = each((s) => s.ct).m
    this.hist.push({ t, v, cad })
    while (this.hist.length && t - this.hist[0].t > c.steadySec + 1) this.hist.shift()
    const old = this.hist[0]
    // 速さが steadySec 秒の間に変わった、速さがありえない：判定しない（速さを変えた直後は、接地の割合も、見積もった速さも追いつかない）。
    // 接地の割合と左右差は、ピッチが変わった間も判定しない（同じ速さで大またにすると接地の割合が上がり、「腰が落ちている」と取り違える。2026-11-02 のわざと大また）。
    // オーバーストライドは、速さだけを見る（同じ速さでピッチが落ちたのが、その崩れ）
    const steadyV = t - old.t >= c.steadySec - 1 && this.hist.every((h) => Math.abs(h.v - v) / v <= c.steadyV) && v >= c.vMin && v <= c.vMax
    const steady = steadyV && this.hist.every((h) => Math.abs(h.cad - cad) / cad <= c.steadyCad)
    const over = this.overstride(t, v, cad, ct, steadyV)
    const n = dfNorm(v, c)
    // 左右差は、長めの窓（winSi）で見る（足ごとの1歩の数が半分なので、同じ窓ではぶれが大きい。左右差は数秒では変わりにくい）
    const L2 = fresh.L ? this.steps.L.filter((s) => this.now.L - s.ic <= c.winSi) : []
    const R2 = fresh.R ? this.steps.R.filter((s) => this.now.R - s.ic <= c.winSi) : []
    const two = L2.length >= c.minSide && R2.length >= c.minSide
    const side = (f: (s: Step) => number) => (two ? { l: median(L2.map(f)), r: median(R2.map(f)) } : { l: NaN, r: NaN })
    const C2 = side((s) => s.ct)
    const ctL = C2.l
    const ctR = C2.r
    const IMP = side((s) => s.impact)
    const impL = IMP.l
    const impR = IMP.r
    const PK = side((s) => s.peak)
    const mountDiff = two && Math.max(PK.l / PK.r, PK.r / PK.l) > c.peakRatio
    const si = (l: number, r: number) => ((r - l) / ((l + r) / 2)) * 100
    return {
      df, ct, v, cad,
      line: n.mean + c.z * n.sd,
      z: (df - n.mean) / n.sd,
      ctL, ctR, ctSi: si(ctL, ctR),
      impL, impR, impSi: si(impL, impR),
      nL: L2.length, nR: R2.length,
      peakL: PK.l, peakR: PK.r, mountDiff,
      steady,
      steadyV,
      ...over,
    }
  }

  // 走り出しの基準を覚え、同じ速さの間のピッチの落ち方を出す
  private overstride(t: number, v: number, cad: number, ct: number, steady: boolean) {
    const c = this.c
    const none = { cadDrop: NaN, cadDropHeld: NaN, ctRise: NaN, ref: this.ref }
    if (!(Number.isFinite(v) && Number.isFinite(cad) && Number.isFinite(ct))) return none
    if (!this.ref) {
      if (!steady) {
        this.refBuf = []
        return none
      }
      this.refBuf.push({ t, v, cad, ct })
      if (t - this.refBuf[0].t < c.refSec) return none
      this.ref = { v: median(this.refBuf.map((x) => x.v)), cad: median(this.refBuf.map((x) => x.cad)), ct: median(this.refBuf.map((x) => x.ct)) }
      this.refBuf = []
      this.drops = []
    }
    const ref = this.ref
    if (Math.abs(v - ref.v) / ref.v > c.sameV) {
      // 速さが違う：比べない。relearn 秒より長く違ったら（ベルトの速さを変えた）、新しい速さで覚え直す
      this.away ??= t
      this.drops = []
      if (t - this.away >= c.relearn) {
        this.ref = null
        this.away = null
      }
      return { ...none, ref: this.ref }
    }
    this.away = null
    const cadDrop = ((ref.cad - cad) / ref.cad) * 100
    const ctRise = ((ct - ref.ct) / ref.ct) * 100
    // 1回の判定の間が gap 秒よりあいたら（止まった・値が切れた）、続けて測れたとはみなさない
    const last = this.drops[this.drops.length - 1]
    if (last && t - last.t > c.overGap) this.drops = []
    this.drops.push({ t, d: cadDrop })
    while (this.drops.length && t - this.drops[0].t > c.overHold) this.drops.shift()
    const held = t - this.drops[0].t >= c.overHold - 1 ? Math.min(...this.drops.map((x) => x.d)) : NaN
    return { cadDrop, cadDropHeld: held, ctRise, ref }
  }
}
