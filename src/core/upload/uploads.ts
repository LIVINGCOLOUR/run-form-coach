// 記録を送るしくみの、端末の側の入れ物（順番待ちと送る鍵は localStorage）と、画面へ知らせる口。
// 送る鍵が入っている端末でだけ、走り終わった記録を順番待ちに入れる（ほかの人の端末では何もしない）。
// 記録の中身は入り口ごとに持っているので、入り口が registerUploadSource で取り出し方を渡す
import { packJson } from './pack'
import { addEntry, entryId, flushQueue, resetWaits, type UploadEntry, type UploadPayload } from './queue'
import { sendRun } from './send'

const LIST_KEY = 'rfc.uploads'
const KEY_KEY = 'rfc.uploadKey'

const sources = new Map<string, (logId: string) => Promise<UploadPayload | undefined>>()
export const registerUploadSource = (kind: string, load: (logId: string) => Promise<UploadPayload | undefined>) => {
  sources.set(kind, load)
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 保存できない環境では何もしない */
  }
}

export interface UploadView {
  list: UploadEntry[]
  hasKey: boolean
  sending: string | null // 送っている記録の id
  pct: number // 送っている記録の進み（%）
}

let sending: string | null = null
let pct = 0
const listeners = new Set<() => void>()
let view: UploadView = { list: [], hasKey: false, sending: null, pct: 0 }
const changed = () => {
  view = { list: getList(), hasKey: !!getUploadKey(), sending, pct }
  listeners.forEach((f) => f())
}
export const subscribeUploads = (f: () => void) => {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
// useSyncExternalStore 用。変わったときだけ別のものを返す
export const uploadView = () => view

const getList = () => read<UploadEntry[]>(LIST_KEY, [])
const setList = (list: UploadEntry[]) => {
  write(LIST_KEY, list)
  changed()
}

export const getUploadKey = () => read<string | null>(KEY_KEY, null)
export function setUploadKey(key: string | null) {
  write(KEY_KEY, key?.trim() || null)
  write(LIST_KEY, resetWaits(getList()))
  changed()
  if (key) void flushUploads(true)
}

export const findUpload = (kind: string, logId: string) => view.list.find((e) => e.id === entryId(kind, logId))

// 走り終わったら呼ぶ。鍵がなければ何もしない。入れたらすぐ送ってみる
export function queueUpload(kind: string, logId: string, startedAt: number) {
  if (!getUploadKey()) return
  setList(addEntry(getList(), kind, logId, startedAt))
  void flushUploads()
}

let running: Promise<void> | null = null
// 送れるものを送る。同時に2つは動かさない。電波がないと分かっているときは何もしない（つながったら online で呼ぶ）
export function flushUploads(force = false): Promise<void> {
  const key = getUploadKey()
  if (!key || running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return running ?? Promise.resolve()
  running = flushQueue(
    {
      getList,
      setList,
      load: async (e) => {
        const load = sources.get(e.kind)
        // 取り出し方が分からないだけのときは「消えた」にしない
        if (!load) throw new Error(`記録の取り出し方がありません（${e.kind}）`)
        return load(e.logId)
      },
      pack: (data) => packJson(data),
      send: (pathname, p, onProgress) => sendRun(pathname, p, key, onProgress),
      now: () => Date.now(),
      onSending: (id, p) => {
        sending = id
        pct = p ?? 0
        changed()
      },
    },
    force,
  ).finally(() => {
    running = null
  })
  return running
}

// アプリを開いたときに1回呼ぶ。電波がつながったとき・画面に戻ったときに送り直す
let started = false
export function startUploads() {
  changed()
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => void flushUploads())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushUploads()
  })
  void flushUploads()
}
