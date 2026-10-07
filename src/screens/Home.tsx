import { useEffect, useMemo, useRef, useState } from 'react'
import { exportLog } from '../core/exportLog'
import type { Screen } from '../App'
import type { ItemKey, Session } from '../core/types'
import { bestSession, nextItem, NEXT_TEXT } from '../core/nextStep'
import { loadSettings, saveSettings, type Settings } from '../core/storage'
import { Mannequin } from '../ui/Mannequin'
import { preloadVoice, speak, unlockVoice } from '../core/voice'
import { PHRASES } from '../core/phrases'
import { VOICES, VOICE_ORDER, type VoiceKind } from '../core/voices'
import { startGravity } from '../core/gravity'
import { demoStride, idealFrame, lerpFrame, nextStepFrame, normalizeStride } from '../ui/figure'
import { ShareBar } from '../ui/ShareBar'

const ITEM_LABEL: Record<ItemKey, string> = { head: '頭の前への出', trunk: '体幹の前傾', body: '体全体の前傾', hip: '腰の下がり' }
const unit = (item: ItemKey) => (item === 'hip' ? '%' : '°')

// 形が変わっていく割合 k を 0↔1 でなめらかに動かす
function useMorph(on: boolean) {
  const [k, setK] = useState(0)
  const kRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const target = on ? 1 : 0
      const next = Math.abs(target - kRef.current) < 0.05 ? target : kRef.current + (target > kRef.current ? 0.05 : -0.05)
      kRef.current = next
      setK(next)
      if (next !== target) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return k
}

