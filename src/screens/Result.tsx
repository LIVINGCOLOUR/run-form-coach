import type { Screen } from '../App'
import type { ItemKey, Session } from '../core/types'
import { ShareBar } from '../ui/ShareBar'
import { fmtDate } from './Home'

const ITEMS: ItemKey[] = ['head', 'trunk', 'body', 'hip']

export function Result({ session: s, sessions, go }: { session: Session; sessions: Session[]; go: (x: Screen) => void }) {
  const idx = sessions.findIndex((x) => x.id === s.id)
  const prev = sessions[idx + 1]
  const good = Math.round(s.share.good * 100)
  const delta = prev ? Math.round((s.share.good - prev.share.good) * 100) : null
  const goodMin = Math.round((s.share.good * s.durationSec) / 60)
  const cues = s.cues.filter((c) => ITEMS.includes(c.item as ItemKey))
  const recovers = s.cues.filter((c) => c.item === 'recover').length
  const half = s.durationSec / 2
  const firstHalf = cues.filter((c) => c.t < half).length
  const summary =
    s.breakdownMin !== undefined
      ? `${s.breakdownMin}分から崩れ始めました。${recovers ? '声をかけるたびに戻せています。' : '後半こそ、今日の意識を思い出しましょう。'}`
      : cues.length
        ? '大きく崩れずに走れました。声をかけた所は、すぐに戻せています。'
        : '最後まで、大きく崩れずに走れました。'

  // 「今悪い」の一致：押した前後5秒にアプリも崩れと判定していたか
  const taps = s.taps ?? []
  const matched = taps.filter((t) => s.samples.some((x) => Math.abs(x.t - t) <= 5 && x.score < 80)).length

  return (
    <main className="page">
      <div className="row">
        <button className="icon-btn" aria-label="ホームへ" onClick={() => go({ name: 'home' })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div style={{ fontSize: 14 }} className="muted">
          {fmtDate(s.startedAt)} · {Math.round(s.durationSec / 60)}分{s.speedKmh ? ` · ${s.speedKmh} km/h` : ''}
        </div>
        <div style={{ width: 44 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14 }} className="muted">良い姿勢で走れた時間</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div className="num" style={{ fontSize: 120, lineHeight: 0.82, color: 'var(--accent)' }}>
            {good}
            <span style={{ fontSize: 56 }}>%</span>
          </div>
          {delta !== null && (
            <div style={{ fontSize: 13, paddingBottom: 10, color: delta >= 0 ? 'var(--accent)' : 'var(--warn)' }}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%　前回より
            </div>
          )}
        </div>
        <ShareBar share={s.share} height={12} />
        <div style={{ fontSize: 12 }} className="muted">良い姿勢 {goodMin}分 / {Math.round(s.durationSec / 60)}分</div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5, paddingTop: 4 }}>{summary}</div>
        {s.standing && (
          <div style={{ fontSize: 12 }} className="muted">
            走る前の立ち姿勢：{s.standing.issue === 'head' ? '頭が前に出ていました' : s.standing.issue === 'back' ? '背中が丸まっていました' : '頭も背中もまっすぐ'}（頭 {Math.round(s.standing.head)}° / 上体 {Math.round(s.standing.trunk)}°）
          </div>
        )}
        {s.provisionalBaseline && <div style={{ fontSize: 12, color: 'var(--warn)' }}>動画で試したため、直立の基準は仮のものです</div>}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <div style={{ fontSize: 15, fontWeight: 700 }}>姿勢スコアの推移</div>
          <div style={{ fontSize: 12 }} className="muted">0〜100</div>
        </div>
        <Timeline s={s} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12 }} className="muted">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 10, background: '#1A2016', border: '1px solid #3E4A2A' }} />
            声なしで確認した時間
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 2, height: 10, background: 'var(--warn)' }} />
            声をかけた
          </span>
        </div>
      </div>

      <button className="card" onClick={() => go({ name: 'posture', id: s.id })} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <div style={{ fontSize: 15, fontWeight: 700 }}>あなたの走り姿</div>
          <div style={{ fontSize: 13, color: 'var(--accent)' }}>詳しく見る →</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }} className="muted">良い・ふつう・悪いそれぞれの1歩を、自分のベストや次の一歩と重ねて見比べられます。</div>
      </button>

      <div style={{ borderTop: '1px solid var(--line)' }}>
        <Stat label="崩れ始め" value={s.breakdownMin !== undefined ? `${s.breakdownMin}分` : 'なし'} note={prev?.breakdownMin !== undefined && s.breakdownMin !== undefined ? `前回 ${prev.breakdownMin}分` : undefined} />
        <Stat label="声をかけた回数" value={`${cues.length}`} note={`前半 ${firstHalf} · 後半 ${cues.length - firstHalf}`} />
        <Stat label="声なしで保てた時間" value={`${Math.round(s.quietHeldSec / 60)}分`} note={`${Math.round(s.durationSec / 60)}分のうち`} />
        {taps.length > 0 && <Stat label="「今悪い」との一致" value={`${Math.round((matched / taps.length) * 100)}%`} note={`${taps.length}回のうち ${matched}回`} />}
      </div>

      {s.cues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13 }} className="muted">最近の声</div>
          {s.cues.slice(-4).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, fontSize: 14, lineHeight: 1.5 }}>
              <span className="num muted" style={{ width: 44, flexShrink: 0, fontSize: 15, fontWeight: 500 }}>
                {String(Math.floor(c.t / 60)).padStart(2, '0')}:{String(c.t % 60).padStart(2, '0')}
              </span>
              <span style={{ color: ITEMS.includes(c.item as ItemKey) ? 'var(--warn)' : 'var(--accent)' }}>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <button className="primary" onClick={() => go({ name: 'home' })}>
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

