// 送る記録を1つのかたまり（Blob）にする。CompressionStream があれば gzip で縮める（生の値の JSON は 1/5〜1/10 ほどになる）。
// 古い Android の Chrome（79 まで）などで CompressionStream がない・失敗したときは、縮めずにそのまま送る
export interface Packed {
  body: Blob
  gzip: boolean
}

export async function packJson(data: unknown, opts: { compress?: boolean } = {}): Promise<Packed> {
  const text = JSON.stringify(data)
  const raw = new Blob([text], { type: 'application/json' })
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (opts.compress === false || typeof CS !== 'function' || typeof raw.stream !== 'function') return { body: raw, gzip: false }
  try {
    const stream = raw.stream().pipeThrough(new CS('gzip'))
    const body = await new Response(stream).blob()
    return { body: new Blob([body], { type: 'application/gzip' }), gzip: true }
  } catch {
    return { body: raw, gzip: false }
  }
}

// 長い記録（core/logChunks.ts の logPieces）を、1つの大きな文字列を作らずに縮める。切れはしを1つずつ gzip に流すので、
// 手元に持つのは縮めたあとのもの（7時間でも数十MB）だけ。縮められないときは、切れはしを並べた Blob（中身はつながない）にする。
// pieces は、縮める途中で失敗したときに初めから流し直せるよう、呼ぶたびに新しい並びを返すものを渡す
export async function packPieces(pieces: () => AsyncIterable<string>, opts: { compress?: boolean } = {}): Promise<Packed> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  const plain = async (): Promise<Packed> => {
    const parts: string[] = []
    for await (const s of pieces()) parts.push(s)
    return { body: new Blob(parts, { type: 'application/json' }), gzip: false }
  }
  if (opts.compress === false || typeof CS !== 'function' || typeof ReadableStream !== 'function') return plain()
  try {
    const it = pieces()[Symbol.asyncIterator]()
    const enc = new TextEncoder()
    const src = new ReadableStream<Uint8Array>({
      async pull(c) {
        const r = await it.next()
        if (r.done) c.close()
        else if (r.value) c.enqueue(enc.encode(r.value))
      },
    })
    const body = await new Response(src.pipeThrough(new CS('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).blob()
    return { body: new Blob([body], { type: 'application/gzip' }), gzip: true }
  } catch {
    return plain()
  }
}
