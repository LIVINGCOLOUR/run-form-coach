import { parseBattery, parsePacket, type Packet } from './parse'
import { SLOTS } from './params'

// 自作のセンサーに Web Bluetooth でつなぐ（hardware/sensor/viewer/viewer.html と同じつなぎ方）。
// iPhone の Safari は Web Bluetooth がないので、つなげるのは Bluefy などの対応ブラウザと、Mac・Android の Chrome だけ。
// ブラウザの決まりで、選ぶ画面（requestDevice）は1回の「つなぐ」で1個ずつ、押したときにしか出せない。
// 一度選んだセンサーは、getDevices があれば選ぶ画面なしでつなぎ直す（restore）。
// つないだものは画面をまたいで残す（ホームでつないで、カメラで走るため）ので、このファイルの sensors を1つだけ使う
//   サービス 0xFFE0：値の通知 0xFFE1、電池 0xFFE2（uint16 mV）、振動 0xFFE3（回数 uint8、長さ uint8 × 10ms）
//   機器の情報 0x180A：ファームの版 0x2A26
// 番号は 128 ビットの文字で渡す（数字の UUID を受け付けないブラウザがあるため。Bluefy で「つなぐ」がエラーになった 2026-11-02）
const uuid = (n: number) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`
const SERVICE = uuid(0xffe0)
const DATA = uuid(0xffe1)
const BATTERY = uuid(0xffe2)
const BUZZ = uuid(0xffe3)
const DEVICE_INFO = uuid(0x180a)
const FIRMWARE_REV = uuid(0x2a26)
const RETRIES = 3 // 「つなぐ」を押してつなげなかったとき、押さずにやり直す回数（2秒おき）
const REJOIN_SEC = 3 // 使っている途中で切れたときは、つながるまでこの間隔で押さずにつなぎ直す（走っている途中は押せないため）

// TypeScript の DOM には Web Bluetooth の型がないので、使う分だけ書く
interface BtChar extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BtChar>
  readValue(): Promise<DataView>
  writeValue?(d: BufferSource): Promise<void>
  writeValueWithoutResponse?(d: BufferSource): Promise<void>
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
  name?: string
  gatt?: BtServer
}
type RequestOptions = { filters: ({ name: string } | { namePrefix: string } | { services: string[] })[]; optionalServices: string[] }
interface Bluetooth {
  requestDevice(o: RequestOptions): Promise<BtDevice>
  getDevices?(): Promise<BtDevice[]>
}

// エラーの中身を、何が起きたかわかる形で出す（Bluefy は数字だけのエラーを返すことがある）
const describe = (e: unknown): string => {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  try {
    return typeof e === 'object' ? JSON.stringify(e) : String(e)
  } catch {
    return String(e)
  }
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
    // 前につなげなかった（エラーの）ものは、覚えている相手を捨てて選び直す。
    // getDevices で戻した相手がつなげないまま残ると、押しても同じエラーをくり返すため
    if (node.device && node.status === 'error') {
      node.wanted = false
      node.device = null
    }
    if (!node.device) {
      // ブラウザによって通らない頼み方があるので、通るまで形を変えて頼む（選ばずに閉じたときは、そこでやめる）
      const tries: RequestOptions[] = [
        { filters: [{ name: node.name }], optionalServices: [SERVICE, DEVICE_INFO] },
        { filters: [{ name: node.name }], optionalServices: [SERVICE] },
        { filters: [{ namePrefix: 'RFC-IMU' }], optionalServices: [SERVICE] },
        { filters: [{ services: [SERVICE] }], optionalServices: [SERVICE] },
      ]
      const errors: string[] = []
      for (const opts of tries) {
        try {
          const device = await bt.requestDevice(opts)
          if (device.name && device.name !== node.name) {
            this.set(node, 'error', `${device.name} を選びました。${node.name} を選んでください`)
            return
          }
          this.attach(node, device)
          break
        } catch (e) {
          if (e instanceof Error && e.name === 'NotFoundError') {
            this.set(node, 'error', '見つからないか、選ばずに閉じました（電源と、10分たって眠っていないかを確かめる）')
            return
          }
          errors.push(describe(e))
        }
      }
      if (!node.device) {
        this.set(node, 'error', `エラー：${errors.join(' / ')}`)
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

  private async open(node: Node, tries = 0, rejoin = false) {
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
      if (rejoin && node.wanted) {
        this.set(node, 'lost', `切れました。つなぎ直しています（${tries + 1}回目）`)
        setTimeout(() => void this.open(node, tries + 1, true), REJOIN_SEC * 1000)
        return
      }
      if (tries + 1 < RETRIES && node.wanted) {
        setTimeout(() => void this.open(node, tries + 1), 2000)
        return
      }
      this.set(node, 'error', `エラー（つなぐところ）：${describe(e)}`)
    }
  }

  private dropped(node: Node) {
    if (node.status !== 'connected') return
    this.set(node, 'lost')
    // 走っている途中は押せないので、つながるまで押さずにつなぎ直す（選んだあとの connect は、押さなくても呼べる）
    // 2026-11-02 の走りで、胸が途中で切れて3回のやり直しで戻らず、そのあと猫背を見られなかった
    if (node.wanted) setTimeout(() => void this.open(node, 0, true), REJOIN_SEC * 1000)
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
