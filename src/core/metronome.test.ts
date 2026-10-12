import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Metronome, type ClickContext } from './metronome'
import { METRONOME } from './params'

// メトロノームの拍の予約を、作りものの音の仕組みで確かめる（本物の音は鳴らさない）

class FakeCtx implements ClickContext {
  currentTime = 0
  state = 'running'
  destination = {} as AudioNode
  clicks: { at: number; hz: number; stopped: boolean }[] = []
  resume() {
    return Promise.resolve()
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }
    return { gain: param, connect() {} } as unknown as GainNode
  }
  createOscillator() {
    const click = { at: -1, hz: 0, stopped: false }
    const freq = { value: 0 }
    return {
      frequency: freq,
      connect() {},
      disconnect() {},
      start: (at: number) => {
        click.at = at
        click.hz = freq.value
        this.clicks.push(click)
      },
      // 鳴らす前に止めたら取り消し。鳴らし終わりの予約（start のあと、at より後の時刻）は数えない
      stop: (at?: number) => {
        if (at === undefined) click.stopped = true
      },
    } as unknown as OscillatorNode
  }
}

// 時計を進める。タイマーは遅れたりばらついたりする（それでも拍はずれない）
function advance(ctx: FakeCtx, sec: number, jitterMs = 0) {
  const steps = Math.round((sec * 1000) / METRONOME.tickMs)
  for (let i = 0; i < steps; i++) {
    const late = jitterMs ? ((i * 7919) % jitterMs) : 0
    ctx.currentTime += (METRONOME.tickMs + late) / 1000
    vi.advanceTimersByTime(METRONOME.tickMs)
  }
}

describe('メトロノーム', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('テンポどおりの間隔で、小節×4拍だけ鳴らし、1拍目だけ高い音にする', () => {
    const ctx = new FakeCtx()
    const m = new Metronome(() => ctx)
    expect(m.start(172, 2)).toBe(true)
    advance(ctx, 10, 20) // タイマーが最大20ms遅れても
    const live = ctx.clicks.filter((c) => !c.stopped)
    expect(live.length).toBe(8)
    const gaps = live.slice(1).map((c, i) => c.at - live[i].at)
    for (const g of gaps) expect(g).toBeCloseTo(60 / 172, 9)
    expect(live.map((c) => c.hz === METRONOME.hz)).toEqual([true, false, false, false, true, false, false, false])
    expect(m.playing).toBe(false)
  })

  it('止めたら、予約した先の拍も取り消す', () => {
    const ctx = new FakeCtx()
    const m = new Metronome(() => ctx)
    m.start(170, 8)
    advance(ctx, 2)
    m.stop()
    const heard = ctx.clicks.filter((c) => !c.stopped && c.at <= ctx.currentTime)
    const future = ctx.clicks.filter((c) => c.at > ctx.currentTime)
    expect(heard.length).toBeGreaterThan(4)
    expect(future.every((c) => c.stopped)).toBe(true)
    advance(ctx, 5)
    expect(ctx.clicks.filter((c) => !c.stopped).length).toBe(heard.length)
    expect(m.playing).toBe(false)
  })

  it('声を話している間は鳴らさず、言い終えてから数え始める', () => {
    const ctx = new FakeCtx()
    let busy = true
    const m = new Metronome(() => ctx, () => busy)
    m.start(180, 1)
    advance(ctx, 4)
    expect(ctx.clicks.length).toBe(0)
    busy = false
    const from = ctx.currentTime
    advance(ctx, 4)
    expect(ctx.clicks.length).toBe(4)
    expect(ctx.clicks[0].at).toBeGreaterThan(from)
    expect(ctx.clicks[0].hz).toBe(METRONOME.hz)
  })

  it('音の仕組みがなければ鳴らさない', () => {
    const m = new Metronome(() => null)
    expect(m.start(170, 4)).toBe(false)
    expect(m.playing).toBe(false)
  })
})
