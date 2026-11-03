import { useEffect, useState } from 'react'
import { loadLog } from '../../core/storage'
import { slipNotes } from './slipText'

// 結果の画面の、センサーがずれたときの知らせ（slipText.ts）。記録がないか、ずれていなければ何も出さない
export function SlipNote({ logId }: { logId?: string }) {
  const [notes, setNotes] = useState<string[]>([])
  useEffect(() => {
    if (!logId) return
    let live = true
    void loadLog(logId).then((log) => live && setNotes(slipNotes(log?.sensors)))
    return () => {
      live = false
    }
  }, [logId])
  if (!notes.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--warn)', fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>
      {notes.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  )
}
