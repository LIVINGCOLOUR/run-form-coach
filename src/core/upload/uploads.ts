// 記録を送るしくみの、端末の側の入れ物（順番待ちと送る鍵は localStorage）と、画面へ知らせる口。
// 送る鍵がある端末でだけ、走り終わった記録を順番待ちに入れる（鍵がなければ何もしない）。
// 記録の中身は入り口ごとに持っているので、入り口が registerUploadSource で取り出し方と、端末に残っている記録の一覧を渡す
import { packJson } from './pack'
import { addEntry, backfillEntries, entryId, flushQueue, resetWaits, type LocalLog, type UploadEntry, type UploadPayload } from './queue'
import { sendRun } from './send'

const LIST_KEY = 'rfc.uploads'
const KEY_KEY = 'rfc.uploadKey'

// テスト期間だけの、送る鍵の既定（Vercel の UPLOAD_KEY と同じ）。鍵を入れていない端末でも、走り終わったら自動で送る。
// ホーム画面のアプリと Safari のタブは localStorage が別なので、鍵を入れ忘れた側の記録が送られなかったことがある。
// ほかの人に使ってもらう前に、必ず null にする（Vercel の UPLOAD_KEY も変える）。手で入れた鍵があれば、そちらを使う
export const TEST_UPLOAD_KEY: string | null = 'run'

interface UploadSource {
  load: (logId: string) => Promise<UploadPayload | undefined>
  list?: () => Promise<Omit<LocalLog, 'kind'>[]> // 端末に残っている記録（まだ順番待ちにないものを、開いたときに入れる）
}
const sources = new Map<string, UploadSource>()
export const registerUploadSource = (kind: string, load: UploadSource['load'], list?: UploadSource['list']) => {
  sources.set(kind, { load, list })
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
  hasKey: boolean // 送る鍵がある（手で入れた鍵か、テスト期間の既定）
  manualKey: boolean // 手で入れた鍵がある
  sending: string | null // 送っている記録の id
  pct: number // 送っている記録の進み（%）
}

let sending: string | null = null
let pct = 0
const listeners = new Set<() => void>()
let view: UploadView = { list: [], hasKey: false, manualKey: false, sending: null, pct: 0 }
const changed = () => {
  view = { list: getList(), hasKey: !!getUploadKey(), manualKey: !!getStoredUploadKey(), sending, pct }
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

// 手で入れた鍵
const getStoredUploadKey = () => read<string | null>(KEY_KEY, null)
// 送るときに使う鍵：手で入れた鍵、なければテスト期間の既定
export const getUploadKey = () => getStoredUploadKey() || TEST_UPLOAD_KEY
// 空にすると、手で入れた鍵を消す（テスト期間の既定に戻る）
export function setUploadKey(key: string | null) {
  write(KEY_KEY, key?.trim() || null)
  write(LIST_KEY, resetWaits(getList()))
  changed()
  void flushUploads(true)
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
        const load = sources.get(e.kind)?.load
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

// 端末に残っている記録のうち、まだ順番待ちにないものを入れる（このしくみの前の記録や、鍵がなかったときの記録も送るため）。
// 送れたもの・消えたものは入れ直さない
export async function backfillUploads(now = Date.now()): Promise<void> {
  if (!getUploadKey()) return
  const logs: LocalLog[] = []
  for (const [kind, s] of sources) {
    if (!s.list) continue
    try {
      for (const l of await s.list()) logs.push({ ...l, kind })
    } catch {
      /* 記録を読めない入り口は飛ばす */
    }
  }
  const before = getList()
  const after = backfillEntries(before, logs, now)
  if (after !== before) setList(after)
}

// アプリを開いたときに1回呼ぶ。端末に残っている記録を入れてから送る。電波がつながったとき・画面に戻ったときに送り直す
let started = false
export function startUploads() {
  changed()
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => void flushUploads())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushUploads()
  })
  void backfillUploads().then(() => flushUploads())
}
