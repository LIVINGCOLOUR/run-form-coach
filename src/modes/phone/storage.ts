import { shareJson } from '../../core/exportLog'
import { allRecords, PHONE_LOGS, PHONE_SESSIONS, putRecord } from '../../core/storage'
import type { UploadPayload } from '../../core/upload/queue'
import type { PhoneLog } from './log'
import type { PhoneSession } from './session'

// スマホ版の結果と調整用の記録。端末の中だけ（IndexedDB）。調整用の記録は直近10回分だけ残す（カメラ版と同じ）
const KEEP_LOGS = 10

export const savePhoneSession = (s: PhoneSession) => putRecord(PHONE_SESSIONS, s)
export const loadPhoneSessions = () => allRecords<PhoneSession>(PHONE_SESSIONS)
export const savePhoneLog = (log: PhoneLog) => putRecord(PHONE_LOGS, log, KEEP_LOGS)

// id がなければ一番新しい記録
export async function loadPhoneLog(id?: string): Promise<PhoneLog | undefined> {
  const all = await allRecords<PhoneLog>(PHONE_LOGS)
  return id ? all.find((l) => l.id === id) : all[0]
}

// 調整用の記録をファイルにして渡す（カメラ版と同じ形：{ log, session }）。ファイル名は rfc-phone-年月日-時分.json
export async function exportPhoneLog(logId?: string): Promise<boolean> {
  const p = await phoneLogPayload(logId)
  return p ? shareJson(p.name, p.data) : false
}

// 書き出しと、Mac へ送る記録（core/upload）の中身。npm run compare にそのまま渡せる形
export async function phoneLogPayload(logId?: string): Promise<UploadPayload | undefined> {
  const log = await loadPhoneLog(logId)
  if (!log) return undefined
  const session = (await loadPhoneSessions()).find((s) => s.logId === log.id)
  return { name: phoneLogName(log.startedAt), data: { log, session } }
}

export function phoneLogName(startedAt: number): string {
  const d = new Date(startedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `rfc-phone-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}
