import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendResult } from './queue'

// 送る口は作り物にする（つながない）。送った名前と鍵を覚えておく
const sent: { pathname: string; key: string }[] = []
vi.mock('./send', () => ({
  sendRun: async (pathname: string, _p: unknown, key: string): Promise<SendResult> => {
    sent.push({ pathname, key })
    return { ok: true, pathname }
  },
}))

// localStorage の作り物（node には localStorage がない）
const store = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

// 記録を送るしくみは端末の中に状態を持つので、テストごとに読み込み直す
const load = async () => {
  vi.resetModules()
  return import('./uploads')
}
const payload = (id: string) => async () => ({ name: 'rfc-phone-20261013-0712.json', data: { id } })

describe('記録を送るしくみ（uploads）', () => {
  beforeEach(() => {
    store.clear()
    sent.length = 0
    vi.stubGlobal('localStorage', fakeStorage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('鍵を入れていなければテスト期間の既定の鍵を使い、手で入れた鍵があればそちらを使う', async () => {
    const u = await load()
    expect(u.TEST_UPLOAD_KEY).toBe('run')
    expect(u.getUploadKey()).toBe(u.TEST_UPLOAD_KEY)
    expect(u.uploadView()).toMatchObject({ hasKey: false }) // 画面へ知らせる前
    u.setUploadKey(' mine ')
    expect(u.getUploadKey()).toBe('mine')
    expect(u.uploadView()).toMatchObject({ hasKey: true, manualKey: true })
    u.setUploadKey('')
    expect(u.getUploadKey()).toBe(u.TEST_UPLOAD_KEY)
    expect(u.uploadView()).toMatchObject({ hasKey: true, manualKey: false })
  })

  it('鍵を入れていない端末でも、走り終わった記録を既定の鍵で送る', async () => {
    const u = await load()
    u.registerUploadSource('phone', (id) => payload(id)())
    u.queueUpload('phone', 'phone-log-1', 1)
    await u.flushUploads()
    expect(sent).toEqual([{ pathname: 'runs/phone/rfc-phone-20261013-0712_phone-log-1.json.gz', key: 'run' }])
    expect(u.findUpload('phone', 'phone-log-1')?.state).toBe('sent')
  })

  it('開いたとき、端末に残っていて順番待ちにない記録を入れて送る。送れたものは送り直さない', async () => {
    const now = Date.now()
    // 前に送れた記録が1件ある
    store.set('rfc.uploads', JSON.stringify([{ id: 'camera:log-sent', kind: 'camera', logId: 'log-sent', startedAt: now - 2 * 86_400_000, state: 'sent', tries: 0, sentAt: now }]))
    const u = await load()
    u.registerUploadSource('camera', (id) => payload(id)(), async () => [
      { logId: 'log-sent', startedAt: now - 2 * 86_400_000 },
      { logId: 'log-new', startedAt: now - 86_400_000 },
      { logId: 'log-old', startedAt: now - 30 * 86_400_000 },
    ])
    u.registerUploadSource('phone', (id) => payload(id)(), async () => {
      throw new Error('読めない')
    })
    await u.backfillUploads(now)
    expect(u.uploadView().list.map((e) => [e.id, e.state])).toEqual([
      ['camera:log-sent', 'sent'],
      ['camera:log-new', 'waiting'],
    ])
    await u.flushUploads()
    expect(sent.map((s) => s.pathname)).toEqual(['runs/camera/rfc-phone-20261013-0712_log-new.json.gz'])
    // もう一度開いても、何も送らない
    await u.backfillUploads(now)
    await u.flushUploads()
    expect(sent).toHaveLength(1)
  })
})
