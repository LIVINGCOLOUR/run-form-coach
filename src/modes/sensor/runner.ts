import type { Level } from '../../core/level'
import { PHRASES } from '../../core/phrases'
import type { SensorLog } from '../../core/types'
import { describeError, sensors } from './ble'
import { MotionGate } from './gate'
import { GpsLatest, watchGps, type GpsFix, type GpsStatus } from './gps'
import { HeartLatest, type HeartSource, type HeartStatus } from './heart'
import { HUNCH, POSE, SENSOR_RUN_SAY, SLOTS, STILL } from './params'
import { SensorSession, type PoseName, type PoseResult } from './session'
import type { CamValues } from './lean'
import { WaistPhone } from './waist'
import { lowBattery, noticeText, SensorWatch } from './notice'

// 1回の走りの間、センサーを動かす役（トレッドミルのカメラ版・センサーラン・腰スマホで共通）。
// SensorSession（崩れの見分け・知らせ・記録）を HUNCH.tick 秒ごとに動かし、「立った姿勢」と「走っている」を渡す。
//   カメラ版：running にカメラの「走っている」を渡し、立った姿勢はカメラが直立の基準を取ったときに stand を呼ぶ
//   カメラなし（running を渡さない）：センサーの揺れで決める（gate.ts の MotionGate）。
//     立った姿勢（say があるセンサーラン）：2つの立ち方を声で案内し、案内を言い終えてから胸と頭（つながっているもの）が3秒じっとしたら、その3秒で測る。
//       a「いつもの楽な立ち方」→ b「胸を開いて、肩を後ろに引いて、顎を軽く引いて」。a と b の差が小さければ、案内して a から測り直す（POSE.retries 回まで）。
//       使い切ったら、b を立った姿勢にして今までの見方（session.ts の calibrate）。覚えるのは1回だけ（走り出したあとの信号待ちでは覚え直さない）。
//       胸のセンサーは付けるたびに角度が変わるので、決まった線ではなく、その日の2つの立ち方を物差しにする（lean.ts の setPoses）
//     say がない（腰スマホ）：今までどおり、胸と頭が3秒じっとしたら、その3秒を立った姿勢として覚える（猫背のまま立つと、猫背の走りを基準にしてしまう）
//     走っている：揺れが RUN_GATE の線を3秒越えたら走り出し、4秒下回ったら止まった。止まっている間は知らせない。
//       決めるのはセンサーの加速度の揺れだけ（胸 → 頭 → 足首。gate.ts）。位置情報（GPS）は使わないので、トレッドミルでも走り出しが分かる
//       say があれば、最初に走り出したときだけ「始めます」と言う（走り直しでは言わない）
//   say を渡すと、立つ案内と待つ案内を声で言う（センサーラン。腰スマホはスマホ版の声があるので渡さない）
//   gps を渡すと（センサーラン）、位置情報の速さと高さを1秒ごとのまとめに残す（gps.ts。知らせには使わない。使えないブラウザでは events に gps: none）
//   waist を渡すと（センサーラン）、腰のポーチに入れたこのスマホの向きを、2つの立ち方とあわせて記録する（waist.ts。知らせには使わない）
//   heart を渡すと（センサーラン）、心拍計の心拍を1秒ごとのまとめ（sec の hr）に、RR 間隔を sensors.hrRR に残す（heart.ts。記録だけで、知らせ・声には使わない）。
//     つながった・切れた・戻った・つないでいない・使えないを events に hr: on / lost / back / off / error / none で、つなぎ方で起きたことを hr:ble で残す。
//     走っていた間の平均と最大の心拍は、結果の画面のため summary.hr に（runLog.ts。この走りで一度でもつながったときだけ）
//   belt を渡すと、ベルトの速さ（トレッドミル）を胸の正しい前傾の速さに使う（session.ts。なければ足首のセンサーの見積もり）
//   カメラなしでは、付けているセンサーの途切れを見張る（notice.ts の SensorWatch）。say があれば（センサーラン）声で知らせる：
//     走り始めに、つながっていない場所を「頭のセンサーがつながっていません」（ポーチに入れる間のあと、立ち方の案内の前に）、
//     走っている間に SENSOR_NOTICE.after 秒より値が来なければ「…切れました」、また来たら「…戻りました」。
//     声は1つずつ、ほかの声を話していないときに言う（立ち方を測るのは、言い終えてから。core/voice.ts の voicePending）。途切れの回数と秒は結果の画面へ（runLog.ts の summary）

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
  belt?: () => number | undefined // ベルトの速さ（時速 km。入れていなければ undefined）
  waist?: boolean | WaistPhone // 腰のスマホの向きを記録する（センサーラン。テストでは受け口を差し替えたものを渡す）
  heart?: HeartSource // 心拍計（センサーラン。heart.ts の heart。テストでは差し替える）。記録だけ
}

