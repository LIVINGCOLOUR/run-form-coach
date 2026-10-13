import { describe, expect, it, vi } from 'vitest'
import type { issueSignedToken } from '@vercel/blob'
import { checkPathname, checkUploadKey, CONTENT_TYPES, handle, MAX_BYTES } from './upload'

// 本物の Blob にはつながない。Blob に鍵をもらうところ（issueSignedToken）を作り物に差し替え、
// 書き込み用 URL の中身（署名つきの決まり）は手元で作られるので、それを確かめる
// 本物の鍵ではない（本物はコードに入れない）。短い鍵でも通ることを確かめる
const KEY = 'abc'
const env = { UPLOAD_KEY: KEY, BLOB_WEBHOOK_PUBLIC_KEY: 'test' }
const PATH = 'runs/phone/rfc-phone-20261013-0712_phone-log-1760307120000.json.gz'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeIssue = vi.fn(async (o: Parameters<typeof issueSignedToken>[0]) => ({
  delegationToken: `${b64({ pathname: o.pathname, operations: o.operations, validUntil: o.validUntil, maximumSizeInBytes: o.maximumSizeInBytes, allowedContentTypes: o.allowedContentTypes, storeId: 'teststore' })}.sig`,
  clientSigningToken: 'fake-signing-token',
  validUntil: o.validUntil ?? 0,
}))

const req = (body: unknown, key?: string) =>
  new Request('https://example.com/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { 'x-upload-key': key }) },
    body: JSON.stringify(body),
  })
const urlEvent = (pathname = PATH) => ({ type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: null, multipart: false } })

describe('送る鍵の確かめ', () => {
  it('合っている鍵だけ通す', () => {
    expect(checkUploadKey(KEY, KEY)).toBe(true)
    expect(checkUploadKey('ab', KEY)).toBe(false)
    expect(checkUploadKey('abc ', KEY)).toBe(false)
    expect(checkUploadKey('ABC', KEY)).toBe(false)
    expect(checkUploadKey('', KEY)).toBe(false)
    expect(checkUploadKey(null, KEY)).toBe(false)
  })
  it('サーバーに鍵がないときは、だれも通さない', () => {
    expect(checkUploadKey('', undefined)).toBe(false)
    expect(checkUploadKey('anything', undefined)).toBe(false)
    expect(checkUploadKey('anything', '')).toBe(false)
  })
  it('名前は決まった形だけ', () => {
    expect(checkPathname(PATH)).toBe(true)
    expect(checkPathname('runs/camera/rfc-20261013-0712_log-1760307120000.json')).toBe(true)
    expect(checkPathname('runs/phone/../secret.json')).toBe(false)
    expect(checkPathname('other/rfc-phone-20261013-0712_x.json')).toBe(false)
    expect(checkPathname('runs/phone/rfc-phone-20261013-0712_x.html')).toBe(false)
    expect(checkPathname('runs/video/rfc-20261013-0712_x.json')).toBe(false)
  })
})

describe('書き込み用 URL を出す口（/api/upload）', () => {
  it('送る鍵がない・違うときは 401 で、Blob に鍵を頼まない', async () => {
    fakeIssue.mockClear()
    for (const key of [undefined, '', 'wrong']) {
      const r = await handle(req(urlEvent(), key), env, fakeIssue)
      expect(r.status).toBe(401)
      expect(JSON.stringify(await r.json())).not.toContain('presignedUrlPayload')
    }
    expect(fakeIssue).not.toHaveBeenCalled()
  })
  it('サーバーに UPLOAD_KEY がなければ 401', async () => {
    const r = await handle(req(urlEvent(), KEY), { BLOB_WEBHOOK_PUBLIC_KEY: 'test' }, fakeIssue)
    expect(r.status).toBe(401)
  })
  it('合っている鍵なら、その名前1件に新しく書くだけの URL を出す', async () => {
    fakeIssue.mockClear()
    const r = await handle(req(urlEvent(), KEY), env, fakeIssue)
    expect(r.status).toBe(200)
    // Blob に頼む鍵：その名前・書き込みだけ・大きさと種類の上限・15分
    const o = fakeIssue.mock.calls[0][0]
    expect(o.pathname).toBe(PATH)
    expect(o.operations).toEqual(['put'])
    expect(o.maximumSizeInBytes).toBe(MAX_BYTES)
    expect(o.allowedContentTypes).toEqual(CONTENT_TYPES)
    expect(o.validUntil).toBeLessThanOrEqual(Date.now() + 15 * 60_000)
    // 署名つきの決まりに、上書きしない・名前を変えないが入る（ブラウザでは書き換えられない）
    const { presignedUrlPayload: p } = (await r.json()) as { presignedUrlPayload: { signature: string; params: Record<string, string> } }
    expect(p.signature).toBeTruthy()
    expect(p.params['vercel-blob-allow-overwrite']).toBe('false')
    expect(p.params['vercel-blob-add-random-suffix']).toBe('false')
    expect(p.params['vercel-blob-maximum-size-in-bytes']).toBe(String(MAX_BYTES))
    expect(JSON.stringify(p)).not.toContain('fake-signing-token')
  })
  it('決まった形でない名前・書き込み用 URL を出す以外の頼みは断り、Blob に鍵を頼まない', async () => {
    fakeIssue.mockClear()
    expect((await handle(req(urlEvent('runs/phone/x.html'), KEY), env, fakeIssue)).status).toBe(400)
    expect((await handle(req({ type: 'blob.upload-completed', payload: {} }, KEY), env, fakeIssue)).status).toBe(400)
    expect((await handle(req({ type: 'blob.generate-client-token', payload: { pathname: PATH } }, KEY), env, fakeIssue)).status).toBe(400)
    expect(fakeIssue).not.toHaveBeenCalled()
  })
})
