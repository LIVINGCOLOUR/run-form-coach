import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Screen } from '../App'
import type { ItemKey, Session } from '../core/types'
import { goodFor, mainStride, pct0, todayFocus } from '../modes/camera/nextStep'
import { FORM, kmh1 } from '../modes/camera/params'
import { loadProgress, loadSettings, saveSettings, setLevel, type Settings } from '../core/storage'
import { ALL, LEVEL_LABEL, LEVEL_NOTE, type Level, type Progress } from '../core/level'
import { Mannequin } from '../modes/camera/ui/Mannequin'
import { preloadVoice, speak, unlockVoice } from '../core/voice'
import { PHRASES } from '../core/phrases'
import { VOICES, VOICE_ORDER, type VoiceKind } from '../core/voices'
import { startGravity } from '../modes/camera/gravity'
import { fullFrames } from '../modes/camera/fullFrames'
import { correctFrames, demoStride, normalizeStride } from '../modes/camera/ui/figure'
import { ShareBar } from '../ui/ShareBar'
import type { PhoneSession } from '../modes/phone/session'
import { requestMotionPermission } from '../modes/phone/sensor'
import { startPhone } from '../modes/phone/screens/startPhone'
import { flushUploads } from '../core/upload/uploads'
import { UploadPanel } from '../ui/Upload'
import { SensorPanel } from '../modes/sensor/SensorPanel'
import { HeartPanel } from '../modes/sensor/HeartPanel'
import { sensors } from '../modes/sensor/ble'
import { SENSOR_RUN_NAME } from '../modes/sensor/name'
import { requestWakeLock as keepScreenOn } from '../core/wake'

const ITEM_LABEL: Record<ItemKey, string> = { hunch: '背中の丸まり', head: '頭の前への出', trunk: '体幹の前傾', trunkBack: '体幹の起きすぎ', body: '体全体の前傾', bodyBack: '体全体の起きすぎ', hip: '腰の下がり', landing: '着地の位置' }
const unit = (item: ItemKey) => (item === 'hip' ? '%' : '°')
// 小数1桁まで（よい例までの差は1°に満たないことがあり、整数に丸めると「7° → 7°」になるため）
const fmt1 = (x: number) => String(Math.round(x * 10) / 10)
// 着地は、速さで補正したかかとの前（脚の長さに対する割合）を % で
const show = (item: ItemKey, x: number) => (item === 'landing' ? pct0(x) : `${fmt1(x)}${unit(item)}`)

// ふだんのホームは、走り方・はじめる・フォームの見方だけにする（本人の希望。2026-11-05）。
// テストの機能（答えつきの記録・崩しの撮影・動画で試す・スロー動画・腰スマホの練習とテスト・記録の書き出しなど）は、
// テスト用のページ /lab/（LabHome.tsx）に分けた（本人の決め 2026-11-17）

// 走り方（入り口）。ホームのいちばん上で選び、「はじめる」1つで始める。選んだものは端末に覚えておく
type RunMode = 'treadmill' | 'waist' | 'sensor'
const MODE_KEY = 'rfc.runMode'
const MODES: { key: RunMode; label: string; note: string }[] = [
  { key: 'treadmill', label: 'トレッドミル', note: '横に置いたカメラで全身を見て、声で知らせます。センサーをつなげば、いっしょに使います' },
  { key: 'waist', label: '腰スマホ', note: 'スマホを腰のベルトに付けて外を走り、ピッチが落ちたら声で知らせます。センサーをつなげば、いっしょに使います（振動だけ）' },
  {
    key: 'sensor',
    label: SENSOR_RUN_NAME,
    note: 'センサーだけで外を走ります（マラソンにも）。スマホはポケットかアームバンドに入れ、画面は消さずに見ません。崩れたら、その場所が震えます。始めたら、声の案内に従って2つの立ち方で3秒ずつ止まってください',
  },
]
const loadMode = (): RunMode => {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'waist' || v === 'sensor' ? v : 'treadmill'
  } catch {
    return 'treadmill'
  }
}
const saveMode = (m: RunMode) => {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* 保存できない環境では何もしない */
  }
}

const linkStyle = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 } as const

