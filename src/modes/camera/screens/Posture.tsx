import { useMemo, useState } from 'react'
import type { Screen } from '../../../App'
import type { Category, ItemKey, Session } from '../../../core/types'
import { bestSession, nextItem, NEXT_TEXT } from '../nextStep'
import { FORM } from '../params'
import { Mannequin } from '../ui/Mannequin'
import { nextStepFrame, normalizeStride } from '../ui/figure'
import { alignStride } from '../ui/align'
import { ShareBar } from '../../../ui/ShareBar'

const CAT_LABEL: Record<Category, string> = { good: '良い', mid: 'ふつう', bad: '悪い' }
const CAT_COLOR: Record<Category, string> = { good: '#7C8A4A', mid: '#C98A5A', bad: '#FF8A3D' }
const ITEM_LABEL: Record<ItemKey, string> = { head: '頭', trunk: '体幹', trunkBack: '体幹', body: '体全体', bodyBack: '体全体', hip: '腰' }
type Overlay = 'next' | 'best' | 'none'

export function Posture({ session: s, sessions, go }: { session: Session; sessions: Session[]; go: (x: Screen) => void }) {
  const cats = (['good', 'mid', 'bad'] as Category[]).filter((c) => s.strides[c])
  const [cat, setCat] = useState<Category>(cats.includes('bad') ? 'bad' : cats[0])
  const [ov, setOv] = useState<Overlay>('next')
  const best = bestSession(sessions)
  const next = best ? nextItem(best) : undefined

  const frames = useMemo(() => {
    const st = s.strides[cat]
    return st ? alignStride(normalizeStride(st)) : []
  }, [s, cat])

  const ghost = useMemo(() => {
    const st = best?.strides.good
    if (!st || ov === 'none') return undefined
    const f = alignStride(normalizeStride(st))
    if (ov === 'best' || !next) return f
    return f.map((x) => nextStepFrame(x, next.item, next.from, next.to))
  }, [best, next, ov])

  const avg = s.strides[cat]?.avg
  const pct = Math.round(s.share[cat] * 100)
  const titles: Record<Category, string> = {
    good: `${pct}%は良い姿勢。${best?.id === s.id ? 'これが今のベストです。' : 'ベストに近い形です。'}`,
    mid: `${pct}%は、崩れ始めた姿勢です。`,
    bad: `${pct}%は、崩れが大きい姿勢です。${s.breakdownMin !== undefined ? `多くは${s.breakdownMin}分以降です。` : ''}`,
  }

  return (
    <main className="page" style={{ gap: 12 }}>
      <div className="row">
        <button className="icon-btn" aria-label="結果へ戻る" onClick={() => go({ name: 'result', id: s.id })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div style={{ fontSize: 14 }} className="muted">あなたの走り姿 · {Math.round(s.durationSec / 60)}分</div>
        <div style={{ width: 44 }} />
      </div>

      <ShareBar share={s.share} labels={false} />
      <div className="seg" style={{ gridTemplateColumns: `repeat(${cats.length}, 1fr)` }}>
        {cats.map((c) => (
          <button key={c} aria-pressed={c === cat} onClick={() => setCat(c)}>
            {CAT_LABEL[c]} <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{Math.round(s.share[c] * 100)}%</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, width: 52 }} className="muted">重ねる</div>
        <button className="chip" aria-pressed={ov === 'next'} onClick={() => setOv('next')} disabled={!next}>次の一歩</button>
        <button className="chip" aria-pressed={ov === 'best'} onClick={() => setOv('best')} disabled={!best}>自分のベスト</button>
        <button className="chip" aria-pressed={ov === 'none'} onClick={() => setOv('none')}>なし</button>
      </div>

      <div className="stage" style={{ height: 352 }}>
        <Mannequin
          frames={frames}
          ghost={ghost}
          ghostColor={ov === 'best' ? '#9AA3AD' : 'var(--accent)'}
          upperColor={CAT_COLOR[cat]}
          width={358}
          height={352}
          viewBox="0 0 358 352"
          transform="translate(40,-6) scale(0.8)"
        />
        <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#C9CFD5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 18, height: 8, borderRadius: 4, background: CAT_COLOR[cat] }} />
            今回の{CAT_LABEL[cat]}姿勢
          </div>
          {ghost && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 18, borderTop: `2px dashed ${ov === 'best' ? '#9AA3AD' : 'var(--accent)'}` }} />
              {ov === 'best' ? '自分のベスト' : `次の一歩（ベスト＋${next ? ITEM_LABEL[next.item] : ''}だけ）`}
            </div>
          )}
        </div>
        {avg && (
          <div style={{ position: 'absolute', right: 12, top: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <Val v={`+${avg.head.toFixed(0)}°`} label="頭の前への出" warn={avg.head > 5} />
            <Val v={`${avg.trunk.toFixed(0)}°`} label="体幹の前傾" warn={avg.trunk > FORM.trunk.max || avg.trunk < FORM.trunk.min} />
            <Val v={`${avg.body.toFixed(0)}°`} label="体全体の前傾" warn={avg.body > FORM.body.max || avg.body < FORM.body.min} />
          </div>
        )}
        <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11, color: 'var(--faint)' }}>1歩をスロー再生 · 同じタイミングで重ねています</div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5 }}>{titles[cat]}</div>

      {next && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row">
            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>次に意識すること</div>
            <div style={{ fontSize: 11 }} className="muted">正しいフォームから一番離れていた1つだけ</div>
          </div>
          <div style={{ fontSize: 17, fontWeight: 900 }}>{NEXT_TEXT[next.item].title}</div>
          <div style={{ fontSize: 12, lineHeight: 1.55 }} className="muted">
            「次の一歩」は、あなたのベストの走りで、{ITEM_LABEL[next.item]}だけを {next.from.toFixed(0)}° → {next.to.toFixed(0)}°（正しいフォームの線）にした形です。今はこの1つだけを意識してください。
          </div>
        </div>
      )}
    </main>
  )
}

function Val({ v, label, warn }: { v: string; label: string; warn: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="num" style={{ fontSize: 26, color: warn ? 'var(--warn)' : 'var(--text)' }}>{v}</div>
      <div style={{ fontSize: 11 }}>{label}</div>
    </div>
  )
}
