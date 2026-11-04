import type { Baseline, RunLog, Session } from './types'
import type { VoiceKind } from './voices'
import { migrateProgress, startProgress, type Level, type Progress } from './level'
import { assembleLog, chunkId, LOG_CHUNK, type LogChunk } from './logChunks'

// 記録は端末の中だけ（IndexedDB）。基準と設定は localStorage。
// 入れ物の大きさ：Safari 17 から、ブラウザのアプリ（とホーム画面のアプリ）は1つのサイトにディスクの最大60%、ほかのアプリ（Bluefy などの中のブラウザ）は最大15%
// （WebKit「Updates to Storage Policy」2023-08-10）。7時間の記録は約70〜150MB なので、どちらでも足りる。消されないように persistStorage で頼む
const DB = 'run-form-coach'
const STORE = 'sessions'
const LOGS = 'logs' // 調整用の記録（骨格の点と判定の数字）。直近10回分だけ残す
const KEEP_LOGS = 10
// 長い走りの記録のかたまり（core/logChunks.ts）。id は `${記録の id}#000012`。記録の頭は LOGS に入れる
const CHUNKS = 'logChunks'
// 走っている途中の記録（id と最後に書き出した時刻）。開いたときに、走っている途中の記録を送らないため（落ちて止まった記録は送る）
const RECORDING_KEY = 'rfc.recording'
// スマホ版（src/modes/phone/）の記録。中身の形はスマホ版が決め、ここでは入れ物だけを用意する
export const PHONE_SESSIONS = 'phoneSessions'
export const PHONE_LOGS = 'phoneLogs'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 4)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(LOGS)) db.createObjectStore(LOGS, { keyPath: 'id' })
      for (const name of [PHONE_SESSIONS, PHONE_LOGS, CHUNKS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSession(s: Session): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(s)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const chunkRange = (logId: string) => IDBKeyRange.bound(`${logId}#`, `${logId}#\uffff`)
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

// 古い記録（新しいものから KEEP_LOGS 件より前）を、かたまりごと消す。記録の id は log-<始めた時刻> なので、id の並びが時刻の並び
async function pruneLogs(db: IDBDatabase, keep: string) {
  const keys = ((await request(db.transaction(LOGS).objectStore(LOGS).getAllKeys())) as string[]).filter((k) => k !== keep).sort()
  const old = keys.slice(0, Math.max(0, keys.length - (KEEP_LOGS - 1)))
  if (!old.length) return
  const tx = db.transaction([LOGS, CHUNKS], 'readwrite')
  for (const id of old) {
    tx.objectStore(LOGS).delete(id)
    tx.objectStore(CHUNKS).delete(chunkRange(id))
  }
  await done(tx)
}

// 走り終わった記録を1回で書く（前からの形。少しずつ書き出していない記録）
export async function saveLog(log: RunLog): Promise<void> {
  const db = await open()
  await pruneLogs(db, log.id)
  const tx = db.transaction(LOGS, 'readwrite')
  tx.objectStore(LOGS).put(log)
  await done(tx)
}

// 走っている間の書き出し（core/logChunks.ts の LogSaver から）：かたまりと記録の頭を1回で書く。最初の書き出しで古い記録を消す
let pruned = ''
export async function writeLogChunk(meta: RunLog, chunk: LogChunk | null): Promise<void> {
  const db = await open()
  if (pruned !== meta.id) {
    pruned = meta.id
    await pruneLogs(db, meta.id).catch(() => {})
  }
  const tx = db.transaction([LOGS, CHUNKS], 'readwrite')
  if (chunk) tx.objectStore(CHUNKS).put(chunk)
  tx.objectStore(LOGS).put(meta)
  await done(tx)
  try {
    if (meta.recording) localStorage.setItem(RECORDING_KEY, JSON.stringify({ id: meta.id, at: Date.now() }))
    else localStorage.removeItem(RECORDING_KEY)
  } catch {
    /* 保存できない環境では何もしない */
  }
}

const getChunk = (db: IDBDatabase, logId: string) => (n: number) => request(db.transaction(CHUNKS).objectStore(CHUNKS).get(chunkId(logId, n))) as Promise<LogChunk | undefined>

// 一番新しい記録の id（中身は読まない）
async function latestLogId(db: IDBDatabase): Promise<string | undefined> {
  const keys = (await request(db.transaction(LOGS).objectStore(LOGS).getAllKeys())) as string[]
  return keys.sort().at(-1)
}

// 記録の頭だけ（かたまりにした配列は、書き出す前に残っていた分しか入っていない）。id がなければ一番新しい記録
export async function loadLogMeta(id?: string): Promise<RunLog | undefined> {
  const db = await open()
  const key = id ?? (await latestLogId(db))
  if (!key) return undefined
  return (await request(db.transaction(LOGS).objectStore(LOGS).get(key))) as RunLog | undefined
}

// id がなければ一番新しい記録。少しずつ書き出した記録は、かたまりをつないで返す
export async function loadLog(id?: string): Promise<RunLog | undefined> {
  const meta = await loadLogMeta(id)
  if (!meta) return undefined
  return assembleLog(meta, getChunk(await open(), meta.id))
}

// 記録の頭と、かたまりを1つずつ読む口（送る・書き出すときに、つないだ1つの文字列を作らないため。core/logChunks.ts の logPieces）
export async function logChunkReader(id?: string): Promise<{ meta: RunLog; get: (n: number) => Promise<LogChunk | undefined> } | undefined> {
  const meta = await loadLogMeta(id)
  if (!meta) return undefined
  return { meta, get: getChunk(await open(), meta.id) }
}

// 端末に残っている調整用の記録の id と始めた時刻（Mac へ送るしくみが、まだ送っていないものを探すのに使う）。
// 中身は読まない（記録の id は log-<始めた時刻>）。走っている途中の記録は入れない（止まってから LOG_CHUNK.staleMs たった記録は入れる）
export async function loadLogStamps(now = Date.now()): Promise<{ logId: string; startedAt: number }[]> {
  const db = await open()
  const keys = (await request(db.transaction(LOGS).objectStore(LOGS).getAllKeys())) as string[]
  let rec: { id: string; at: number } | null = null
  try {
    rec = JSON.parse(localStorage.getItem(RECORDING_KEY) ?? 'null')
  } catch {
    rec = null
  }
  return keys
    .filter((k) => !(rec && rec.id === k && now - rec.at < LOG_CHUNK.staleMs))
    .map((k) => ({ logId: k, startedAt: Number(k.replace(/^log-/, '')) || 0 }))
}

// 入り口ごとの入れ物に1件入れる（id で上書き）。keep があれば、startedAt の新しいものから keep 件だけ残す
export async function putRecord<T extends { id: string; startedAt: number }>(store: string, v: T, keep?: number): Promise<void> {
  const db = await open()
  const old = keep ? (await allRecords<T>(store)).filter((o) => o.id !== v.id).sort((a, b) => b.startedAt - a.startedAt).slice(keep - 1) : []
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const st = tx.objectStore(store)
    for (const o of old) st.delete(o.id)
    st.put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// 入り口ごとの入れ物の中身すべて（新しい順）
export async function allRecords<T extends { startedAt: number }>(store: string): Promise<T[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll()
    req.onsuccess = () => resolve((req.result as T[]).sort((a, b) => b.startedAt - a.startedAt))
    req.onerror = () => reject(req.error)
  })
}

// 端末の記録を消されないように頼む（Safari はホーム画面のアプリなどで認める。必ず認められるわけではない）。いまの様子を返す（使えなければ undefined）
export async function persistStorage(): Promise<RunLog['storage']> {
  const st = typeof navigator === 'undefined' ? undefined : (navigator.storage as StorageManager | undefined)
  if (!st) return undefined
  const out: NonNullable<RunLog['storage']> = {}
  try {
    out.persisted = (await st.persisted?.()) || (await st.persist?.()) || false
  } catch {
    /* 使えないブラウザ */
  }
  try {
    const e = await st.estimate?.()
    if (e) {
      out.usage = e.usage
      out.quota = e.quota
    }
  } catch {
    /* 使えないブラウザ */
  }
  return out
}

export async function loadSessions(): Promise<Session[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as Session[]).sort((a, b) => b.startedAt - a.startedAt))
    req.onerror = () => reject(req.error)
  })
}

