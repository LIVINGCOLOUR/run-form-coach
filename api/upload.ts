// Vercel の関数：スマホから記録を送るための、短い期限の書き込み用 URL（presigned URL）を出す。記録そのものはここを通らない
// （ブラウザが Blob に直接送る。関数の受け取りは 4.5MB までなので）。
// - 送る鍵（環境変数 UPLOAD_KEY）が x-upload-key に入っていなければ 401。UPLOAD_KEY がなければ、だれにも出さない
// - 出す URL は、決まった形の名前（runs/phone|camera/rfc-….json(.gz)）1件に、新しく書き込むこと（put）だけができる。
//   読む・一覧・消す・上書きはできない。大きさは 64MB まで、期限は15分
// - Blob への認証は、Vercel の関数の OIDC（VERCEL_OIDC_TOKEN と BLOB_STORE_ID。Blob を「つなぐ」と入る）。
//   BLOB_READ_WRITE_TOKEN は使わない（あれば @vercel/blob が使うが、なくても動く）。BLOB_WEBHOOK_PUBLIC_KEY も、つなぐと入る
// Vercel の関数はこのファイルだけで動くように、ほかのファイルを読み込まない（テストは api/upload.test.ts）
import { createHash, timingSafeEqual } from 'node:crypto'
import { issueSignedToken } from '@vercel/blob'
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client'

export const UPLOAD_KEY_HEADER = 'x-upload-key'
export const PATHNAME = /^runs\/(phone|camera)\/rfc-[a-z0-9-]{1,40}_[A-Za-z0-9-]{1,64}\.json(\.gz)?$/
export const MAX_BYTES = 64 * 1024 * 1024
export const CONTENT_TYPES = ['application/gzip', 'application/json']
const TOKEN_MINUTES = 15

// 送る鍵が合っているか。中身で答えの速さが変わらないように、ハッシュにしてから比べる
export function checkUploadKey(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(given), h(expected))
}

export const checkPathname = (pathname: string) => PATHNAME.test(pathname) && !pathname.includes('..')

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

// Vercel が呼ぶ口。2つめの引数に別のものが渡ることがあるので、環境変数はここで読んで渡す
export function POST(request: Request): Promise<Response> {
  return handle(request, process.env)
}

// issue：Blob に「この名前に書き込んでよい」という鍵をもらう（テストでは作り物に差し替える）
export async function handle(request: Request, env: Record<string, string | undefined>, issue: typeof issueSignedToken = issueSignedToken): Promise<Response> {
  if (!checkUploadKey(request.headers.get(UPLOAD_KEY_HEADER), env.UPLOAD_KEY)) return json(401, { error: 'bad upload key' })
  let body: HandleUploadPresignedBody
  try {
    body = (await request.json()) as HandleUploadPresignedBody
  } catch {
    return json(400, { error: 'bad body' })
  }
  // 書き込み用 URL を出すことだけを受ける（書き終わりの知らせ（webhook）は使わない）
  if (body?.type !== 'blob.generate-presigned-url') return json(400, { error: 'bad type' })
  try {
    const r = await handleUploadPresigned({
      body,
      request,
      // 書き終わりの知らせを使わないので中身は使われないが、ないと動かない
      webhookPublicKey: env.BLOB_WEBHOOK_PUBLIC_KEY || 'unused',
      getSignedToken: async (pathname) => {
        if (!checkPathname(pathname)) throw new Error('bad pathname')
        const validUntil = Date.now() + TOKEN_MINUTES * 60_000
        const token = await issue({ pathname, operations: ['put'], validUntil, allowedContentTypes: CONTENT_TYPES, maximumSizeInBytes: MAX_BYTES })
        return { token, urlOptions: { allowedContentTypes: CONTENT_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: false, allowOverwrite: false, validUntil } }
      },
    })
    return json(200, r)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'bad pathname') return json(400, { error: msg })
    console.error('upload: 書き込み用 URL を出せませんでした', msg)
    return json(500, { error: 'upload failed' })
  }
}
