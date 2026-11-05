import type { Level } from '../../core/level'
import { PHRASES } from '../../core/phrases'
import type { SensorLog } from '../../core/types'
import { sensors } from './ble'
import { MotionGate } from './gate'
import { GpsLatest, watchGps, type GpsFix, type GpsStatus } from './gps'
import { HUNCH, POSE, SENSOR_RUN_SAY, SLOTS, STILL } from './params'
import { SensorSession, type PoseName, type PoseResult } from './session'
import type { CamValues } from './lean'

// 1回の走りの間、センサーを動かす役（トレッドミルのカメラ版・センサーラン・腰スマホで共通）。
// SensorSession（崩れの見分け・知らせ・記録）を HUNCH.tick 秒ごとに動かし、「立った姿勢」と「走っている」を渡す。
//   カメラ版：running にカメラの「走っている」を渡し、立った姿勢はカメラが直立の基準を取ったときに stand を呼ぶ
//   カメラなし（running を渡さない）：センサーの揺れで決める（gate.ts の MotionGate）。
//     立った姿勢（say があるセンサーラン）：2つの立ち方を声で案内し、案内を言い終えてから胸と頭（つながっているもの）が3秒じっとしたら、その3秒で測る。
//       a「いつもの楽な立ち方」→ b「胸を開いて、肩を後ろに引いて、顎を軽く引いて」。a と b の差が小さければ、案内して a から測り直す（POSE.retries 回まで）。
//       使い切ったら、b を立った姿勢にして今までの見方（session.ts の calibrate）。覚えるのは1回だけ（走り出したあとの信号待ちでは覚え直さない）。
//       胸のセンサーは付けるたびに角度が変わるので、決まった線ではなく、その日の2つの立ち方を物差しにする（lean.ts の setPoses）
//     say がない（腰スマホ）：今までどおり、胸と頭が3秒じっとしたら、その3秒を立った姿勢として覚える（猫背のまま立つと、猫背の走りを基準にしてしまう）
//     走っている：揺れが RUN_GATE の線を3秒越えたら走り出し、4秒下回ったら止まった。止まっている間は知らせない
//   say を渡すと、立つ案内と待つ案内を声で言う（センサーラン。腰スマホはスマホ版の声があるので渡さない）
//   gps を渡すと（センサーラン）、位置情報の速さと高さを1秒ごとのまとめに残す（gps.ts。知らせには使わない。使えないブラウザでは events に gps: none）

export type SensorRunPhase = 'stand' | 'ready' | 'run' | 'stop'

export interface SensorRunnerOptions {
  onEvent: (t: number, text: string) => void // できごとを記録の events に残す
  level?: Level // 胸の線のレベル
  voice?: boolean // 接地の知らせを声でも言う（トレッドミルのカメラ版だけ。外は振動だけ）
  running?: () => boolean // カメラの「走っている」。渡さなければセンサーで見分ける
  camera?: () => CamValues | null // カメラ版：いまのカメラの上体と頭の位置（胸のずれの見分けに使う。lean.ts）。なければ null
  say?: (text: string) => void // カメラなしの案内を声で言う
  speaking?: () => boolean // 声を話している（待っている）間か。立った姿勢は、言い終えてから STILL.sec 秒じっとしたぶんで覚える
  onChange?: () => void // 段階が変わった・位置情報の様子が変わった（画面を直す）
  // 位置情報を受け取る（カメラなしのときだけ。腰スマホはスマホ版が自分で受け取るので渡さない）。watch：テストで差し替える受け口（なければブラウザの位置情報）
  gps?: boolean | typeof watchGps
  onGps?: (f: GpsFix) => void // 位置が届くたび（センサーの速さの見積もりを GPS に合わせるときの口。いまは記録に残すだけ）
}

const now = () => performance.now() / 1000
const GAP = 2 // tick の間がこれ（秒）よりあいたら、止まっていたとみて events に残す（画面を消した・裏に回したときに、何が止まるかを記録で確かめるため）

