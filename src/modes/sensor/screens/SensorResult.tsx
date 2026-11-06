import { useEffect, useState } from 'react'
import { LIMIT } from '../../../core/params'
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
  // ベルトの速さを入れて、足首の速さの式をこの人に合わせたか（SensorLive.tsx の events：belt:kmh と speedFit:A）。入れたのが効いたと分かるように出す
  const belt = log?.events.find((e) => /^belt:kmh /.test(e[1]))?.[1].split(' ')[1]
  const fitted = log?.events.some((e) => /^speedFit:A /.test(e[1]))
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
            <Row label="接地が長い（両足首）" n={sum.sit} />
            <Row label="接地の左右差" n={sum.side} />
            <Row label="足が体より前に着いた（両足首）" n={sum.stride} />
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>着地を変えると負担がふくらはぎ・アキレス腱に移るので、変えるのは少しずつ、週単位で。</div>
            {sum.bends > 0 && <div className="muted" style={{ fontSize: 12 }}>体を大きく曲げた {sum.bends} 回は、走る姿勢ではないので知らせていません。</div>}
            {sum.capped > 0 && <div className="muted" style={{ fontSize: 12 }}>同じ知らせが1時間に {LIMIT.perHour} 回に達したので、その項目はその1時間の残りは知らせていません（{sum.capped} 回）。</div>}
          </div>
          {belt && (
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              {fitted
                ? `ベルトの速さ（時速${belt}km）に、足首で見積もる速さを合わせました。次の走りから使います。`
                : `ベルトの速さ（時速${belt}km）を使いました。走った歩数が足りず、足首で見積もる速さはまだ合わせていません。`}
            </div>
          )}
          {slipNotes(s).map((n) => (
            <div key={n} style={{ color: 'var(--warn)', fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>{n}</div>
          ))}
          {!sum.stood && sum.trunk && (
            <div style={{ color: 'var(--warn)', fontSize: 13, lineHeight: 1.6 }}>
              立った姿勢が取れなかったので、胸と頭は見ていません（接地は見ています）。次は、始めてすぐに、案内に従って2つの立ち方で3秒ずつ止まってください。
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
