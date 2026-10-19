import { fmtMinSec, quietDelta, QUIET_NONE, splitMinSec } from '../../../core/quiet'
import { ShareBar } from '../../../ui/ShareBar'
import type { FatigueBlock, FatigueResult } from '../fatigue'
import type { MountIssue } from '../mount'
import { FATIGUE } from '../params'
import type { PhoneSession } from '../session'
import { exportPhoneLog } from '../storage'
import { UploadState } from '../../../ui/Upload'
import { FormTestCard, PracticeCard } from './PhoneProgress'

// スマホ版の結果。カメラ版の結果（src/screens/Result.tsx）は姿勢の項目と走り姿を前提にしているので、別に持つ
// 腰のスマホでは姿勢が見えないので「良い姿勢」ではなく「良い走り」と言う

const CUE_ITEMS = ['cadence', 'braking', 'bounce', 'mount', 'loose', 'place']
const MOUNT_TEXT: Record<MountIssue, string> = {
  notWaist: 'スマホが腰以外に付いていたようです。見つけたところから、判定を止めました。',
  loose: 'スマホがゆるかったようです。見つけたところから、ピッチだけ判定しました（上下動・ブレーキは見ていません）。',
  shifted: '途中でスマホがずれたようです。見つけたところから、判定を止めました。',
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const fmtDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function PhoneResult({ session: s, sessions, onHome }: { session: PhoneSession; sessions: PhoneSession[]; onHome: () => void }) {
  const idx = sessions.findIndex((x) => x.id === s.id)
  const prev = sessions[idx + 1]
  const held = splitMinSec(s.quietHeldSec)
  const heldAny = held.min > 0 || held.sec > 0
  const heldDelta = quietDelta(s.quietHeldSec, prev?.quietHeldSec)
  const judgedAny = s.samples.some((x) => x.score !== null)
  const cues = s.cues.filter((c) => CUE_ITEMS.includes(c.item))
  const avg = (k: 'cadence' | 'bounceCm' | 'brakingMs') => mean(s.samples.flatMap((x) => (x[k] === null ? [] : [x[k] as number])))
  const cad = avg('cadence')
  const bounce = avg('bounceCm')
  const braking = avg('brakingMs')
  // 速さで判定を止めた時間（外だけ。1秒の記録の数で数える）
  const gated = s.samples.filter((x) => x.gate).length
  const gatedNoGps = s.samples.filter((x) => x.gate === 'noGps' || x.gate === 'noBase').length

  return (
    <main className="page">
      <div className="row">
        <button className="icon-btn" aria-label="ホームへ" onClick={onHome}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div style={{ fontSize: 14 }} className="muted">
          {fmtDate(s.startedAt)} · {Math.round(s.durationSec / 60)}分 · スマホ（腰）
        </div>
        <div style={{ width: 44 }} />
      </div>

      {s.mount && <div style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid var(--warn)', color: 'var(--warn)', fontSize: 13, lineHeight: 1.6 }}>{MOUNT_TEXT[s.mount]}</div>}

      {s.practice && <PracticeCard s={s} sessions={sessions} />}
      {s.test && <FormTestCard s={s} sessions={sessions} />}

      {/* 練習とテストでは、ピッチが落ちても知らせないので、声なしで保てた時間と良い走りの割合は出さない */}
      {!s.kind && (
        <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14 }} className="muted">声なしで保てた時間</div>
        {heldAny ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 12px' }}>
            <div className="num" style={{ fontSize: 88, lineHeight: 0.82, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
              {held.min > 0 && (
                <>
                  {held.min}
                  <span style={{ fontSize: 36 }}>分</span>
                </>
              )}
              {(held.sec > 0 || held.min === 0) && (
                <>
                  {held.sec}
                  <span style={{ fontSize: 36 }}>秒</span>
                </>
              )}
            </div>
            {heldDelta !== null && heldDelta !== 0 && (
              <div style={{ fontSize: 13, paddingBottom: 8, color: heldDelta > 0 ? 'var(--accent)' : 'var(--warn)' }}>
                {heldDelta > 0 ? '▲' : '▼'} {fmtMinSec(Math.abs(heldDelta))}　前回より
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.6 }} className="muted">{QUIET_NONE.how.replace('良い姿勢', '良い走り')}</div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14 }} className="muted">良い走りの割合（走り始めの自分と比べて）</div>
        {judgedAny ? <ShareBar share={s.share} height={12} /> : <div style={{ fontSize: 13 }} className="muted">判定した時間がありません（走り始めの基準は3分で作ります）</div>}
      </div>
        </>
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <div style={{ fontSize: 15, fontWeight: 700 }}>ピッチの推移</div>
          <div style={{ fontSize: 12 }} className="muted">歩/分</div>
        </div>
        <CadenceChart s={s} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12 }} className="muted">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, borderTop: '1.5px dashed var(--faint)' }} />
            走り始めの基準
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 2, height: 10, background: 'var(--warn)' }} />
            声をかけた
          </span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)' }}>
        <Stat label="ピッチ" value={cad !== null ? `${Math.round(cad)}` : '—'} note={s.ref ? `基準 ${Math.round(s.ref.cadence)} 歩/分` : '歩/分'} />
        <Stat label="上下動" value={bounce !== null ? bounce.toFixed(1) : '—'} note={s.ref ? `基準 ${s.ref.bounceCm.toFixed(1)} cm` : 'cm'} />
        <Stat label="着地のブレーキ" value={braking !== null ? braking.toFixed(2) : '—'} note={s.ref ? `基準 ${s.ref.brakingMs.toFixed(2)} m/s` : 'm/s'} />
        {s.where === 'outdoor' && (
          <Stat label="速さで判定を止めた" value={fmtMinSec(gated)} note={gatedNoGps ? `うち GPS なし ${fmtMinSec(gatedNoGps)}` : s.refSpeed ? `基準 ${(s.refSpeed * 3.6).toFixed(1)} km/h` : undefined} />
        )}
        <Stat
          label="崩れ始め"
          value={s.fatigue ? (s.fatigue.onsetSec !== null ? `${Math.round(s.fatigue.onsetSec / 60)}分` : 'なし') : '—'}
          note={s.fatigue ? 'リズムと揺れ方から' : s.fatigue === null ? '走り始めの基準を作れませんでした' : undefined}
        />
        <Stat label="知らせた回数" value={`${cues.length}`} note={`声 ${cues.filter((c) => !c.tone).length} · メトロノーム ${cues.filter((c) => c.tone).length}`} />
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">上下動とブレーキは、腰のスマホで測った目安です。カメラ版と比べて確かめるまでは、自分の基準との差だけを見てください。</div>

      {s.fatigue && <FatigueCard f={s.fatigue} total={s.durationSec} />}
      {s.fatigue && <ChangeCard f={s.fatigue} total={s.durationSec} />}

      {s.cues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13 }} className="muted">最近の知らせ</div>
          {s.cues.slice(-4).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, fontSize: 14, lineHeight: 1.5 }}>
              <span className="num muted" style={{ width: 44, flexShrink: 0, fontSize: 15, fontWeight: 500 }}>
                {String(Math.floor(c.t / 60)).padStart(2, '0')}:{String(c.t % 60).padStart(2, '0')}
              </span>
              <span style={{ color: CUE_ITEMS.includes(c.item) ? 'var(--warn)' : 'var(--accent)' }}>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      {s.logId && <UploadState kind="phone" logId={s.logId} startedAt={s.startedAt} />}
      {s.logId && (
        <button onClick={() => exportPhoneLog(s.logId).then((ok) => ok || alert('記録が見つかりません'))} style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 }}>
          調整用の記録を書き出す（加速度・ジャイロと1秒ごとの判定）
        </button>
      )}
      <button className="primary" onClick={onHome}>
        ホームへ
      </button>
    </main>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontSize: 14 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>{value}</span>
        {note && <span style={{ fontSize: 12 }} className="muted">{note}</span>}
      </div>
    </div>
  )
}