// 結果の画面に出す心拍（走っていた間。拍/分。走っている間に心拍が届かなければ null）。sec：走っていて心拍があった秒、lost：途中で切れた回数
export type HeartSummary = { avg: number | null; max: number | null; sec: number; lost: number }

// 心拍計の様子を events の言葉にする（connecting は残さない）
const HEART_WORD: Record<HeartStatus, string | null> = { none: 'none', idle: 'off', connecting: null, connected: 'on', lost: 'lost', error: 'error' }

const now = () => performance.now() / 1000
const ERRORS_LOGGED = 3 // tick の中で起きたエラーを events に残す数（0.1秒ごとに同じエラーをくり返すので、はじめの数回だけ）
const GAP = 2 // tick の間がこれ（秒）よりあいたら、止まっていたとみて events に残す（画面を消した・裏に回したときに、何が止まるかを記録で確かめるため）

export class SensorRunner {
  readonly session: SensorSession
  readonly gate: MotionGate | null
  phase: SensorRunPhase
  stoodAt: number | null = null // 立った姿勢を覚えた t
  runSec = 0 // 走っていた時間（秒）
  gaps = 0 // tick が GAP 秒より止まった回数
  errors = 0 // tick の中で起きたエラーの数
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
  private readonly t0: number // 始めた t（センサーランは、ここから SENSOR_RUN_SAY.pouch 秒はポーチに入れる間）
  private lastSay: number
  private started = false // 一度でも走り出した
  // センサーラン：2つの立ち方を測り終える前に走り出したら、止まったときに a の案内から測り直す。
  // laterSaid：「立ち方をまだ測っていません…」を言った。armed：いま測ってよい（その止まりで a の案内を言った。走り出す前は、はじめから測ってよい）
  private laterSaid = false
  private armed = true
  private quietSince: number | null = null // 案内の声が終わった t
  private wasRunning = false
  private closed = false
  private result: SensorLog | undefined
  private diagSeen: number // ble.ts の diag のうち、もう events に移した行の数（diagTotal）
  readonly watch: SensorWatch | null // 付けているセンサーの途切れ（カメラなしのときだけ）
  private notices: string[] = [] // まだ言っていない、センサーの途切れの知らせ（センサーランだけ）
  private readonly o: SensorRunnerOptions
  // 心拍計（heart を渡したときだけ）
  private hr: HeartLatest | null = null
  private hrStatus: HeartStatus | null = null
  private hrEver = false // この走りで一度でもつながった
  private hrLost = 0
  private hrSum = 0 // 走っていた間の 心拍 × 秒
  private hrSec = 0
  private hrMax: number | null = null
  private hrDiagSeen = 0
  private offHeart: () => void = () => {}

