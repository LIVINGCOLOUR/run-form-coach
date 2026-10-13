import { useEffect, useMemo, useRef, useState } from 'react'
import { exportLog } from '../core/exportLog'
import type { Screen } from '../App'
import type { ItemKey, Session } from '../core/types'
import { bestSession, nextItem, NEXT_TEXT } from '../modes/camera/nextStep'
import { loadProgress, loadSettings, saveSettings, setLevel, type Settings } from '../core/storage'
import { ALL, LEVEL_LABEL, LEVEL_NOTE, STEPS, type Level, type Progress } from '../core/level'
import { LEVEL } from '../core/params'
import { Mannequin } from '../modes/camera/ui/Mannequin'
import { preloadVoice, speak, unlockVoice } from '../core/voice'
import { PHRASES } from '../core/phrases'
import { VOICES, VOICE_ORDER, type VoiceKind } from '../core/voices'
import { startGravity } from '../modes/camera/gravity'
import { demoStride, idealFrame, lerpFrame, nextStepFrame, normalizeStride } from '../modes/camera/ui/figure'
import { ShareBar } from '../ui/ShareBar'
import type { PhoneKind, PhoneSession, PhoneWhere } from '../modes/phone/session'
import { nextPractice } from '../modes/phone/practice'
import { prevFormTest } from '../modes/phone/formtest'
import { FORM_TEST, PRACTICE } from '../modes/phone/params'
import { requestLocation, requestMotionPermission, requestWakeLock } from '../modes/phone/sensor'
import { exportPhoneLog, loadPhoneWhere, savePhoneWhere } from '../modes/phone/storage'
import { flushUploads } from '../core/upload/uploads'
import { UploadKeyButton, UploadPanel } from '../ui/Upload'

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

const WHERE_LABEL: Record<PhoneWhere, string> = { outdoor: '外', treadmill: 'トレッドミル' }
const WHERE_NOTE: Record<PhoneWhere, string> = {
  outdoor: 'GPS で速さを見ます。ペースを変えたときは判定を止めます（位置情報の許可を求めます）',
  treadmill: 'GPS は使いません。速さは一定とみなします',
}

const linkStyle = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 } as const

