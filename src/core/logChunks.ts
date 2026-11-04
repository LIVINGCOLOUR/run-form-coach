import type { RunLog } from './types'

// 長い走り（マラソンで7時間まで）の記録を、1つの大きな配列や1つの大きな IndexedDB の件にしないためのしくみ。
// 走っている間、every 秒ごとに、大きくなる配列（paths：カメラの骨格の行・センサーの値・1秒ごとのまとめ）の中身を手元から取り出して
// 1つの「かたまり」（chunk）として端末へ書き、残り（記録の頭：events や知らせた記録など）もいっしょに書き直す。
// アプリが落ちても、書いたところまでは残る。読むとき（loadLog）はつなぎ直し、送るとき・書き出すときは、つないだ1つの文字列を作らずに
// かたまりごとに JSON の切れはしを流す（pieces）。長い記録は perPart かたまりごとに別のファイルに分けて送り、Mac（npm run logs）でつなぐ
// 端末の入れ物そのもの（IndexedDB）は storage.ts。ここは入れ物から切り離した計算だけ（テストで確かめられるように）

export const LOG_CHUNK = {
  every: 60, // 書き出す間隔（秒）
  // 送るときに1つのファイルに入れるかたまりの数（60秒 × 120 = 2時間）。カメラ版の骨格とセンサーで約22MB/時、
  // gzip で約10MB/時なので、1ファイル 約20MB（送り先の上限 api/upload.ts の MAX_BYTES 64MB の内側）
  perPart: 120,
  paths: ['rows', 'sensors.blocks', 'sensors.sec'],
  staleMs: 3 * 60_000, // recording のままこれより長く書き出していなければ、止まった（落ちた）記録とみなして送ってよい
}

export interface LogChunk {
  id: string // `${logId}#000012`
  logId: string
  n: number // 何番目のかたまりか（0 から）
  data: Record<string, unknown[]> // paths ごとの中身
}

export const chunkId = (logId: string, n: number) => `${logId}#${String(n).padStart(6, '0')}`

type Obj = Record<string, unknown>
// path（'sensors.blocks' など）の配列。make なら、なければ作る（親がなければ作らない）
function arrayAt(o: Obj, path: string, make = false): unknown[] | undefined {
  const keys = path.split('.')
  let cur: Obj | undefined = o
  for (const k of keys.slice(0, -1)) {
    const next: unknown = cur?.[k]
    if (!next || typeof next !== 'object') return undefined
    cur = next as Obj
  }
  const last = keys[keys.length - 1]
  const v = cur[last]
  if (Array.isArray(v)) return v
  if (make && cur) {
    const a: unknown[] = []
    cur[last] = a
    return a
  }
  return undefined
}

// 記録の paths の配列の中身を取り出して（記録の配列は空になる）、n 番目のかたまりにする。どれも空なら null
export function takeChunk(log: RunLog, n: number, paths = LOG_CHUNK.paths): LogChunk | null {
  const data: Record<string, unknown[]> = {}
  let any = false
  for (const p of paths) {
    const a = arrayAt(log as unknown as Obj, p)
    if (!a?.length) continue
    data[p] = a.splice(0, a.length)
    any = true
  }
  return any ? { id: chunkId(log.id, n), logId: log.id, n, data } : null
}

// 書き出せなかったかたまりを、記録の配列の先頭へ戻す（次の書き出しで、もう一度書く）
export function restoreChunk(log: RunLog, c: LogChunk) {
  for (const [p, items] of Object.entries(c.data)) {
    const a = arrayAt(log as unknown as Obj, p, true)
    if (a) a.unshift(...items)
  }
}

// かたまりを記録の配列のうしろへ足す（読むときにつなぐ）
export function appendChunk(log: RunLog, c: LogChunk) {
  for (const [p, items] of Object.entries(c.data)) {
    const a = arrayAt(log as unknown as Obj, p, true)
    if (a) for (const x of items) a.push(x)
  }
}

// 書き出すときの入れ物（storage.ts の IndexedDB。テストでは作り物）
export interface ChunkSink {
  // かたまり（なければ記録の頭だけ）と記録の頭を、1回で書く
  write(meta: RunLog, chunk: LogChunk | null): Promise<void>
}

// 走っている間の記録を、少しずつ書き出す。flush は重ねて呼んでも順に1つずつ書く
export class LogSaver {
  private n = 0
  private chain: Promise<void> = Promise.resolve()
  failures = 0 // 書き出せなかった回数（中身は手元に戻して、次にもう一度書く）
  private readonly log: RunLog
  private readonly sink: ChunkSink
  private readonly paths: string[]

  constructor(log: RunLog, sink: ChunkSink, paths = LOG_CHUNK.paths) {
    this.log = log
    this.sink = sink
    this.paths = paths
  }

  // final：走り終わり（recording を false にする）
  flush(final = false): Promise<void> {
    this.chain = this.chain.then(() => this.write(final))
    return this.chain
  }

