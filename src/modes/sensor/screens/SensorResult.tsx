import { useEffect, useState } from 'react'
import type { RunLog } from '../../../core/types'
import { sensorLogMeta, sensorRunCounts } from '../runLog'
import { slipNotes } from '../slipText'
import { SENSOR_RUN_NAME } from '../name'

// センサーランの結果。走っている間は画面を見ないので、何回どこで知らせたか・センサーがずれたか・アプリが止まっていたかを、ここで出す。
// 記録の頭（events・cues・slips・summary。センサーの値そのものは読まない）から数える
export function SensorResult({ logId, onHome }: { logId: string; onHome: () => void }) {
  const [log, setLog] = useState<RunLog | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void sensorLogMeta(logId)
      .then((m) => live && setLog(m ?? null))
      .catch(() => live && setLog(null))
    return () => {
      live = false
    }
  }, [logId])

  if (log === undefined) return <main className="page" />
  const s = log?.sensors
  const sum = log ? sensorRunCounts(log) : null
  const d = log ? new Date(log.startedAt) : null
  return (
    <main className="page" style={{ gap: 16 }}>
      <div className="row">
        <button className="icon-btn" aria-label="ホームへ" onClick={onHome}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className="muted" style={{ fontSize: 13 }}>
          {SENSOR_RUN_NAME}
          {d ? `　${d.getMonth() + 1}/${d.getDate()}` : ''}
        </div>
      </div>
      {!log || !sum ? (
        <div className="muted">記録が見つかりません。</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="muted" style={{ fontSize: 13 }}>走っていた時間</div>
            <div className="num" style={{ fontSize: 56, lineHeight: 1 }}>{Math.round(sum.runMin)}<span style={{ fontSize: 24 }}> 分</span></div>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>振動で知らせた回数</div>
            <Row label="背中が丸まった（胸）" n={sum.chest} />
            <Row label="頭が前に出た（頭）" n={sum.head} />
            <Row label="接地が長い（腰が落ちた）" n={sum.sit} />
            <Row label="接地の左右差" n={sum.side} />
            {sum.bends > 0 && <div className="muted" style={{ fontSize: 12 }}>体を大きく曲げた {sum.bends} 回は、走る姿勢ではないので知らせていません。</div>}
          </div>
          {slipNotes(s).map((n) => (
            <div key={n} style={{ color: 'var(--warn)', fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>{n}</div>
          ))}
          {!sum.stood && sum.trunk && (
            <div style={{ color: 'var(--warn)', fontSize: 13, lineHeight: 1.6 }}>
              立った姿勢が取れなかったので、胸と頭は見ていません（接地は見ています）。次は、始めてすぐにまっすぐ立って3秒止まってください。
            </div>
          )}
          {sum.gaps > 0 && (
            <div style={{ color: 'var(--warn)', fontSize: 13, lineHeight: 1.6 }}>
              アプリが {sum.gaps} 回止まっていました（画面が消えた・ほかのアプリに切り替えたなど）。その間は見られていません。次は画面を消さずに走ってください。
            </div>
          )}
          {!s && <div className="muted" style={{ fontSize: 13 }}>センサーの値が届いていませんでした。</div>}
        </>
      )}
      <div style={{ flexGrow: 1 }} />
      <button className="primary" onClick={onHome}>
        ホームへ
      </button>
    </main>
  )
}

function Row({ label, n }: { label: string; n: number }) {
  return (
    <div className="row" style={{ fontSize: 14 }}>
      <span>{label}</span>
      <span className="num" style={{ fontSize: 20 }}>{n}</span>
    </div>
  )
}
