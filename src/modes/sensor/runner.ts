import type { Level } from '../../core/level'
import { PHRASES } from '../../core/phrases'
import type { SensorLog } from '../../core/types'
import { sensors } from './ble'
import { MotionGate } from './gate'
import { HUNCH, SENSOR_RUN_SAY, SLOTS, STILL } from './params'
import { SensorSession } from './session'
import type { CamValues } from './lean'

// 1回の走りの間、センサーを動かす役（トレッドミルのカメラ版・センサーラン・腰スマホで共通）。
// SensorSession（崩れの見分け・知らせ・記録）を HUNCH.tick 秒ごとに動かし、「立った姿勢」と「走っている」を渡す。
//   カメラ版：running にカメラの「走っている」を渡し、立った姿勢はカメラが直立の基準を取ったときに stand を呼ぶ
//   カメラなし（running を渡さない）：センサーの揺れで決める（gate.ts の MotionGate）。
//     立った姿勢：胸と頭（つながっているもの）が3秒じっとしたら、その3秒で覚える（覚えるのは1回だけ。走り出したあとの信号待ちでは覚え直さない）。
//     カメラがないので、立った姿勢がまっすぐかは確かめられない（付けるたびにセンサーの角度が変わるので、決まった線と比べられない）。
//     崩れは、その立った姿勢と走り出しの前傾からの増え方で見る。猫背のまま立つと、猫背の走りを基準にしてしまう
//     走っている：揺れが RUN_GATE の線を3秒越えたら走り出し、4秒下回ったら止まった。止まっている間は知らせない
//   say を渡すと、立つ案内と待つ案内を声で言う（センサーラン。腰スマホはスマホ版の声があるので渡さない）

export type SensorRunPhase = 'stand' | 'ready' | 'run' | 'stop'

export interface SensorRunnerOptions {
  onEvent: (t: number, text: string) => void // できごとを記録の events に残す
  level?: Level // 胸の線のレベル
  voice?: boolean // 接地の知らせを声でも言う（トレッドミルのカメラ版だけ。外は振動だけ）
  running?: () => boolean // カメラの「走っている」。渡さなければセンサーで見分ける
  camera?: () => CamValues | null // カメラ版：いまのカメラの上体と頭の位置（胸のずれの見分けに使う。lean.ts）。なければ null
  say?: (text: string) => void // カメラなしの案内を声で言う
  speaking?: () => boolean // 声を話している（待っている）間か。立った姿勢は、言い終えてから STILL.sec 秒じっとしたぶんで覚える
  onChange?: () => void // 段階が変わった（画面を直す）
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
    this.timer = setInterval(() => this.tick(now()), HUNCH.tick * 1000)
  }

  // 胸か頭がつながっている（立った姿勢が要る）
  private needsStand() {
    const on = sensors.snapshot().some((v) => v.status === 'connected' && STILL.places.includes(v.place))
    if (on) this.trunk = true
    return on
  }

  // カメラ版：カメラが直立の基準を取り終えた t。止まっていた最後の sec 秒で覚える
  stand(t: number, sec: number) {
    if (this.session.stand(t, sec)) this.stoodAt = t
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
    this.session.tick(t, running, this.o.camera?.() ?? null)
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
    // 立った姿勢：まだ覚えていなくて、止まっている間に胸と頭が3秒じっとしたら覚える
    // 案内を聞いている間に姿勢を直すので、言い終える前の3秒は使わない
    if (this.o.speaking?.()) this.quietSince = null
    else this.quietSince ??= t
    const quiet = this.quietSince !== null && t - this.quietSince >= STILL.sec
    if (this.stoodAt === null && !running && quiet && gate.still(t) && this.session.stand(t, STILL.sec)) {
      this.stoodAt = t
      this.o.onEvent(t, 'sensor:autoStand')
      if (!this.started) this.speak(t, PHRASES.baseDone)
    }
    // 案内（声）：立つ前は「まっすぐ立って3秒」、覚えてから走り出すまでは「走り出すと始まります」。走り出したあとは言わない
    if (!running && !this.started) {
      if (this.stoodAt === null && this.needsStand()) {
        if (t - this.lastSay >= SENSOR_RUN_SAY.standRepeat) this.speak(t, PHRASES.baseStand)
      } else if (t - this.lastSay >= SENSOR_RUN_SAY.waitRepeat) this.speak(t, PHRASES.waitRun)
    }
    const phase: SensorRunPhase = running ? 'run' : this.started ? 'stop' : this.stoodAt === null && this.needsStand() ? 'stand' : 'ready'
    if (phase !== this.phase) {
      this.phase = phase
      this.o.onChange?.()
    }
    return running
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
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible)
    this.result = this.session.finish()
    return this.result
  }
}
