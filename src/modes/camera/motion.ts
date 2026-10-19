import type { Frame } from '../../core/types'
import { RUNNING } from '../../core/params'
import { L, HEAD_POINTS, KEY_PAIRS } from './landmarks'
import { facing, legLength } from './geometry'

// 「走っている」を見分ける
//
// 本番：研究で確かめられた歩数の数え方（足首が腰より一番前に出た瞬間＝接地、一番後ろ＝離地）で歩数を数え、
//   ピッチが毎分130歩以上なら走っている。トレッドミルでも外でも使え、ピッチ（歩／分）もここで出る
//   参考：Zeni ら 2008、スマホ動画で2〜5コマの誤差（Automated Stride Detection from OpenPose Keypoints, 2023）
// 検証用：その場で走るフリは脚が前後に動かず歩数が数えられないので、左右の膝と足首が上下に入れ替わる
//   リズムでも走っているとする（RUNNING.inPlaceForTesting）。いまは切っている：トレッドミルの歩きも走るフリと見てしまった
// 1コマずつの判定はぶれるので、走り始め・止まりは RunningGate で、直近のコマの割合から決める

const RUN_SPM = RUNNING.runSpm // 歩きはおよそ毎分100〜120歩、走りは150〜190歩
const STEP_PROMINENCE = RUNNING.stepProminence // 足首の前後の振れ（脚の長さに対する割合）がこれだけ戻ったら山・谷とみなす
const STEP_WINDOW = 4 // ピッチは直近4秒の接地から出す
const MIN_SD = { x: 0.1, y: 0.04 } // 検証用：脚の長さに対する揺れの大きさ
const MIN_STEPS_PER_SEC = 2
const MIN_LIFT_SD = 0.03 // 片脚の持ち上げの揺れ（脚の長さに対する割合）

// 片脚ずつ、足首の前後の位置（腰から見て、進む向きが正）の山と谷を見つける
class LegSteps {
  private seekMax = true
  private ext = { t: 0, v: -Infinity }
  strikes: number[] = []
  update(t: number, v: number) {
    if (this.seekMax) {
      if (v > this.ext.v) this.ext = { t, v }
      else if (v < this.ext.v - STEP_PROMINENCE) {
        this.strikes.push(this.ext.t) // 一番前に出た瞬間＝接地
        this.seekMax = false
        this.ext = { t, v }
      }
    } else {
      if (v < this.ext.v) this.ext = { t, v }
      else if (v > this.ext.v + STEP_PROMINENCE) {
        this.seekMax = true // 一番後ろ＝離地
        this.ext = { t, v }
      }
    }
    while (this.strikes.length && t - this.strikes[0] > STEP_WINDOW) this.strikes.shift()
  }
}

export class MotionDetector {
  private xs: { t: number; x: number; y: number; l: number; r: number }[] = []
  private legs = [new LegSteps(), new LegSteps()]
  private lastT = -1e9
  private legRef = 0 // 直近の脚の長さの最大（脚を上げると見かけの長さが縮むので、持ち上げの量はこれで割る）
  private windowSec: number
  cadence: number | null = null // ピッチ（歩／分）
  by: 'steps' | 'inPlace' | null = null // 何で走っていると判断したか
  constructor(windowSec = 2) {
    this.windowSec = windowSec
  }

  update(frame: Frame, t: number): boolean {
    const leg = legLength(frame)
    // 間があいたら（骨格を取っていない間）、つながらないので数え直す
    if (t - this.lastT > 0.5) {
      this.legs = [new LegSteps(), new LegSteps()]
      this.xs = []
    }
    this.lastT = t
    if (leg > 0) {
      const dir = facing(frame)
      const pelvis = (frame[L.leftHip].x + frame[L.rightHip].x) / 2
      this.legs[0].update(t, ((frame[L.leftAnkle].x - pelvis) * dir) / leg)
      this.legs[1].update(t, ((frame[L.rightAnkle].x - pelvis) * dir) / leg)
      const hipY = (frame[L.leftHip].y + frame[L.rightHip].y) / 2
      // 片脚ずつの持ち上げ：腰から見た足首と膝の高さ（真横からだと奥の脚が手前の脚に重なることがあるので、片脚だけでも見る）
      this.legRef = Math.max(leg, this.legRef * 0.995)
      const lift = (a: number, k: number) => (hipY - frame[a].y + (hipY - frame[k].y)) / this.legRef
      this.xs.push({
        t,
        x: (frame[L.leftAnkle].x - frame[L.rightAnkle].x) / leg,
        y: (frame[L.leftAnkle].y - frame[L.rightAnkle].y + frame[L.leftKnee].y - frame[L.rightKnee].y) / leg,
        l: lift(L.leftAnkle, L.leftKnee),
        r: lift(L.rightAnkle, L.rightKnee),
      })
    }
    while (this.xs.length && t - this.xs[0].t > this.windowSec) this.xs.shift()

    // ピッチは、片脚ごとの接地の間隔（1歩きの周期）から出す。左右の接地をまとめて数えると、窓の端でずれる
    // 片脚の接地の間隔（1周の長さ）の中央値。左右の名前の取り違えで生まれる、ありえない短い・長い間隔は除く
    // （1周 0.45〜1.4秒 ＝ 毎分86〜266歩）
    const periods = this.legs
      .filter((l) => l.strikes.length >= 2 && t - l.strikes[l.strikes.length - 1] < 1.5)
      .flatMap((l) => l.strikes.slice(1).map((x, i) => x - l.strikes[i]))
      .filter((p) => p >= 0.45 && p <= 1.4)
      .sort((a, b) => a - b)
    this.cadence = periods.length ? 120 / periods[Math.floor(periods.length / 2)] : null
    if (this.cadence !== null && this.cadence >= RUN_SPM) {
      this.by = 'steps'
      return true
    }
    this.by = RUNNING.inPlaceForTesting && this.inPlace() ? 'inPlace' : null
    return this.by !== null
  }