export function Home({ sessions, phoneSessions = [], go }: { sessions: Session[]; phoneSessions?: PhoneSession[]; go: (s: Screen) => void }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [ideal, setIdeal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const slowRef = useRef<HTMLInputElement>(null)
  const k = useMorph(ideal)
  // ホームを開いたら、送れていない記録を送ってみる
  useEffect(() => {
    void flushUploads()
  }, [])

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
  // 今日の意識：注意する項目を広げている途中なら、その段階のこと。すべて見る段階なら、ベストと理想の差から
  const stepping = progress.step < ALL
  const focus = stepping
    ? {
        title: STEPS[progress.step].title,
        reason: `${Math.round(LEVEL.minRunSec / 60)}分以上の走りで、これについて声がかからない走りが${LEVEL.advanceAfter}回続いたら、次へ進みます（いま ${progress.clean}/${LEVEL.advanceAfter}回）`,
      }
    : next
      ? NEXT_TEXT[next.item]
      : { title: '胸のライトで前を照らす', reason: best ? 'あなたのベストは、もう理想に近い姿勢です' : '最初の1回で、あなたの基準を作ります' }
  const chooseLevel = (level: Level) => {
    if (level === progress.level) return
    setProgress(setLevel(level))
  }

  const setVoice = async (voice: VoiceKind) => {
    const s = { ...settings, voice }
    setSettings(s)
    saveSettings(s)
    // 選んだ声で、ためしに一言話す
    unlockVoice()
    await preloadVoice(voice)
    speak(PHRASES.sample, voice)
  }

  // スマホ版：押したときに、動きのセンサーの許可（iPhone）と、画面が消えないようにする仕組みと、位置情報の許可（外のとき）をまとめて求める。
  // 動きのセンサーの許可は、押した流れの中で求めないと出ないので先に。位置情報は、そのあとに続けて
  const startPhone = async (where: PhoneWhere, kind?: PhoneKind) => {
    unlockVoice()
    const wake = requestWakeLock()
    await requestMotionPermission()
    const location = where === 'outdoor' ? await requestLocation() : undefined
    await wake
    go({ name: 'phone', where, location, kind })
  }
  const lastPhone = phoneSessions[0]
  // ピッチを上げる練習（選んだ人だけ）とフォームのテスト（月1回）
  const practice = nextPractice(phoneSessions, Date.now())
  const lastTest = prevFormTest(phoneSessions, Date.now())
  const testDays = lastTest ? Math.floor((Date.now() - lastTest.startedAt) / (24 * 3600 * 1000)) : null
  // どこで走るかを先に選び、やること（走る・練習・テスト）は同じ形のボタンで並べる。選んだ場所は端末に覚えておく
  const [where, setWhere] = useState<PhoneWhere>(loadPhoneWhere)
  const chooseWhere = (w: PhoneWhere) => {
    setWhere(w)
    savePhoneWhere(w)
  }
  const testDue = testDays !== null && testDays >= FORM_TEST.everyDays
  const phoneActions = [
    { title: '走る', note: 'ピッチが落ちたら、声で知らせます', start: () => startPhone(where) },
    {
      title: 'ピッチを上げる練習',
      note: practice.n === 1 ? `メトロノームに合わせて走ります。2週間で${PRACTICE.runs}回` : `${practice.n} / ${PRACTICE.runs} 回目。メトロノームに合わせて走ります`,
      start: () => startPhone(where, { kind: 'practice', plan: practice }),
    },
    {
      title: 'フォームのテスト',
      note: testDays === null ? '声はかけずに5分。月1回' : testDue ? `前のテストから${testDays}日。そろそろ` : `前のテストから${testDays}日`,
      due: testDue,
      start: () => startPhone(where, { kind: 'test' }),
    },
  ]

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13 }} className="muted">あなたのレベル</div>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(['beginner', 'intermediate', 'advanced'] as Level[]).map((lv) => (
            <button key={lv} aria-pressed={progress.level === lv} onClick={() => chooseLevel(lv)}>
              {LEVEL_LABEL[lv]}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12 }} className="muted">
          {LEVEL_NOTE[progress.level]}
          {progress.level !== 'advanced' && (progress.step >= ALL ? '（すべての項目を見ています）' : `（${progress.step + 1}/${ALL}段階目）`)}
        </div>
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
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>スマホ版（腰に付けて走る）</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              スマホを腰のベルトに付けて走ります。加速度とジャイロでピッチ・上下動・着地のブレーキを測ります。いまは実機の値を取るための試作で、画面はつけたまま使います。
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13 }} className="muted">どこで走る？</div>
            <div className="seg" role="group" aria-label="どこで走る？" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {(['outdoor', 'treadmill'] as PhoneWhere[]).map((w) => (
                <button key={w} aria-pressed={where === w} onClick={() => chooseWhere(w)}>
                  {WHERE_LABEL[w]}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
              {WHERE_NOTE[where]}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {phoneActions.map((a) => (
              <button key={a.title} className="phone-action" onClick={a.start}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{a.title}</span>
                  <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, color: a.due ? 'var(--accent)' : undefined }}>
                    {a.note}
                  </span>
                </span>
                <span aria-hidden="true" style={{ fontSize: 20, color: 'var(--accent)' }}>
                  ›
                </span>
              </button>
            ))}
          </div>

          {lastPhone && (
            <button onClick={() => go({ name: 'phoneResult', id: lastPhone.id })} style={{ ...linkStyle, alignSelf: 'flex-start', fontSize: 13 }}>
              前回の結果を見る（{fmtDate(lastPhone.startedAt)}）
            </button>
          )}
          <UploadPanel />

          <details className="dev">
            <summary>開発用</summary>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, paddingTop: 10 }}>
              <button onClick={() => exportPhoneLog().then((ok) => ok || alert('まだスマホ版の記録がありません'))} style={linkStyle}>
                直近の記録を書き出す
              </button>
              <button
                onClick={() => {
                  unlockVoice()
                  go({ name: 'phone', where: 'treadmill', sim: 10 })
                }}
                style={linkStyle}
              >
                模擬データで試す（センサーの代わりに作った値を流す）
              </button>
              <UploadKeyButton />
            </div>
          </details>
        </div>
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