export function Home({ sessions, go }: { sessions: Session[]; go: (s: Screen) => void }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [ideal, setIdeal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const slowRef = useRef<HTMLInputElement>(null)
  const k = useMorph(ideal)

  const last = sessions[0]
  const prev = sessions[1]
  const best = bestSession(sessions)
  const next = best ? nextItem(best) : undefined

  const { base, ghost, idealFrames, exaggerated } = useMemo(() => {
    const stride = best?.strides.good
    if (!stride) {
      const demo = demoStride({ lean: 12, head: 3, drop: 0 })
      return { base: demo, ghost: undefined, idealFrames: demoStride({ lean: 7, head: 0, drop: 0 }), exaggerated: false }
    }
    const frames = normalizeStride(stride)
    let ghost
    let exaggerated = false
    if (next) {
      const d = next.from - next.to
      const shown = Math.abs(d) < 4 ? Math.sign(d || 1) * 4 : d
      exaggerated = shown !== d
      ghost = frames.map((f) => nextStepFrame(f, next.item, next.from, next.from - shown))
    }
    return { base: frames, ghost, idealFrames: frames.map((f) => idealFrame(f, stride.avg)), exaggerated }
  }, [best, next])

  const shown = k > 0 ? base.map((f, i) => lerpFrame(f, idealFrames[i % idealFrames.length], k)) : base
  const focus = next ? NEXT_TEXT[next.item] : { title: '上から吊られるように', reason: best ? 'あなたのベストは、もう理想に近い姿勢です' : '最初の1回で、あなたの基準を作ります' }

  const setVoice = async (voice: VoiceKind) => {
    const s = { ...settings, voice }
    setSettings(s)
    saveSettings(s)
    // 選んだ声で、ためしに一言話す
    unlockVoice()
    await preloadVoice(voice)
    speak(PHRASES.sample, voice)
  }

  const goodPct = last ? Math.round(last.share.good * 100) : null
  const delta = last && prev ? Math.round((last.share.good - prev.share.good) * 100) : null

  return (
    <main className="page">
      <div className="row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--accent)" strokeWidth="2" aria-hidden="true">
            <circle cx="14" cy="14" r="12" />
            <circle cx="14" cy="14" r="4.5" />
            <path d="M14 2v4M14 22v4" />
          </svg>
          <div style={{ fontFamily: 'var(--num)', fontWeight: 700, fontSize: 20, letterSpacing: 3 }}>RUN FORM COACH</div>
        </div>
      </div>

      <button
        className="stage"
        onClick={() => setIdeal((v) => !v)}
        aria-label={ideal ? '自分のフォームに戻す' : '理想のフォームを見る'}
        style={{ height: 236, padding: 0, textAlign: 'left', borderColor: k > 0.5 ? '#3A424B' : undefined }}
      >
        <Mannequin
          frames={shown}
          ghost={k < 0.05 && !ideal ? ghost : undefined}
          upperColor={k > 0.5 ? '#F2F4F5' : best ? '#6B7480' : '#4A535D'}
          width={358}
          height={236}
          viewBox="0 0 358 236"
          transform="translate(52,-22) scale(0.56)"
        />
        {k < 0.05 && !ideal && (
          <div style={{ position: 'absolute', left: 14, top: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#C9CFD5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 16, height: 8, borderRadius: 4, background: '#6B7480' }} />
              {best ? 'あなたのベスト' : '見本'}
            </div>
            {ghost && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 16, borderTop: '2px dashed var(--accent)' }} />
                今日のフォーム
              </div>
            )}
          </div>
        )}
        {k < 0.05 && !ideal && next && (
          <div style={{ position: 'absolute', right: 14, top: 64, textAlign: 'right' }}>
            <div style={{ fontSize: 11 }} className="muted">{ITEM_LABEL[next.item]}</div>
            <div className="num" style={{ fontSize: 30 }}>
              <span className="muted">{Math.round(next.from)}{unit(next.item)}</span> <span style={{ fontSize: 20, color: 'var(--faint)' }}>→</span>{' '}
              <span style={{ color: 'var(--accent)' }}>{Math.round(next.to)}{unit(next.item)}</span>
            </div>
            <div style={{ fontSize: 11, paddingTop: 4 }} className="muted">ほかはそのまま</div>
            {exaggerated && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>差は見やすく強調</div>}
          </div>
        )}
        {k > 0.95 && (
          <>
            <div style={{ position: 'absolute', left: 14, top: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 900 }}>理想のフォーム</div>
              <div style={{ fontSize: 11 }} className="muted">研究にもとづく目安</div>
            </div>
            <div style={{ position: 'absolute', right: 14, top: 56, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontSize: 12, color: '#C9CFD5' }}>
              <div>耳・肩・腰が一直線</div>
              <div>体幹の前傾 7°前後</div>
              <div>足首から少し前へ</div>
            </div>
          </>
        )}
        <div style={{ position: 'absolute', right: 12, bottom: 10, padding: '6px 10px', borderRadius: 14, background: 'rgba(10,12,14,0.8)', fontSize: 11, color: '#C9CFD5' }}>
          {ideal ? 'タップで自分のフォームに戻る' : 'タップで理想のフォーム'}
        </div>
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px' }}>
        <div style={{ fontSize: 12 }} className="muted">今日の意識</div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>{focus.title}</div>
        <div style={{ fontSize: 12 }} className="muted">{focus.reason}</div>
      </div>

      {last && goodPct !== null && (
        <button className="card" onClick={() => go({ name: 'result', id: last.id })} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ fontSize: 13 }}>
            <span className="muted">前回の良い姿勢</span>
            <span className="muted">{fmtDate(last.startedAt)} · {Math.round(last.durationSec / 60)}分　›</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div className="num" style={{ fontSize: 72, lineHeight: 0.85, color: 'var(--accent)' }}>
              {goodPct}
              <span style={{ fontSize: 36 }}>%</span>
            </div>
            {delta !== null && (
              <div style={{ fontSize: 14, paddingBottom: 6, color: delta >= 0 ? 'var(--accent)' : 'var(--warn)' }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%　前回より
              </div>
            )}
          </div>
          <ShareBar share={last.share} />
        </button>
      )}

      {VOICE_ORDER.length > 1 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13 }} className="muted">声（押すと試しに話します）</div>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {VOICE_ORDER.map((v) => (
            <button key={v} aria-pressed={settings.voice === v} onClick={() => setVoice(v)}>
              {VOICES[v].label}
            </button>
          ))}
        </div>
      </div>
      )}

      <div style={{ flexGrow: 1 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <button
          className="primary"
          onClick={() => {
            unlockVoice()
            startGravity()
            go({ name: 'live' })
          }}
        >
          はじめる
        </button>
        <div style={{ fontSize: 12 }} className="muted">
          走る前に、まっすぐ立って基準を取ります
          {' · '}
          <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 }}>
            動画で試す
          </button>
          {' · '}
          <button onClick={() => exportLog().then((ok) => ok || alert('まだ記録がありません'))} style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 }}>
            直近の記録を書き出す
          </button>
          {' · '}
          <a href="/theory/" style={{ color: 'var(--muted)', fontSize: 12 }}>
            フォームの見方
          </a>
        </div>
        <button className="card" onClick={() => slowRef.current?.click()} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>スロー動画で詳しく見る</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            iPhone のカメラの「スロー」で、真横から1〜1.5m離れて、足元まで入れて数歩撮った動画を選びます。接地時間・着地のすね・上下動を測ります。
          </div>
        </button>
        <input
          ref={slowRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) go({ name: 'slow', video: f })
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              unlockVoice()
              go({ name: 'live', video: f })
            }
          }}
        />
      </div>
    </main>
  )
}

export function fmtDate(ms: number) {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