export class SensorRunner {
  readonly session: SensorSession
  readonly gate: MotionGate | null
  phase: SensorRunPhase
  stoodAt: number | null = null // 立った姿勢を覚えた t
  runSec = 0 // 走っていた時間（秒）
  gaps = 0 // tick が GAP 秒より止まった回数
  trunk = false // 胸か頭が一度でもつながっていた（立った姿勢が要った）
  stage: PoseName = 'a' // 2つの立ち方のどちらを測っているか（センサーラン）
  poseResult: PoseResult | null = null // 2つの立ち方で決めた結果
  gpsStatus: GpsStatus | null = null // 位置情報の様子（gps を渡したときだけ。none＝使えないブラウザ）
  private gps: GpsLatest | null = null
  private offGps: () => void = () => {}
  private timer: ReturnType<typeof setInterval>
  private offPacket: () => void = () => {}
  private onVisible: () => void
  private lastTick: number
  private lastSay: number
  private started = false // 一度でも走り出した
  private quietSince: number | null = null // 案内の声が終わった t
  private wasRunning = false
  private closed = false
  private result: SensorLog | undefined
  private readonly o: SensorRunnerOptions

  constructor(o: SensorRunnerOptions) {
    this.o = o
    this.session = new SensorSession(o.onEvent, o.level)
    this.session.voice = !!o.voice
    this.gate = o.running ? null : new MotionGate()
    const t0 = now()
    this.lastTick = t0
    // 走る前に「まとめてつなぐ」で起きたこと（Bluefy でどう動いたかを、送った記録で確かめるため。ble.ts の diag）
    for (const d of sensors.diag) o.onEvent(t0, `sensor:ble ${d.text}（${Math.round(t0 - d.t)}秒前）`)
    this.lastSay = -Infinity
    this.phase = this.gate && this.needsStand() ? 'stand' : 'ready'
    if (this.gate) {
      const gate = this.gate
      this.offPacket = sensors.onPacket((node, t, p) => {
        const place = SLOTS[node]?.place
        if (place) for (const s of p.samples) gate.sample(place, t, s.a, s.g)
      })
    }
    this.onVisible = () => o.onEvent(now(), `sensor:visible ${document.visibilityState}`)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible)
    // 位置情報（センサーラン）：速さと高さを1秒ごとのまとめに残す。様子が変わったら events に gps: on / none / denied / error <code>
    if (o.gps && this.gate) {
      const gps = new GpsLatest()
      this.gps = gps
      const watch = typeof o.gps === 'function' ? o.gps : watchGps
      this.offGps = watch(
        (f) => {
          gps.fix(f)
          o.onGps?.(f)
        },
        (s, code) => {
          if (s === this.gpsStatus) return
          this.gpsStatus = s
          o.onEvent(now(), `gps: ${s}${code !== undefined ? ` ${code}` : ''}`)
          o.onChange?.()
        },
      )
    }
    this.timer = setInterval(() => this.tick(now()), HUNCH.tick * 1000)
  }

  // 胸か頭がつながっている（立った姿勢が要る）
  private needsStand() {
    const on = sensors.snapshot().some((v) => v.status === 'connected' && STILL.places.includes(v.place))
    if (on) this.trunk = true
    return on
  }

  // カメラ版：カメラが直立の基準を取り終えた t。止まっていた最後の sec 秒で覚える（2つの立ち方を使わないとき）
  stand(t: number, sec: number) {
    if (this.session.stand(t, sec)) this.stoodAt = t
  }

  // 2つの立ち方の1つを測り終えた t（カメラ版はカメラの3秒、センサーランはじっとした3秒）。cam：カメラ版のその3秒の上体と頭の位置
  pose(which: PoseName, t: number, sec: number, cam: CamValues | null = null): boolean {
    return this.session.pose(which, t, sec, cam)
  }

  // a と b を測り終えた t。final：もう測り直さない。retry なら、呼ぶ側が案内して a から測り直す。そうでなければ立った姿勢を覚えた
  calibrate(t: number, final: boolean): PoseResult {
    const r = this.session.calibrate(t, final)
    this.poseResult = r
    if (!r.retry && r.parts.some((p) => p.mode !== 'none')) this.stoodAt = t
    return r
  }

  // HUNCH.tick 秒ごと（テストでは直接呼ぶ）
  tick(t: number) {
    if (t - this.lastTick > GAP) {
      this.gaps++
      this.o.onEvent(t, `sensor:gap ${(t - this.lastTick).toFixed(1)}`)
    }
    const dt = Math.max(0, Math.min(1, t - this.lastTick))
    this.lastTick = t
    const running = this.o.running ? this.o.running() : this.autoTick(t)
    if (running) this.runSec += dt
    this.session.tick(t, running, this.o.camera?.() ?? null, this.gps?.at(t) ?? null)
  }

  // カメラなし：立った姿勢と走っているかを、センサーで決める
  private autoTick(t: number): boolean {
    const gate = this.gate!
    const running = gate.update(t)
    if (running !== this.wasRunning) {
      this.wasRunning = running
      this.o.onEvent(t, `sensor:run ${running ? 'on' : 'off'}${gate.last.place ? ` ${gate.last.place} ${gate.last.std?.toFixed(2)}` : ''}`)
      if (running) this.started = true
    }
    // 立った姿勢：まだ覚えていなくて、止まっている間に胸と頭が3秒じっとしたら測る
    // 案内を聞いている間に姿勢を直すので、言い終える前の3秒は使わない
    if (this.o.speaking?.()) this.quietSince = null
    else this.quietSince ??= t
    const quiet = this.quietSince !== null && t - this.quietSince >= STILL.sec
    const two = !!this.o.say // センサーラン：2つの立ち方。腰スマホ：今までどおり1つ
    if (this.stoodAt === null && !running && quiet && gate.still(t)) {
      if (!two) {
        if (this.session.stand(t, STILL.sec)) {
          this.stoodAt = t
          this.o.onEvent(t, 'sensor:autoStand')
        }
      } else if (this.session.pose(this.stage, t, STILL.sec)) {
        // 次の姿勢は、次の案内を言い終えてから測る（同じ3秒を使わない）
        this.quietSince = null
        if (this.stage === 'a') {
          this.setStage('b')
          this.speak(t, PHRASES.poseOpen)
        } else {
          const r = this.calibrate(t, this.session.poseTries >= POSE.retries)
          this.setStage('a')
          if (r.retry) {
            this.speak(t, PHRASES.poseRetry)
            this.speak(t, PHRASES.poseHabit)
          } else {
            this.o.onEvent(t, 'sensor:autoStand')
            const chest = r.parts.find((p) => p.mode !== 'none')
            if (!this.started) this.speak(t, chest?.mode === 'fallback' ? PHRASES.poseSmall : PHRASES.poseDone)
          }
        }
      }
    }
    // 案内（声）：立つ前は、いま測る立ち方（言い直しも）、覚えてから走り出すまでは「走り出すと始まります」。走り出したあとは言わない
    if (!running && !this.started) {
      if (this.stoodAt === null && this.needsStand()) {
        if (t - this.lastSay >= SENSOR_RUN_SAY.standRepeat) this.speak(t, !two ? PHRASES.baseStand : this.stage === 'a' ? PHRASES.poseHabit : PHRASES.poseOpen)
      } else if (t - this.lastSay >= SENSOR_RUN_SAY.waitRepeat) this.speak(t, PHRASES.waitRun)
    }
    const phase: SensorRunPhase = running ? 'run' : this.started ? 'stop' : this.stoodAt === null && this.needsStand() ? 'stand' : 'ready'
    if (phase !== this.phase) {
      this.phase = phase
      this.o.onChange?.()
    }
    return running
  }

  private setStage(s: PoseName) {
    if (s === this.stage) return
    this.stage = s
    this.o.onChange?.()
  }

  private speak(t: number, text: string) {
    this.lastSay = t
    if (!this.o.say) return
    this.o.say(text)
    this.o.onEvent(t, text)
  }

  // 走っている途中の記録（端末へ少しずつ書き出すため）
  current(): SensorLog | undefined {
    return this.session.current()
  }

  // 走り終わり。記録をまとめて返す（値が1つも届かなかったら undefined）。2回目からは同じものを返す
  finish(): SensorLog | undefined {
    if (this.closed) return this.result
    this.closed = true
    clearInterval(this.timer)
    this.offPacket()
    this.offGps() // 位置情報も止める（電池）
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible)
    this.result = this.session.finish()
    return this.result
  }
}
