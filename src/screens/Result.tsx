import type { Screen } from '../App'
import { ITEM_KEYS, type ItemKey, type Session } from '../core/types'
import { ShareBar } from '../ui/ShareBar'
import { fmtDate } from './Home'
import { exportLog } from '../core/exportLog'
import { UploadState } from '../ui/Upload'
import { fmtMinSec, quietDelta, QUIET_NONE, splitMinSec } from '../core/quiet'
import { formRows, nextItem, nextNote, NEXT_TEXT, type FormRow, type Next } from '../modes/camera/nextStep'
import { GOOD } from '../modes/camera/params'
import type { FormResult } from '../core/types'

const ITEMS: ItemKey[] = ITEM_KEYS

export function Result({ session: s, sessions, go }: { session: Session; sessions: Session[]; go: (x: Screen) => void }) {
  const idx = sessions.findIndex((x) => x.id === s.id)
  const prev = sessions[idx + 1]
  const good = Math.round(s.share.good * 100)
  const delta = prev ? Math.round((s.share.good - prev.share.good) * 100) : null
  const goodMin = Math.round((s.share.good * s.durationSec) / 60)
  // 主役：声なしで保てた時間
  const held = splitMinSec(s.quietHeldSec)
  const heldAny = held.min > 0 || held.sec > 0
  const heldDelta = quietDelta(s.quietHeldSec, prev?.quietHeldSec)
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
        <div style={{ fontSize: 14 }} className="muted">声なしで保てた時間</div>
        {heldAny ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 12px' }}>
            <div className="num" style={{ fontSize: 104, lineHeight: 0.82, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
              {held.min > 0 && (
                <>
                  {held.min}
                  <span style={{ fontSize: 40 }}>分</span>
                </>
              )}
              {(held.sec > 0 || held.min === 0) && (
                <>
                  {held.sec}
                  <span style={{ fontSize: 40 }}>秒</span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.4, color: 'var(--accent)' }}>{QUIET_NONE.title}</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">{QUIET_NONE.how}</div>
          </div>
        )}
        {heldAny && <div style={{ fontSize: 12 }} className="muted">声をかけずに見守る間、良い姿勢で走れた時間 · {Math.round(s.durationSec / 60)}分のうち</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14 }} className="muted">良い姿勢で走れた時間</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div className="num" style={{ fontSize: 72, lineHeight: 0.85 }}>
            {good}
            <span style={{ fontSize: 36 }}>%</span>
          </div>
          {delta !== null && (
            <div style={{ fontSize: 13, paddingBottom: 6, color: delta >= 0 ? 'var(--accent)' : 'var(--warn)' }}>
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

      {s.form && s.form.length > 0 && <FormCard form={s.form} next={nextItem(s)} />}

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
        <Stat label="声をかけた回数" value={`${cues.length}`} note={`前半 ${firstHalf} · 後半 ${cues.length - firstHalf}${cues.some((c) => c.lead) ? ` · うち正しいフォームの線 ${cues.filter((c) => c.lead).length}` : ''}`} />
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
      {s.logId && <UploadState kind="camera" logId={s.logId} startedAt={s.startedAt} />}
      {s.logId && (
        <button onClick={() => exportLog(s.logId)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 }}>
          調整用の記録を書き出す（骨格の数字だけ・映像なし）
        </button>
      )}
      <button className="primary" onClick={() => go({ name: 'home' })}>
        ホームへ
      </button>
    </main>
  )
}

// よい例との差：項目ごとに、走っていた秒の平均と、よい例の範囲と、その差（主役）。声をかける線（正しいフォームの線）との
// 比べは、控えめに添える（線は外れた声にならないよう広く取っているので、ふつうはどれも内側に入る）。次に意識する1つも。
// 言葉は nextStep.ts の formRows で決める
function FormCard({ form, next }: { form: FormResult[]; next: Next | undefined }) {
  const rows = formRows(form)
  // 線の外は warn、よい例から離れていたら mid、ほぼ同じは文字の色、よい例の範囲なら accent
  const color = (r: FormRow) => (r.lineOut ? 'var(--warn)' : r.state === 'off' ? 'var(--mid)' : r.state === 'near' ? 'var(--text)' : 'var(--accent)')
  const skippedHead = !next && rows.some((r) => r.state === 'off' && r.note)
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>よい例との差</div>
        <div style={{ fontSize: 12 }} className="muted">走っていた間の平均を、よい例の範囲と比べました</div>
      </div>
      {rows.map((r) => (
        <div key={r.group} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13 }} className="muted">{r.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 6px', color: color(r) }}>
            {r.state === 'in' ? (
              <span style={{ fontSize: 22, fontWeight: 900 }}>よい例の範囲です</span>
            ) : (
              <>
                <span style={{ fontSize: 15, fontWeight: 700 }}>よい例より</span>
                <span className="num" style={{ fontSize: 40, fontWeight: 600 }}>{r.gap}</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{r.word}</span>
                {r.state === 'near' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>差はわずかで、ほぼ同じ</span>}
              </>
            )}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            あなた{' '}
            {r.youParts.map((p, i) => (
              <span key={p.label}>
                {i > 0 && '・'}
                {p.label}
                <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>{p.value}</span>
              </span>
            ))}
            <span className="muted">／よい例 {r.good}</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: r.lineOut ? 'var(--warn)' : 'var(--faint)' }}>{r.line}</div>
          {r.note && <div style={{ fontSize: 12, lineHeight: 1.5, color: '#E0B341' }}>{r.note}</div>}
        </div>
      ))}
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--faint)' }}>
        よい例は、ランニングの講師1人の手本{GOOD.examples}本を、アプリと同じ骨格の推定で測った値です（時速{GOOD.kmh.min}〜{GOOD.kmh.max}km。体全体の傾きは、速く走るほど大きく出ます）。声をかける線の内側なら、走っている間は声をかけません。
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
        {next ? (
          <>
            次に意識すること：<span style={{ fontWeight: 700 }}>{NEXT_TEXT[next.item].title}</span>
            <div style={{ fontSize: 12 }} className="muted">{nextNote(next)}</div>
          </>
        ) : (
          <div style={{ fontSize: 12 }} className="muted">
            {skippedHead ? '頭のほかは、よい例の範囲か、差はわずかでした（頭は大きく出ているかもしれないので、次に意識することには選びません）' : 'どの項目も、よい例の範囲か、差はわずかでした'}
          </div>
        )}
      </div>
    </div>
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
  const cueTimes = s.cues.filter((c) => ITEMS.includes(c.item as ItemKey)).map((c) => c.t)
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