  private async write(final: boolean) {
    const log = this.log
    const chunk = takeChunk(log, this.n, this.paths)
    const n = chunk ? this.n + 1 : this.n
    log.chunks = { n, paths: this.paths }
    log.recording = !final
    log.updatedAt = Date.now()
    try {
      await this.sink.write(log, chunk)
      this.n = n
    } catch {
      this.failures++
      if (chunk) restoreChunk(log, chunk)
      log.chunks = { n: this.n, paths: this.paths }
    }
  }
}

// 端末の記録の頭と、かたまりを1つずつ読む口から、{ log, session } をつないだもの
export async function assembleLog(meta: RunLog, get: (n: number) => Promise<LogChunk | undefined>): Promise<RunLog> {
  if (!meta.chunks?.n) return meta
  // 頭に残っていた中身（書き出す前のもの）は、かたまりのあとに来る
  const tail: LogChunk = { id: '', logId: meta.id, n: -1, data: {} }
  for (const p of meta.chunks.paths) {
    const a = arrayAt(meta as unknown as Obj, p)
    if (a?.length) tail.data[p] = a.splice(0, a.length)
  }
  for (let n = 0; n < meta.chunks.n; n++) {
    const c = await get(n)
    if (c) appendChunk(meta, c)
  }
  appendChunk(meta, tail)
  return meta
}

// 送るときのファイルの数
export const partCount = (meta: RunLog, perPart = LOG_CHUNK.perPart) => Math.max(1, Math.ceil((meta.chunks?.n ?? 0) / perPart))

const MARK = (p: string) => `\u0000chunk:${p}`

// { log, session } の JSON を、1つの大きな文字列を作らずに切れはしで流す。
// part（0 から）を渡すと、そのファイルに入るかたまりだけ（記録の頭はどのファイルにも入れ、session は最初のファイルだけ）。
// 2つ以上に分けるときは "part": [何番目（1 から）, いくつ] を付ける（npm run logs が chunks.paths の配列をつなぐ）
export async function* logPieces(meta: RunLog, session: unknown, get: (n: number) => Promise<LogChunk | undefined>, part?: number, perPart = LOG_CHUNK.perPart): AsyncGenerator<string> {
  const total = meta.chunks?.n ?? 0
  const parts = partCount(meta, perPart)
  const [from, to] = part === undefined ? [0, total] : [part * perPart, Math.min(total, (part + 1) * perPart)]
  const last = part === undefined || part === parts - 1
  const paths = meta.chunks?.paths ?? []
  // 頭の配列のうち、かたまりにしたもの（の場所）を印に置き換える
  const marks = new Map<unknown, string>()
  for (const p of paths) {
    const a = arrayAt(meta as unknown as Obj, p)
    if (a) marks.set(a, p)
  }
  const head = JSON.stringify(meta, (_k, v) => (marks.has(v) ? MARK(marks.get(v)!) : v))
  const tag = parts > 1 && part !== undefined ? `"part":[${part + 1},${parts}],` : ''
  yield `{${tag}"log":`
  let rest = head
  for (;;) {
    let at = -1
    let which = ''
    for (const p of paths) {
      const i = rest.indexOf(JSON.stringify(MARK(p)))
      if (i >= 0 && (at < 0 || i < at)) {
        at = i
        which = p
      }
    }
    if (at < 0) break
    yield rest.slice(0, at)
    rest = rest.slice(at + JSON.stringify(MARK(which)).length)
    // その場所の配列：かたまりの中身を順に、最後のファイルには頭に残っていた中身も
    yield '['
    let first = true
    const emit = function* (items: unknown[] | undefined) {
      if (!items?.length) return
      const s = JSON.stringify(items)
      yield (first ? '' : ',') + s.slice(1, -1)
      first = false
    }
    for (let n = from; n < to; n++) yield* emit((await get(n))?.data[which])
    if (last) yield* emit(arrayAt(meta as unknown as Obj, which))
    yield ']'
  }
  yield rest
  yield part === undefined || part === 0 ? (session === undefined ? '}' : `,"session":${JSON.stringify(session)}}`) : '}'
}

// 分けて送ったファイル（logPieces の part ごと）を、1つの { log, session } に戻す（npm run logs と同じ計算。テスト用）
export function mergeParts(parts: { part?: [number, number]; log: RunLog; session?: unknown }[]): { log: RunLog; session?: unknown } {
  const sorted = [...parts].sort((a, b) => (a.part?.[0] ?? 1) - (b.part?.[0] ?? 1))
  const base = sorted[0]
  for (const x of sorted.slice(1)) {
    for (const p of base.log.chunks?.paths ?? []) {
      const items = arrayAt(x.log as unknown as Obj, p)
      if (items?.length) appendChunk(base.log, { id: '', logId: base.log.id, n: -1, data: { [p]: items } })
    }
  }
  return { log: base.log, session: base.session }
}
