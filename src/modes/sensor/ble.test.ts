import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError, placeFor, SensorHub, sensors, whose } from './ble'
import { SLOTS } from './params'

// どのセンサーかの見分け（名前でなく、つないでから読む型番 0x2A24 で。iPhone が「AdaDFU」の名前を覚えたままになるため）

describe('どのセンサーか（whose）', () => {
  it('型番に番号があれば、名前より型番', () => {
    expect(whose('RFC-IMU-4', 'AdaDFU')).toBe('RFC-IMU-4')
    expect(whose('RFC-IMU-4', 'RFC-IMU-2')).toBe('RFC-IMU-4')
    expect(whose('RFC-IMU-4\0', undefined)).toBe('RFC-IMU-4')
  })
  it('前の版（型番が RFC-IMU だけ）や読めないときは名前', () => {
    expect(whose('RFC-IMU', 'RFC-IMU-3')).toBe('RFC-IMU-3')
    expect(whose(null, 'RFC-IMU-3')).toBe('RFC-IMU-3')
  })
  it('どちらも違う形なら null', () => {
    expect(whose('RFC-IMU', 'AdaDFU')).toBeNull()
    expect(whose(null, undefined)).toBeNull()
  })
})

describe('押した枠とつないだセンサー（placeFor）', () => {
  const slots = [
    { name: 'RFC-IMU-1', busy: false },
    { name: 'RFC-IMU-2', busy: true },
    { name: 'RFC-IMU-4', busy: false },
    { name: null, busy: false },
  ]
  it('同じなら、わからなければ、その枠', () => {
    expect(placeFor(slots, 2, 'RFC-IMU-4')).toEqual({ kind: 'here' })
    expect(placeFor(slots, 2, null)).toEqual({ kind: 'here' })
  })
  it('ほかの枠のものなら、空いていれば移し、使っていれば知らせる', () => {
    expect(placeFor(slots, 0, 'RFC-IMU-4')).toEqual({ kind: 'move', to: 2 })
    expect(placeFor(slots, 0, 'RFC-IMU-2')).toEqual({ kind: 'taken', to: 1 })
  })
  it('どの枠にもないセンサー', () => {
    expect(placeFor(slots, 0, 'RFC-IMU-5')).toEqual({ kind: 'unknown' })
  })
})

// 名前が AdaDFU のままの機器を、つないでから型番で見分けて、正しい枠につなぐ
function fakeDevice(name: string, model: string, refuse?: unknown) {
  const text = (s: string) => ({ readValue: async () => new DataView(new TextEncoder().encode(s).buffer) })
  const ch = Object.assign(new EventTarget(), { startNotifications: async () => ch, readValue: async () => new DataView(new ArrayBuffer(2)) })
  const server = {
    connected: true,
    connect: vi.fn(async () => {
      if (refuse !== undefined) throw refuse
      return server
    }),
    disconnect: vi.fn(),
    getPrimaryService: async (u: string) => ({
      getCharacteristic: async (c: string) => {
        if (u.startsWith('0000180a')) return c.startsWith('00002a24') ? text(model) : text('2026-11-05.2')
        return ch
      },
    }),
  }
  return Object.assign(new EventTarget(), { id: `id-${model}`, name, gatt: server })
}

describe('つなぐ（SensorHub）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const at = (name: string) => SLOTS.findIndex((s) => s.name === name)

  it('名前が AdaDFU でも、型番が合えばその枠でつながる。番号を覚える', async () => {
    const wrist = at('RFC-IMU-4')
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    const requestDevice = vi.fn(async () => fakeDevice('AdaDFU', 'RFC-IMU-4'))
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } })
    await sensors.connect(wrist)
    expect(sensors.snapshot()[wrist].status).toBe('connected')
    // 名前では絞らない（古い名前を覚えていると出てこないため）
    expect(JSON.stringify(requestDevice.mock.calls[0])).not.toContain('"name"')
    expect(JSON.parse(store.get('rfc.sensorIds')!)).toEqual({ 'id-RFC-IMU-4': 'RFC-IMU-4' })
  })

  it('ほかの枠のセンサーを選んだら、そちらへつなぎ、押した枠には知らせる', async () => {
    const head = at('RFC-IMU-6') // 押した枠（前のテストでつないだ4番の枠は避ける）
    const chest = at('RFC-IMU-2')
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => fakeDevice('AdaDFU', 'RFC-IMU-2') } })
    await sensors.connect(head)
    await vi.waitFor(() => expect(sensors.snapshot()[chest].status).toBe('connected'))
    expect(sensors.snapshot()[head].status).toBe('error')
    expect(sensors.snapshot()[head].message).toContain('RFC-IMU-2')
  })
})

