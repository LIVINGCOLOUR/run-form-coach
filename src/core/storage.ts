import type { Baseline, Session } from './types'
import type { VoiceKind } from './voices'

// 記録は端末の中だけ（IndexedDB）。基準と設定は localStorage
const DB = 'run-form-coach'
const STORE = 'sessions'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
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

// 猫背ぎみに立った日に基準が甘くならないよう、直近の基準の真ん中より5°以上悪い分は5°までに抑える
export const BASELINE_SLACK = 5
export function capBaseline(neck: number, history: Baseline[]): number {
  if (!history.length) return neck
  const sorted = history.map((b) => b.neck).sort((a, b) => a - b)
  return Math.min(neck, sorted[Math.floor(sorted.length / 2)] + BASELINE_SLACK)
}

export interface Settings {
  screen: 'show' | 'dark'
  voice: VoiceKind
  camera: 'front' | 'back' // 前面は画面を見ながら置ける。背面は暗い場所に強い
}
export const loadSettings = (): Settings => ({ screen: 'dark', voice: 'female', ...(read<Partial<Settings>>('rfc.settings') ?? {}), camera: 'back' }) // 今の段階は背面カメラだけを使う
export const saveSettings = (s: Settings) => write('rfc.settings', s)
