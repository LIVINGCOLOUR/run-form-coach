import { useSyncExternalStore } from 'react'
import { findUpload, flushUploads, queueUpload, setUploadKey, subscribeUploads, uploadView } from '../core/upload/uploads'
import type { UploadEntry } from '../core/upload/queue'

// 走った記録を Mac へ送るしくみ（テスト期間用）の画面の部品。送る鍵は、ここで1回入れて端末に残す
const linkStyle = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 } as const

const useUploads = () => useSyncExternalStore(subscribeUploads, uploadView)

const hm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function askKey() {
  const k = window.prompt('記録を送る鍵（テスト用）を入れてください。空にすると送るのをやめます')
  if (k === null) return
  setUploadKey(k.trim() || null)
}

// ホーム：送れていない記録の数と、最後に送ったとき。鍵のない端末では何も出さない（鍵を入れるのはホームの「開発用」の中：UploadKeyButton）
export function UploadPanel() {
  const v = useUploads()
  if (!v.hasKey) return null
  const waiting = v.list.filter((e) => e.state === 'waiting')
  const lastSent = v.list.filter((e) => e.state === 'sent').sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))[0]
  const badKey = waiting.some((e) => e.badKey)
  const lastError = waiting.find((e) => e.error)?.error
  let text: string
  if (v.sending) text = `記録を送っています（${v.pct}%）`
  else if (badKey) text = '送る鍵が違います。入れ直してください'
  else if (waiting.length) text = `まだ送れていない記録が ${waiting.length} 件${lastError ? `（${lastError}）` : ''}。つながったら送ります`
  else if (lastSent?.sentAt) text = `記録はすべて送りました（最後は ${hm(lastSent.sentAt)}）`
  else text = '走り終わると、記録を自動で送ります'
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, color: badKey || waiting.length ? 'var(--warn)' : undefined }} className={badKey || waiting.length ? undefined : 'muted'}>
      {text}
      {waiting.length > 0 && !v.sending && !badKey && (
        <>
          {'　·　'}
          <button onClick={() => void flushUploads(true)} style={linkStyle}>
            今すぐ送る
          </button>
        </>
      )}
      {badKey && (
        <>
          {'　·　'}
          <button onClick={askKey} style={linkStyle}>
            鍵を入れ直す
          </button>
        </>
      )}
    </div>
  )
}

// ホームの「開発用」の中：送る鍵を入れる・入れ直す
export function UploadKeyButton() {
  const v = useUploads()
  return (
    <button onClick={askKey} style={linkStyle}>
      {v.hasKey ? '記録を送る鍵を入れ直す' : '記録を送る鍵を入れる（テスト用）'}
    </button>
  )
}

const ENTRY_TEXT = (e: UploadEntry, sending: boolean, pct: number) =>
  sending
    ? `この記録を送っています（${pct}%）`
    : e.state === 'sent'
      ? `この記録は送りました（${e.sentAt ? hm(e.sentAt) : ''}）`
      : e.state === 'gone'
        ? 'この記録は端末から消えていて、送れませんでした'
        : e.badKey
          ? 'この記録はまだ送れていません（送る鍵が違います。ホームで入れ直してください）'
          : `この記録はまだ送れていません${e.error ? `（${e.error}）` : ''}。つながったら送ります`

// 結果の画面：この記録を送れたかどうか。鍵がある端末で、まだ順番待ちにないものは「送る」を出す
export function UploadState({ kind, logId, startedAt }: { kind: string; logId: string; startedAt: number }) {
  const v = useUploads()
  if (!v.hasKey) return null
  const e = findUpload(kind, logId)
  if (!e) {
    return (
      <button onClick={() => queueUpload(kind, logId, startedAt)} style={linkStyle}>
        この記録を送る
      </button>
    )
  }
  const sending = v.sending === e.id
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, color: e.state === 'sent' || sending ? 'var(--muted)' : 'var(--warn)' }}>
      {ENTRY_TEXT(e, sending, v.pct)}
      {e.state === 'waiting' && !sending && !e.badKey && (
        <>
          {'　·　'}
          <button onClick={() => void flushUploads(true)} style={linkStyle}>
            今すぐ送る
          </button>
        </>
      )}
    </div>
  )
}
