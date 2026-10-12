import { MOUNT, PHONE } from './params'
import { refineFreq, resample, stepPeriod, type PhoneMeasure, type Vec3 } from './signal'

// 付け方の確認：腰のベルトにしっかり付いているかを、直近の値から見分ける
//   notWaist（腰以外：腕・手・ポケット）：腕や脚は2歩で1回、肩や股関節を支点に前後に振れるので、水平な軸まわりの
//     回転（ジャイロ）が大きい。腰の回転は、ねじれ（上下の軸まわり）が主で、水平な軸まわりは左右の傾きの分だけ。
//     手に持つと、振りの遠心力で平均の加速度が g よりはっきり大きくなる（ジャイロが無くても分かる）
//   loose（ゆるい）：着地のたびにスマホが体に対して揺れ、歩くリズムより速い細かい回転が出る
//   shifted（途中でずれた）：走り始めに決めた、スマホの座標で見た上向きから、大きく傾いた
// 模擬データで試して使わなかったもの：加速度の「2歩で1回の波」の強さ（腕では、振りの加速度と重力の傾きが打ち消し
//   合って小さく出て、左右の揺れが大きい腰と分けられなかった）、2歩ずらした自己相関（ゆるくても下がらなかった。
//   走るリズムかどうかを確かめるのにだけ使う）
// 線はどれも模擬データ（simulate.ts）だけで決めた仮の値。研究の根拠はない（params.ts の MOUNT）

export type MountIssue = 'notWaist' | 'loose' | 'shifted'

export interface MountFeatures {
  stepHz: number // 1歩の周波数
  gravity: number // 平均の加速度の大きさ（m/s²）
  up: Vec3 // スマホの座標で見た上向き（平均の加速度の向き）
  gyroSwing?: number // 角速度のうち、水平な軸まわり（上向きに直交する成分）の二乗平均（rad/s）。ジャイロが取れないときは無い
  gyroHf?: number // 角速度のうち、歩くリズムより速い揺れ（MOUNT.hfWindow 秒の移動平均からのずれ）の二乗平均（rad/s）
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// 直近の値から、付け方を見分ける手がかりを出す。stepHz：1歩の周波数（estimate で分かっていれば）。
// 1歩のリズムが見つからない・値が足りないときは null
export function mountFeatures(ms: PhoneMeasure[], stepHz?: number): MountFeatures | null {
  if (ms.length < 3 || ms[ms.length - 1].t - ms[0].t < PHONE.minWindow) return null
  const { t, acc, gyro } = resample(ms)
  const g: Vec3 = [0, 1, 2].map((k) => mean(acc.map((a) => a[k]))) as Vec3
  const gravity = norm(g)
  if (gravity < PHONE.gravityMin) return null
  const up: Vec3 = [g[0] / gravity, g[1] / gravity, g[2] / gravity]

  // 1歩のリズム。estimate が出せないとき（手に持つと、上下の揺れが2歩で1回の振りに埋もれる）は、1歩の周期を探し、
  // 3方向の加速度が2歩ごとに同じ形をくり返しているか（2歩ずらした自己相関）で、走るリズムかを確かめる
  let f = stepHz
  if (!f) {
    const vert = acc.map((a) => dot(a, up))
    const sp = stepPeriod(vert, PHONE.fs)
    if (!sp) return null
    f = refineFreq(t, vert, 1 / sp.period)
    if (strideRegularity(acc, g, (2 * PHONE.fs) / f) < PHONE.minRegularity) return null
  }

  const out: MountFeatures = { stepHz: f, gravity, up }
  if (gyro) {
    out.gyroSwing = Math.sqrt(mean(gyro.map((w) => Math.max(0, dot(w, w) - dot(w, up) ** 2))))
    const h = Math.max(1, Math.round((MOUNT.hfWindow * PHONE.fs) / 2))
    const hf: number[] = []
    for (let i = h; i < gyro.length - h; i++) {
      let e = 0
      for (let k = 0; k < 3; k++) {
        let s = 0
        for (let j = i - h; j <= i + h; j++) s += gyro[j][k]
        e += (gyro[i][k] - s / (2 * h + 1)) ** 2
      }
      hf.push(e)
    }
    out.gyroHf = Math.sqrt(mean(hf))
  }
  return out
}

// 3方向の加速度の、2歩（lag コマ）ずらした自己相関。1歩ごとの周期のばらつきに合わせて、±10% の中の山を取る
function strideRegularity(acc: Vec3[], g: Vec3, lag0: number): number {
  const d = acc.map((a) => [a[0] - g[0], a[1] - g[1], a[2] - g[2]])
  const v0 = mean(d.map((a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2]))
  if (v0 <= 0) return 0
  let best = -1
  for (let lag = Math.round(lag0 * 0.9); lag <= Math.round(lag0 * 1.1) && lag < d.length - 1; lag++) {
    let s = 0
    for (let i = 0; i + lag < d.length; i++) s += d[i][0] * d[i + lag][0] + d[i][1] * d[i + lag][1] + d[i][2] * d[i + lag][2]
    best = Math.max(best, s / (d.length - lag) / v0)
  }
  return best
}

// 1つの窓の見立て。ジャイロが取れないときは、手に持ったときの遠心力だけを見る（ゆるみ・腕・ポケットは見分けない）
export function mountVerdict(x: MountFeatures): 'ok' | 'notWaist' | 'loose' {
  if (x.gravity >= MOUNT.handGravity) return 'notWaist'
  if (x.gyroHf === undefined || x.gyroSwing === undefined) return 'ok'
  if (x.gyroHf >= MOUNT.looseGyroHf) return 'loose'
  if (x.gyroSwing >= MOUNT.swingGyro) return 'notWaist'
  return 'ok'
}

// 走るリズムで、腰以外に付けて動いているか（estimate が出せないときに、走っているとみなすため）。
// 手に持つと平均の加速度が g より大きく、ピッチ・上下動の計算は値を出さないので、これがないと走り出しに気づけない
export function offWaistRunning(x: MountFeatures | null, runSpm: number): boolean {
  if (!x) return false
  const spm = x.stepHz * 60
  return spm >= runSpm && spm <= PHONE.spmMax && mountVerdict(x) === 'notWaist'
}

// 2つの向きのなす角（度）
export const angleDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180) / Math.PI

