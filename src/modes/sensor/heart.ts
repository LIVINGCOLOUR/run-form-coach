import { describeError } from './ble'
import { HEART } from './params'

// 心拍計（センサーランだけ。記録だけで、知らせ・声には使わない。数字は params.ts の HEART）。
// ふつうの Bluetooth の Heart Rate Profile（サービス 0x180D、通知 0x2A37 Heart Rate Measurement）の機器なら、どれでもつなげる。
//   Fitbit Charge 6 は、時計の画面を下に引いて「Broadcast HR」（日本語の画面では「心拍数をブロードキャスト」）を押してから、
//   ここで選ぶ。つないだあと、時計に出る画面で「共有」→「開始」を押す。同時につなげるのは1つのアプリだけ（ほかのアプリにつないでいると出てこない）
// 自作のセンサー（ble.ts）とは別に、1つだけつなぐ。つなぎ方は ble.ts に合わせる（ble.ts は変えずに、ここで同じ形に書く）：
//   選ぶ画面（requestDevice）は押したときだけ。サービスは 128 ビットの文字で渡す（数字の UUID を受け付けないブラウザがあるため。ble.ts と同じ）。
//   一度選んだものは、getDevices があれば押さずにつなぎにいく（restore。ホームの心拍計の枠を開いたとき）。
//     Bluefy は覚えていた機器に押さずにはつなげなかった（ble.ts の説明。2026-11-06）ので、つなげなければ、その機器を手放して「心拍計をつなぐ」を押してもらう
//   走っている途中で切れたら、押さずに HEART.rejoin 秒おきにつなぎ直す（走っている途中は押せないため）。
//   起きたことは diag に残し、走りの記録の events にも「hr:ble …」で入れる（runner.ts）
// つないだものは画面をまたいで残す（ホームでつないで、センサーランで走るため）ので、このファイルの heart を1つだけ使う

