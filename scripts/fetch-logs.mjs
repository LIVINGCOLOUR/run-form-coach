// スマホから送られた走りの記録（Vercel Blob の runs/）の一覧を出し、まだ取ってきていないものを取ってくる
// 使い方: npm run logs [-- --list] [--out フォルダ]
//   --list：一覧だけ出して、取ってこない
//   --out：置き場所（既定は環境変数 RFC_RUNS_DIR、なければ ~/Developer/research-data/runs/）。リポジトリの中には置かない
// 読む鍵は .env.local（または環境変数）の、次のどちらか。中身は出さない
//   - BLOB_READ_WRITE_TOKEN（Blob の置き場所の画面で作れるとき）
//   - VERCEL_OIDC_TOKEN と BLOB_STORE_ID（vercel env pull .env.local で入る。OIDC の鍵は半日ほどで切れるので、切れたら取り直す）
// 置く名前は rfc-phone-年月日-時分_<記録の id>.json（カメラ版は rfc-年月日-時分_<id>.json）。gzip はほどいて、
// 書き出し（{ log, session }）と同じ JSON で置くので、npm run compare -- <スマホ版> <カメラ版> にそのまま渡せる
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { get, list } from '@vercel/blob'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const out = resolve(opt('--out') ?? process.env.RFC_RUNS_DIR ?? join(homedir(), 'Developer/research-data/runs'))
const listOnly = args.includes('--list')

if (existsSync(join(root, '.env.local'))) process.loadEnvFile(join(root, '.env.local'))
const token = process.env.BLOB_READ_WRITE_TOKEN || undefined
if (!token && !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)) {
  console.error('Blob を読む鍵がありません。.env.local に BLOB_READ_WRITE_TOKEN を入れるか、vercel env pull .env.local で VERCEL_OIDC_TOKEN と BLOB_STORE_ID を入れてください')
  process.exit(1)
}
// token がなければ、@vercel/blob が VERCEL_OIDC_TOKEN と BLOB_STORE_ID で読む
const auth = token ? { token } : {}
if ((out + sep).startsWith(resolve(root) + sep)) {
  console.error(`置き場所がリポジトリの中です（${out}）。研究データはリポジトリの外に置きます`)
  process.exit(1)
}

// runs/phone/rfc-phone-20261013-0712_phone-log-1760307120000.json.gz → rfc-phone-20261013-0712_phone-log-1760307120000.json
const localName = (pathname) => pathname.split('/').pop().replace(/\.gz$/, '')
const kindOf = (pathname) => pathname.split('/')[1] ?? '?'
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`
const when = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const blobs = []
let cursor
try {
  do {
    const r = await list({ prefix: 'runs/', cursor, limit: 1000, ...auth })
    blobs.push(...r.blobs)
    cursor = r.hasMore ? r.cursor : undefined
  } while (cursor)
} catch (e) {
  console.error(`一覧を取れませんでした（${e instanceof Error ? e.message : e}）。鍵が今の置き場所のものか・OIDC の鍵が切れていないか（vercel env pull .env.local で取り直す）を確かめてください`)
  process.exit(1)
}
blobs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt))

if (!blobs.length) {
  console.log('届いた記録はまだありません')
  process.exit(0)
}

mkdirSync(out, { recursive: true })
const fresh = blobs.filter((b) => !existsSync(join(out, localName(b.pathname))))
console.log(`届いた記録 ${blobs.length} 件（新しく取ってくるもの ${fresh.length} 件） → ${out}`)
for (const b of blobs) {
  const mark = fresh.includes(b) ? '新' : '　'
  console.log(`${mark} ${when(new Date(b.uploadedAt))}  ${kindOf(b.pathname).padEnd(6)}  ${mb(b.size).padStart(7)}  ${localName(b.pathname)}`)
}
if (listOnly || !fresh.length) process.exit(0)

let failed = 0
for (const b of fresh) {
  const name = localName(b.pathname)
  try {
    const access = new URL(b.url).hostname.includes('.public.') ? 'public' : 'private'
    const r = await get(b.pathname, { access, useCache: false, ...auth })
    if (!r || r.statusCode !== 200) throw new Error('見つかりません')
    let buf = Buffer.from(await new Response(r.stream).arrayBuffer())
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
    const data = JSON.parse(buf.toString('utf8'))
    if (!data || typeof data !== 'object' || !data.log) throw new Error('書き出しの形（{ log, session }）ではありません')
    const dest = join(out, name)
    writeFileSync(`${dest}.part`, buf)
    renameSync(`${dest}.part`, dest)
    console.log(`取ってきた: ${name}（${mb(buf.length)}）`)
  } catch (e) {
    failed++
    console.error(`取ってこられなかった: ${name}（${e instanceof Error ? e.message : e}）`)
  }
}
if (failed) process.exit(1)
console.log(`比べるとき: npm run compare -- ${join(out, '<rfc-phone-….json>')} ${join(out, '<rfc-….json（カメラ版）>')}`)