const read = <T>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 保存できない環境では何もしない */
  }
}

// 直立の基準は走るたびに取り直す。直近5回分を残し、今日の基準が甘すぎないかの比較に使う
export const loadBaselines = (): Baseline[] => read<Baseline[]>('rfc.baselines') ?? (read<Baseline>('rfc.baseline') ? [read<Baseline>('rfc.baseline')!] : [])
export const saveBaseline = (b: Baseline) => write('rfc.baselines', [...loadBaselines(), b].slice(-5))

export interface Settings {
  screen: 'show' | 'dark'
  voice: VoiceKind
  camera: 'front' | 'back' // 前面は画面を見ながら置ける。背面は暗い場所に強い
}
export const loadSettings = (): Settings => ({ voice: 'female', ...(read<Partial<Settings>>('rfc.settings') ?? {}), screen: 'dark', camera: 'back' }) // 今の段階は背面カメラだけを使う
export const saveSettings = (s: Settings) => write('rfc.settings', s)

// ランナーのレベルと、注意する項目の段階。初めては初心者から。段階の並びを変える前の記録は、いまの並びに直して読む
export const loadProgress = (): Progress => {
  const p = read<Progress>('rfc.progress')
  return p ? migrateProgress(p) : startProgress('beginner')
}
export const saveProgress = (p: Progress) => write('rfc.progress', p)
export const setLevel = (level: Level): Progress => {
  const p = startProgress(level)
  saveProgress(p)
  return p
}
