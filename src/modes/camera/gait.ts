// 走りの数字（ピッチ・上下動・腰の高さ・腕振り）を、走りながらの骨格から1歩ずつ測る。声はかけず、結果の画面に出すだけ
// （数字と、声にしない理由は params.ts の GAIT。仮想実験は sim/result-gait.md）
//   1歩：着地の測り方（landing.ts の LandingMeter）が取った、前にあるほうの足首が一番前に出た山から、次の山まで。
//     山は左右の名前によらず1歩に1つなので、となりの山の間が1歩
//   ピッチ：1歩の長さの中央値から（歩／分）
//   上下動：1歩の間の、腰（左右の股関節の真ん中）の一番高い位置と低い位置の差 ÷ 脚の長さ
//   腰の高さ：1歩の間の、低いほう（接地している側）の足首から腰までの高さ ÷ 脚の長さ の平均。
//     結果の画面では、走る前に立って測った同じ値で割る（脚がまっすぐなら1に近い。人による点の位置の違いを消すため）
//   腕振り：手前の腕の、肩→肘の線の前後の振れ幅（1周＝2歩の間の、一番前と一番後ろの角度の差、度）と、肘の角度の平均（まっすぐで180°）
//   脚の長さは、1コマずつだとぶれる（自分の記録で ±7%）ので、直近のコマの中央値で割る（LandingMeter と同じ）
import type { Frame, GaitResult } from '../../core/types'
import type { Peak } from './landing'
import { median } from './landing'
import { L } from './landmarks'
import { facing, legLength, mid, nearSide } from './geometry'
import { GAIT } from './params'

const DEG = 180 / Math.PI

// 1コマから、腕の角度（手前の腕。点がはっきりしないときは null）
export function armOf(f: Frame): { swing: number; elbow: number } | null {
  const left = nearSide(f) === 'left'
  const sh = f[left ? L.leftShoulder : L.rightShoulder]
  const el = f[left ? L.leftElbow : L.rightElbow]
  const wr = f[left ? L.leftWrist : L.rightWrist]
  if (Math.min(sh.v, el.v, wr.v) < GAIT.armVis) return null
  const dir = facing(f)
  // 肩→肘の線と鉛直の角度（肘が肩より前で正）
  const swing = Math.atan2((el.x - sh.x) * dir, el.y - sh.y) * DEG
  const a = [sh.x - el.x, sh.y - el.y]
  const b = [wr.x - el.x, wr.y - el.y]
  const n = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])
  if (!n) return null
  const elbow = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / n))) * DEG
  return { swing, elbow }
}

interface GaitFrame {
  t: number
  hipY: number // 腰（左右の股関節の真ん中）の高さ（画素。下が正）
  hipH: number // 低いほうの足首から腰までの高さ（画素）
  leg: number // 直近のコマの脚の長さの中央値（画素）
  arm: { swing: number; elbow: number } | null
}

// 1歩の値
export interface GaitStep {
  t: number // 1歩の始まり（山の時刻）
  sec: number // 1歩の長さ（秒）
  vo: number // 上下動（脚の長さに対する割合）
  hip: number // 腰の高さ（脚の長さに対する割合）
  arm?: number // 腕の振れ幅（度。この歩と前の歩の1周）
  elbow?: number // 肘の角度（度）
}

export class GaitWatch {
  private frames: GaitFrame[] = []
  private legs: number[] = []
  private last: Peak | null = null // 前の山
  private prevStep: { from: number; to: number } | null = null // 前の1歩（腕は2歩で1周）
  readonly steps: GaitStep[] = []

  // 骨格を取ったコマ（なめらかにして傾きを直したもの。着地と同じコマ）
  frame(f: Frame, t: number) {
    const l0 = legLength(f)
    if (!(l0 > 0)) return
    this.legs.push(l0)
    if (this.legs.length > 31) this.legs.shift()
    const hip = mid(f[L.leftHip], f[L.rightHip])
    const low = Math.max(f[L.leftAnkle].y, f[L.rightAnkle].y)
    this.frames.push({ t, hipY: hip.y, hipH: low - hip.y, leg: median(this.legs), arm: armOf(f) })
    while (this.frames.length && t - this.frames[0].t > GAIT.keep) this.frames.shift()
  }

  // 1秒ごと：その秒に振り分けた山（歩数で走っていた秒の山だけ。landing.ts の LandingWatch.second）。
  // となりの山の間を1歩として測る。間があきすぎた・コマが抜けた歩は測らない
  second(peaks: Peak[]) {
    for (const p of [...peaks].sort((a, b) => a.t - b.t)) {
      const a = this.last
      this.last = p
      if (!a) continue
      const sec = p.t - a.t
      if (sec < GAIT.stepMin || sec > GAIT.stepMax) {
        this.prevStep = null
        continue
      }
      const fs = this.within(a.t, p.t)
      if (!fs) {
        this.prevStep = null
        continue
      }
      const leg = median(fs.map((x) => x.leg))
      const ys = fs.map((x) => x.hipY)
      const step: GaitStep = { t: a.t, sec, vo: (Math.max(...ys) - Math.min(...ys)) / leg, hip: fs.reduce((s, x) => s + x.hipH, 0) / fs.length / leg }
      // 腕：前の歩とこの歩（1周）の、肩→肘の角度の一番前と一番後ろの差
      const prev = this.prevStep
      const stride = prev && prev.to === a.t ? this.within(prev.from, p.t) : null
      const arms = stride?.flatMap((x) => (x.arm ? [x.arm] : []))
      if (stride && arms && arms.length >= stride.length * GAIT.armCover) {
        const sw = arms.map((x) => x.swing)
        step.arm = Math.max(...sw) - Math.min(...sw)
        step.elbow = arms.reduce((s, x) => s + x.elbow, 0) / arms.length
      }
      this.steps.push(step)
      this.prevStep = { from: a.t, to: p.t }
    }
  }

  // t0〜t1 のコマ（続けて取れていなければ null）
  private within(t0: number, t1: number): GaitFrame[] | null {
    const fs = this.frames.filter((x) => x.t >= t0 - GAIT.edge && x.t <= t1 + GAIT.edge)
    if (fs.length < GAIT.minFrames) return null
    if (fs[0].t > t0 + GAIT.maxGap || fs[fs.length - 1].t < t1 - GAIT.maxGap) return null
    for (let i = 1; i < fs.length; i++) if (fs[i].t - fs[i - 1].t > GAIT.maxGap) return null
    return fs
  }

  // 走り全体：1歩ずつの値の中央値。測れた歩が GAIT.minSteps に足りない項目は無い
  result(): GaitResult {
    const s = this.steps
    const out: GaitResult = { steps: s.length }
    if (s.length < GAIT.minSteps) return out
    out.cadence = 60 / median(s.map((x) => x.sec))
    out.vo = median(s.map((x) => x.vo))
    out.hip = median(s.map((x) => x.hip))
    const arm = s.flatMap((x) => (x.arm === undefined ? [] : [x.arm]))
    if (arm.length >= GAIT.minSteps) {
      out.arm = median(arm)
      out.elbow = median(s.flatMap((x) => (x.elbow === undefined ? [] : [x.elbow])))
    }
    return out
  }
}