// 「まとめてつなぐ」：覚えている機器は選ばずに、足りない分は選ぶ画面を続けて。選んだ順は問わず、型番で枠を決める
describe('まとめてつなぐ（connectAll）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const named = SLOTS.filter((s) => s.name).map((s) => s.name!)
  const placeOf = (hub: SensorHub, name: string) => hub.snapshot().find((n) => n.name === name)!
  const tapError = () => Object.assign(new Error('Must be handling a user gesture to show a permission request.'), { name: 'SecurityError' })
  const setup = (bluetooth: object) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    vi.stubGlobal('navigator', { bluetooth })
    return new SensorHub()
  }

  it('getDevices で覚えている機器は、選ぶ画面なしで全部つなぐ（名前が AdaDFU でも型番で）', async () => {
    const requestDevice = vi.fn()
    const hub = setup({ requestDevice, getDevices: async () => named.map((m) => fakeDevice('AdaDFU', m)) })
    await hub.connectAll()
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
    expect(requestDevice).not.toHaveBeenCalled()
    expect(hub.bulkSnapshot().left).toBe(0)
    expect(hub.bulkSnapshot().diag.join('\n')).toContain(`getDevices ${named.length}個`)
  })

  it('getDevices がなければ、選ぶ画面を続けて出し、ばらばらの順に選んでも正しい枠につなぐ', async () => {
    const order = [...named].reverse()
    const requestDevice = vi.fn(async () => fakeDevice('AdaDFU', order[requestDevice.mock.calls.length - 1]))
    const hub = setup({ requestDevice })
    await hub.connectAll()
    expect(requestDevice).toHaveBeenCalledTimes(named.length)
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
    const diag = hub.bulkSnapshot().diag.join('\n')
    expect(diag).toContain('getDevices なし')
    expect(diag).toContain('（続けて）: 選んだ')
  })

  it('覚えている分をつないでから、足りない分だけ選ぶ', async () => {
    const [a, b, ...rest] = named
    const requestDevice = vi.fn(async () => fakeDevice('AdaDFU', rest[requestDevice.mock.calls.length - 1]))
    const hub = setup({ requestDevice, getDevices: async () => [fakeDevice('RFC-IMU-x', b), fakeDevice('AdaDFU', a)] })
    await hub.connectAll()
    expect(requestDevice).toHaveBeenCalledTimes(rest.length)
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
  })

  it('続けて出せない（押した扱いが要る）ときは、もう1回押すと次を選べる。つないであるものを選んでもそのまま', async () => {
    const devices = named.map((m) => fakeDevice('AdaDFU', m))
    let allowed = 1 // 1回押すごとに1回だけ選ぶ画面を出せるブラウザ
    let next = 0
    const requestDevice = vi.fn(async () => {
      if (allowed-- <= 0) throw tapError()
      return devices[next++]
    })
    const hub = setup({ requestDevice, getDevices: async () => [] })
    await hub.connectAll()
    expect(placeOf(hub, named[0]).status).toBe('connected')
    expect(hub.bulkSnapshot()).toMatchObject({ needTap: true, left: named.length - 1 })
    expect(hub.bulkSnapshot().diag.join('\n')).toContain('押し直しが要る SecurityError')

    // つないであるものをもう一度選んだ：数は減らず、次に押せばまた選べる
    allowed = 1
    next = 0
    await hub.connectAll()
    expect(hub.bulkSnapshot()).toMatchObject({ needTap: true, left: named.length - 1 })
    expect(hub.bulkSnapshot().diag.join('\n')).toContain('つないである')

    for (let k = 1; k < named.length; k++) {
      allowed = 1
      next = k
      await hub.connectAll()
    }
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
    expect(hub.bulkSnapshot()).toMatchObject({ needTap: false, left: 0 })
  })

  it('選ばずに閉じたら、そこでやめる', async () => {
    const requestDevice = vi.fn(async () => {
      throw Object.assign(new Error('cancelled'), { name: 'NotFoundError' })
    })
    const hub = setup({ requestDevice })
    await hub.connectAll()
    expect(requestDevice).toHaveBeenCalledTimes(1)
    expect(hub.bulkSnapshot()).toMatchObject({ needTap: false, left: named.length })
  })
})

describe('エラーの中身（describeError）', () => {
  it('Error でないものは型を付ける（Bluefy の数字だけのエラー）', () => {
    expect(describeError(2)).toBe('number 2')
    expect(describeError('x')).toBe('string x')
    expect(describeError({ code: 2 })).toBe('object {"code":2}')
    expect(describeError(null)).toBe('null')
    expect(describeError(Object.assign(new Error('m'), { name: 'NetworkError' }))).toBe('NetworkError: m')
  })
})