  constructor(o: SensorRunnerOptions) {
    this.o = o
    this.session = new SensorSession(o.onEvent, o.level, { belt: o.belt, waist: o.waist instanceof WaistPhone ? o.waist : o.waist ? new WaistPhone(o.onEvent) : null })
    this.session.voice = !!o.voice
    this.gate = o.running ? null : new MotionGate()
    const t0 = now()
    this.t0 = t0
    this.lastTick = t0
    // 走る前に「まとめてつなぐ」で起きたこと（Bluefy でどう動いたかを、送った記録で確かめるため。ble.ts の diag）
    for (const d of sensors.diag) o.onEvent(t0, `sensor:ble ${d.text}（${Math.round(t0 - d.t)}秒前）`)
    this.diagSeen = sensors.diagTotal
    // 付けているはずなのに、つながっていない場所（自動のつなぎ直しにしくじったなど。走っている間は画面を見ないので、記録で分かるように）
    for (const v of sensors.snapshot()) if (v.name && v.status !== 'connected') o.onEvent(t0, `sensor:missing ${v.place} ${v.status}`)
    this.lastSay = -Infinity
    this.phase = this.gate && this.needsStand() ? 'stand' : 'ready'
    this.watch = this.gate ? new SensorWatch(sensors.snapshot(), t0) : null
    // センサーラン：つながっていない場所と、電池が少ない場所を、立ち方の案内の前に言う
    if (this.watch && o.say) {
      this.notices.push(...this.watch.missingAtStart.map((place) => noticeText(place, 'missing')))
      this.notices.push(...lowBattery(sensors.snapshot()).map((place) => noticeText(place, 'battery')))
    }
    if (this.gate) {
      const gate = this.gate
      const watch = this.watch!
      this.offPacket = sensors.onPacket((node, t, p) => {
        const place = SLOTS[node]?.place
        if (place) for (const s of p.samples) gate.sample(place, t, s.a, s.g)
        const back = watch.packet(node, t)
        if (back && o.say) this.notices.push(back)
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
    if (o.heart) this.startHeart(o.heart, t0)
    this.timer = setInterval(() => this.tick(now()), HUNCH.tick * 1000)
  }

  // 心拍計：走る前に起きたこと（hr:ble）と、いまの様子（hr: on / off / none …）を残し、心拍を受け取り始める
  private startHeart(h: HeartSource, t0: number) {
    const hr = new HeartLatest()
    this.hr = hr
    for (const d of h.diag) this.o.onEvent(t0, `hr:ble ${d.text}（${Math.round(t0 - d.t)}秒前）`)
    this.hrDiagSeen = h.diagTotal
    this.heartChanged(h, t0, false) // 作っている途中なので、画面には知らせない（呼ぶ側の runner がまだない）
    const offRead = h.onReading((r) => hr.fix(r))
    const offStatus = h.subscribe(() => this.heartChanged(h, now()))
    this.offHeart = () => {
      offRead()
      offStatus()
    }
  }

  // 様子が変わったときだけ events に残す。切れたあとにつながったら back（戻った）。tell：画面に知らせる（onChange）
  private heartChanged(h: HeartSource, t: number, tell = true) {
    const v = h.snapshot()
    if (v.status === this.hrStatus) return
    const word = HEART_WORD[v.status]
    if (!word) return // つないでいる途中は残さない（つながった・つなげなかったで残す）
    const was = this.hrStatus
    this.hrStatus = v.status
    if (v.status === 'connected') {
      this.o.onEvent(t, `hr: ${this.hrEver && was === 'lost' ? 'back' : 'on'}${v.name ? ` ${v.name}` : ''}`)
      this.hrEver = true
    } else {
      if (v.status === 'lost') this.hrLost++
      this.o.onEvent(t, `hr: ${word}${v.status === 'error' ? ` ${v.message}` : ''}`)
    }
    if (tell) this.o.onChange?.()
  }

  // 結果の画面のため（runLog.ts の summary.hr）。この走りで心拍計が一度もつながらなければ undefined
  heartSummary(): HeartSummary | undefined {
    if (!this.hrEver) return undefined
    const s = this.hrSec
    return { avg: s > 0 ? Math.round(this.hrSum / s) : null, max: this.hrMax, sec: Math.round(s), lost: this.hrLost }
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
      this.watch?.appGap(t) // アプリが止まっていた間は、センサーの途切れに数えない
    }
    const dt = Math.max(0, Math.min(1, t - this.lastTick))
    this.lastTick = t
    this.flushDiag(t)
    // エラーは events に残す（setInterval の中で投げると、画面にも記録にも出ないまま、毎回そこから先が動かなくなるため）
    try {
      const running = this.o.running ? this.o.running() : this.autoTick(t)
      if (running) this.runSec += dt
      // 心拍（記録だけ）：走っていた間の平均と最大を数え、1秒ごとのまとめと RR 間隔は session に渡す
      const bpm = this.hr?.at(t) ?? null
      if (running && bpm !== null) {
        this.hrSum += bpm * dt
        this.hrSec += dt
        this.hrMax = Math.max(this.hrMax ?? 0, bpm)
      }
      this.session.tick(t, running, this.o.camera?.() ?? null, this.gps?.at(t) ?? null, this.hr ? { bpm, rr: this.hr.takeRR() } : null)
    } catch (e) {
      if (this.errors++ < ERRORS_LOGGED) this.o.onEvent(t, `sensor:error ${describeError(e)}`)
    }
  }

  // 走っている間に ble.ts の diag に増えた行（途中で切れたセンサーのつなぎ直し・つなげなかった理由）も、events に sensor:ble で残す
  // （前は走り始めの分だけで、途中でつなぎ直せなかった理由が記録に残らなかった）
  // 心拍計の diag（heart.ts）も同じく hr:ble で残す
  private flushDiag(t: number) {
    const fresh = sensors.diagTotal - this.diagSeen
    if (fresh > 0) {
      this.diagSeen = sensors.diagTotal
      for (const d of sensors.diag.slice(-Math.min(fresh, sensors.diag.length))) this.o.onEvent(t, `sensor:ble ${d.text}`)
    }
    const h = this.o.heart
    const hFresh = h ? h.diagTotal - this.hrDiagSeen : 0
    if (h && hFresh > 0) {
      this.hrDiagSeen = h.diagTotal
      for (const d of h.diag.slice(-Math.min(hFresh, h.diag.length))) this.o.onEvent(t, `hr:ble ${d.text}`)
    }
  }

  // カメラなし：立った姿勢と走っているかを、センサーで決める
  private autoTick(t: number): boolean {
    const gate = this.gate!
    const running = gate.update(t)
    if (running !== this.wasRunning) {
      this.wasRunning = running
      this.o.onEvent(t, `sensor:run ${running ? 'on' : 'off'}${gate.last.place ? ` ${gate.last.place} ${gate.last.std?.toFixed(2)}` : ''}`)
      if (running) {
        // 走り出したと分かったことを声で知らせる（カメラ版の走り出しと同じ言葉。core/engine.ts の SAY.start）。
        // トレッドミルでは画面を見ないまま走り出すので、声がないと見分けたかが分からない（2026-11-06 の試走）。
        // 言うのは最初の1回だけ：信号や給水で止まって走り直すたびに言うとうるさい。止まっている間も、覚えた立ち方と走る前傾は
        // そのまま使い続けるので、走り直しで新しく始まることはない（止まった・走り直したは events の sensor:run に残る）
        if (!this.started) this.speak(t, PHRASES.start)
        this.started = true
        // センサーラン：2つの立ち方を測り終える前に走り出した。途中まで測っていても、止まったときに a の案内から測り直す（1回だけ言う）
        if (this.o.say && this.stoodAt === null && this.needsStand()) {
          if (!this.laterSaid) this.speak(t, PHRASES.poseLater)
          this.laterSaid = true
          this.armed = false
          this.setStage('a')
        }
      }
    }
    // 立った姿勢：まだ覚えていなくて、止まっている間に胸と頭が3秒じっとしたら測る
    // 案内を聞いている間に姿勢を直すので、言い終える前の3秒は使わない
    // 話している間は言い直しの間隔も数えない（言い終えてから数える。長い案内で、測る前に言い直さないため）
    const two = !!this.o.say // センサーラン：2つの立ち方。腰スマホ：今までどおり1つ
    // センサーラン：始めてから pouch 秒は、スマホをポーチに入れる間。何も言わず、測らず、じっとした時間も数えない
    //   （押してすぐ案内すると、ポーチに入れている間に「いつもの立ち方」を測ってしまう）
    const pouching = two && t - this.t0 < SENSOR_RUN_SAY.pouch
    if (this.o.speaking?.() || pouching) {
      this.quietSince = null
      if (this.lastSay > -Infinity) this.lastSay = t
    }
    else this.quietSince ??= t
    // 走り出したあとに止まった（立ち方をまだ測っていない）：走り出す前と同じく、a の案内から始める。案内を言い終えてから測る
    if (two && this.started && !this.armed && this.stoodAt === null && !running && !pouching && !this.notices.length && this.needsStand()) {
      this.armed = true
      this.quietSince = null
      this.speak(t, PHRASES.poseHabit)
    }
    const quiet = this.quietSince !== null && t - this.quietSince >= STILL.sec
    // センサーの途切れ：切れた場所を見つけ、センサーランなら1つずつ言う（ポーチに入れる間は待つ。ほかの声を話している間も待つ）
    const lost = this.watch!.tick(t)
    if (two) this.notices.push(...lost)
    if (two && !pouching && this.notices.length && !this.o.speaking?.()) {
      const text = this.notices.shift()!
      this.o.say!(text)
      this.o.onEvent(t, text)
    }
    if (this.stoodAt === null && !running && quiet && this.armed && gate.still(t)) {
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
            // 走り出したあとの止まりで測ったときも言う（「走り出すと始まります」は、止まっている今もそのとおり）
            this.speak(t, chest?.mode === 'small' ? PHRASES.poseChestStill : chest?.mode === 'fallback' ? PHRASES.poseSmall : PHRASES.poseDone)
          }
        }
      }
    }
    // 案内（声）：立つ前は、いま測る立ち方（言い直しも）、覚えてから走り出すまでは「走り出すと始まります」。走り出したあとは言わない
    // つながっていない・切れたの知らせが残っている間は待つ（知らせを先に言い終える）
    // 走り出したあとも、立ち方をまだ測っていなければ、止まっている間は測る案内を言い直す（センサーラン。a の案内を言ったあと）
    if (!running && !pouching && !this.notices.length) {
      if (this.stoodAt === null && this.needsStand()) {
        if ((!this.started || (two && this.armed)) && t - this.lastSay >= SENSOR_RUN_SAY.standRepeat) this.speak(t, !two ? PHRASES.baseStand : this.stage === 'a' ? PHRASES.poseHabit : PHRASES.poseOpen)
      } else if (!this.started && t - this.lastSay >= SENSOR_RUN_SAY.waitRepeat) this.speak(t, PHRASES.waitRun)
    }
    // 走り出したあとの止まりで立ち方を測っている間（センサーラン）も 'stand'（画面に、いま測る立ち方を出す）
    const measuring = this.stoodAt === null && this.needsStand() && (!this.started || (two && this.armed))
    const phase: SensorRunPhase = running ? 'run' : measuring ? 'stand' : this.started ? 'stop' : 'ready'
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
    this.offHeart() // 心拍の受け取りをやめる（心拍計とのつながりは切らない。次の走りでも使うため）
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible)
    this.result = this.session.finish()
    return this.result
  }
}
