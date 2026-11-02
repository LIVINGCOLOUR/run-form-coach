import { parseBattery, parsePacket, type Packet } from './parse'
import { SLOTS } from './params'

// 自作のセンサーに Web Bluetooth でつなぐ（hardware/sensor/viewer/viewer.html と同じつなぎ方）。
// iPhone の Safari は Web Bluetooth がないので、つなげるのは Bluefy などの対応ブラウザと、Mac・Android の Chrome だけ。
// ブラウザの決まりで、選ぶ画面（requestDevice）は1回の「つなぐ」で1個ずつ、押したときにしか出せない。
// 一度選んだセンサーは、getDevices があれば選ぶ画面なしでつなぎ直す（restore）。
// つないだものは画面をまたいで残す（ホームでつないで、カメラで走るため）ので、このファイルの sensors を1つだけ使う
//   サービス 0xFFE0：値の通知 0xFFE1、電池 0xFFE2（uint16 mV）、振動 0xFFE3（回数 uint8、長さ uint8 × 10ms）
//   機器の情報 0x180A：ファームの版 0x2A26
const SERVICE = 0xffe0
const DATA = 0xffe1
const BATTERY = 0xffe2
const BUZZ = 0xffe3
const DEVICE_INFO = 0x180a
const FIRMWARE_REV = 0x2a26
const RETRIES = 3 // 走っている途中で切れたとき、押さずにつなぎ直す回数（2秒おき）

// TypeScript の DOM には Web Bluetooth の型がないので、使う分だけ書く
interface BtChar extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BtChar>
  readValue(): Promise<DataView>
  writeValue?(d: BufferSource): Promise<void>
  writeValueWithoutResponse?(d: BufferSource): Promise<void>
}
interface BtService {
  getCharacteristic(u: number): Promise<BtChar>
}
interface BtServer {
  connected: boolean
  connect(): Promise<BtServer>
  disconnect(): void
  getPrimaryService(u: number): Promise<BtService>
}
interface BtDevice extends EventTarget {
  name?: string
  gatt?: BtServer
}
interface Bluetooth {
  requestDevice(o: { filters: { name: string }[]; optionalServices: number[] }): Promise<BtDevice>
  getDevices?(): Promise<BtDevice[]>
}

const bluetooth = (): Bluetooth | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth)

export type NodeStatus = 'none' | 'idle' | 'connecting' | 'connected' | 'lost' | 'error'

// 画面に出す、センサー1個の様子
export interface NodeView {
  place: string
  name: string | null
  status: NodeStatus
  message: string
  battery: number | null // V
  rate: number // 直近1秒に届いた件数（100Hz なら約100）
  lost: number // 通し番号が飛んだ件数（つないでからの合計）
  fw: string | null
  canBuzz: boolean
}

interface Node extends NodeView {
  device: BtDevice | null
  data: BtChar | null
  buzzChar: BtChar | null
  onData: ((e: Event) => void) | null
  expected: number | null
  count: number
  range: number
  wanted: boolean // 切れたらつなぎ直すか（自分で切ったときは false）
}

type Listener = (node: number, t: number, p: Packet) => void

const MESSAGE: Record<NodeStatus, string> = {
  none: 'この場所には付けていません',
  idle: 'つないでいません',
  connecting: 'つないでいます…',
  connected: 'つながっています',
  lost: '切れました（「つなぎ直す」を押してください）',
  error: 'つなげませんでした',
}

