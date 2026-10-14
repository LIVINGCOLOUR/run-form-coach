import type { CoachState } from '../../core/engine'
import type { PhoneSample } from './analyzer'
import type { Estimate, PhoneMeasure } from './signal'
import type { MountFeatures } from './mount'
import type { FatigueResult } from './fatigue'
import { SPEED_GATES, type FixOut, type GpsFix } from './speed'

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
  'vCadence', 'vBounce', 'vBraking', 'stepHz', 'gravity', 'gyroSwing', 'gyroHf', 'upX', 'upY', 'upZ', 'speed', 'gate',
  'brakingFixed', 'gyroLevel', 'apRegularity', 'ratioV', 'ratioAP', 'ratioML', 'contactMs',
] as const
// 位置が届くたびの1行（外だけ）。位置そのもの（緯度・経度）は残さない（家の場所が分かるため）。速さは前の点からの距離で出し直せる
export const PHONE_GPS_COLUMNS = ['t', 'wallMs', 'accuracy', 'speedDevice', 'stepM', 'raw', 'speed', 'used', 'altitude', 'altitudeAccuracy'] as const
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
  where?: 'outdoor' | 'treadmill' // 外（GPS の速さで判定を止める）か、トレッドミル（速さは一定とみなす）か
  units: Record<string, string>
  columns: readonly string[]
  rows: (number | null)[][] // 生の値（PHONE_RAW_COLUMNS）
  secondColumns: readonly string[]
  seconds: (number | null)[][] // 1秒ごとの判定の値（PHONE_SECOND_COLUMNS）。測れなかった値は null
  events: [number, string][] // [t, 話した言葉やしくみの状態の切り替え]
  gpsColumns?: readonly string[]
  gps?: (number | null)[][] // 位置が届くたびの値（PHONE_GPS_COLUMNS）。外だけ
  truncated?: boolean // 生の値が多すぎて途中で止めた
  fatigue?: FatigueResult | null // 疲れの見分けの結果（走り終わったときに fatigue.ts で出す）。基準を作れなければ null
  sessionId?: string
}

const UNITS = {
  t: '秒（performance.now）',
  wallMs: 'ふつうの時刻（ms）',
  'ax,ay,az': 'm/s²。重力を含む加速度（accelerationIncludingGravity、スマホの座標）',
  'gx,gy,gz': 'rad/s。角速度（rotationRate を deg/s から直した。gx=beta、gy=gamma、gz=alpha）。取れないときは null',
  state: `しくみの状態（${PHONE_STATES.map((s, i) => `${i}=${s}`).join('、')}）`,
  sec: '走っていた秒（一時停止中は進まない。結果の画面の時間）',
  'cadence,bounceCm,brakingMs': '歩/分・cm・m/s。その秒の直近4秒から出した値。brakingMs は、ジャイロがあれば1コマごとに向きを直してから出した値',
  'brakingFixed,gyroLevel': 'm/s。数歩の平均の向きで固定して出したブレーキ（ジャイロで直す前の方法）と、brakingMs をジャイロで直したか（1/0）',
  'regularity,apRegularity': '上下・前後の加速度の、1歩ずらした自己相関（リズムの規則性。疲れの見分けの材料）',
  'ratioV,ratioAP,ratioML': '3方向の揺れの割合（上下・前後・左右のばらつき ÷ 3方向合わせたばらつき）',
  contactMs: 'ms。有効接地時間（上下の加速度が1gを上回っている時間の、1歩ごとの平均。Patoz 2021。本当の接地時間より短く出る）',
  fatigue: '疲れの見分けの結果（fatigue.ts）：基準の区間、1分ごとの「いつもと違う度合い」と上下動・ブレーキ・有効接地時間の変化、崩れ始め（秒）',
  'vCadence,vBounce,vBraking': '線と比べた値（走り始めからのピッチの下がり %・上下動の増え cm・ブレーキの増え m/s）。判定しない秒は null',
  mount: `付け方の問題（${PHONE_MOUNTS.map((s, i) => `${i}=${s ?? 'なし'}`).join('、')}）`,
  'stepHz,gravity,gyroSwing,gyroHf,upX,upY,upZ': '付け方の確認の手がかり（mount.ts の MountFeatures）',
  speed: 'm/s。GPS のならした速さ（外だけ。取れない秒・トレッドミルは null）',
  gate: `速さで判定を止めた理由（${SPEED_GATES.map((s, i) => `${i}=${s ?? '止めていない'}`).join('、')}。noGps=GPS が取れない、noBase=基準の速さを作れなかった、slow・fast=基準の速さから外れた）。トレッドミルは null`,
  'gps:accuracy,speedDevice,stepM,raw,speed,used,altitude,altitudeAccuracy':
    '位置が届くたび（外だけ）：横の誤差 m・端末が出した速さ m/s・前に使った点からの距離 m・ならす前の速さ m/s・ならした速さ m/s・速さに使ったか（1/0）・高さ m・高さの誤差 m',
  events: '話した言葉、state:状態（しくみの状態の切り替え）、tone:on:項目:テンポ（歩/分）・tone:off:項目（メトロノームを鳴らす・止める）、ref:later:ピッチ（基準を5〜12分の平均に置き換えた）、ref:speed:速さ（基準の速さ m/s。作れなければ none）、gate:on:理由・gate:off（速さで判定を止めた・戻した）、kind:practice:何回目:自分のピッチ・kind:test（ピッチを上げる練習・フォームのテストの走り）。練習のメトロノームは tone:on:practice:テンポ。崩しの撮影（drill.ts）は kind:drill:full|short:extra|base|upper（upper は上半身だけ）と、区間の印 protocol:区間:start・protocol:区間:end（jump1・still・jump2 は走る前・あとのジャンプと立つ間）・protocol:stopped（途中でやめた）・protocol:done',
}

const r = (x: number, k: number) => Math.round(x * k) / k
const n = (x: number | null | undefined, k: number) => (x === null || x === undefined || !Number.isFinite(x) ? null : r(x, k))

export class PhoneLogRecorder {
  log: PhoneLog
  constructor(clock: { perfMs: number; epochMs: number }, device: Omit<PhoneLog['device'], 'gyro'>, where: 'outdoor' | 'treadmill' = 'treadmill') {
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
      where,
    }
    if (where === 'outdoor') {
      this.log.gpsColumns = PHONE_GPS_COLUMNS
      this.log.gps = []
    }
  }

  gps(f: GpsFix, o: FixOut) {
    if (!this.log.gps || this.log.gps.length >= MAX_RAW) return
    this.log.gps.push([r(f.t, 1000), this.wallMs(f.t), n(f.accuracy, 10), n(f.speed, 100), n(o.stepM, 100), n(o.raw, 100), n(o.speed, 100), o.used ? 1 : 0, n(f.altitude, 10), n(f.altitudeAccuracy, 10)])
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
      n(s.speed, 100), s.gate === undefined ? null : SPEED_GATES.indexOf(s.gate),
      n(est?.brakingFixed, 1000), est ? (est.gyroLevel ? 1 : 0) : null, n(est?.apRegularity, 1000),
      n(est?.ratioV, 1000), n(est?.ratioAP, 1000), n(est?.ratioML, 1000), n(est?.contactMs, 1),
    ])
  }

  event(t: number, text: string) {
    this.log.events.push([r(t, 1000), text])
  }
}