  // 検証用：左右が交互に入れ替わるリズム（上下・前後どちらでも）、または片脚が上下するリズム
  private inPlace(): boolean {
    if (this.xs.length < 10) return false
    const span = this.xs[this.xs.length - 1].t - this.xs[0].t
    if (span < this.windowSec * 0.7) return false
    const rhythm = (k: 'x' | 'y' | 'l' | 'r') => {
      const v = this.xs.map((p) => p[k])
      const m = v.reduce((a, b) => a + b, 0) / v.length
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)
      return { sd, perSec: steps(v, m, sd * 0.4) / span }
    }
    if ((['x', 'y'] as const).some((k) => {
      const r = rhythm(k)
      return r.sd >= MIN_SD[k] && r.perSec >= MIN_STEPS_PER_SEC
    })) return true
    // 片脚：上がって下りるで2回入れ替わる＝1周（2歩）。毎秒1周以上（毎分120歩以上）
    return (['l', 'r'] as const).some((k) => {
      const r = rhythm(k)
      return r.sd >= MIN_LIFT_SD && r.perSec / 2 >= MIN_STEPS_PER_SEC / 2
    })
  }
}

// 走り始め・止まりを、1コマずつの判定（MotionDetector）の割合で決める。
// 直近 RUNNING.ratioWindow 秒のコマのうち、走っていると見たコマが RUNNING.startRatio 以上で「走っている」、
// RUNNING.stopRatio を切ったら「止まった」。骨格を取ったコマだけを渡す（間引いて取らなかったコマは渡さない）
export class RunningGate {
  running = false
  private win: { t: number; on: boolean }[] = []
  private lastT = -1e9
  private since = -1e9 // 歩数を数え直し始めた時刻

  // 戻り値：このコマを割合に入れたか（間があいた直後で、歩数をまだ数えられないコマは入れない）
  push(t: number, on: boolean): boolean {
    // MotionDetector と同じく、0.5秒より間があくと歩数は数え直しになる
    if (t - this.lastT > 0.5) this.since = t
    this.lastT = t
    if (t - this.since < RUNNING.stepSettle) return false
    this.win.push({ t, on })
    while (t - this.win[0].t > RUNNING.ratioWindow) this.win.shift()
    const ratio = this.win.filter((x) => x.on).length / this.win.length
    // 走り始めは、窓のほぼ全部を続けて見てから決める（間引いた飛び飛びの数コマだけで決めない）
    if (!this.running && this.covered() >= RUNNING.ratioWindow * 0.9 && ratio >= RUNNING.startRatio) this.running = true
    else if (this.running && this.win.length >= 10 && ratio < RUNNING.stopRatio) this.running = false
    return true
  }

  // 窓の中で、続けて見ていた時間（秒）。0.5秒より間があいたところは数えない
  private covered(): number {
    let s = 0
    for (let i = 1; i < this.win.length; i++) {
      const dt = this.win[i].t - this.win[i - 1].t
      if (dt <= 0.5) s += dt
    }
    return s
  }
}

// 左右が入れ替わった回数（＝歩数）。真ん中付近の小さな揺れで数えないよう、帯を越えたときだけ数える
function steps(v: number[], mean: number, band: number): number {
  let side = 0
  let n = 0
  for (const x of v) {
    const s = x > mean + band ? 1 : x < mean - band ? -1 : 0
    if (s === 0) continue
    if (side !== 0 && s !== side) n++
    side = s
  }
  return n
}

// 全身が見えているか
// 人以外のもの（床や家具）を人と見間違えたものは、並び方と大きさで落とす
export function bodyVisible(frame: Frame, minV = 0.5, height?: number): boolean {
  if (!(HEAD_POINTS.some((i) => frame[i].v >= minV) && KEY_PAIRS.every(([a, b]) => Math.max(frame[a].v, frame[b].v) >= minV))) return false
  return plausibleBody(frame, height)
}

// 上から 頭 → 肩 → 腰 → 膝 → 足首 の順に並び、画面の高さの3割以上を占めているか
// （足首は、蹴り上げた脚が膝より上に来るので、低い方＝接地している側で見る）
export function plausibleBody(frame: Frame, height?: number): boolean {
  const y = (a: number, b: number) => (frame[a].y + frame[b].y) / 2
  const head = frame[L.nose].y
  const shoulder = y(L.leftShoulder, L.rightShoulder)
  const hip = y(L.leftHip, L.rightHip)
  const knee = y(L.leftKnee, L.rightKnee)
  const ankle = Math.max(frame[L.leftAnkle].y, frame[L.rightAnkle].y)
  if (!(head < shoulder && shoulder < hip && hip < knee && knee < ankle)) return false
  return height === undefined || ankle - head >= height * 0.3
}
