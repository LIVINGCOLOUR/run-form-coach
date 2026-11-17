import { useEffect, useSyncExternalStore } from 'react'
import { heart } from './heart'
import { HEART } from './params'

// 心拍計をつなぐ小さな枠（ホームで「センサーラン」を選んだとき、センサーの枠の下）。記録だけで、知らせには使わない（heart.ts）。
// 自作のセンサーの「まとめてつなぐ」とは別のボタン。Web Bluetooth のないブラウザでは出さない（センサーの枠が Bluefy の案内を出す）
export function HeartPanel() {
  const v = useSyncExternalStore(heart.subscribe, heart.snapshot)
  // 前に選んだ心拍計に、押さずにつなぎにいく（getDevices があるブラウザだけ）
  useEffect(() => {
    void heart.restore()
  }, [])
  if (!heart.supported) return null
  const ok = v.status === 'connected'
  const busy = v.status === 'connecting'
  const fresh = ok && v.bpm !== null && v.t !== null && performance.now() / 1000 - v.t <= HEART.stale
  const color = ok ? 'var(--accent)' : v.status === 'error' || v.status === 'lost' ? 'var(--warn)' : 'var(--muted)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 0', minWidth: 0, fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700 }}>心拍計</span>
          <span className="muted">（記録するだけ）</span>
          <div style={{ color, overflowWrap: 'anywhere' }}>
            {ok ? `${fresh ? `${v.bpm} 拍/分・` : ''}つながっています${v.name ? `（${v.name}）` : ''}` : v.message}
          </div>
        </div>
        {!ok && (
          <button
            disabled={busy}
            onClick={() => void heart.connect()}
            style={{ flexShrink: 0, whiteSpace: 'nowrap', height: 32, padding: '0 12px', borderRadius: 16, border: '1px solid var(--text)', background: 'transparent', color: 'var(--text)', fontSize: 12, fontWeight: 700 }}
          >
            {busy ? 'つないでいます…' : '心拍計をつなぐ'}
          </button>
        )}
      </div>
      {!ok && !busy && (
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          Fitbit Charge 6 は、時計の画面を下に引いて「Broadcast HR」（心拍数をブロードキャスト）を押してから、つなぎます。つないだら、時計の「共有」→「開始」を押します。ほかのアプリにつないでいると出てきません。
        </div>
      )}
    </div>
  )
}
