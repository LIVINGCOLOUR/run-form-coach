import { shareFile } from '../../core/exportLog'
import { allRecords, deleteLog, loadLog, loadLogStamps, logChunkReader, PHONE_LOGS, PHONE_SESSIONS, putRecord, writeLogChunk } from '../../core/storage'
import { LogSaver, logPieces, partCount } from '../../core/logChunks'
import type { UploadPayload } from '../../core/upload/queue'
import type { PhoneLog } from './log'
import type { PhoneSession, PhoneWhere } from './session'

// スマホ版の結果と調整用の記録。端末の中だけ（IndexedDB）。
// 調整用の記録は、走っている間 60秒ごとに端末へ少しずつ書き出す（core/logChunks.ts。カメラ版と同じしくみ。生の値に上限を置かず、7時間でも残す）。
// 何本残すかは core/upload/uploads.ts の KEEP_RUNS（Mac へ送れたものだけ消す）

// 少しずつ書き出す配列（生の値・1秒ごとの値・GPS）
export const PHONE_LOG_PATHS = ['rows', 'seconds', 'gps']

export const savePhoneSession = (s: PhoneSession) => putRecord(PHONE_SESSIONS, s)
export const loadPhoneSessions = () => allRecords<PhoneSession>(PHONE_SESSIONS)
// 走っている間の記録を、少しずつ端末へ書き出すもの（flush を LOG_CHUNK.every 秒ごとに、走り終わりに flush(true)）
export const phoneLogSaver = (log: PhoneLog) => new LogSaver(log, { write: (meta, chunk) => writeLogChunk(meta, chunk, PHONE_LOGS) }, PHONE_LOG_PATHS)
export const deletePhoneLog = (id: string) => deleteLog(PHONE_LOGS, id)

// id がなければ一番新しい記録（かたまりをつないで返す）
export const loadPhoneLog = (id?: string) => loadLog<PhoneLog>(id, PHONE_LOGS)

// 端末に残っている調整用の記録の id と始めた時刻（Mac へ送るしくみが、まだ送っていないものを探すのに使う。走っている途中の記録は入れない）
export const loadPhoneLogStamps = () => loadLogStamps(Date.now(), PHONE_LOGS)

// 調整用の記録をファイルにして渡す（カメラ版と同じ形：{ log, session }）。ファイル名は rfc-phone-年月日-時分.json
export async function exportPhoneLog(logId?: string): Promise<boolean> {
  const r = await logChunkReader<PhoneLog>(logId, PHONE_LOGS)
  if (!r) return false
  const session = (await loadPhoneSessions()).find((s) => s.logId === r.meta.id)
  const parts: string[] = []
  for await (const x of logPieces(r.meta, session, r.get)) parts.push(x)
  return shareFile(new File(parts, phoneLogName(r.meta.startedAt), { type: 'application/json' }))
}

// 書き出しと、Mac へ送る記録（core/upload）の中身。npm run compare にそのまま渡せる形。
// 2時間より長い記録は、2時間ごとのファイルに分けて送る（npm run logs がつなぐ）
export async function phoneLogPayload(logId?: string): Promise<UploadPayload | undefined> {
  const r = await logChunkReader<PhoneLog>(logId, PHONE_LOGS)
  if (!r) return undefined
  const session = (await loadPhoneSessions()).find((s) => s.logId === r.meta.id)
  const parts = partCount(r.meta)
  return { name: phoneLogName(r.meta.startedAt), parts, pieces: (k) => logPieces(r.meta, session, r.get, parts > 1 ? k : undefined) }
}

export function phoneLogName(startedAt: number): string {
  const d = new Date(startedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `rfc-phone-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

// ホームの「どこで走る？」で選んだ場所。端末に覚えておく（localStorage。使えない環境では外のまま）
const WHERE_KEY = 'rfc.phoneWhere'
export function loadPhoneWhere(): PhoneWhere {
  try {
    return localStorage.getItem(WHERE_KEY) === 'treadmill' ? 'treadmill' : 'outdoor'
  } catch {
    return 'outdoor'
  }
}
export function savePhoneWhere(where: PhoneWhere) {
  try {
    localStorage.setItem(WHERE_KEY, where)
  } catch {
    /* 保存できない環境では何もしない */
  }
}
