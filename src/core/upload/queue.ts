// 記録を送る順番待ち（中身は持たず、どの記録かだけを持つ）。ここは画面や保存先から切り離した計算だけ。
// 走り終わったら入れ、ホームを開いたとき・電波がつながったときなどに、古いものから1件ずつ送る。
// 送れなかったものは待つ間を倍々にのばして（30秒→…→30分）送り直す。鍵が違うと言われたら、鍵を入れ直すまで送らない
import type { Packed } from './pack'

export type UploadState = 'waiting' | 'sent' | 'gone'

export interface UploadEntry {
  id: string // `${kind}:${logId}`
  kind: string // 'phone'（スマホ版）か 'camera'（カメラ版）
  logId: string
  startedAt: number
  state: UploadState // waiting：まだ送れていない。sent：送れた。gone：端末から記録が消えていて送れない
  tries: number // 送ろうとして失敗した回数
  lastTryAt?: number
  sentAt?: number
  pathname?: string // 送った先の名前
  error?: string // 最後に送れなかった理由（画面に出す）
  badKey?: boolean // 送る鍵が違うと言われた
}

export const UPLOAD = {
  firstWaitMs: 30_000, // 1回目の失敗のあと、次に送るまで
  maxWaitMs: 30 * 60_000, // 待つ間の上限
  keep: 30, // 順番待ちに残す数（送れたもの・消えたものから捨てる）
}

// tries 回失敗したあと、次に送るまでの待ち
export const backoffMs = (tries: number) => (tries <= 0 ? 0 : Math.min(UPLOAD.firstWaitMs * 2 ** (tries - 1), UPLOAD.maxWaitMs))

export const entryId = (kind: string, logId: string) => `${kind}:${logId}`

// 入れる。同じ記録がすでにあれば何もしない（送れたものをもう一度送らない）。多すぎたら、送れた・消えたものの古いものから捨てる
export function addEntry(list: UploadEntry[], kind: string, logId: string, startedAt: number): UploadEntry[] {
  const id = entryId(kind, logId)
  if (list.some((e) => e.id === id)) return list
  return trim([...list, { id, kind, logId, startedAt, state: 'waiting', tries: 0 }])
}

function trim(list: UploadEntry[]): UploadEntry[] {
  if (list.length <= UPLOAD.keep) return list
  const done = list.filter((e) => e.state !== 'waiting').sort((a, b) => a.startedAt - b.startedAt)
  const drop = new Set(done.slice(0, list.length - UPLOAD.keep).map((e) => e.id))
  return list.filter((e) => !drop.has(e.id))
}

// いま送るもの（古い順）。force：待つ間を無視する（「今すぐ送る」）。鍵が違うと言われたものは、鍵を入れ直すまで送らない
export function dueEntries(list: UploadEntry[], now: number, force = false): UploadEntry[] {
  return list
    .filter((e) => e.state === 'waiting' && !e.badKey && (force || e.lastTryAt === undefined || now - e.lastTryAt >= backoffMs(e.tries)))
    .sort((a, b) => a.startedAt - b.startedAt)
}

export type SendResult = { ok: true; pathname: string } | { ok: false; error: string; badKey?: boolean }

export function markResult(list: UploadEntry[], id: string, r: SendResult | 'gone', now: number): UploadEntry[] {
  return list.map((e) => {
    if (e.id !== id) return e
    if (r === 'gone') return { ...e, state: 'gone', error: undefined, lastTryAt: now }
    if (r.ok) return { ...e, state: 'sent', sentAt: now, lastTryAt: now, pathname: r.pathname, error: undefined, badKey: undefined }
    return { ...e, tries: e.tries + 1, lastTryAt: now, error: r.error, badKey: r.badKey || undefined }
  })
}

// 鍵を入れ直したら、鍵が違うと言われたもの・待っているものをすぐ送れるようにする
export const resetWaits = (list: UploadEntry[]): UploadEntry[] => list.map((e) => (e.state === 'waiting' ? { ...e, tries: 0, lastTryAt: undefined, badKey: undefined } : e))

// 送り先の名前。runs/<kind>/<書き出しと同じ名前>_<記録の id>.json(.gz)
// Mac の npm run logs は、この名前から .gz と記録の id を外して、書き出しと同じ名前で保存する
export function uploadPathname(kind: string, name: string, logId: string, gzip: boolean): string {
  const base = name.replace(/\.json$/, '')
  const id = logId.replace(/[^A-Za-z0-9-]/g, '-')
  return `runs/${kind}/${base}_${id}.json${gzip ? '.gz' : ''}`
}

// 送る記録の中身。name は書き出しのファイル名（rfc-phone-年月日-時分.json など）
export interface UploadPayload {
  name: string
  data: unknown
}

export interface FlushDeps {
  getList: () => UploadEntry[]
  setList: (list: UploadEntry[]) => void
  load: (e: UploadEntry) => Promise<UploadPayload | undefined>
  pack: (data: unknown) => Promise<Packed>
  send: (pathname: string, p: Packed, onProgress?: (pct: number) => void) => Promise<SendResult>
  now: () => number
  onSending?: (id: string | null, pct?: number) => void
}

// 送れるものを古い順に1件ずつ送る。鍵が違うと言われたら、そこでやめる（ほかのものも同じ鍵で送るので）
export async function flushQueue(deps: FlushDeps, force = false): Promise<void> {
  const ids = dueEntries(deps.getList(), deps.now(), force).map((e) => e.id)
  try {
    for (const id of ids) {
      // 送っている間に順番待ちが変わることがあるので、毎回読み直す
      const e = deps.getList().find((x) => x.id === id)
      if (!e || e.state !== 'waiting' || e.badKey) continue
      deps.onSending?.(id, 0)
      let r: SendResult | 'gone'
      try {
        const p = await deps.load(e)
        if (!p) r = 'gone'
        else {
          const packed = await deps.pack(p.data)
          r = await deps.send(uploadPathname(e.kind, p.name, e.logId, packed.gzip), packed, (pct) => deps.onSending?.(id, pct))
        }
      } catch (err) {
        r = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      deps.setList(markResult(deps.getList(), id, r, deps.now()))
      if (r !== 'gone' && !r.ok && r.badKey) break
    }
  } finally {
    deps.onSending?.(null)
  }
}