// Bluefy（2026-11-06）：getDevices で覚えていた機器は gatt.connect() を数字の 2 で断り、選ぶ画面で選んだ機器はつながる
describe('覚えていた機器につなげないブラウザ（Bluefy）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const named = SLOTS.filter((s) => s.name).map((s) => s.name!)
  const placeOf = (hub: SensorHub, name: string) => hub.snapshot().find((n) => n.name === name)!
  const setup = (store: Map<string, string>) => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })
    // 名前がセンサーの形のもの（open でつなぎにいく）と AdaDFU のもの（型番を読みにいく）の両方
    const memory = named.map((m, k) => fakeDevice(k % 2 ? 'AdaDFU' : m, m, 2))
    let next = 0
    const order = [...named].reverse() // 選ぶ順は問わない
    const requestDevice = vi.fn(async () => fakeDevice('AdaDFU', order[next++]))
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices: async () => memory } })
    return { hub: new SensorHub(), requestDevice, memory }
  }

  it('自動でつなげなければ枠を空け（エラーにしない）、まとめてつなぐは覚えている機器を見ずに選ぶ画面で全部つなぐ', async () => {
    const store = new Map<string, string>()
    const { hub, requestDevice, memory } = setup(store)
    await hub.restore()
    for (const m of named) {
      expect(placeOf(hub, m).status).toBe('idle')
      expect(placeOf(hub, m).message).not.toContain('エラー（つなぐところ）')
    }
    expect(store.get('rfc.rememberedFails')).toBe('1')
    const before = memory.map((d) => d.gatt.connect.mock.calls.length)
    expect(hub.bulkSnapshot()).toMatchObject({ busy: false, needTap: false, left: named.length })
    const diag = hub.bulkSnapshot().diag.join('\n')
    expect(diag).toContain('number 2')
    expect(diag).toContain('→選ぶ画面に回す')
    expect(diag).toContain('watchAdvertisements なし')

    await hub.connectAll()
    expect(requestDevice).toHaveBeenCalledTimes(named.length)
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
    // まとめてつなぐは、覚えていた機器にもう一度つなぎにいかない
    expect(memory.map((d) => d.gatt.connect.mock.calls.length)).toEqual(before)
    expect(hub.bulkSnapshot()).toMatchObject({ needTap: false, left: 0 })
    expect(hub.bulkSnapshot().diag.join('\n')).toContain('すぐ選ぶ画面を出す')
  })

  it('はじめてでも（覚えがなくても）、覚えていた機器につなげなかった枠は選ぶ画面に回り、全部つながる', async () => {
    const store = new Map<string, string>()
    const { hub, requestDevice } = setup(store)
    await hub.connectAll()
    expect(requestDevice).toHaveBeenCalledTimes(named.length)
    for (const m of named) expect(placeOf(hub, m).status).toBe('connected')
    expect(store.get('rfc.rememberedFails')).toBe('1')
  })

  it('自動のつなぎ直しの途中は、まとめてつなぐを始めない（同じ機器を2回つなぎにいかない）', async () => {
    const { hub, requestDevice, memory } = setup(new Map())
    const auto = hub.restore()
    expect(hub.bulkSnapshot().busy).toBe(true)
    await hub.connectAll()
    expect(requestDevice).not.toHaveBeenCalled()
    await auto
    expect(hub.bulkSnapshot().busy).toBe(false)
    // 覚えていた機器それぞれに、つなぎにいったのは1回だけ
    for (const d of memory) expect(d.gatt.connect).toHaveBeenCalledTimes(1)
  })

  it('自動では、つなぐ前に広告を聞く（watchAdvertisements があれば）', async () => {
    const { hub, memory } = setup(new Map())
    for (const d of memory) {
      Object.assign(d, {
        watchAdvertisements: vi.fn(async () => {
          queueMicrotask(() => d.dispatchEvent(new Event('advertisementreceived')))
        }),
      })
    }
    await hub.restore()
    expect(hub.bulkSnapshot().diag.join('\n')).toContain('広告あり')
  })

  it('選んだ機器でもつなげずエラーになったら、エラーの中身を型つきで diag に残す', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
      vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => fakeDevice('RFC-IMU-2', 'RFC-IMU-2', 2) } })
      const hub = new SensorHub()
      const chest = SLOTS.findIndex((s) => s.name === 'RFC-IMU-2')
      const done = hub.connect(chest)
      await vi.runAllTimersAsync()
      await done
      expect(hub.snapshot()[chest].status).toBe('error')
      expect(hub.snapshot()[chest].message).toBe('エラー（つなぐところ）：number 2')
      expect(hub.bulkSnapshot().diag.join('\n')).toContain('（RFC-IMU-2）エラー: エラー（つなぐところ）：number 2')
    } finally {
      vi.useRealTimers()
    }
  })
})