// 30秒ごとの平均のピッチ、走り始めの基準、声をかけた時刻
function CadenceChart({ s }: { s: PhoneSession }) {
  const W = 324
  const H = 120
  const X0 = 28
  const total = Math.max(60, s.durationSec)
  const pts: { t: number; v: number }[] = []
  for (let a = 0; a < s.durationSec; a += 30) {
    const v = mean(s.samples.filter((p) => p.t >= a && p.t < a + 30 && p.cadence !== null).map((p) => p.cadence as number))
    if (v !== null) pts.push({ t: a + 15, v })
  }
  if (pts.length < 2) return <div style={{ fontSize: 13 }} className="muted">ピッチを測れた時間が短く、グラフにできません</div>
  const vs = pts.map((p) => p.v).concat(s.ref ? [s.ref.cadence] : [])
  const lo = Math.floor(Math.min(...vs) - 5)
  const hi = Math.ceil(Math.max(...vs) + 5)
  const x = (t: number) => X0 + (t / total) * (W - X0)
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 8)
  const cueTimes = s.cues.filter((c) => CUE_ITEMS.includes(c.item)).map((c) => c.t)
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 36}`} aria-label="ピッチの推移">
      <path d={`M${X0} ${H}H${W}`} stroke="#262C33" />
      <text x="0" y={y(hi) + 12} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{hi}</text>
      <text x="0" y={H - 2} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{lo}</text>
      {s.ref && <path d={`M${X0} ${y(s.ref.cadence)}H${W}`} stroke="#6B7480" strokeDasharray="4 4" />}
      <polyline fill="none" stroke="#F2F4F5" strokeWidth="2" strokeLinejoin="round" points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
      {cueTimes.map((t, i) => (
        <rect key={i} x={x(t) - 1} y={H + 6} width={2} height={8} fill="#FF8A3D" />
      ))}
      <text x={X0} y={H + 30} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">0分</text>
      <text x={W - 30} y={H + 30} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{Math.round(s.durationSec / 60)}分</text>
    </svg>
  )
}

const baseText = (f: FatigueResult) => (f.base === 'later' ? '5〜12分' : '30秒〜3分')

// いつもと違う度合い（疲れの見分け）。1分ごと。線を超えた区間が続いたところが崩れ始め
function FatigueCard({ f, total }: { f: FatigueResult; total: number }) {
  const pts = f.blocks.filter((b): b is FatigueBlock & { score: number } => b.score !== null).map((b) => ({ t: b.t + FATIGUE.block / 2, v: b.score }))
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row">
        <div style={{ fontSize: 15, fontWeight: 700 }}>いつもと違う度合い</div>
        <div style={{ fontSize: 12 }} className="muted">基準 {baseText(f)}</div>
      </div>
      <LineChart pts={pts} total={total} zero={0} mark={FATIGUE.line} onset={f.onsetSec} fmt={(v) => v.toFixed(0)} label="いつもと違う度合いの推移" />
      <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
        リズムのそろい方・上下前後左右の揺れの割合・接地の長さを、走り始めの自分と比べてまとめた値です（走っている間は声にしません）。
        {f.onsetSec !== null ? `${Math.round(f.onsetSec / 60)}分ごろから、いつもと違う走りが続きました。` : 'いつもと違う走りが続いたところはありませんでした。'}
        点線（{FATIGUE.line}）は仮の目安で、まだ確かめていません。
      </div>
    </div>
  )
}

// 上下動・ブレーキ・有効接地時間の、走り始めの自分からの変化。決まった線での良し悪しは言わない（根拠がないため）
function ChangeCard({ f, total }: { f: FatigueResult; total: number }) {
  const rows: { key: 'dBounceCm' | 'dBrakingPct' | 'dContactMs'; label: string; unit: string; fmt: (v: number) => string }[] = [
    { key: 'dBounceCm', label: '上下動', unit: 'cm', fmt: (v) => v.toFixed(1) },
    { key: 'dBrakingPct', label: '着地のブレーキ', unit: '%', fmt: (v) => v.toFixed(0) },
    { key: 'dContactMs', label: '接地の長さ（有効接地時間）', unit: 'ms', fmt: (v) => v.toFixed(0) },
  ]
  const late = f.blocks.filter((b) => b.t >= f.baseTo)
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row">
        <div style={{ fontSize: 15, fontWeight: 700 }}>走り始めからの変化</div>
        <div style={{ fontSize: 12 }} className="muted">基準 {baseText(f)}</div>
      </div>
      {rows.map((r) => {
        const pts = f.blocks.flatMap((b) => (b[r.key] === null ? [] : [{ t: b.t + FATIGUE.block / 2, v: b[r.key] as number }]))
        const after = late.flatMap((b) => (b[r.key] === null ? [] : [b[r.key] as number]))
        const end = after.length ? after[after.length - 1] : null
        return (
          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ fontSize: 13 }}>
              <span>{r.label}</span>
              <span className="muted">{end !== null ? `最後の1分 ${end > 0 ? '+' : ''}${r.fmt(end)} ${r.unit}` : '—'}</span>
            </div>
            <LineChart pts={pts} total={total} zero={0} onset={f.onsetSec} fmt={r.fmt} height={56} label={`${r.label}の変化`} />
          </div>
        )
      })}
      <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
        0 の線が走り始めの自分です。増えた・減ったの良し悪しは決めていません（決まった線を言える研究がないため）。接地の長さは本当の接地時間より短く出る目安です。
      </div>
    </div>
  )
}

// 1分ごとの値の線。zero：基準の線（実線）、mark：目安の線（点線）、onset：崩れ始めの縦線
function LineChart({ pts, total, zero, mark, onset, fmt, height = 90, label }: { pts: { t: number; v: number }[]; total: number; zero: number; mark?: number; onset: number | null; fmt: (v: number) => string; height?: number; label: string }) {
  const W = 324
  const H = height
  const X0 = 28
  const T = Math.max(60, total)
  if (pts.length < 2) return <div style={{ fontSize: 13 }} className="muted">測れた時間が短く、グラフにできません</div>
  const vs = pts.map((p) => p.v).concat([zero], mark !== undefined ? [mark] : [])
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1]
  const pad = (hi - lo) * 0.1
  lo -= pad
  hi += pad
  const x = (t: number) => X0 + (Math.min(t, T) / T) * (W - X0)
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 8) - 2
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 18}`} aria-label={label}>
      <text x="0" y={y(hi - pad) + 10} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{fmt(hi - pad)}</text>
      <text x="0" y={y(lo + pad)} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{fmt(lo + pad)}</text>
      <path d={`M${X0} ${y(zero)}H${W}`} stroke="#6B7480" />
      {mark !== undefined && <path d={`M${X0} ${y(mark)}H${W}`} stroke="#6B7480" strokeDasharray="4 4" />}
      {onset !== null && <path d={`M${x(onset)} 0V${H}`} stroke="#FF8A3D" strokeWidth="1.2" strokeDasharray="4 4" />}
      <polyline fill="none" stroke="#F2F4F5" strokeWidth="2" strokeLinejoin="round" points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
      <text x={X0} y={H + 15} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">0分</text>
      <text x={W - 30} y={H + 15} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{Math.round(total / 60)}分</text>
    </svg>
  )
}
