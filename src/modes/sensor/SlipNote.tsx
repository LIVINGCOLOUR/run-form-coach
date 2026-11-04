import { useEffect, useState } from 'react'
import { loadLogMeta } from '../../core/storage'
import { slipNotes } from './slipText'

// 結果の画面の、センサーがずれたときの知らせ（slipText.ts）。記録がないか、ずれていなければ何も出さない
// store：記録の入れ物（カメラ版の記録が既定。腰スマホといっしょに使ったセンサーの記録は SENSOR_LOGS）
export function SlipNote({ logId, store }: { logId?: string; store?: string }) {
  const [notes, setNotes] = useState<string[]>([])
  useEffect(() => {
    if (!logId) return
    let live = true
    void loadLogMeta(logId, store).then((log) => live && setNotes(slipNotes(log?.sensors)))
    return () => {
      live = false
    }
  }, [logId, store])
  if (!notes.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--warn)', fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>
      {notes.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  )
}