// 走りを通して、付け方を見続ける。1秒に1回 check を呼ぶ。おかしいと決まった1回だけ、その問題を返す
//   走り出して MOUNT.startFrom 秒までは見ない（走り出しは揺れが落ち着かない）
//   直近 MOUNT.window 回の見立てのうち MOUNT.share 以上が同じ問題なら、その問題とする（1回の見立てでは決めない）
//   ずれは、走り始め（MOUNT.startFrom〜MOUNT.refUntil 秒）の上向きの平均から MOUNT.shiftDeg 以上傾いた見立てで数える
export class MountCheck {
  issue: MountIssue | null = null // 見つけた問題（1つだけ。見つけたら、その走りではもう見ない）
  issueAt: number | null = null
  private recent: (MountIssue | 'ok')[] = []
  private upSum: Vec3 = [0, 0, 0]
  private ref: Vec3 | null = null

  check(t: number, x: MountFeatures | null): MountIssue | null {
    if (this.issue || !x || t < MOUNT.startFrom) return null
    let v: MountIssue | 'ok' = mountVerdict(x)
    if (t <= MOUNT.refUntil) {
      if (v === 'ok') this.upSum = [this.upSum[0] + x.up[0], this.upSum[1] + x.up[1], this.upSum[2] + x.up[2]]
    } else if (!this.ref && norm(this.upSum) > 0) {
      this.ref = this.upSum
    }
    if (v === 'ok' && this.ref && angleDeg(this.ref, x.up) >= MOUNT.shiftDeg) v = 'shifted'
    this.recent.push(v)
    if (this.recent.length > MOUNT.window) this.recent.shift()
    if (this.recent.length < MOUNT.window) return null
    for (const k of ['notWaist', 'loose', 'shifted'] as const) {
      if (this.recent.filter((r) => r === k).length >= MOUNT.share * MOUNT.window) {
        this.issue = k
        this.issueAt = t
        return k
      }
    }
    return null
  }
}
