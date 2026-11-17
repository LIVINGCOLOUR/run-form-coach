import { useEffect, useRef, useState } from 'react'
import type { Screen } from '../App'
import type { Session } from '../core/types'
import { exportLog } from '../core/exportLog'
import { unlockVoice } from '../core/voice'
import { flushUploads } from '../core/upload/uploads'
import { UploadKeyButton, UploadPanel } from '../ui/Upload'
import type { PhoneSession, PhoneWhere } from '../modes/phone/session'
import { nextPractice } from '../modes/phone/practice'
import { prevFormTest } from '../modes/phone/formtest'
import { FORM_TEST, PRACTICE } from '../modes/phone/params'
import { drillPlan, LAB_TIME, labSteps, type DrillOptions, type DrillVersion } from '../modes/phone/drill'
import { exportPhoneLog, loadPhoneWhere, savePhoneWhere } from '../modes/phone/storage'
import { startPhone } from '../modes/phone/screens/startPhone'
import { SensorPanel } from '../modes/sensor/SensorPanel'
import { HeartPanel } from '../modes/sensor/HeartPanel'
import { fmtDate } from './Home'

// テスト用のページ（/lab/）のホーム。アプリはまだ公開できる段階ではないので、テストの機能はふつうのアプリ（/）から外して、ここに置く
// （本人の決め 2026-11-17）。画面（走っている間・結果）と記録・Mac へ送るしくみは、ふつうのアプリと同じものを使う（App.tsx）。
//   いちばん上：答えつきの記録（腰のスマホ1台。外でもトレッドミルでも。drill.ts の labPlan）。アプリが声で区間を順に指示し、
//     終わったら指示なしの走り（自由走。free.ts）に切り替えて、腰のスマホの値だけで試しの声を出す。本人が長押しで終える。
//     そのすぐ下に、センサーと心拍計をつなぐ枠（つながっている分だけ記録する。震わせない・立ち方の案内もしない）
//   崩しの撮影（トレッドミル。横の iPhone で全身を録画。drill.ts）、腰スマホの開発中の機能（ピッチを上げる練習・フォームのテスト）、
//   カメラ版の確かめ（動画で試す・スロー動画・記録の書き出し）、開発用（模擬データ・送る鍵）

const WHERE_LABEL: Record<PhoneWhere, string> = { outdoor: '外', treadmill: 'トレッドミル' }
const WHERE_NOTE: Record<PhoneWhere, string> = {
  outdoor: '平らで見通しのよい、人や車の少ない道で。GPS で速さも記録します（位置情報の許可を求めます）',
  treadmill: 'GPS は使いません。速さは一定とみなします',
}

const LAB = { version: 'lab', extra: false } as const
const linkStyle = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 } as const

