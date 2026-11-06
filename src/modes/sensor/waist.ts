import type { SensorWaistLog } from '../../core/types'
import { listenMotion, motionPermission, type MotionLike } from '../phone/sensor'
import { LeanDetector } from './lean'
import { HUNCH, WAIST } from './params'
import type { Vec3 } from './parse'
import type { PoseName } from './session'

// 腰のスマホ（センサーランで、腰のポーチに入れて持つスマホ）の向きを記録する（数字は params.ts の WAIST）。知らせには使わない。
// 胸のセンサーと同じ見方（lean.ts の LeanDetector：ならした重力の向き、2つの立ち方の b からの傾き）で、スマホの動きのセンサーの値を見る。
//   pose：2つの立ち方の1つを測り終えた t（胸と同じ3秒）。calibrate：a と b を測り終えた t（session.ts の calibrate から）
//   second：1秒ごとのまとめ（傾き・重力の向き・その1秒に届いた値の数）。tick：値の途切れを events に残す
// iPhone のウェブのページは、画面が消える（ロックされる）と動きのセンサーの値が来なくなる。途切れは waist:gap / waist:back で正直に残す（埋めない）
// 許可（iPhone）は、ホームの「はじめる」を押したときに求める（phone/sensor.ts の requestMotionPermission）。結果は events の waist:permission
export type WaistSec = { tilt: number | null; g: Vec3 | null; n: number }

export class WaistPhone {
  readonly d = new LeanDetector({ ...HUNCH, place: WAIST.place, ema: WAIST.ema, standMin: WAIST.standMin, poseMin: WAIST.poseMin, stale: WAIST.stale, poseSpeed: false })
  private dirs: Partial<Record<PoseName, Vec3>> = {}
  private n = 0 // いまの1秒に届いた値の数
  private firstAt: number | null = null
  private lastAt = -Infinity
  private gapFrom: number | null = null // 途切れ始めた t（waist:gap を残した）
  private noneSaid = false
  private readonly startAt: number
  private readonly off: () => void
  private readonly onEvent: (t: number, text: string) => void

  // listen：動きのセンサーの受け口（テストで差し替える）。now：いまの t（秒、performance.now() の時計）
  constructor(onEvent: (t: number, text: string) => void, listen: (cb: (e: MotionLike) => void) => () => void = listenMotion, now = () => performance.now() / 1000) {
    this.onEvent = onEvent
    this.startAt = now()
    if (motionPermission) onEvent(this.startAt, `waist:permission ${motionPermission}`)
    this.off = listen((e) => {
      const a = e.accelerationIncludingGravity
      if (!a || a.x === null || a.y === null || a.z === null) return
      this.sample(now(), [a.x, a.y, a.z])
    })
  }

  sample(t: number, a: Vec3) {
    if (this.firstAt === null) {
      this.firstAt = t
      this.onEvent(t, 'waist: on')
    }
    if (this.gapFrom !== null) {
      this.onEvent(t, `waist:back ${(t - this.gapFrom).toFixed(1)}`)
      this.gapFrom = null
    }
    this.lastAt = t
    this.n++
    this.d.sample(t, a)
  }

  // 2つの立ち方の1つ（胸と同じ3秒）。測れなければ何もしない
  pose(which: PoseName, t: number, sec: number) {
    const d = this.d.dirOver(t, sec)
    if (d) this.dirs[which] = d
  }

  // a と b を測り終えた：差が poseMin 以上なら b→a の向きに沿って見る（pose）。小さい・片方だけなら b（なければ a）からの向きによらない角度（fallback）
  calibrate(t: number): SensorWaistLog {
    const { a, b } = this.dirs
    const r4 = (v: Vec3) => v.map((x) => Math.round(x * 1e4) / 1e4) as Vec3
    let mode: SensorWaistLog['mode'] = 'none'
    if (a && b && this.d.setPoses(a, b)) mode = 'pose'
    else if (b ?? a) {
      this.d.standDir((b ?? a)!)
      mode = 'fallback'
    }
    const deg = a && b ? Math.round(Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 1800 / Math.PI) / 10 : null
    this.onEvent(t, `waist:pose ${mode} ${deg === null ? '-' : deg.toFixed(1)}`)
    return { t: Math.round(t * 100) / 100, deg, mode, ...(a && { a: r4(a) }), ...(b && { b: r4(b) }) }
  }

  // 値の途切れ（走っているかによらない。画面が消えた・裏に回った）
  tick(t: number) {
    if (this.firstAt === null) {
      if (!this.noneSaid && t - this.startAt >= WAIST.none) {
        this.noneSaid = true
        this.onEvent(t, 'waist: none')
      }
      return
    }
    if (this.gapFrom === null && t - this.lastAt > WAIST.gap) {
      this.gapFrom = this.lastAt
      this.onEvent(t, `waist:gap ${(t - this.lastAt).toFixed(1)}`)
    }
  }

  // 1秒ごとのまとめ。傾きは b からの度（覚える前・値が古いときは null）
  second(t: number): WaistSec {
    const fresh = t - this.lastAt <= WAIST.stale
    const out: WaistSec = { tilt: fresh ? this.d.tilt() : null, g: fresh ? this.d.dir() : null, n: this.n }
    this.n = 0
    return out
  }

  stop() {
    this.off()
  }
}
