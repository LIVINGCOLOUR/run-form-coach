import { parseBattery, parsePacket, type Packet } from './parse'
import { SLOTS } from './params'

// 自作のセンサーに Web Bluetooth でつなぐ（hardware/sensor/viewer/viewer.html と同じつなぎ方）。
// iPhone の Safari は Web Bluetooth がないので、つなげるのは Bluefy などの対応ブラウザと、Mac・Android の Chrome だけ。
// 選ぶ画面（requestDevice）は、押したときにしか出せない。Chrome は1回押すごとに1個とされる（続けて出すと SecurityError のはず。ここでは試していない）。
// 一度選んだセンサーは、getDevices があれば選ぶ画面なしでつなぎ直す（restore・connectAll）。
// Bluefy が getDevices を持つか、選ぶ画面を続けて出せるかは、まだ確かめていない（調べても書いたものが見つからなかった）。
//   「まとめてつなぐ」で起きたことを diag に残し、パネルに出し、次の走りの記録の events にも「sensor:ble …」で入れる（runner.ts）
// つないだものは画面をまたいで残す（ホームでつないで、カメラで走るため）ので、このファイルの sensors を1つだけ使う
//   サービス 0xFFE0：値の通知 0xFFE1、電池 0xFFE2（uint16 mV）、振動 0xFFE3（回数 uint8、長さ uint8 × 10ms）
//   機器の情報 0x180A：ファームの版 0x2A26、どのセンサーか 0x2A24（2026-11-05.2 から「RFC-IMU-4」の形。前は「RFC-IMU」だけ）
// どのセンサーかは、つないでから 0x2A24 で確かめる。名前（device.name）は当てにしない：
//   無線で書き換えた直後は、同じアドレスで「AdaDFU」と名乗るので、iPhone がその名前を覚えたままになる（再起動しても。2026-11-05 の4番）。
//   名前で選ぶ画面を絞ると、その子が出てこなくなるので、選ぶ画面はサービス 0xFFE0 で絞り、名前は確かめられないときの代わりにだけ使う。
//   シリアル番号 0x2A25 は Web Bluetooth の決まりで読めない（gatt_blocklist）ので使わない
// 番号は 128 ビットの文字で渡す（数字の UUID を受け付けないブラウザがあるため。Bluefy で「つなぐ」がエラーになった 2026-11-02）
const uuid = (n: number) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`
const SERVICE = uuid(0xffe0)
const DATA = uuid(0xffe1)
const BATTERY = uuid(0xffe2)
const BUZZ = uuid(0xffe3)
const DEVICE_INFO = uuid(0x180a)
const FIRMWARE_REV = uuid(0x2a26)
const MODEL = uuid(0x2a24)
const IDS_KEY = 'rfc.sensorIds' // 選んだ機器（device.id）がどのセンサーだったか。名前が古いままでも、次から選ばずにつなげるように
const RETRIES = 3 // 「つなぐ」を押してつなげなかったとき、押さずにやり直す回数（2秒おき）
const REJOIN_SEC = 3 // 使っている途中で切れたときは、つながるまでこの間隔で押さずにつなぎ直す（走っている途中は押せないため）
const RESTORE_WAIT = 4 // まとめてつなぐ：覚えているセンサーがつながるのを待つ長さ（秒）。待ちすぎると、押した扱いが切れて選ぶ画面を出せなくなる（Chrome は約5秒）
const DIAG_MAX = 20 // diag に残す行数

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
  id?: string
  name?: string
  gatt?: BtServer
}
type RequestOptions = { filters: ({ name: string } | { namePrefix: string } | { services: string[] })[]; optionalServices: string[] }
interface Bluetooth {
  requestDevice(o: RequestOptions): Promise<BtDevice>
  getDevices?(): Promise<BtDevice[]>
}

// 選ぶ画面の頼み方。ブラウザによって通らない形があるので、上から順に試す
const PICK_FORMS: RequestOptions[] = [
  { filters: [{ services: [SERVICE] }, { namePrefix: 'RFC-IMU' }], optionalServices: [SERVICE, DEVICE_INFO] },
  { filters: [{ services: [SERVICE] }], optionalServices: [SERVICE, DEVICE_INFO] },
  { filters: [{ services: [SERVICE] }], optionalServices: [SERVICE] },
  { filters: [{ namePrefix: 'RFC-IMU' }], optionalServices: [SERVICE] },
]

// エラーの中身を、何が起きたかわかる形で出す（Bluefy は数字だけのエラーを返すことがある）
const describe = (e: unknown): string => {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  try {
    return typeof e === 'object' ? JSON.stringify(e) : String(e)
  } catch {
    return String(e)
  }
}

// どのセンサーか（「RFC-IMU-4」の形）。0x2A24 を先に見て、なければ名前。どちらも違う形（AdaDFU など）なら null
const SENSOR_NAME = /^RFC-IMU-\d+$/
export function whose(model: string | null, name: string | undefined): string | null {
  const m = model?.replace(/\0+$/, '').trim()
  if (m && SENSOR_NAME.test(m)) return m
  return name && SENSOR_NAME.test(name) ? name : null
}

// 「つなぐ」を押した枠（asked）に、つないだセンサー（id）をどうするか
//   here：その枠で使う（id がわからないときも、選んだ本人を信じてここ）
//   move：ほかの枠のセンサーだったので、そちらへ移す
//   taken：ほかの枠で、もう別の（か同じ）機器を使っている
//   unknown：どの枠にも割り当てていないセンサー
export type Placement = { kind: 'here' } | { kind: 'move' | 'taken'; to: number } | { kind: 'unknown' }
export function placeFor(slots: readonly { name: string | null; busy: boolean }[], asked: number, id: string | null): Placement {
  if (!id || slots[asked]?.name === id) return { kind: 'here' }
  const to = slots.findIndex((s) => s.name === id)
  if (to < 0) return { kind: 'unknown' }
  return slots[to].busy ? { kind: 'taken', to } : { kind: 'move', to }
}

const loadIds = (): Record<string, string> => {
  try {
    const v = JSON.parse(localStorage.getItem(IDS_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
const saveId = (device: BtDevice, name: string) => {
  if (!device.id) return
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify({ ...loadIds(), [device.id]: name }))
  } catch {
    /* 覚えられなくても、押せばつなげる */
  }
}

// 押した扱いがない（続けて選ぶ画面を出せない）ときのエラーか
const needsTap = (e: unknown) => e instanceof Error && (e.name === 'SecurityError' || e.name === 'NotAllowedError')

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

// 「まとめてつなぐ」の様子（画面用）
export interface BulkView {
  busy: boolean
  left: number // まだつながっていない枠（つなごうとしているものは数えない）
  needTap: boolean // 続けて選ぶ画面を出せなかった（もう1回押せば次を選べる）
  diag: string[] // 起きたこと（新しいものが後ろ）
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

export class SensorHub {
  readonly nodes: Node[]
  private listeners = new Set<Listener>()
  private watchers = new Set<() => void>()
  private views: NodeView[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private restored = false
  private watched = new WeakSet<BtDevice>() // 切れたときの知らせを付けた機器（同じ機器に2回付けない）
  private identifying = new Set<BtDevice>() // どのセンサーか確かめている途中の機器（同じ機器を2回確かめない）
  private form = 0 // requestDevice で通った頼み方（PICK_FORMS の何番目）。次からそこから頼む
  private bulkBusy = false
  private needTap = false
  private bulk: BulkView = { busy: false, left: 0, needTap: false, diag: [] }
  readonly diag: { t: number; text: string }[] = [] // t は performance.now() の秒

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
  bulkSnapshot = () => this.bulk

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
      const r = await this.pick(bt)
      if (r.kind === 'cancel') {
        this.set(node, 'error', `見つからないか、選ばずに閉じました（${node.name} を選ぶ。名前が AdaDFU などに見えることもある。電源と、10分たって眠っていないかも確かめる）`)
        return
      }
      if (r.kind !== 'device') {
        this.set(node, 'error', `エラー：${r.error}`)
        return
      }
      this.attach(node, r.device)
    }
    await this.open(node)
  }

  // 選ぶ画面を出して、センサーを1個選んでもらう。
  // 名前では絞らない（iPhone が古い名前を覚えていると出てこない。上の説明）。センサーが全部出るので、どれかを選んでもらい、
  // どのセンサーだったかは open・adopt で確かめる。
  // ブラウザによって通らない頼み方があるので、通るまで形を変えて頼む（選ばずに閉じたとき・押した扱いがないときは、そこでやめる）
  private async pick(bt: Bluetooth): Promise<{ kind: 'device'; device: BtDevice } | { kind: 'cancel' } | { kind: 'tap' | 'error'; error: string }> {
    const errors: string[] = []
    for (let k = this.form; k < PICK_FORMS.length; k++) {
      try {
        const device = await bt.requestDevice(PICK_FORMS[k])
        this.form = k
        return { kind: 'device', device }
      } catch (e) {
        if (e instanceof Error && e.name === 'NotFoundError') return { kind: 'cancel' }
        if (needsTap(e)) return { kind: 'tap', error: describe(e) }
        errors.push(describe(e))
      }
    }
    return { kind: 'error', error: errors.join(' / ') }
  }

  // 前に選んだことのあるセンサーに、選ぶ画面なしでつなぎにいく（getDevices があるブラウザだけ。何度呼んでも1回だけ。パネルを開いたとき）
  async restore() {
    if (this.restored) return
    this.restored = true
    await this.remembered('自動')
  }

  // getDevices で覚えている機器を、つながっていないものだけ、全部いっしょにつなぎにいく。つなぎ終わる（か失敗する）まで待つ
  private async remembered(why: string): Promise<void> {
    const bt = bluetooth()
    if (!bt?.getDevices) {
      this.note(`${why}: getDevices なし`)
      return
    }
    let devices: BtDevice[]
    try {
      devices = await bt.getDevices()
    } catch (e) {
      this.note(`${why}: getDevices エラー ${describe(e)}`)
      return
    }
    const todo = devices.filter((d) => !this.inUse(d))
    this.note(`${why}: getDevices ${devices.length}個（つなぎにいく ${todo.length}個）`)
    const got = await Promise.all(todo.map((d) => this.adopt(d)))
    if (todo.length) this.note(`${why}: 覚えていた機器 ${got.join('・')}`)
  }

  // この機器がもう、つながっているか、つなごうとしているか（同じ機器でも、取り方で別のものが返ることがあるので id でも比べる）
  private inUse(d: BtDevice) {
    if (this.identifying.has(d)) return true
    return this.nodes.some((n) => n.device && (n.device === d || (!!d.id && n.device.id === d.id)) && (n.status === 'connected' || n.status === 'connecting'))
  }

  // 枠を決めずに選んだ・覚えていた機器を、どのセンサーか確かめて、その枠につなぐ。起きたことを短い言葉で返す（diag 用）
  private async adopt(device: BtDevice): Promise<string> {
    if (this.inUse(device)) return 'つないである'
    const free = (n: Node) => !(n.device && n.device !== device && (n.status === 'connected' || n.status === 'connecting'))
    // 前に確かめた番号か、センサーの形の名前なら、その枠でつなぐ（違っていても open で確かめ直して移す）
    const guess = (device.id && loadIds()[device.id]) || whose(null, device.name)
    let node = guess ? this.nodes.find((n) => n.name === guess && free(n)) : undefined
    if (!node) {
      // わからなければ、つないで型番を読んでから枠を決める
      const gatt = device.gatt
      if (!gatt) return 'つなげない機器'
      this.identifying.add(device)
      try {
        const server = await gatt.connect()
        const info = await server.getPrimaryService(DEVICE_INFO)
        const model = new TextDecoder().decode(await (await info.getCharacteristic(MODEL)).readValue())
        const id = whose(model, device.name)
        node = this.nodes.find((n) => n.name && n.name === id)
        if (!node || !free(node)) {
          if (!this.nodes.some((n) => n.device === device)) gatt.disconnect()
          return `${id ?? device.name ?? '?'}は${node ? 'ほかの機器が使用中' : 'どの場所にもない'}`
        }
      } catch (e) {
        return `確かめられない（${describe(e)}）`
      } finally {
        this.identifying.delete(device)
      }
    }
    this.attach(node, device)
    await this.open(node)
    // open で別の枠へ移すことがあるので、つないだ先を探す
    const at = this.nodes.find((n) => n.device === device)
    return at ? `${at.name}→${at.place}` : '使えない（パネルの知らせを見る）'
  }

  // 「まとめてつなぐ」：覚えている機器を選ばずにつなぎ、足りない分だけ選ぶ画面を続けて出す（選んだ順は問わない。型番で枠を決める）。
  // 続けて出せなければ（押した扱いが要るブラウザ）、もう1回押すと次を選べるようにする
  async connectAll() {
    const bt = bluetooth()
    if (!bt || this.bulkBusy) return
    this.bulkBusy = true
    this.refresh()
    try {
      // 前の押しで続けて出せなかったときは、覚えている機器は見たばかりなので、すぐ選ぶ画面を出す（待つと押した扱いが切れる）
      if (!this.needTap) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<void>((ok) => (timer = setTimeout(ok, RESTORE_WAIT * 1000)))
        await Promise.race([this.remembered('まとめて'), late])
        clearTimeout(timer)
      }
      this.needTap = false
      const need = this.left()
      const picking: Promise<string>[] = []
      for (let k = 1; k <= need; k++) {
        const r = await this.pick(bt)
        const nth = `選ぶ画面${k}/${need}${k > 1 ? '（続けて）' : ''}`
        if (r.kind === 'device') {
          this.note(`${nth}: 選んだ ${r.device.name ?? '?'}`)
          // 確かめるのを待たずに、次の選ぶ画面を出す（待つと押した扱いが切れることがある）
          picking.push(this.adopt(r.device).then((g) => (this.note(`${nth}: ${g}`), g)))
          continue
        }
        if (r.kind === 'tap') {
          this.needTap = true
          this.note(`${nth}: 押し直しが要る ${r.error}`)
        } else this.note(`${nth}: ${r.kind === 'cancel' ? '選ばずに閉じた' : `エラー ${r.error}`}`)
        break
      }
      await Promise.all(picking)
    } finally {
      this.bulkBusy = false
      this.refresh()
    }
  }

  // まだつながっていない（つなごうともしていない）、名前のある枠の数
  private left() {
    return this.nodes.filter((n) => n.name && n.status !== 'connected' && n.status !== 'connecting').length
  }

  private note(text: string) {
    this.diag.push({ t: performance.now() / 1000, text })
    if (this.diag.length > DIAG_MAX) this.diag.splice(0, this.diag.length - DIAG_MAX)
    this.refresh()
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
    if (this.watched.has(device)) return
    this.watched.add(device)
    // 枠を移すことがあるので、切れたときは今その機器を持っている枠を探す
    device.addEventListener('gattserverdisconnected', () => {
      for (const n of this.nodes) if (n.device === device) this.dropped(n)
    })
  }

  // つないだセンサーが、この枠のものか確かめる。違えば正しい枠へ移すか、知らせて手放す。この枠で使うなら true
  private claim(node: Node, device: BtDevice, id: string | null): boolean {
    const i = this.nodes.indexOf(node)
    const slots = this.nodes.map((n) => ({ name: n.name, busy: !!n.device && n.device !== device && (n.status === 'connected' || n.status === 'connecting') }))
    const p = placeFor(slots, i, id)
    if (p.kind === 'here') return true
    node.device = null
    node.wanted = false
    if (p.kind === 'move') {
      const to = this.nodes[p.to]
      this.set(node, 'error', `選んだのは ${id}（${to.place}）だったので、${to.place}につなぎました。${node.place}は ${node.name} を選んでください`)
      this.attach(to, device)
      void this.open(to)
      return false
    }
    // ほかの枠がこの機器を使っていなければ、切っておく
    if (!this.nodes.some((n) => n.device === device)) device.gatt?.disconnect()
    const where = p.kind === 'taken' ? `${this.nodes[p.to].place}で別のものを使っています` : 'どの場所にも割り当てていません'
    this.set(node, 'error', `選んだのは ${id} でした（${where}）。${node.name} を選んでください`)
    return false
  }

  private async open(node: Node, tries = 0, rejoin = false) {
    const device = node.device
    const gatt = device?.gatt
    if (!device || !gatt) return
    node.wanted = true
    this.set(node, 'connecting')
    try {
      const server = await gatt.connect()
      // どのセンサーかを、値を受け始める前に確かめる（違う枠の値が混ざらないように）
      let model: string | null = null
      try {
        const info = await server.getPrimaryService(DEVICE_INFO)
        const text = async (u: string) => new TextDecoder().decode(await (await info.getCharacteristic(u)).readValue())
        node.fw = await text(FIRMWARE_REV)
        model = await text(MODEL).catch(() => null)
      } catch {
        node.fw = null // 機器の情報を読めないブラウザ・ファーム
      }
      const id = whose(model, device.name)
      if (!this.claim(node, device, id)) return
      saveId(device, node.name!)
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
    const left = this.left()
    if (!left) this.needTap = false
    this.bulk = { busy: this.bulkBusy, left, needTap: this.needTap, diag: this.diag.map((d) => d.text) }
    this.views = this.nodes.map(({ place, name, status, message, battery, rate, lost, fw, canBuzz }) => ({ place, name, status, message, battery, rate, lost, fw, canBuzz }))
    for (const fn of this.watchers) fn()
  }
}

export const sensors = new SensorHub()
