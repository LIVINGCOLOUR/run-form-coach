import type { SensorWaistLog } from '../../core/types'
import { listenMotion, motionPermission, toMeasure, type MotionLike } from '../phone/sensor'
import type { PhoneMeasure } from '../phone/signal'
import { LeanDetector } from './lean'
import { HUNCH, WAIST, WAIST_SIT } from './params'
import type { Vec3 } from './parse'
import type { PoseName } from './session'
import { median, waistGait, WaistSit, type WaistGait, type WaistSitSec } from './waistSit'

// 腰のスマホ（センサーランで、腰のポーチに入れて持つスマホ）の向きを記録する（数字は params.ts の WAIST）。知らせには使わない。
// 胸のセンサーと同じ見方（lean.ts の LeanDetector：ならした重力の向き、2つの立ち方の b からの傾き）で、スマホの動きのセンサーの値を見る。
//   pose：2つの立ち方の1つを測り終えた t（胸と同じ3秒）。calibrate：a と b を測り終えた t（session.ts の calibrate から）
//   second：1秒ごとのまとめ（傾き・重力の向き・その1秒に届いた値の数）。tick：値の途切れを events に残す
// iPhone のウェブのページは、画面が消える（ロックされる）と動きのセンサーの値が来なくなる。途切れは waist:gap / waist:back で正直に残す（埋めない）
// 許可（iPhone）は、ホームの「はじめる」を押したときに求める（phone/sensor.ts の requestMotionPermission）。結果は events の waist:permission
// 腰落ち（記録だけ。開発中）：直近 WAIST_SIT.window 秒の値（角速度も）から、1秒ごとにピッチ・上下動・有効接地時間・接地の割合・上下の加速度の山を出し、
//   waistSit.ts の WaistSit で、同じ速さのふつうの走りと比べる（events の waist:ref・waist:sit・waist:sitOk）
// テスト期間：届いた値すべて（t・加速度・角速度）を WAIST_RAW_COLUMNS の行で残す（session.ts が記録の sensors.waistRaw へ移す。60秒ごとに端末へ書き出す）
export type WaistSec = { tilt: number | null; g: Vec3 | null; n: number; gait: WaistGait | null; sit: WaistSitSec | null }
// 1秒ごとのまとめに渡す、そのときの走りのようす。running：走っているか。chestOver：胸の猫背の見張りが線を越えているか。
// v：いまの速さ（km/h。足首のセンサーの見積もり、なければ GPS。分からなければ null）
export type WaistCtx = { running: boolean; chestOver: boolean; v: number | null }

// 腰のスマホの生の値の列（スマホ版の PHONE_RAW_COLUMNS から、ふつうの時刻と状態を抜いたもの。ふつうの時刻は記録の clock で直せる）
export const WAIST_RAW_COLUMNS = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const
// 記録（SensorLog）に足す欄。core/types.ts の SensorLog にはまだない（センサーランの腰のスマホだけ）
export type WaistRawLog = { waistRawCols?: readonly string[]; waistRaw?: (number | null)[][] }

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
  private buf: PhoneMeasure[] = [] // 直近 WAIST_SIT.window 秒の値
  private raw: (number | null)[][] = [] // まだ記録へ移していない生の値
  private vs: { t: number; v: number }[] = [] // 直近 WAIST_SIT.speedSec 秒の速さ
  readonly sit = new WaistSit((t, text) => this.onEvent(t, text))

  // listen：動きのセンサーの受け口（テストで差し替える）。now：いまの t（秒、performance.now() の時計）
  constructor(onEvent: (t: number, text: string) => void, listen: (cb: (e: MotionLike) => void) => () => void = listenMotion, now = () => performance.now() / 1000) {
    this.onEvent = onEvent
    this.startAt = now()
    if (motionPermission) onEvent(this.startAt, `waist:permission ${motionPermission}`)
    this.off = listen((e) => {
      const m = toMeasure(e, now())
      if (m) this.sample(m.t, [m.ax, m.ay, m.az], m.gx === undefined ? undefined : [m.gx, m.gy!, m.gz!])
    })
  }

  // a：重力を含む加速度（m/s²）。w：角速度（rad/s。取れなければ undefined）
  sample(t: number, a: Vec3, w?: Vec3) {
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
    const m: PhoneMeasure = { t, ax: a[0], ay: a[1], az: a[2], ...(w && { gx: w[0], gy: w[1], gz: w[2] }) }
    this.buf.push(m)
    while (this.buf.length && t - this.buf[0].t > WAIST_SIT.window) this.buf.shift()
    const r = (x: number, k: number) => Math.round(x * k) / k
    this.raw.push([r(t, 1000), r(a[0], 1000), r(a[1], 1000), r(a[2], 1000), w ? r(w[0], 10000) : null, w ? r(w[1], 10000) : null, w ? r(w[2], 10000) : null])
  }

  // まだ記録へ移していない生の値を渡して、手元から消す（記録がまだなければ、呼ぶ側が捨てる）
  takeRaw(): (number | null)[][] {
    return this.raw.splice(0, this.raw.length)
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

  // 1秒ごとのまとめ。傾きは b からの度（覚える前・値が古いときは null）。ctx を渡すと、腰落ちの値も出す（記録だけ）
  second(t: number, ctx?: WaistCtx): WaistSec {
    const fresh = t - this.lastAt <= WAIST.stale
    let gait: WaistGait | null = null
    let sit: WaistSitSec | null = null
    if (ctx) {
      if (ctx.running && ctx.v !== null && Number.isFinite(ctx.v)) this.vs.push({ t, v: ctx.v })
      while (this.vs.length && t - this.vs[0].t > WAIST_SIT.speedSec) this.vs.shift()
      const v = this.vs.length ? median(this.vs.map((x) => x.v)) : null
      // 窓の値が途切れていたら（画面が消えた）出さない
      gait = fresh && this.buf.length && t - this.buf[0].t >= WAIST_SIT.window - WAIST.gap ? waistGait(this.buf) : null
      sit = this.sit.second(t, gait, ctx.running, ctx.chestOver, v)
    }
    const out: WaistSec = { tilt: fresh ? this.d.tilt() : null, g: fresh ? this.d.dir() : null, n: this.n, gait, sit }
    this.n = 0
    return out
  }

  stop() {
    this.off()
  }
}
