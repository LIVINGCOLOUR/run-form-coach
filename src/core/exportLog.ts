import { loadLog, loadSessions } from './storage'

// 調整用の記録をファイルにして渡す（iPhone は共有シートから、ほかはダウンロード）
export async function exportLog(logId?: string): Promise<boolean> {
  const log = await loadLog(logId)
  if (!log) return false
  const session = (await loadSessions()).find((s) => s.logId === log.id)
  const d = new Date(log.startedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `rfc-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
  return shareJson(name, { log, session })
}

// JSON をファイルにして渡す（iPhone は共有シートから、ほかはダウンロード）
export async function shareJson(name: string, data: unknown): Promise<boolean> {
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' })
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
