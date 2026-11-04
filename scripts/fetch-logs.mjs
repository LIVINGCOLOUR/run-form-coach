// スマホから送られた走りの記録（Vercel Blob の runs/）の一覧を出し、まだ取ってきていないものを取ってくる
// 使い方: npm run logs [-- --list] [--out フォルダ]
//   --list：一覧だけ出して、取ってこない
//   --out：置き場所（既定は環境変数 RFC_RUNS_DIR、なければ ~/Developer/research-data/runs/）。リポジトリの中には置かない
// 読む鍵は .env.local（または環境変数）の、次のどちらか。中身は出さない
//   - BLOB_READ_WRITE_TOKEN（Blob の置き場所の画面で作れるとき）
//   - VERCEL_OIDC_TOKEN と BLOB_STORE_ID（vercel env pull .env.local で入る。OIDC の鍵は半日ほどで切れるので、切れたら取り直す）
// 置く名前は rfc-phone-年月日-時分_<記録の id>.json（カメラ版は rfc-年月日-時分_<id>.json）。gzip はほどいて、
// 書き出し（{ log, session }）と同じ JSON で置くので、npm run compare -- <スマホ版> <カメラ版> にそのまま渡せる
// 2時間より長い記録は、2時間ごとのファイル（名前の id のうしろに -p<何番目>of<いくつ>）に分けて届く（src/core/logChunks.ts）。
// 全部そろってから取ってきて、log.chunks.paths の配列（rows・sensors.blocks・sensors.sec）をつないで1つのファイルにする。そろうまでは「途中」と出して取らない
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
// 分けたファイル（…_log-1793790318421-p2of4.json.gz）は、つないだあとの名前（…_log-1793790318421.json）
const PART = /-p(\d+)of(\d+)\.json$/
const fileName = (pathname) => pathname.split('/').pop().replace(/\.gz$/, '')
const localName = (pathname) => fileName(pathname).replace(PART, '.json')
const partOf = (pathname) => {
  const m = fileName(pathname).match(PART)
  return m ? [Number(m[1]), Number(m[2])] : [1, 1]
}
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
// 同じ記録のファイル（分けたもの）をまとめる
const groups = new Map()
for (const b of blobs) {
  const name = localName(b.pathname)
  const g = groups.get(name) ?? { name, kind: kindOf(b.pathname), parts: [], of: partOf(b.pathname)[1] }
  g.parts.push(b)
  groups.set(name, g)
}
const runs = [...groups.values()]
const complete = (g) => new Set(g.parts.map((b) => partOf(b.pathname)[0])).size >= g.of
const fresh = runs.filter((g) => !existsSync(join(out, g.name)) && complete(g))
console.log(`届いた記録 ${runs.length} 件（新しく取ってくるもの ${fresh.length} 件） → ${out}`)
for (const g of runs) {
  const mark = fresh.includes(g) ? '新' : !complete(g) && !existsSync(join(out, g.name)) ? '途' : '　'
  const size = g.parts.reduce((n, b) => n + b.size, 0)
  const last = g.parts.reduce((a, b) => (new Date(b.uploadedAt) > new Date(a.uploadedAt) ? b : a))
  const parts = g.of > 1 ? `  （${g.parts.length}/${g.of} に分けて${complete(g) ? '' : '、途中'}）` : ''
  console.log(`${mark} ${when(new Date(last.uploadedAt))}  ${g.kind.padEnd(6)}  ${mb(size).padStart(7)}  ${g.name}${parts}`)
}
if (listOnly || !fresh.length) process.exit(0)

// 1つのファイルを取ってきて、gzip をほどいて読む
async function fetchJson(b) {
  const access = new URL(b.url).hostname.includes('.public.') ? 'public' : 'private'
  const r = await get(b.pathname, { access, useCache: false, ...auth })
  if (!r || r.statusCode !== 200) throw new Error('見つかりません')
  let buf = Buffer.from(await new Response(r.stream).arrayBuffer())
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
  const data = JSON.parse(buf.toString('utf8'))
  if (!data || typeof data !== 'object' || !data.log) throw new Error('書き出しの形（{ log, session }）ではありません')
  return { data, text: buf }
}

// path（'sensors.blocks' など）の配列。なければ作る（親がなければ undefined）
function arrayAt(o, path) {
  const keys = path.split('.')
  let cur = o
  for (const k of keys.slice(0, -1)) {
    cur = cur?.[k]
    if (!cur || typeof cur !== 'object') return undefined
  }
  const last = keys[keys.length - 1]
  if (!Array.isArray(cur[last])) cur[last] = []
  return cur[last]
}

let failed = 0
for (const g of fresh) {
  try {
    const dest = join(out, g.name)
    let text
    if (g.of <= 1) text = (await fetchJson(g.parts[0])).text
    else {
      // 分けたファイルを番号順に取ってきて、1番目に2番目からの配列を足す（ほかの中身は1番目のもの）
      const sorted = [...new Map(g.parts.map((b) => [partOf(b.pathname)[0], b])).entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1])
      let base = null
      for (const b of sorted) {
        const { data } = await fetchJson(b)
        if (!base) {
          base = data
          continue
        }
        for (const p of base.log.chunks?.paths ?? []) {
          const items = arrayAt(data.log, p)
          const into = arrayAt(base.log, p)
          if (items && into) for (const x of items) into.push(x)
        }
      }
      delete base.part
      text = JSON.stringify(base)
    }
    writeFileSync(`${dest}.part`, text)
    renameSync(`${dest}.part`, dest)
    console.log(`取ってきた: ${g.name}（${mb(text.length)}${g.of > 1 ? `、${g.of} つをつないだ` : ''}）`)
  } catch (e) {
    failed++
    console.error(`取ってこられなかった: ${g.name}（${e instanceof Error ? e.message : e}）`)
  }
}
if (failed) process.exit(1)
console.log(`比べるとき: npm run compare -- ${join(out, '<rfc-phone-….json>')} ${join(out, '<rfc-….json（カメラ版）>')}`)
