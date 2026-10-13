// 1つの記録を Vercel Blob に送る（ブラウザから直接。サイトの関数は通さない）。
// 1. /api/upload に送る鍵を見せて、その名前の1件だけに書き込める短い期限の URL（presigned URL）をもらう
// 2. その URL で Blob に直接書き込む。サイトの関数は 4.5MB までしか受け取れないが、この道なら大きい記録も送れる
// 送る鍵では、決まった名前の場所に新しく書き込むことしかできない（読む・消す・上書きはできない。api/upload.ts）
import type { Packed } from './pack'
import type { SendResult } from './queue'

export const UPLOAD_URL = '/api/upload'
export const UPLOAD_KEY_HEADER = 'x-upload-key'
// Blob の置き場所は「Private」で作る（読むには Blob の鍵が要る）
const ACCESS = 'private'
// これより大きいものは分けて送る（途中で切れても、切れた分だけ送り直せる）
const MULTIPART_BYTES = 8 * 1024 * 1024

export async function sendRun(pathname: string, p: Packed, key: string, onProgress?: (pct: number) => void): Promise<SendResult> {
  try {
    const { uploadPresigned } = await import('@vercel/blob/client')
    const r = await uploadPresigned(pathname, p.body, {
      access: ACCESS,
      handleUploadUrl: UPLOAD_URL,
      headers: { [UPLOAD_KEY_HEADER]: key },
      contentType: p.gzip ? 'application/gzip' : 'application/json',
      multipart: p.body.size > MULTIPART_BYTES,
      onUploadProgress: onProgress ? (e) => onProgress(Math.round(e.percentage)) : undefined,
    })
    return { ok: true, pathname: r.pathname }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 前に送れたのに返事を受け取れなかったとき、同じ名前はもうある（上書きはできない）。送れたとみなす
    if (/already exists/i.test(msg)) return { ok: true, pathname }
    // 書き込み用 URL をもらえなかった：理由（鍵が違う・つながらない・送り先のエラー）を確かめる
    if (/presigned URL/i.test(msg)) return whyNoUrl(key)
    return { ok: false, error: msg }
  }
}

async function whyNoUrl(key: string): Promise<SendResult> {
  let res: Response
  try {
    // 名前のない頼みを送る。鍵が違えば 401、合っていれば 400 が返る（何も書き込まれない）
    res = await fetch(UPLOAD_URL, { method: 'POST', headers: { 'content-type': 'application/json', [UPLOAD_KEY_HEADER]: key }, body: '{}' })
  } catch {
    return { ok: false, error: 'つながりません' }
  }
  if (res.status === 401) return { ok: false, error: '送る鍵が違います', badKey: true }
  return { ok: false, error: `送り先が書き込み用の URL を出せませんでした（${res.status}）` }
}