// 1分ごとの平均の姿勢スコア、声なしで確認した時間の帯、声をかけた時刻
function Timeline({ s }: { s: Session }) {
  const W = 324
  const H = 140
  const X0 = 24
  const total = Math.max(60, s.durationSec)
  const x = (t: number) => X0 + (t / total) * (W - X0)
  const y = (v: number) => H - (v / 100) * (H - 8)
  const perMin: { t: number; v: number }[] = []
  for (let m = 0; m * 60 < s.durationSec; m++) {
    const xs = s.samples.filter((p) => p.t >= m * 60 && p.t < (m + 1) * 60)
    if (xs.length) perMin.push({ t: m * 60 + 30, v: xs.reduce((a, b) => a + b.score, 0) / xs.length })
  }
  const bands: { a: number; b: number }[] = []
  for (const p of s.samples) {
    const last = bands[bands.length - 1]
    if (p.quiet) {
      if (last && p.t - last.b <= 2) last.b = p.t
      else bands.push({ a: p.t, b: p.t })
    }
  }
  const cueTimes = s.cues.filter((c) => ['head', 'trunk', 'body', 'hip'].includes(c.item)).map((c) => c.t)
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 36}`} aria-label="姿勢スコアの推移">
      {bands.map((b, i) => (
        <rect key={i} x={x(b.a)} y={0} width={Math.max(1, x(b.b) - x(b.a))} height={H} fill="#1A2016" />
      ))}
      <path d={`M${X0} ${H}H${W}`} stroke="#262C33" />
      <path d={`M${X0} ${y(50)}H${W}`} stroke="#1E2429" />
      <text x="0" y="14" fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">100</text>
      <text x="4" y={y(50) + 4} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">50</text>
      {s.breakdownMin !== undefined && (
        <>
          <path d={`M${x(s.breakdownMin * 60)} 0V${H}`} stroke="#FF8A3D" strokeWidth="1.2" strokeDasharray="4 4" />
          <text x={x(s.breakdownMin * 60) + 6} y="12" fontSize="11" fill="#FF8A3D">崩れ始め {s.breakdownMin}分</text>
        </>
      )}
      {perMin.length > 1 && <polyline fill="none" stroke="#F2F4F5" strokeWidth="2" strokeLinejoin="round" points={perMin.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />}
      {cueTimes.map((t, i) => (
        <rect key={i} x={x(t) - 1} y={H + 6} width={2} height={8} fill="#FF8A3D" />
      ))}
      <text x={X0} y={H + 30} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">0分</text>
      <text x={W - 30} y={H + 30} fontSize="11" fill="#9AA3AD" fontFamily="Barlow Condensed">{Math.round(s.durationSec / 60)}分</text>
    </svg>
  )
}
