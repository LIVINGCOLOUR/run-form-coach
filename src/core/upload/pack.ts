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
