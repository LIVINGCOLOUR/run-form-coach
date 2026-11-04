import { logPieces, partCount } from './logChunks'
import { logChunkReader, loadSessions } from './storage'
import type { UploadPayload } from './upload/queue'

// 調整用の記録をファイルにして渡す（iPhone は共有シートから、ほかはダウンロード）
export async function exportLog(logId?: string): Promise<boolean> {
  const r = await logChunkReader(logId)
  if (!r) return false
  const session = (await loadSessions()).find((s) => s.logId === r.meta.id)
  // 長い記録でも1つの大きな文字列を作らない（切れはしを並べたファイルにする）
  const parts: string[] = []
  for await (const s of logPieces(r.meta, session, r.get)) parts.push(s)
  return shareFile(new File(parts, logName(r.meta.startedAt), { type: 'application/json' }))
}

const logName = (startedAt: number) => {
  const d = new Date(startedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `rfc-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

// 書き出しと、Mac へ送る記録（core/upload）の中身。npm run compare にそのまま渡せる形
// 少しずつ書き出した記録（core/logChunks.ts）は、かたまりを読みながら JSON の切れはしを流す。2時間より長い記録は、2時間ごとのファイルに分けて送る
export async function cameraLogPayload(logId?: string): Promise<UploadPayload | undefined> {
  const r = await logChunkReader(logId)
  if (!r) return undefined
  const session = (await loadSessions()).find((s) => s.logId === r.meta.id)
  const parts = partCount(r.meta)
  return { name: logName(r.meta.startedAt), parts, pieces: (k) => logPieces(r.meta, session, r.get, parts > 1 ? k : undefined) }
}

// JSON をファイルにして渡す（iPhone は共有シートから、ほかはダウンロード）
export async function shareJson(name: string, data: unknown): Promise<boolean> {
  return shareFile(new File([JSON.stringify(data)], name, { type: 'application/json' }))
}

async function shareFile(file: File): Promise<boolean> {
  const name = file.name
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return true
    } catch {
      /* 共有をやめたときは、ダウンロードにする */
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}
