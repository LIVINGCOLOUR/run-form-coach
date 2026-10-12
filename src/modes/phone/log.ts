import type { CoachState } from '../../core/engine'
import type { PhoneSample } from './analyzer'
import type { Estimate, PhoneMeasure } from './signal'
import type { MountFeatures } from './mount'

// スマホ版の調整用の記録。センサーの生の値（届いたコマすべて）と、1秒ごとの判定の値を残す
// 書き出したファイルを、トレッドミルで同時に撮ったカメラ版の記録と時刻で合わせて比べる（作る順番の2）
//
// 時刻は2つ持つ：
//   t：performance.now() の秒（この記録の中の並びと間隔に使う。カメラ版の記録の t と同じ時計）
//   wallMs：ふつうの時刻（1970年からのミリ秒）。clock の2つの値から t を直したもので、別の端末の記録と合わせるのに使う
//     wallMs = clock.epochMs + (t × 1000 − clock.perfMs)

export const PHONE_RAW_COLUMNS = ['t', 'wallMs', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'state'] as const
export const PHONE_SECOND_COLUMNS = [
  't', 'wallMs', 'sec', 'cadence', 'bounceCm', 'brakingMs', 'regularity', 'accRms', 'score', 'quiet', 'mount',
  'vCadence', 'vBounce', 'vBraking', 'stepHz', 'gravity', 'gyroSwing', 'gyroHf', 'upX', 'upY', 'upZ',
] as const
// state の列の数字（しくみの状態）。mount の列の数字（付け方の問題）
export const PHONE_STATES: readonly CoachState[] = ['waiting', 'running', 'paused', 'ended']
export const PHONE_MOUNTS = [null, 'notWaist', 'loose', 'shifted'] as const

// 生の値は長く走ると多くなるので、ここまでで止める（毎秒60回で約110分）
const MAX_RAW = 400000

export interface PhoneLog {
  id: string
  mode: 'phone'
  startedAt: number // ふつうの時刻（ms）
  clock: { perfMs: number; epochMs: number } // 同じ瞬間の performance.now() と Date.now()
  device: { userAgent: string; intervalMs: number | null; gyro: boolean; sim?: number } // sim：模擬データで試したときの速さ（倍）
  units: Record<string, string>
  columns: readonly string[]
  rows: (number | null)[][] // 生の値（PHONE_RAW_COLUMNS）
  secondColumns: readonly string[]
  seconds: (number | null)[][] // 1秒ごとの判定の値（PHONE_SECOND_COLUMNS）。測れなかった値は null
  events: [number, string][] // [t, 話した言葉やしくみの状態の切り替え]
  truncated?: boolean // 生の値が多すぎて途中で止めた
  sessionId?: string
}

const UNITS = {
  t: '秒（performance.now）',
  wallMs: 'ふつうの時刻（ms）',
  'ax,ay,az': 'm/s²。重力を含む加速度（accelerationIncludingGravity、スマホの座標）',
  'gx,gy,gz': 'rad/s。角速度（rotationRate を deg/s から直した。gx=beta、gy=gamma、gz=alpha）。取れないときは null',
  state: `しくみの状態（${PHONE_STATES.map((s, i) => `${i}=${s}`).join('、')}）`,
  sec: '走っていた秒（一時停止中は進まない。結果の画面の時間）',
  'cadence,bounceCm,brakingMs': '歩/分・cm・m/s。その秒の直近4秒から出した値',
  'vCadence,vBounce,vBraking': '線と比べた値（走り始めからのピッチの下がり %・上下動の増え cm・ブレーキの増え m/s）。判定しない秒は null',
  mount: `付け方の問題（${PHONE_MOUNTS.map((s, i) => `${i}=${s ?? 'なし'}`).join('、')}）`,
  'stepHz,gravity,gyroSwing,gyroHf,upX,upY,upZ': '付け方の確認の手がかり（mount.ts の MountFeatures）',
  events: '話した言葉、state:状態（しくみの状態の切り替え）、tone:on:項目:テンポ（歩/分）・tone:off:項目（メトロノームを鳴らす・止める）、ref:later:ピッチ（基準を5〜12分の平均に置き換えた）',
}

const r = (x: number, k: number) => Math.round(x * k) / k
const n = (x: number | null | undefined, k: number) => (x === null || x === undefined || !Number.isFinite(x) ? null : r(x, k))

export class PhoneLogRecorder {
  log: PhoneLog
  constructor(clock: { perfMs: number; epochMs: number }, device: Omit<PhoneLog['device'], 'gyro'>) {
    this.log = {
      id: `phone-log-${clock.epochMs}`,
      mode: 'phone',
      startedAt: clock.epochMs,
      clock,
      device: { ...device, gyro: false },
      units: UNITS,
      columns: PHONE_RAW_COLUMNS,
      rows: [],
      secondColumns: PHONE_SECOND_COLUMNS,
      seconds: [],
      events: [],
    }
  }

  wallMs(t: number): number {
    return Math.round(this.log.clock.epochMs + (t * 1000 - this.log.clock.perfMs))
  }

  raw(m: PhoneMeasure, state: CoachState) {
    if (this.log.rows.length >= MAX_RAW) {
      this.log.truncated = true
      return
    }
    if (m.gx !== undefined) this.log.device.gyro = true
    // 角速度がないコマは null にする
    this.log.rows.push([r(m.t, 1000), this.wallMs(m.t), r(m.ax, 1000), r(m.ay, 1000), r(m.az, 1000), n(m.gx, 10000), n(m.gy, 10000), n(m.gz, 10000), PHONE_STATES.indexOf(state)])
  }

  second(t: number, s: PhoneSample, est: Estimate | null, x: MountFeatures | null) {
    this.log.seconds.push([
      r(t, 1000), this.wallMs(t), s.t,
      n(s.cadence, 10), n(s.bounceCm, 100), n(s.brakingMs, 1000), n(est?.regularity, 1000), n(est?.accRms, 100),
      s.score, s.quiet ? 1 : 0, PHONE_MOUNTS.indexOf(s.mount),
      n(s.values.cadence, 100), n(s.values.bounce, 100), n(s.values.braking, 1000),
      n(x?.stepHz, 1000), n(x?.gravity, 100), n(x?.gyroSwing, 1000), n(x?.gyroHf, 1000), n(x?.up[0], 1000), n(x?.up[1], 1000), n(x?.up[2], 1000),
    ])
  }

  event(t: number, text: string) {
    this.log.events.push([r(t, 1000), text])
  }
}