const uuid = (n: number) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`
const HR_SERVICE = uuid(0x180d)
const HR_MEASUREMENT = uuid(0x2a37)
const ID_KEY = 'rfc.heartId' // 選んだ心拍計（device.id）。次から押さずにつなぎにいくため
const DIAG_MAX = 20 // diag に残す行数
// 走っている途中のつなぎ直しでつなげなかったとき、diag に残すのは最初の REJOIN_NOTE_FIRST 回と、そのあと REJOIN_NOTE_EVERY 回ごと（ble.ts と同じ）
const REJOIN_NOTE_FIRST = 3
const REJOIN_NOTE_EVERY = 20

// ---- Heart Rate Measurement（0x2A37）を読む ----
// 1バイト目のフラグ：bit0 心拍が 16 ビットか（0 なら 8 ビット）、bit1 皮膚に触れているか、bit2 触れているかを知らせる機器か、
//   bit3 消費エネルギー（uint16 kJ）が付くか、bit4 RR 間隔（心拍の間。uint16、1/1024 秒）が付くか。値はすべてリトルエンディアン
export type HeartValue = {
  bpm: number // 心拍（拍/分）
  rr: number[] // RR 間隔（ms。付かなければ空）
  contact: boolean | null // 皮膚に触れているか（知らせない機器は null）
  energy: number | null // 消費エネルギー（kJ。付かなければ null）
}

export function parseHeartRate(v: DataView): HeartValue | null {
  if (v.byteLength < 2) return null
  const flags = v.getUint8(0)
  const wide = (flags & 0x01) !== 0
  if (v.byteLength < (wide ? 3 : 2)) return null
  const bpm = wide ? v.getUint16(1, true) : v.getUint8(1)
  let i = wide ? 3 : 2
  const contact = flags & 0x04 ? (flags & 0x02) !== 0 : null
  let energy: number | null = null
  if (flags & 0x08) {
    if (v.byteLength >= i + 2) energy = v.getUint16(i, true)
    i += 2
  }
  const rr: number[] = []
  if (flags & 0x10) for (; i + 1 < v.byteLength; i += 2) rr.push(Math.round((v.getUint16(i, true) * 1000) / 1024))
  return { bpm, rr, contact, energy }
}

// 届いた1回ぶん（t は performance.now() の秒。センサーの値と同じ時計）
export type HeartReading = HeartValue & { t: number }

// いちばん新しい心拍を持ち、1秒ごとのまとめの値にする。RR 間隔は記録へ移すまでためる（[届いた t, ms]）
//   心拍が 0、または皮膚に触れていないと知らせてきたときの心拍は使わない（外したまま 0 や古い値を送る機器があるため）
export class HeartLatest {
  private last: { t: number; bpm: number } | null = null
  private rr: [number, number][] = []
  readonly stale: number

  constructor(stale = HEART.stale) {
    this.stale = stale
  }

  fix(r: HeartReading) {
    if (r.bpm > 0 && r.contact !== false && (!this.last || r.t >= this.last.t)) this.last = { t: r.t, bpm: r.bpm }
    const t = Math.round(r.t * 100) / 100
    for (const ms of r.rr.slice(0, HEART.rrMax)) this.rr.push([t, ms])
  }

  // t の心拍（拍/分）。最後の心拍が stale 秒より古ければ null
  at(t: number): number | null {
    const l = this.last
    return l && t - l.t <= this.stale ? l.bpm : null
  }

  // ためた RR 間隔を取り出す（取り出したら空にする）
  takeRR(): [number, number][] {
    if (!this.rr.length) return []
    const out = this.rr
    this.rr = []
    return out
  }
}

// ---- つなぐ ----
// TypeScript の DOM には Web Bluetooth の型がないので、使う分だけ書く（ble.ts と同じ形）
interface BtChar extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BtChar>
}
interface BtService {
  getCharacteristic(u: string): Promise<BtChar>
}
interface BtServer {
  connected: boolean
  connect(): Promise<BtServer>
  disconnect(): void
  getPrimaryService(u: string): Promise<BtService>
}
interface BtDevice extends EventTarget {
  id?: string
  name?: string
  gatt?: BtServer
}
interface Bluetooth {
  requestDevice(o: { filters: { services: string[] }[]; optionalServices: string[] }): Promise<BtDevice>
  getDevices?(): Promise<BtDevice[]>
}
const bluetooth = (): Bluetooth | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth)

const loadId = (): string | null => {
  try {
    return localStorage.getItem(ID_KEY)
  } catch {
    return null
  }
}
const saveId = (id: string | undefined) => {
  if (!id) return
  try {
    localStorage.setItem(ID_KEY, id)
  } catch {
    /* 覚えられなくても、押せばつなげる */
  }
}

// none：Web Bluetooth のないブラウザ。idle：つないでいない。connecting：つないでいる途中。connected：つながっている。
// lost：使っている途中で切れて、つなぎ直している。error：つなげなかった
export type HeartStatus = 'none' | 'idle' | 'connecting' | 'connected' | 'lost' | 'error'

// 画面に出す、心拍計の様子
export interface HeartView {
  status: HeartStatus
  message: string
  name: string | null // 機器の名前（選んでいなければ null）
  bpm: number | null // 最後に届いた心拍（使えない値のときは null）
  t: number | null // 最後に心拍が届いた t（performance.now() の秒。古いかは呼ぶ側が HEART.stale で見る）
}

// 走りの記録が使う口（runner.ts。テストでは差し替える）
export interface HeartSource {
  snapshot(): HeartView
  subscribe(fn: () => void): () => void
  onReading(fn: (r: HeartReading) => void): () => void
  readonly diag: { t: number; text: string }[]
  readonly diagTotal: number
}

const MESSAGE: Record<HeartStatus, string> = {
  none: 'このブラウザは心拍計につなげません',
  idle: 'つないでいません',
  connecting: 'つないでいます…',
  connected: 'つながっています',
  lost: '切れました。つなぎ直しています',
  error: 'つなげませんでした',
}

export class HeartMonitor implements HeartSource {
  private device: BtDevice | null = null
  private char: BtChar | null = null
  private wanted = false // 切れたらつなぎ直すか
  private watched = new WeakSet<BtDevice>()
  private restored = false
  private picking = false
  private status: HeartStatus
  private message: string
  private bpm: number | null = null
  private lastT: number | null = null
  private view: HeartView
  private watchers = new Set<() => void>()
  private listeners = new Set<(r: HeartReading) => void>()
  readonly diag: { t: number; text: string }[] = []
  diagTotal = 0 // diag に残した行の数（消した行も数える。走っている間に増えた行を、runner.ts が記録の events に移すため）
  clock = () => performance.now() / 1000

  constructor() {
    this.status = bluetooth() ? 'idle' : 'none'
    this.message = MESSAGE[this.status]
    this.view = this.makeView()
  }

  get supported() {
    return !!bluetooth()
  }

  // 画面用（useSyncExternalStore）
  subscribe = (fn: () => void) => {
    this.watchers.add(fn)
    return () => {
      this.watchers.delete(fn)
    }
  }
  snapshot = () => this.view

  // 心拍が届くたびに呼ぶ
  onReading(fn: (r: HeartReading) => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // 「心拍計をつなぐ」を押したとき：選ぶ画面を出して選んでもらい、つなぐ（前の機器があっても選び直す。Bluefy は選んだ機器ならつながる）
  async connect() {
    const bt = bluetooth()
    if (!bt || this.picking) return
    this.picking = true
    try {
      let device: BtDevice
      try {
        device = await bt.requestDevice({ filters: [{ services: [HR_SERVICE] }], optionalServices: [HR_SERVICE] })
      } catch (e) {
        if (e instanceof Error && e.name === 'NotFoundError') {
          // つながっている・つなぎ直している途中なら、そのまま
          if (this.status === 'idle' || this.status === 'error') this.set('idle', '見つからないか、選ばずに閉じました（Charge 6 は「Broadcast HR」を押してから。ほかのアプリにつないでいると出てきません）')
          return
        }
        this.note(`選ぶ画面 エラー ${describeError(e)}`)
        this.set('error', `エラー：${describeError(e)}`)
        return
      }
      this.note(`選んだ ${device.name ?? '?'}`)
      this.use(device)
      await this.open(device, 'pick')
    } finally {
      this.picking = false
      this.refresh()
    }
  }

  // 前に選んだ心拍計に、押さずにつなぎにいく（getDevices があるブラウザだけ。何度呼んでも1回だけ。ホームの心拍計の枠を開いたとき）
  async restore() {
    if (this.restored) return
    this.restored = true
    const bt = bluetooth()
    const id = loadId()
    if (!bt?.getDevices || !id || this.device) return
    let devices: BtDevice[]
    try {
      devices = await bt.getDevices()
    } catch (e) {
      this.note(`自動: getDevices エラー ${describeError(e)}`)
      return
    }
    const d = devices.find((x) => x.id === id)
    if (!d || this.device) return
    this.note(`自動: 覚えていた ${d.name ?? '?'} につなぎにいく`)
    this.use(d)
    await this.open(d, 'memory')
  }

  // 使う機器を替える（前の機器はつなぎ直さない）
  private use(device: BtDevice) {
    if (this.device && this.device !== device) {
      this.wanted = false
      this.device.gatt?.disconnect()
    }
    this.device = device
    if (this.watched.has(device)) return
    this.watched.add(device)
    device.addEventListener('gattserverdisconnected', () => {
      if (device === this.device) this.dropped(device)
    })
  }

  // how：pick（選んだ）・memory（覚えていた機器に押さずに）・rejoin（使っている途中で切れたあとのつなぎ直し）
  private async open(device: BtDevice, how: 'pick' | 'memory' | 'rejoin', tries = 0) {
    const gatt = device.gatt
    if (!gatt) {
      this.set('error', 'つなげない機器です')
      return
    }
    this.wanted = true
    if (how !== 'rejoin') this.set('connecting')
    try {
      const server = await gatt.connect()
      const ch = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT)
      if (device !== this.device) return // 途中で別の機器を選んだ
      if (this.char) this.char.removeEventListener('characteristicvaluechanged', this.onValue)
      this.char = ch
      ch.addEventListener('characteristicvaluechanged', this.onValue)
      await ch.startNotifications()
      // ここまでの間に切れていたら、つながったことにしない（ble.ts と同じ穴をふさぐ）
      if (gatt.connected === false) throw new Error('つないでいる途中で切れました')
      saveId(device.id)
      this.note(how === 'rejoin' ? `つなぎ直した（${tries + 1}回目）` : `つないだ ${device.name ?? '?'}${how === 'memory' ? '（押さずに）' : ''}`)
      this.set('connected')
    } catch (e) {
      if (device !== this.device) return
      if (how === 'rejoin' && this.wanted) {
        if (tries < REJOIN_NOTE_FIRST || (tries + 1) % REJOIN_NOTE_EVERY === 0) this.note(`つなぎ直せない（${tries + 1}回目）${describeError(e)}`)
        this.set('lost', `切れました。つなぎ直しています（${tries + 1}回目）`)
        this.rejoinLater(device, tries + 1)
        return
      }
      this.wanted = false
      if (how === 'memory') {
        // 覚えていた機器に押さずにはつなげない（Bluefy）：手放して、押してもらう
        this.device = null
        this.note(`覚えていた機器に押さずにはつなげない ${describeError(e)}`)
        this.set('idle', '「心拍計をつなぐ」を押して選んでください（Charge 6 は「Broadcast HR」を押してから）')
        return
      }
      this.note(`つなげない ${describeError(e)}`)
      this.set('error', `つなげませんでした：${describeError(e)}`)
    }
  }

  private rejoinLater(device: BtDevice, tries: number) {
    setTimeout(() => {
      if (device === this.device && this.wanted) void this.open(device, 'rejoin', tries)
    }, HEART.rejoin * 1000)
  }

  private dropped(device: BtDevice) {
    if (this.status !== 'connected') return
    this.note('切れた')
    this.set('lost')
    // 走っている途中は押せないので、つながるまで押さずにつなぎ直す
    if (this.wanted) this.rejoinLater(device, 0)
  }

  private onValue = (e: Event) => {
    const v = (e.target as BtChar).value
    if (v) this.value(v)
  }

  // 通知が1つ届いた（テストでは直接呼ぶ）
  value(v: DataView) {
    const p = parseHeartRate(v)
    if (!p) return
    const r: HeartReading = { ...p, t: this.clock() }
    this.bpm = p.bpm > 0 && p.contact !== false ? p.bpm : null
    this.lastT = r.t
    // 受け手ごとに分けて呼ぶ（1つがエラーを出しても、ほかには届ける。ble.ts と同じ）
    for (const fn of this.listeners) {
      try {
        fn(r)
      } catch {
        /* 記録の受け手のエラーで、画面を止めない */
      }
    }
    this.refresh()
  }

  private note(text: string) {
    this.diagTotal++
    this.diag.push({ t: this.clock(), text })
    if (this.diag.length > DIAG_MAX) this.diag.splice(0, this.diag.length - DIAG_MAX)
  }

  private set(status: HeartStatus, message?: string) {
    this.status = status
    this.message = message ?? MESSAGE[status]
    if (status !== 'connected') this.bpm = null
    this.refresh()
  }

  private makeView(): HeartView {
    return { status: this.status, message: this.message, name: this.device?.name ?? null, bpm: this.bpm, t: this.lastT }
  }

  private refresh() {
    this.view = this.makeView()
    for (const fn of this.watchers) fn()
  }
}

export const heart = new HeartMonitor()