export function Home({ sessions, phoneSessions = [], go }: { sessions: Session[]; phoneSessions?: PhoneSession[]; go: (s: Screen) => void }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [mode, setMode] = useState<RunMode>(loadMode)
  const chooseMode = (m: RunMode) => {
    setMode(m)
    saveMode(m)
  }
  const sensorNodes = useSyncExternalStore(sensors.subscribe, sensors.snapshot)
  const sensorsOn = sensorNodes.filter((n) => n.status === 'connected').length
  // ホームを開いたら、送れていない記録を送ってみる
  useEffect(() => {
    void flushUploads()
  }, [])

  const last = sessions[0]
  const prev = sessions[1]
  // 今日の意識：走り出す前に言う1つと同じもの（nextStep.ts の todayFocus）。走り姿の右に、前回の値 → 目指す値で出す
  const focus = useMemo(() => todayFocus(sessions, progress), [sessions, progress])
  const next = focus.next

  // 走り姿：後ろの灰色の人形が正しいフォーム（その走りの速さのよい例の真ん中に、上体と頭を直した形。figure.ts の correctFrames）、
  // 上の緑の点線が前回の走り（いちばん多かった姿勢の1周。nextStep.ts の mainStride）。同じ1周から作るので、同じタイミングで動く。
  // 過去でいちばん良い走りは出さない（良い姿勢の割合は、その日の自分の基準との比べなので、正しいフォームに近いとは限らない。2026-11-07 本人の決め）。
  // まだ走っていなければ、見本（研究データの脚に、上体 7° を足したもの）だけ
  const run = sessions.find((s) => mainStride(s))
  const { correct, today, good } = useMemo(() => {
    const st = run && mainStride(run)
    if (!run || !st) return { correct: demoStride({ lean: 7, head: 0, drop: 0 }), today: undefined, good: undefined }
    const frames = normalizeStride(st, run.gait?.cadence)
    const good = goodFor(run)
    return { correct: correctFrames(frames, good), today: frames, good }
  }, [run])
  // 前回の走りが今日なら「今日のフォーム」、前の日なら「前回のフォーム」
  const todayRun = !!run && new Date(run.startedAt).toDateString() === new Date().toDateString()
  const runLabel = todayRun ? '今日のフォーム' : '前回のフォーム'
  // 次の一歩の項目が、前回の走り（緑の点線）の項目のときだけ右に出す（前回の走りに比べがなく、もっと前の走りから選んだときは出さない）
  const nextShown = !!today && !!next && run === sessions[0]

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

  // 腰スマホ：外で走る（GPS で速さを見る）。トレッドミルで試すのは /lab/ から
  const lastPhone = phoneSessions[0]

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

      <div className="stage" style={{ height: 236 }}>
        <Mannequin
          frames={correct}
          ghost={today}
          upperColor="#6B7480"
          width={358}
          height={236}
          viewBox="0 0 358 236"
          transform="translate(52,-22) scale(0.56)"
        />
        <div style={{ position: 'absolute', left: 14, top: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#C9CFD5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 16, height: 8, borderRadius: 4, background: '#6B7480' }} />
            {today ? '正しいフォーム' : '見本'}
          </div>
          {today && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 16, borderTop: '2px dashed var(--accent)' }} />
              {runLabel}
            </div>
          )}
          {good && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{good.kmh !== undefined ? `時速${kmh1(good.kmh)}kmのよい例` : '時速12kmのよい例（速さが分からないとき）'}</div>}
          {!today && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>研究にもとづく目安</div>}
        </div>
        {nextShown && next && (
          <div style={{ position: 'absolute', right: 14, top: 64, textAlign: 'right' }}>
            <div style={{ fontSize: 11 }} className="muted">{next.kind === 'good' ? `${next.group === 'head' ? '首の角度' : ITEM_LABEL[next.group]}（よい例へ）` : ITEM_LABEL[next.item]}</div>
            <div className="num" style={{ fontSize: 30 }}>
              <span style={{ color: 'var(--accent)' }}>{show(next.item, next.from)}</span> <span style={{ fontSize: 20, color: 'var(--faint)' }}>→</span>{' '}
              <span style={{ color: '#C9CFD5' }}>{show(next.item, next.to)}</span>
            </div>
            <div style={{ fontSize: 11, paddingTop: 4 }} className="muted">{next.kind === 'line' ? (next.group === 'landing' && !FORM.landing.say ? '試しの線まで' : '声をかける線まで') : 'よい例の範囲まで'}</div>
          </div>
        )}
      </div>

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          <div className="seg" role="group" aria-label="走り方" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {MODES.map((m) => (
              <button key={m.key} aria-pressed={mode === m.key} onClick={() => chooseMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
            {MODES.find((m) => m.key === mode)!.note}
          </div>
        </div>
        <button
          className="primary"
          disabled={mode === 'sensor' && sensorsOn === 0}
          style={mode === 'sensor' && sensorsOn === 0 ? { opacity: 0.4 } : undefined}
          onClick={() => {
            unlockVoice()
            if (mode === 'waist') return void startPhone(go, 'outdoor')
            if (mode === 'sensor') {
              // 腰のポーチに入れたこのスマホの向きも記録する（sensor/waist.ts）。iPhone は押した流れの中でしか、動きのセンサーの許可が出ない
              void requestMotionPermission()
              void keepScreenOn()
              return go({ name: 'sensorRun' })
            }
            startGravity()
            go({ name: 'live' })
          }}
        >
          はじめる
        </button>
        {mode === 'sensor' && sensorsOn === 0 && <div style={{ fontSize: 12, color: 'var(--warn)' }}>{SENSOR_RUN_NAME}は、センサーを1つ以上つないでから始めます</div>}
        {mode === 'treadmill' && fullFrames() && (
          <div style={{ fontSize: 12, color: 'var(--accent)' }}>全コマ記録（検証用）：走っている間も間引かず、毎コマ骨格を取って残します</div>
        )}
        <SensorPanel key={mode === 'sensor' ? 'open' : 'closed'} defaultOpen={mode === 'sensor' && sensorsOn === 0} />
        {/* 心拍計（センサーランだけ。記録するだけ） */}
        {mode === 'sensor' && <HeartPanel />}
        <div style={{ fontSize: 12 }} className="muted">
          {mode === 'treadmill' && <>走る前に、2つの立ち方で基準を取ります{' · '}</>}
          <a href="/theory/" style={{ color: 'var(--muted)', fontSize: 12 }}>
            フォームの見方
          </a>
        </div>
        <UploadPanel />
        {mode === 'waist' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>腰スマホ</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                加速度とジャイロでピッチ・上下動・着地のブレーキを測ります。いまは実機の値を取るための試作で、画面はつけたまま使います。
              </div>
            </div>
            {lastPhone && (
              <button onClick={() => go({ name: 'phoneResult', id: lastPhone.id })} style={{ ...linkStyle, alignSelf: 'flex-start', fontSize: 13 }}>
                前回の結果を見る（{fmtDate(lastPhone.startedAt)}）
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

export function fmtDate(ms: number) {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
