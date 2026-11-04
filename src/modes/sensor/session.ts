import type { Level } from '../../core/level'
import type { SensorLog } from '../../core/types'
import { speak, voiceBusy } from '../../core/voice'
import { sensors } from './ble'
import { ContactCoach } from './contactCoach'
import { LeanDetector } from './lean'
import { SensorRecorder } from './log'
import { ANKLES, CONTACT_LOG, HEAD, HUNCH, HUNCH_BY_LEVEL, SLOTS, type LeanParams } from './params'

// 1回の走りの間、つないだセンサーの値を記録し、胸で猫背を、頭で頭が前に出たのを見て、その場所を震わせる（カメラ版の Live から使う）。
// 区切りはカメラのものを使う：立った姿勢 = カメラの直立の基準を取った3秒（stand）、走っている = カメラが歩数で決めた「走っている」（tick）。
// センサーがつながっていなければ何もしない（記録にも sensors を付けない）

// 見る崩れごとの、記録とできごとの名前（胸は前からの名前のまま。古い記録と同じ形で残す）。
// 胸の線はランナーのレベルごと（params.ts の HUNCH_BY_LEVEL。カメラの猫背の線と同じく、レベルで厳しさを変える）。分からなければ HUNCH
type Key = 'chest' | 'head'
type Names = { stand: string; lean: string; cue: string }
const partsFor = (level?: Level): { key: Key; p: LeanParams; ev: Names }[] => [
  { key: 'chest', p: level ? HUNCH_BY_LEVEL[level] : HUNCH, ev: { stand: 'sensor:stand', lean: 'sensor:runLean', cue: 'sensor:hunch' } },
  { key: 'head', p: HEAD, ev: { stand: 'sensor:headStand', lean: 'sensor:headLean', cue: 'sensor:head' } },
]
// ずれとみなしたとき（胸も頭も同じ名前で、場所を付ける）：sensor:slip 胸 18.2→34.6（ずれを測るもとの基準 → 置き直した基準）
const SLIP = 'sensor:slip'

const r2 = (x: number) => Math.round(x * 100) / 100

export class SensorSession {
  private rec: SensorRecorder | null = null
  private parts: (ReturnType<typeof partsFor>[number] & { d: LeanDetector; node: number })[]
  private off: () => void
  private offStatus: () => void
  private connected: boolean[]
  private onEvent: (t: number, text: string) => void
  // 足首の2つで、接地時間が長い（腰が落ちている）・接地時間の左右差を見る（contactCoach.ts）。voice：知らせを声でも言う（カメラ版はトレッドミルで声が出せる）
  private contact = new ContactCoach()
  private ankle = { L: SLOTS.findIndex((s) => s.place === ANKLES.L), R: SLOTS.findIndex((s) => s.place === ANKLES.R) }
  private nextSteps = 0
  voice = true

  // onEvent：区切り（覚えた・知らせた）を、カメラの記録の events にも残す。level：ランナーのレベル（胸の線を選ぶ）
  constructor(onEvent: (t: number, text: string) => void, level?: Level) {
    this.parts = partsFor(level).map((x) => ({ ...x, d: new LeanDetector(x.p), node: SLOTS.findIndex((s) => s.place === x.p.place) }))
    this.onEvent = onEvent
    this.off = sensors.onPacket((node, t, p) => {
      this.rec ??= new SensorRecorder(SLOTS.map((s) => ({ place: s.place, name: s.name ?? '' })))
      this.rec.add(node, t, p.range, p.samples)
      for (const x of this.parts) if (node === x.node) for (const s of p.samples) x.d.sample(t, s.a)
      const side = node === this.ankle.L ? 'L' : node === this.ankle.R ? 'R' : null
      if (side) for (const s of p.samples) this.contact.sample(side, t, s.t / 1000, s.g, s.a)
    })
    // 切れた・戻ったも events に残す（あとで記録を読むとき、値が途切れた理由がわかるように）
    this.connected = sensors.snapshot().map((v) => v.status === 'connected')
    this.offStatus = sensors.subscribe(() => {
      const t = performance.now() / 1000
      sensors.snapshot().forEach((v, i) => {
        const now = v.status === 'connected'
        if (now !== this.connected[i]) this.onEvent(t, `sensor:${now ? 'back' : 'lost'} ${v.place}`)
        this.connected[i] = now
      })
    })
  }

