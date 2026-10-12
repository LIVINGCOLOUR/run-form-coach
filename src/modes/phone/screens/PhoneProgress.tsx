import { compareFormTests, prevFormTest, steadyNote, type FormTestKey, type FormTestResult } from '../formtest'
import { FORM_TEST, PRACTICE } from '../params'
import { practiceProgress } from '../practice'
import type { PhoneSession } from '../session'

// 走った後に見せる、ピッチを上げる練習の進み（practice.ts）と、フォームのテストの比べ（formtest.ts）。PhoneResult から使う

const r0 = (v: number | null) => (v === null ? '—' : `${Math.round(v)}`)
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`
const fmtDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const pace = (v: number | null) => {
  if (v === null || v < 0.5) return '—'
  const s = Math.round(1000 / v)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`
}

export function PracticeCard({ s, sessions }: { s: PhoneSession; sessions: PhoneSession[] }) {
  const p = s.practice!
  const g = practiceProgress(sessions, p.programId)
  const left = g.total - g.done
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row">
        <div style={{ fontSize: 15, fontWeight: 700 }}>ピッチを上げる練習</div>
        <div style={{ fontSize: 13 }} className="muted">
          {g.done} / {g.total} 回
        </div>
      </div>
      {!p.counted && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--warn)' }}>
          {p.base === null
            ? 'はじめの3分を走りきれず、今のピッチを測れませんでした。次も1回目からです。'
            : `メトロノームを鳴らしてから ${Math.round(PRACTICE.minSec / 60)} 分に届かなかったので、1回に数えていません。`}
        </div>
      )}
      {g.base !== null && (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          自分のピッチ {r0(g.base)} 歩/分 → 目標 {r0(g.base * (1 + PRACTICE.target / 100))} 歩/分（+{PRACTICE.target}
          %）
          {g.latest !== null && g.changePct !== null && (
            <div>
              最後の回のピッチ <b>{r0(g.latest)}</b> 歩/分（
              {signed(g.changePct, 1)}%{g.runs[g.runs.length - 1]?.cadenceOff !== null ? '・音が止まっている間' : ''}）
            </div>
          )}
        </div>
      )}
      {g.runs.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr 1fr 1fr',
            gap: '4px 10px',
            fontSize: 12,
          }}
        >
          <span className="muted">回</span>
          <span className="muted">鳴らした</span>
          <span className="muted">音あり</span>
          <span className="muted">音なし</span>
          {g.runs.map((x) => (
            <Row key={x.n} cells={[`${x.n}`, `${Math.round((x.onSec / Math.max(1, x.practiceSec)) * 100)}%`, r0(x.cadenceOn), x.cadenceOff !== null ? r0(x.cadenceOff) : '—']} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
        {g.done >= g.total
          ? '8回の練習が終わりました。ふつうの走りでも、このピッチが保てているかを見ていきます。'
          : g.done >= 4
            ? `あと${left}回。5回目からは、音が止まる時間を増やしていきます。止まっても同じリズムで走れるかが、身についたかの目安です。`
            : `あと${left}回。2週間で${g.total}回を目安に。5回目からは、音が止まる時間が少しずつ増えます。`}
      </div>
    </div>
  )
}

function Row({ cells }: { cells: string[] }) {
  return (
    <>
      {cells.map((c, i) => (
        <span key={i} className={i === 0 ? 'muted' : 'num'} style={{ fontSize: i === 0 ? 12 : 15 }}>
          {c}
        </span>
      ))}
    </>
  )
}

const LABEL: Record<FormTestKey, { name: string; unit: string; digits: number }> = {
  cadence: { name: 'ピッチ', unit: '歩/分', digits: 0 },
  bounceCm: { name: '上下動', unit: 'cm', digits: 1 },
  brakingMs: { name: '着地のブレーキ', unit: 'm/s', digits: 2 },
  contactMs: { name: '接地時間', unit: 'ms', digits: 0 },
}

export function FormTestCard({ s, sessions }: { s: PhoneSession; sessions: PhoneSession[] }) {
  const t: FormTestResult = s.test!
  const prev = prevFormTest(sessions, s.startedAt)
  const cmp = t.ok && prev?.test ? compareFormTests(t, s.startedAt, prev.test, prev.startedAt) : null
  const fmt = (k: FormTestKey, v: number | null) => (v === null ? '—' : v.toFixed(LABEL[k].digits))
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row">
        <div style={{ fontSize: 15, fontWeight: 700 }}>フォームのテスト</div>
        <div style={{ fontSize: 12 }} className="muted">
          {cmp ? `前回 ${fmtDate(prev!.startedAt)}（${cmp.days}日前）と比べて` : '初めてのテスト'}
        </div>
      </div>
      {!t.ok && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--warn)' }}>
          {t.why === 'mount'
            ? 'スマホの付け方に問題があったので、このテストは比べるのに使いません。'
            : `5分のうち測れた時間が足りなかったので、このテストは比べるのに使いません。最後まで ${Math.round(FORM_TEST.seconds / 60)} 分走ってください。`}
        </div>
      )}
      <div style={{ fontSize: 13 }} className="muted">
        速さ {pace(t.speed)}
        {cmp && cmp.speedDiff !== null && `（前回 ${pace(prev!.test!.speed)}）`}
      </div>
      {(cmp ? cmp.notes : [steadyNote(t)].filter((x): x is string => !!x)).map((n, i) => (
        <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--warn)' }}>
          {n}
        </div>
      ))}
      {cmp && cmp.speedOk && cmp.steadyOk !== false && <div style={{ fontSize: 13, color: 'var(--accent)' }}>速さはそろっていました。</div>}
      <div style={{ borderTop: '1px solid var(--line)' }}>
        {(['cadence', 'bounceCm', 'brakingMs', 'contactMs'] as FormTestKey[]).map((k) => {
          const it = cmp?.items.find((x) => x.key === k)
          return (
            <div
              key={k}
              className="row"
              style={{
                padding: '10px 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ fontSize: 14 }}>{LABEL[k].name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>
                  {fmt(k, t[k])}
                </span>
                <span style={{ fontSize: 12 }} className="muted">
                  {it && it.prev !== null && it.diff !== null ? `前回 ${fmt(k, it.prev)}（${it.same ? '変わらず' : signed(it.diff, LABEL[k].digits)}）` : LABEL[k].unit}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
        始めの{FORM_TEST.skip}秒を除いた平均です。ピッチは {FORM_TEST.cadenceMin}{' '}
        歩/分より小さい差を「変わらず」としています。上下動・ブレーキ・接地時間は腰のスマホで測った目安で、良し悪しの線はありません。毎回、同じ平らな道で比べてください。
      </div>
    </div>
  )
}
