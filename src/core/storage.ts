import type { Baseline, RunLog, Session } from './types'
import type { VoiceKind } from './voices'
import { migrateProgress, startProgress, type Level, type Progress } from './level'

// 記録は端末の中だけ（IndexedDB）。基準と設定は localStorage
const DB = 'run-form-coach'
const STORE = 'sessions'
const LOGS = 'logs' // 調整用の記録（骨格の点と判定の数字）。直近10回分だけ残す
const KEEP_LOGS = 10
// スマホ版（src/modes/phone/）の記録。中身の形はスマホ版が決め、ここでは入れ物だけを用意する
export const PHONE_SESSIONS = 'phoneSessions'
export const PHONE_LOGS = 'phoneLogs'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(LOGS)) db.createObjectStore(LOGS, { keyPath: 'id' })
      for (const name of [PHONE_SESSIONS, PHONE_LOGS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
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

export async function saveLog(log: RunLog): Promise<void> {
  const db = await open()
  const all = await new Promise<RunLog[]>((resolve, reject) => {
    const req = db.transaction(LOGS).objectStore(LOGS).getAll()
    req.onsuccess = () => resolve(req.result as RunLog[])
    req.onerror = () => reject(req.error)
  })
  const old = all.sort((a, b) => b.startedAt - a.startedAt).slice(KEEP_LOGS - 1)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOGS, 'readwrite')
    const st = tx.objectStore(LOGS)
    for (const o of old) st.delete(o.id)
    st.put(log)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// id がなければ一番新しい記録
export async function loadLog(id?: string): Promise<RunLog | undefined> {
  const db = await open()
  const all = await new Promise<RunLog[]>((resolve, reject) => {
    const req = db.transaction(LOGS).objectStore(LOGS).getAll()
    req.onsuccess = () => resolve(req.result as RunLog[])
    req.onerror = () => reject(req.error)
  })
  if (id) return all.find((l) => l.id === id)
  return all.sort((a, b) => b.startedAt - a.startedAt)[0]
}

// 端末に残っている調整用の記録の id と始めた時刻（Mac へ送るしくみが、まだ送っていないものを探すのに使う）
export const loadLogStamps = async () => (await allRecords<RunLog>(LOGS)).map((l) => ({ logId: l.id, startedAt: l.startedAt }))

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