  // 胸の記録はいちばん上の stand / runLean / cues、頭は head の中（core/types.ts の SensorLog）
  private slot(key: Key) {
    const log = this.rec!.log
    return key === 'chest' ? log : (log.head ??= { cues: [] })
  }

  // カメラが直立の基準を取り終えた t。止まっていた最後の sec 秒の、胸と頭の向きを覚える
  stand(t: number, sec: number) {
    for (const x of this.parts) {
      if (!x.d.stand(t, sec) || !this.rec) continue
      this.slot(x.key).stand = { t: r2(t), base: x.d.base!.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number] }
      this.onEvent(t, x.ev.stand)
    }
  }

  // HUNCH.tick 秒ごと（胸と頭で同じ間隔）。running：カメラが歩数で決めた「走っている」
  tick(t: number, running: boolean) {
    for (const x of this.parts) {
      const r = x.d.update(t, running)
      if (r.learned !== undefined && this.rec) {
        this.slot(x.key).runLean = { t: r2(t), deg: Math.round(r.learned * 10) / 10 }
        this.onEvent(t, `${x.ev.lean} ${r.learned.toFixed(1)}`)
      }
      // ずれとみなした：短く3回震わせる（崩れの1秒1回と分ける）。声は出さない。走ったあとの結果の画面で「付け直して」と知らせる（SlipNote.tsx）
      if (r.slip) {
        const { from, to } = r.slip
        if (this.rec) (this.slot(x.key).slips ??= []).push([r2(t), Math.round(from * 10) / 10, Math.round(to * 10) / 10])
        this.onEvent(t, `${SLIP} ${x.p.place} ${from.toFixed(1)}→${to.toFixed(1)}`)
        void sensors.buzz(x.p.place, x.p.slipBuzzCount, x.p.slipBuzzMs)
      }
      if (r.cue && r.tilt !== null) {
        const tilt = r.tilt
        void sensors.buzz(x.p.place, x.p.buzzCount, x.p.buzzMs).then((ok) => {
          this.rec?.cue(t, tilt, ok, x.key)
          this.onEvent(t, `${x.ev.cue} ${tilt.toFixed(1)}${ok ? '' : ' (no buzz)'}`)
        })
      }
    }
    this.tickContact(t, running)
  }

  // 接地時間：しくみ（engine.ts）が決めた知らせを、足首の振動と声にする。値の移り変わりは CONTACT_LOG.every 秒ごとに events に残す
  //   sensor:contact sit 2.3（腰が落ちている。値は平均から標準偏差いくつぶん上か）・sensor:contact longL 16.9（左が長い左右差 %）
  //   sensor:contactOk sit（直った）・sensor:steps df 0.38 ct 272 L 270 R 275 v 7.4 cad 168 imp 4.1/4.9
  private tickContact(t: number, running: boolean) {
    for (const c of this.contact.tick(t, running)) {
      for (const place of c.places) void sensors.buzz(place, c.count, c.ms)
      // 声はカメラの声と重ねない（話している間は振動だけ）
      if (this.voice && !voiceBusy()) speak(c.text)
      this.onEvent(t, c.kind === 'cue' ? `sensor:contact ${c.item} ${c.value?.toFixed(1) ?? ''}` : `sensor:contactOk ${c.item}`)
    }
    const m = this.contact.last
    if (m && t >= this.nextSteps) {
      this.nextSteps = t + CONTACT_LOG.every
      const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-')
      this.onEvent(t, `sensor:steps df ${f(m.df, 3)} ct ${f(m.ct * 1000)} L ${f(m.ctL * 1000)} R ${f(m.ctR * 1000)} v ${f(m.v, 1)} cad ${f(m.cad)} imp ${f(m.impL, 1)}/${f(m.impR, 1)}${m.steady ? '' : ' unsteady'}${m.mountDiff ? ' mount' : ''}`)
    }
  }

  // 走り終わり：記録をまとめて返す（値が1つも届かなかったら undefined）
  finish(): SensorLog | undefined {
    this.off()
    this.offStatus()
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
