import { afterEach, describe, expect, it, vi } from 'vitest'
import { placeFor, sensors, whose } from './ble'
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
function fakeDevice(name: string, model: string) {
  const text = (s: string) => ({ readValue: async () => new DataView(new TextEncoder().encode(s).buffer) })
  const ch = Object.assign(new EventTarget(), { startNotifications: async () => ch, readValue: async () => new DataView(new ArrayBuffer(2)) })
  const server = {
    connected: true,
    connect: async () => server,
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
    const head = at('RFC-IMU-1')
    const chest = at('RFC-IMU-2')
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => fakeDevice('AdaDFU', 'RFC-IMU-2') } })
    await sensors.connect(head)
    await vi.waitFor(() => expect(sensors.snapshot()[chest].status).toBe('connected'))
    expect(sensors.snapshot()[head].status).toBe('error')
    expect(sensors.snapshot()[head].message).toContain('RFC-IMU-2')
  })
})
