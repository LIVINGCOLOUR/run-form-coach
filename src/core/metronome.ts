import { METRONOME } from './params'
import { audioContext, voiceBusy } from './voice'

// メトロノーム：決まったテンポ（1拍＝1歩）で、短い音を決まった拍の数だけ鳴らす。声かけのしくみの「音の知らせ」（tone）に使う
//   拍は、音の仕組み（Web Audio）の時刻で前もって予約する。タイマー（setInterval）は予約を見直すだけなので、
//   タイマーが遅れても拍の間隔はずれない（METRONOME.lookahead 秒先まで予約し、METRONOME.tickMs ごとに見直す）
//   声を話している間は拍を予約しない（声と重ねない）。数え残しは、声が終わってから続ける
//   1拍目（4拍に1回）だけ高い音にして、小節が分かるようにする
// 声と同じ AudioContext を使う（iPhone では、最初のタップで unlockVoice が起こしたものだけが鳴る）

// 使う音の仕組みの一部（テストで作りものに替えられるように）
export interface ClickContext {
  readonly currentTime: number
  readonly state: string
  resume(): Promise<void>
  createOscillator(): OscillatorNode
  createGain(): GainNode
  readonly destination: AudioNode
}

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null
  private nextAt: number | null = null // 次の拍の時刻（音の仕組みの秒）
  private left = 0 // 残りの拍
  private beat = 0 // 何拍目か（0 が1拍目）
  private spb = 0.35 // 1拍の秒
  private scheduled: { osc: OscillatorNode; at: number }[] = []
  bpm = 0

  private readonly ctx: () => ClickContext | null
  private readonly busy: () => boolean

  constructor(ctx: () => ClickContext | null, busy: () => boolean = () => false) {
    this.ctx = ctx
    this.busy = busy
  }

  get playing() {
    return this.timer !== null
  }

  // bpm のテンポで bars 小節（1小節＝4拍）鳴らす。鳴らしていれば、はじめから鳴らし直す。音の仕組みがなければ false
  start(bpm: number, bars: number): boolean {
    this.stop()
    const c = this.ctx()
    if (!c || !(bpm > 0) || bars <= 0) return false
    if (c.state !== 'running') c.resume().catch(() => {})
    this.bpm = bpm
    this.spb = 60 / bpm
    this.left = Math.round(bars * 4)
    this.beat = 0
    this.nextAt = null
    this.timer = setInterval(() => this.tick(), METRONOME.tickMs)
    this.tick()
    return true
  }

  // 止める。予約した先の拍も取り消す
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.left = 0
    this.nextAt = null
    const c = this.ctx()
    for (const s of this.scheduled) {
      try {
        // 鳴らす前の拍は止め、つなぎも外す（stop を2回呼べない古い Safari でも鳴らないように）
        if (!c || s.at > c.currentTime) {
          s.osc.disconnect()
          s.osc.stop()
        }
      } catch {
        /* すでに止まっている */
      }
    }
    this.scheduled = []
  }

  private tick() {
    const c = this.ctx()
    if (!c) return this.stop()
    const now = c.currentTime
    this.scheduled = this.scheduled.filter((s) => s.at > now - 1)
    // 声の間は予約しない。声が終わったら、少しあけて数え直す
    if (this.busy()) {
      this.nextAt = null
      return
    }
    // 音の仕組みが止まっていた（画面の切り替えなど）ときは、拍を詰めて鳴らさず、今から数え直す
    if (this.nextAt === null || this.nextAt < now) this.nextAt = now + METRONOME.startDelay
    while (this.left > 0 && this.nextAt < now + METRONOME.lookahead) {
      this.click(c, this.nextAt, this.beat % 4 === 0)
      this.nextAt += this.spb
      this.left--
      this.beat++
    }
    if (this.left <= 0) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }

  private click(c: ClickContext, at: number, accent: boolean) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.frequency.value = accent ? METRONOME.hz : METRONOME.hzBeat
    // 立ち上がりと消え方をなめらかにして、ぷつっという雑音を出さない
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(METRONOME.gain, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.001, at + METRONOME.clickSec)
    osc.connect(g)
    g.connect(c.destination)
    osc.start(at)
    osc.stop(at + METRONOME.clickSec + 0.01)
    this.scheduled.push({ osc, at })
  }
}

// アプリで使うメトロノーム（声と同じ音の仕組み）
export const metronome = new Metronome(audioContext, voiceBusy)
