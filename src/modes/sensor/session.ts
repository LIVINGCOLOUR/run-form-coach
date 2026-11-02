import type { SensorLog } from '../../core/types'
import { sensors } from './ble'
import { HunchDetector } from './hunch'
import { SensorRecorder } from './log'
import { CHEST, HUNCH, SLOTS } from './params'

// 1回の走りの間、つないだセンサーの値を記録し、胸で猫背を見て震わせる（カメラ版の Live から使う）。
// 区切りはカメラのものを使う：立った姿勢 = カメラの直立の基準を取った3秒（stand）、走っている = カメラが歩数で決めた「走っている」（tick）。
// センサーがつながっていなければ何もしない（記録にも sensors を付けない）
export class SensorSession {
  private rec: SensorRecorder | null = null
  private hunch = new HunchDetector()
  private off: () => void
  private chest = SLOTS.findIndex((s) => s.place === CHEST)
  private onEvent: (t: number, text: string) => void

  // onEvent：区切り（覚えた・知らせた）を、カメラの記録の events にも残す
  constructor(onEvent: (t: number, text: string) => void) {
    this.onEvent = onEvent
    this.off = sensors.onPacket((node, t, p) => {
      this.rec ??= new SensorRecorder(SLOTS.map((s) => ({ place: s.place, name: s.name ?? '' })))
      this.rec.add(node, t, p.range, p.samples)
      if (node === this.chest) for (const s of p.samples) this.hunch.sample(t, s.a)
    })
  }

  // カメラが直立の基準を取り終えた t。止まっていた最後の sec 秒の胸の向きを覚える
  stand(t: number, sec: number) {
    if (!this.hunch.stand(t, sec) || !this.rec) return
    this.rec.log.stand = { t: Math.round(t * 100) / 100, base: this.hunch.base!.map((x) => Math.round(x * 1e4) / 1e4) as [number, number, number] }
    this.onEvent(t, 'sensor:stand')
  }

  // HUNCH.tick 秒ごと。running：カメラが歩数で決めた「走っている」
  tick(t: number, running: boolean) {
    const r = this.hunch.update(t, running)
    if (r.learned !== undefined && this.rec) {
      this.rec.log.runLean = { t: Math.round(t * 100) / 100, deg: Math.round(r.learned * 10) / 10 }
      this.onEvent(t, `sensor:runLean ${r.learned.toFixed(1)}`)
    }
    if (r.cue && r.tilt !== null) {
      const tilt = r.tilt
      void sensors.buzz(CHEST, HUNCH.buzzCount, HUNCH.buzzMs).then((ok) => {
        this.rec?.cue(t, tilt, ok)
        this.onEvent(t, `sensor:hunch ${tilt.toFixed(1)}${ok ? '' : ' (no buzz)'}`)
      })
    }
  }

  // 走り終わり：記録をまとめて返す（値が1つも届かなかったら undefined）
  finish(): SensorLog | undefined {
    this.off()
    if (!this.rec) return undefined
    this.rec.finish()
    const views = sensors.snapshot()
    this.rec.log.nodes.forEach((n, i) => {
      const v = views[i]
      if (!v?.name) return
      if (v.fw) n.fw = v.fw
      n.lost = v.lost
      if (v.battery !== null) n.battery = v.battery
    })
    return this.rec.log
  }
}
