import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packJson, type Packed } from './pack'
import { addEntry, backoffMs, dueEntries, flushQueue, markResult, resetWaits, UPLOAD, uploadPathname, type SendResult, type UploadEntry } from './queue'

const big = { log: { id: 'phone-log-1', rows: Array.from({ length: 3000 }, (_, i) => [i / 50, 0.1, -9.8, 0.2, 0.01, 0.02, 0.03]) }, session: { id: 'phone-1' } }

describe('送る記録を縮める', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('CompressionStream があれば gzip にし、元に戻すと同じ中身', async () => {
    const p = await packJson(big)
    expect(p.gzip).toBe(true)
    expect(p.body.type).toBe('application/gzip')
    const raw = JSON.stringify(big)
    expect(p.body.size).toBeLessThan(raw.length / 3)
    const back = gunzipSync(Buffer.from(await p.body.arrayBuffer())).toString('utf8')
    expect(JSON.parse(back)).toEqual(big)
  })

  it('CompressionStream がない（古い Android の Chrome）ときは、縮めずにそのまま', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const p = await packJson(big)
    expect(p.gzip).toBe(false)
    expect(p.body.type).toBe('application/json')
    expect(JSON.parse(await p.body.text())).toEqual(big)
  })

  it('縮める途中で失敗したら、縮めずにそのまま', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('not supported')
        }
      },
    )
    const p = await packJson(big)
    expect(p.gzip).toBe(false)
    expect(JSON.parse(await p.body.text())).toEqual(big)
  })
})

describe('送り直しの順番待ち', () => {
  it('同じ記録は1回だけ入り、送れたものはもう一度入らない', () => {
    let l = addEntry([], 'phone', 'a', 1)
    l = addEntry(l, 'phone', 'a', 1)
    expect(l).toHaveLength(1)
    l = markResult(l, 'phone:a', { ok: true, pathname: 'x' }, 10)
    l = addEntry(l, 'phone', 'a', 1)
    expect(l).toHaveLength(1)
    expect(l[0].state).toBe('sent')
    expect(addEntry(l, 'camera', 'a', 1)).toHaveLength(2)
  })

  it('多すぎたら、送れたものの古いものから捨て、待っているものは捨てない', () => {
    let l: UploadEntry[] = []
    for (let i = 0; i < UPLOAD.keep; i++) l = markResult(addEntry(l, 'phone', `s${i}`, i), `phone:s${i}`, { ok: true, pathname: 'x' }, 0)
    l = addEntry(l, 'phone', 'w', 100)
    expect(l).toHaveLength(UPLOAD.keep)
    expect(l.some((e) => e.id === 'phone:s0')).toBe(false)
    expect(l.some((e) => e.id === 'phone:w')).toBe(true)
  })

  it('待つ間は倍々にのび、上限で止まる', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(3)).toBe(120_000)
    expect(backoffMs(20)).toBe(UPLOAD.maxWaitMs)
  })

  it('古い順に送り、失敗したものは待つ間が過ぎるまで送らない（今すぐ送るなら送る）', () => {
    let l = addEntry(addEntry([], 'phone', 'new', 200), 'camera', 'old', 100)
    expect(dueEntries(l, 0).map((e) => e.id)).toEqual(['camera:old', 'phone:new'])
    l = markResult(l, 'camera:old', { ok: false, error: 'つながりません' }, 1000)
    expect(l.find((e) => e.id === 'camera:old')).toMatchObject({ state: 'waiting', tries: 1, error: 'つながりません' })
    expect(dueEntries(l, 1000 + 29_999).map((e) => e.id)).toEqual(['phone:new'])
    expect(dueEntries(l, 1000 + 30_000).map((e) => e.id)).toEqual(['camera:old', 'phone:new'])
    expect(dueEntries(l, 1001, true).map((e) => e.id)).toEqual(['camera:old', 'phone:new'])
  })

  it('鍵が違うと言われたものは、鍵を入れ直すまで送らない', () => {
    let l = markResult(addEntry([], 'phone', 'a', 1), 'phone:a', { ok: false, error: '鍵', badKey: true }, 0)
    expect(dueEntries(l, 1e12, true)).toHaveLength(0)
    l = resetWaits(l)
    expect(dueEntries(l, 1)).toHaveLength(1)
  })

  it('送り先の名前は、書き出しの名前と記録の id から作る', () => {
    expect(uploadPathname('phone', 'rfc-phone-20261013-0712.json', 'phone-log-1760307120000', true)).toBe('runs/phone/rfc-phone-20261013-0712_phone-log-1760307120000.json.gz')
    expect(uploadPathname('camera', 'rfc-20261013-0712.json', 'log-1', false)).toBe('runs/camera/rfc-20261013-0712_log-1.json')
  })
})

describe('まとめて送る（flushQueue）', () => {
  const packed: Packed = { body: new Blob(['{}']), gzip: true }
  const setup = (list: UploadEntry[], results: Record<string, SendResult | Error>, missing: string[] = []) => {
    let l = list
    let t = 1000
    const sent: string[] = []
    const deps = {
      getList: () => l,
      setList: (x: UploadEntry[]) => {
        l = x
      },
      load: async (e: UploadEntry) => (missing.includes(e.logId) ? undefined : { name: `rfc-phone-20261013-0712.json`, data: { id: e.logId } }),
      pack: async () => packed,
      send: async (pathname: string) => {
        sent.push(pathname)
        const id = pathname.match(/_([^.]+)\.json/)![1]
        const r = results[id] ?? { ok: true, pathname }
        if (r instanceof Error) throw r
        return r
      },
      now: () => (t += 1),
    }
    return { deps, sent, list: () => l }
  }

  it('送れたもの・消えていたもの・失敗したものを、それぞれ印を付ける', async () => {
    const l0 = ['a', 'b', 'c', 'd'].reduce((l, id, i) => addEntry(l, 'phone', id, i), [] as UploadEntry[])
    const s = setup(l0, { b: { ok: false, error: '500' }, d: new Error('network') }, ['c'])
    await flushQueue(s.deps)
    const by = Object.fromEntries(s.list().map((e) => [e.logId, e]))
    expect(by.a.state).toBe('sent')
    expect(by.a.pathname).toBe('runs/phone/rfc-phone-20261013-0712_a.json.gz')
    expect(by.b).toMatchObject({ state: 'waiting', tries: 1, error: '500' })
    expect(by.c.state).toBe('gone')
    expect(by.d).toMatchObject({ state: 'waiting', tries: 1, error: 'network' })
    expect(s.sent).toHaveLength(3)
    // すぐにもう一度呼んでも、失敗したものは待つ間が過ぎるまで送らない
    await flushQueue(s.deps)
    expect(s.sent).toHaveLength(3)
  })

  it('鍵が違うと言われたら、そこでやめる', async () => {
    const l0 = ['a', 'b'].reduce((l, id, i) => addEntry(l, 'phone', id, i), [] as UploadEntry[])
    const s = setup(l0, { a: { ok: false, error: '鍵', badKey: true } })
    await flushQueue(s.deps)
    expect(s.sent).toHaveLength(1)
    expect(s.list().every((e) => e.state === 'waiting')).toBe(true)
  })
})