export function LabHome({ sessions, phoneSessions = [], go }: { sessions: Session[]; phoneSessions?: PhoneSession[]; go: (s: Screen) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const slowRef = useRef<HTMLInputElement>(null)
  // 開いたら、送れていない記録を送ってみる
  useEffect(() => {
    void flushUploads()
  }, [])
  const [where, setWhere] = useState<PhoneWhere>(loadPhoneWhere)
  const chooseWhere = (w: PhoneWhere) => {
    setWhere(w)
    savePhoneWhere(w)
  }
  // 崩しの撮影（トレッドミルだけ）：ふつう版か短い版か、上半身だけにするか、最後に付け方の区間も走るか
  const [drill, setDrill] = useState<DrillOptions>({ version: 'full', extra: true, upper: false })
  const minOf = (o: DrillOptions) => Math.round(drillPlan(o).total / 60)
  const practice = nextPractice(phoneSessions, Date.now())
  const lastTest = prevFormTest(phoneSessions, Date.now())
  const testDays = lastTest ? Math.floor((Date.now() - lastTest.startedAt) / (24 * 3600 * 1000)) : null
  const testDue = testDays !== null && testDays >= FORM_TEST.everyDays
  const lastPhone = phoneSessions[0]
  const lastCamera = sessions[0]
  // 答えつきの記録の並び（画面に出す短い形。同じ崩しが続く2回目は「もう一度」でまとめる）
  const steps = labSteps().filter((s) => s.key !== 'normal1' && s.key !== 'normal2')
  const again = steps.findIndex((s, i) => steps.slice(0, i).some((x) => x.key === s.key))
  const names = (xs: typeof steps) => xs.map((s) => s.name).join('・')
  const order = `ふつう${LAB_TIME.base / 60}分 → ${again < 0 ? names(steps) : `${names(steps.slice(0, again))} → もう一度 ${names(steps.slice(again))}`} → ふつう${LAB_TIME.last / 60}分`

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
        <div style={{ fontFamily: 'var(--num)', fontWeight: 700, fontSize: 14, letterSpacing: 2, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 8px' }}>LAB</div>
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        テスト用のページです。記録はふつうのアプリと同じく、走り終わると Mac へ送ります。ふつうに走るときは{' '}
        <a href="/" style={{ color: 'var(--muted)' }}>
          アプリ
        </a>
        へ。
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'var(--accent)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>答えつきの記録</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            腰のスマホで走ります。アプリの声の指示どおりに、わざと崩した走りを順に走ります。崩しは{LAB_TIME.sec}秒ずつ、はっきり大きく。あいだの{LAB_TIME.back}秒は、走ったままふつうに戻します。この間はピッチの声とメトロノームは鳴りません。約{minOf(LAB)}分
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>{order} → 指示なしで走る</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            そのあとは指示なしで、いつもどおり走ります。崩れたら、腰のスマホの値だけで声で言います（試し。線は、この走りの崩しの区間から作ります）。終えるときは「長押しで終える」。
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13 }} className="muted">
            どこで走る？
          </div>
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
        <button className="primary" onClick={() => void startPhone(go, where, { kind: 'drill', drill: LAB })}>
          はじめる（約{minOf(LAB)}分 ＋ 指示なし）
        </button>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          スマホは腰のベルトかウエストポーチにしっかり付け、画面は点けたままにします。横の iPhone でも撮るとき（トレッドミル。なくてもよい）は、真横から全身が映るように置いて、録画かカメラ版を先に始めます。
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          センサー（頭・胸・手首・足首）と心拍計は、下の枠でつないだ分だけ記録します（答え合わせの材料。震えません。立ち方の案内もしません）。つながなくても走れます。
        </div>
      </div>

      <SensorPanel defaultOpen={false} />
      <HeartPanel />

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>崩しの撮影（トレッドミル）</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            横の iPhone で全身を録画しながら、{drill.upper ? '頭を前に・下を向く・腕を振らない…' : '頭を前に・腕を振らない・ピッチを落とす…'}を声の指示どおりに順に走ります。区間のあいだはベルトのふちに立って休みます。約{minOf(drill)}分
          </div>
        </div>
        <div className="seg" role="group" aria-label="崩しの撮影の長さ" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {(['full', 'short'] as DrillVersion[]).map((v) => (
            <button key={v} aria-pressed={drill.version === v} onClick={() => setDrill({ ...drill, version: v })}>
              {v === 'full' ? 'ふつう版' : '短い版'}（約{minOf({ ...drill, version: v })}分）
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!drill.upper} onChange={(e) => setDrill({ ...drill, upper: e.target.checked })} style={{ accentColor: 'var(--accent)', width: 18, height: 18 }} />
          上半身だけ（頭・目線・背中・腕。脚に負担のかかる区間は走らない）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: drill.upper ? 0.45 : 1 }}>
          <input type="checkbox" checked={drill.extra && !drill.upper} disabled={!!drill.upper} onChange={(e) => setDrill({ ...drill, extra: e.target.checked })} style={{ accentColor: 'var(--accent)', width: 18, height: 18 }} />
          最後に付け方の区間も（ゆるい・手・ポケット）
        </label>
        <Action title="崩しの撮影をはじめる" note={`トレッドミルで。約${minOf(drill)}分`} onClick={() => void startPhone(go, 'treadmill', { kind: 'drill', drill })} />
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>腰スマホの開発中の機能</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            上の「どこで走る？」（いまは{WHERE_LABEL[where]}）で始まります
          </div>
        </div>
        <Action title="ふつうに走る" note="ピッチが落ちたら声で知らせます（ふつうのアプリの腰スマホと同じ）" onClick={() => void startPhone(go, where)} />
        <Action
          title="ピッチを上げる練習"
          note={practice.n === 1 ? `メトロノームに合わせて走ります。2週間で${PRACTICE.runs}回` : `${practice.n} / ${PRACTICE.runs} 回目。メトロノームに合わせて走ります`}
          onClick={() => void startPhone(go, where, { kind: 'practice', plan: practice })}
        />
        <Action
          title="フォームのテスト"
          note={testDays === null ? '声はかけずに5分。月1回' : testDue ? `前のテストから${testDays}日。そろそろ` : `前のテストから${testDays}日`}
          due={testDue}
          onClick={() => void startPhone(go, where, { kind: 'test' })}
        />
        {lastPhone && (
          <button onClick={() => go({ name: 'phoneResult', id: lastPhone.id })} style={{ ...linkStyle, alignSelf: 'flex-start', fontSize: 13, paddingTop: 4 }}>
            腰スマホの前回の結果を見る（{fmtDate(lastPhone.startedAt)}）
          </button>
        )}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>カメラ版の確かめ</div>
        <Action title="動画で試す" note="撮った動画を、走っている最中と同じしくみに通します" onClick={() => fileRef.current?.click()} />
        <Action title="スロー動画で詳しく見る" note="iPhone の「スロー」で、真横から1〜1.5m離れて、足元まで入れて数歩撮った動画。接地時間・着地のすね・上下動を測ります" onClick={() => slowRef.current?.click()} />
        {lastCamera && (
          <button onClick={() => go({ name: 'result', id: lastCamera.id })} style={{ ...linkStyle, alignSelf: 'flex-start', fontSize: 13, paddingTop: 4 }}>
            カメラ版の前回の結果を見る（{fmtDate(lastCamera.startedAt)}）
          </button>
        )}
      </div>

      <UploadPanel />

      <details className="dev">
        <summary>開発用</summary>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, paddingTop: 10 }}>
          <button onClick={() => exportPhoneLog().then((ok) => ok || alert('まだ腰スマホの記録がありません'))} style={linkStyle}>
            腰スマホの直近の記録を書き出す
          </button>
          <button onClick={() => exportLog().then((ok) => ok || alert('まだカメラ版の記録がありません'))} style={linkStyle}>
            カメラ版の直近の記録を書き出す
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
          <button
            onClick={() => {
              unlockVoice()
              go({ name: 'phone', where: 'treadmill', sim: 20, kind: { kind: 'drill', drill: LAB } })
            }}
            style={linkStyle}
          >
            模擬データで答えつきの記録を試す（20倍の速さで）
          </button>
          <button
            onClick={() => {
              unlockVoice()
              go({ name: 'phone', where: 'treadmill', sim: 20, kind: { kind: 'drill', drill: { ...drill, version: 'short' } } })
            }}
            style={linkStyle}
          >
            模擬データで崩しの撮影を試す（上の選び方の短い版を20倍の速さで）
          </button>
          <UploadKeyButton />
          <a href="/theory/" style={{ ...linkStyle, fontSize: 12 }}>
            フォームの見方
          </a>
        </div>
      </details>

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
    </main>
  )
}

function Action({ title, note, due, onClick }: { title: string; note: string; due?: boolean; onClick: () => void }) {
  return (
    <button className="phone-action" onClick={onClick}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, color: due ? 'var(--accent)' : undefined }}>
          {note}
        </span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 20, color: 'var(--accent)' }}>
        ›
      </span>
    </button>
  )
}