class SensorHub {
  readonly nodes: Node[]
  private listeners = new Set<Listener>()
  private watchers = new Set<() => void>()
  private views: NodeView[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private restored = false

  constructor() {
    this.nodes = SLOTS.map((s) => ({
      ...s, status: s.name ? 'idle' : 'none', message: MESSAGE[s.name ? 'idle' : 'none'], battery: null, rate: 0, lost: 0, fw: null, canBuzz: false,
      device: null, data: null, buzzChar: null, onData: null, expected: null, count: 0, range: 0, wanted: false,
    }))
    this.refresh()
  }

  // このブラウザで Web Bluetooth が使えるか（iPhone の Safari では false）
  get supported() {
    return !!bluetooth()
  }

  get connected() {
    return this.nodes.filter((n) => n.status === 'connected').length
  }

  // 付けている（名前のある）枠の数
  get slots() {
    return this.nodes.filter((n) => n.name).length
  }

  index(place: string) {
    return this.nodes.findIndex((n) => n.place === place)
  }

  // 画面用（useSyncExternalStore）
  subscribe = (fn: () => void) => {
    this.watchers.add(fn)
    return () => {
      this.watchers.delete(fn)
    }
  }
  snapshot = () => this.views

  // 値が届くたびに呼ぶ（node は SLOTS の何番目か、t は performance.now() の秒）
  onPacket(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // 「つなぐ」を押したとき。一度選んだものは選び直さずにつなぎ直す
  async connect(i: number) {
    const node = this.nodes[i]
    const bt = bluetooth()
    if (!node?.name || !bt) return
    if (!node.device) {
      try {
        const device = await bt.requestDevice({ filters: [{ name: node.name }], optionalServices: [SERVICE, DEVICE_INFO] })
        this.attach(node, device)
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        this.set(node, 'error', name === 'NotFoundError' ? '見つからないか、選ばずに閉じました（電源と、10分たって眠っていないかを確かめる）' : `エラー：${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    await this.open(node)
  }

  // 前に選んだことのあるセンサーに、選ぶ画面なしでつなぎにいく（getDevices があるブラウザだけ。何度呼んでも1回だけ）
  async restore() {
    const bt = bluetooth()
    if (this.restored || !bt?.getDevices) return
    this.restored = true
    try {
      const devices = await bt.getDevices()
      for (const d of devices) {
        const node = this.nodes.find((n) => n.name && n.name === d.name)
        if (!node || node.device) continue
        this.attach(node, d)
        void this.open(node)
      }
    } catch {
      /* 使えないときは、押してつなぐだけにする */
    }
  }

  // 振動させる（回数、1回の長さ ms。長さは最大 2550ms）。送れたら true。振動のない古いファームや、つながっていなければ false
  async buzz(place: string, count: number, ms: number): Promise<boolean> {
    const node = this.nodes[this.index(place)]
    const ch = node?.status === 'connected' ? node.buzzChar : null
    if (!ch) return false
    const data = new Uint8Array([Math.max(0, Math.min(255, count)), Math.max(0, Math.min(255, Math.round(ms / 10)))])
    try {
      if (ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(data)
      else if (ch.writeValue) await ch.writeValue(data)
      else return false
      return true
    } catch {
      return false
    }
  }

  private attach(node: Node, device: BtDevice) {
    node.device = device
    device.addEventListener('gattserverdisconnected', () => this.dropped(node))
  }

  private async open(node: Node, tries = 0) {
    const gatt = node.device?.gatt
    if (!gatt) return
    node.wanted = true
    this.set(node, 'connecting')
    try {
      const server = await gatt.connect()
      const service = await server.getPrimaryService(SERVICE)
      const data = await service.getCharacteristic(DATA)
      node.expected = null
      node.lost = 0
      if (node.data && node.onData) node.data.removeEventListener('characteristicvaluechanged', node.onData)
      node.onData = (e) => this.packet(node, (e.target as BtChar).value)
      node.data = data
      data.addEventListener('characteristicvaluechanged', node.onData)
      await data.startNotifications()
      try {
        const bat = await service.getCharacteristic(BATTERY)
        node.battery = parseBattery(await bat.readValue())
        bat.addEventListener('characteristicvaluechanged', (e) => {
          const v = (e.target as BtChar).value
          if (v) node.battery = parseBattery(v)
        })
        await bat.startNotifications()
      } catch {
        /* 電池を測らない古いファーム */
      }
      try {
        node.buzzChar = await service.getCharacteristic(BUZZ)
      } catch {
        node.buzzChar = null // 振動のない古いファーム
      }
      node.canBuzz = !!node.buzzChar
      try {
        const info = await server.getPrimaryService(DEVICE_INFO)
        node.fw = new TextDecoder().decode(await (await info.getCharacteristic(FIRMWARE_REV)).readValue())
      } catch {
        node.fw = null
      }
      this.set(node, 'connected')
      this.tick()
    } catch (e) {
      if (tries + 1 < RETRIES && node.wanted) {
        setTimeout(() => void this.open(node, tries + 1), 2000)
        return
      }
      this.set(node, 'error', `エラー：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private dropped(node: Node) {
    if (node.status !== 'connected') return
    this.set(node, 'lost')
    // 走っている途中は押せないので、何回かは押さずにつなぎ直す（選んだあとの connect は、押さなくても呼べる）
    if (node.wanted) setTimeout(() => void this.open(node, 0), 2000)
  }

  private packet(node: Node, v: DataView | undefined) {
    if (!v) return
    const p = parsePacket(v)
    if (!p.samples.length) {
      if (node.message !== MESSAGE.connected) return
      this.set(node, 'connected', '形の違うデータが届いています。今の 03_ble_imu を書き込み直してください')
      return
    }
    if (node.expected !== null) {
      const gap = (p.seq - node.expected) & 0xffff
      if (gap !== 0 && gap < 0x8000) node.lost += gap // 通し番号が飛んだぶんが抜け
    }
    node.expected = (p.seq + p.samples.length) & 0xffff
    node.range = p.range
    node.count += p.samples.length
    const t = performance.now() / 1000
    const i = this.nodes.indexOf(node)
    for (const fn of this.listeners) fn(i, t, p)
  }

  // 1秒ごとに、届いた件数を数えて画面を直す（どれかがつながっている間だけ）
  private tick() {
    if (this.timer) return
    this.timer = setInterval(() => {
      for (const n of this.nodes) {
        n.rate = n.count
        n.count = 0
      }
      this.refresh()
      if (!this.nodes.some((n) => n.status === 'connected' || n.status === 'connecting')) {
        clearInterval(this.timer!)
        this.timer = null
      }
    }, 1000)
  }

  private set(node: Node, status: NodeStatus, message?: string) {
    node.status = status
    node.message = message ?? MESSAGE[status]
    if (status !== 'connected') node.rate = 0
    this.refresh()
  }

  private refresh() {
    this.views = this.nodes.map(({ place, name, status, message, battery, rate, lost, fw, canBuzz }) => ({ place, name, status, message, battery, rate, lost, fw, canBuzz }))
    for (const fn of this.watchers) fn()
  }
}

export const sensors = new SensorHub()
