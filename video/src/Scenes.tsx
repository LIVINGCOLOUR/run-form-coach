import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame } from 'remotion'
import { Figure } from './Figure'
import { C, FPS, jp, num } from './theme'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const fadeUp = (f: number, at: number, dur = 14) => ({
  opacity: interpolate(f, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [at, at + dur], [40, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
})
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 14, stiffness: 160 } })

export function Bg({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: jp, color: C.text }}>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <g stroke={C.grid} strokeWidth={1.5}>
          {Array.from({ length: 12 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${(i + 1) * 160}H1080`} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={`v${i}`} d={`M${(i + 1) * 160} 0V1920`} />
          ))}
        </g>
      </svg>
      {children}
    </AbsoluteFill>
  )
}

const H1: CSSProperties = { fontWeight: 900, fontSize: 112, lineHeight: 1.2, letterSpacing: -2 }
const H2: CSSProperties = { fontWeight: 900, fontSize: 76, lineHeight: 1.3, letterSpacing: -1 }

// ナレーションの字幕（音を消して見る人のため）
export function Caption({ text, from, to }: { text: string; from: number; to: number }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [from, from + 6, to - 6, to], [0, 1, 1, 0], clamp)
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, bottom: 56, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.5, textAlign: 'center', padding: '18px 30px', borderRadius: 20, background: 'rgba(10,12,14,0.78)' }}>{text}</div>
    </div>
  )
}

function Mark({ size, draw = 1 }: { size: number; draw?: number }) {
  const c = 2 * Math.PI * 12
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke={C.accent} strokeWidth={2}>
      <circle cx={14} cy={14} r={12} strokeDasharray={c} strokeDashoffset={c * (1 - draw)} />
      <circle cx={14} cy={14} r={4.5} opacity={draw} />
      <path d="M14 2v4M14 22v4" opacity={draw} />
    </svg>
  )
}

// 1. 後半で失速するペースの線
export function SHook() {
  const f = useCurrentFrame()
  const x = (km: number) => 120 + (km / 42.195) * 840
  const y = (km: number) => (km < 30 ? 820 + Math.sin(km * 0.7) * 1.5 : 820 + ((km - 30) / 12.195) ** 1.6 * 300)
  const pts = (a: number, b: number) =>
    Array.from({ length: 60 }, (_, i) => a + ((b - a) * i) / 59)
      .map((k) => `${x(k).toFixed(1)},${y(k).toFixed(1)}`)
      .join(' ')
  const draw = interpolate(f, [8, 110], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const len = 1200
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 260, ...fadeUp(f, 6) }}>
        <div style={H1}>フルマラソン。</div>
      </div>
      <div style={{ position: 'absolute', left: 90, top: 420, ...fadeUp(f, 70) }}>
        <div style={{ ...H2, color: C.muted }}>
          後半で、<span style={{ color: C.warn }}>失速</span>
          <br />
          していませんか。
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M${x(30)} 700V1180`} stroke={C.warn} strokeWidth={2} strokeDasharray="10 10" opacity={draw > 0.65 ? 1 : 0} />
        <text x={x(30) + 14} y={720} fill={C.warn} fontSize={40} fontFamily={num} fontWeight={700} opacity={draw > 0.65 ? 1 : 0}>
          30km
        </text>
        <polyline points={pts(0, 30)} fill="none" stroke={C.text} strokeWidth={8} strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(1, draw / 0.7))} />
        <polyline points={pts(30, 42.195)} fill="none" stroke={C.warn} strokeWidth={8} strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0, (draw - 0.7) / 0.3))} />
        <path d="M120 1220H960" stroke={C.line} strokeWidth={3} />
        <text x={120} y={1280} fill={C.muted} fontSize={40} fontFamily={num}>
          0km
        </text>
        <text x={960} y={1280} fill={C.muted} fontSize={40} fontFamily={num} textAnchor="end">
          42.195km
        </text>
        <text x={120} y={790} fill={C.muted} fontSize={36} fontFamily={num}>
          PACE
        </text>
      </svg>
    </Bg>
  )
}

// 2. 疲れて崩れるフォーム。自分では見えない
export function SProblem() {
  const f = useCurrentFrame()
  const k = interpolate(f, [50, 230], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const upper = interpolateColors(k, [0, 1], [C.limb, C.warn])
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 220, ...fadeUp(f, 10) }}>
        <div style={H1}>
          疲れて、
          <br />
          <span style={{ color: C.warn }}>崩れる。</span>
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Figure frame={f} lean={7 + 10 * k} head={12 * k} upper={upper} transform="translate(170,520) scale(2.0)" />
      </svg>
      <div style={{ position: 'absolute', right: 90, top: 700, textAlign: 'right', opacity: k }}>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 92, color: C.warn, lineHeight: 1 }}>+{Math.round(12 * k)}°</div>
        <div style={{ fontSize: 34 }}>頭が前に落ちる</div>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 92, lineHeight: 1, marginTop: 30 }}>{Math.round(7 + 10 * k)}°</div>
        <div style={{ fontSize: 34 }}>上体が倒れる</div>
      </div>
      <div style={{ position: 'absolute', left: 90, top: 1440, ...fadeUp(f, 205) }}>
        <div style={{ ...H2, fontSize: 64 }}>
          その姿は、<span style={{ color: C.accent }}>自分では見えない。</span>
        </div>
      </div>
    </Bg>
  )
}

// 3. ロゴ。スマホ1台で見続ける
export function SSolution() {
  const f = useCurrentFrame()
  const draw = interpolate(f, [0, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const s = pop(f, 18)
  const scan = (f * 9) % 480
  return (
    <Bg>
      <div style={{ position: 'absolute', top: 250, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
        <div style={{ transform: `scale(${0.6 + 0.4 * s})` }}>
          <Mark size={170} draw={draw} />
        </div>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 122, letterSpacing: 14, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>RUN FORM COACH</div>
        <div style={{ fontSize: 52, fontWeight: 700, textAlign: 'center', lineHeight: 1.5, ...fadeUp(f, 60) }}>
          スマホ1台で、
          <br />
          あなたの走りを<span style={{ color: C.accent }}>見続ける</span>AIコーチ。
        </div>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 1010, height: 480, ...fadeUp(f, 130) }}>
        <svg width={900} height={560} viewBox="0 0 900 560">
          <rect x={40} y={20} width={820} height={460} rx={56} fill={C.stage} stroke="#3A424B" strokeWidth={6} />
          <g stroke={C.grid}>
            <path d="M40 140H860M40 260H860M40 380H860M240 20V480M440 20V480M640 20V480" />
          </g>
          <Figure frame={f} lean={7} head={0} upper={C.accent} transform="translate(300,28) scale(0.98)" />
          <rect x={40} y={20 + scan * 0.95} width={820} height={6} fill={C.accent} opacity={0.35} />
          <path d="M450 480V545M370 545H530" stroke="#3A424B" strokeWidth={10} strokeLinecap="round" />
        </svg>
      </div>
    </Bg>
  )
}

// 4. 置いて、立って、走るだけ
export function SSteps() {
  const f = useCurrentFrame()
  const items: [string, number, ReactNode][] = [
    ['置いて、', 6, <path key="a" d="M22 8h20v34H22zM32 42v16M20 58h24" />],
    ['立って、', 36, <path key="b" d="M32 6a5 5 0 1 0 0 .1M32 16v22M22 24h20M32 38l-7 20M32 38l7 20" />],
    ['走るだけ。', 66, <path key="c" d="M38 6a5 5 0 1 0 0 .1M36 18l-6 16 10 8-2 16M30 34l-12 4M36 20l10 8 8-2M40 42l-16 4" />],
  ]
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 110, top: 470, display: 'flex', flexDirection: 'column', gap: 90 }}>
        {items.map(([word, at, icon], i) => {
          const s = pop(f, at)
          const last = i === 2
          return (
            <div key={word} style={{ display: 'flex', alignItems: 'center', gap: 50, opacity: Math.min(1, s * 1.4), transform: `translateX(${(1 - s) * -80}px)` }}>
              <svg width={150} height={150} viewBox="0 0 64 64" fill="none" stroke={last ? C.accent : C.text} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>
              <div style={{ fontWeight: 900, fontSize: 150, letterSpacing: -4, color: last ? C.accent : C.text }}>{word}</div>
            </div>
          )
        })}
      </div>
    </Bg>
  )
}

// 5. 走行中：崩れたら声、直ったらほめる（アプリの実際の声）
export const CUE_TEXT = '頭が前に出ています。顎を引いてください。'
export const RECOVER_TEXT = 'いい感じです。その姿勢を保ちましょう。'
export function SCoach() {
  const f = useCurrentFrame()
  const k = interpolate(f, [118, 140], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const bad = k < 0.5
  const upper = interpolateColors(k, [0, 1], [C.warn, C.accent])
  const score = Math.round(interpolate(f, [0, 118, 160], [58, 56, 92], clamp))
  const sec = 42 * 60 + 18 + Math.floor(f / FPS)
  const cap = f < 120 ? CUE_TEXT : RECOVER_TEXT
  const capO = f < 120 ? interpolate(f, [14, 22], [0, 1], clamp) : interpolate(f, [130, 138], [0, 1], clamp)
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 230, ...fadeUp(f, 4) }}>
        <div style={H2}>
          走りながら、
          <br />
          <span style={{ color: C.accent }}>その場で直る。</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 50, right: 50, top: 560, height: 560, borderRadius: 56, background: C.stage, border: '6px solid #3A424B', overflow: 'hidden' }}>
        <svg width={968} height={548} style={{ position: 'absolute', inset: 0 }}>
          <g stroke={C.grid}>
            <path d="M0 137H968M0 274H968M0 411H968M242 0V548M484 0V548M726 0V548" />
          </g>
          <Figure frame={f} lean={12 - 5 * k} head={12 * (1 - k)} upper={upper} transform="translate(330,40) scale(1.06)" />
        </svg>
        <div style={{ position: 'absolute', left: 34, top: 28, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: C.accent }} />
          <div style={{ fontFamily: num, fontSize: 32, letterSpacing: 5, color: C.muted }}>COACHING</div>
        </div>
        <div style={{ position: 'absolute', right: 34, top: 18, fontFamily: num, fontWeight: 700, fontSize: 84 }}>
          {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
        </div>
        {bad && (
          <div style={{ position: 'absolute', right: 34, top: 120, padding: '12px 22px', borderRadius: 30, background: C.warn, color: C.bg, fontWeight: 900, fontSize: 30 }}>頭が前に出ています</div>
        )}
        <div style={{ position: 'absolute', left: 34, bottom: 28 }}>
          <div style={{ fontSize: 24, color: '#C9CFD5' }}>姿勢スコア</div>
          <div style={{ fontFamily: num, fontWeight: 700, fontSize: 84, lineHeight: 1, color: bad ? C.warn : C.accent }}>{score}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 1180, display: 'flex', justifyContent: 'center', opacity: capO }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '26px 36px', borderRadius: 60, background: 'rgba(10,12,14,0.9)', border: `3px solid ${bad ? C.warn : C.accent}` }}>
          <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke={bad ? C.warn : C.accent} strokeWidth={2}>
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
          <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1.35, whiteSpace: 'nowrap' }}>{cap}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1420, textAlign: 'center', fontSize: 34, color: C.muted, ...fadeUp(f, 30) }}>
        画面を見なくていい。声だけで、フォームが変わる。
      </div>
    </Bg>
  )
}

// 6. 崩れ始めが後ろにずれていく
export function SHabit() {
  const f = useCurrentFrame()
  const X = (m: number) => 110 + (m / 60) * 860
  const Y = (v: number) => 1300 - v * 4.6
  const curve = (brk: number) =>
    Array.from({ length: 61 }, (_, m) => {
      const v = m < brk ? 90 + Math.sin(m * 0.5) * 0.6 : 90 - (m - brk) * (brk > 45 ? 1.2 : 2.6)
      return `${X(m).toFixed(1)},${Y(Math.max(35, v)).toFixed(1)}`
    }).join(' ')
  const d1 = interpolate(f, [10, 90], [0, 1], clamp)
  const d2 = interpolate(f, [110, 200], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const len = 1400
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 230, ...fadeUp(f, 6) }}>
        <div style={H2}>
          疲れた後半でも
          <br />
          <span style={{ color: C.accent }}>崩れないフォーム</span>が、
          <br />
          体に残る。
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M110 ${Y(0) + 20}H970`} stroke={C.line} strokeWidth={3} />
        <polyline points={curve(38)} fill="none" stroke={C.faint} strokeWidth={7} strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - d1)} />
        <polyline points={curve(52)} fill="none" stroke={C.accent} strokeWidth={9} strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - d2)} />
        <g opacity={d1 > 0.8 ? 1 : 0}>
          <path d={`M${X(38)} 820V1300`} stroke={C.warn} strokeWidth={3} strokeDasharray="10 10" />
          <text x={X(38) - 14} y={800} fill={C.warn} fontSize={40} fontFamily={num} fontWeight={700} textAnchor="end">
            38分
          </text>
        </g>
        <g opacity={d2 > 0.9 ? 1 : 0}>
          <path d={`M${X(52)} 820V1300`} stroke={C.accent} strokeWidth={3} strokeDasharray="10 10" />
          <text x={X(52) + 14} y={800} fill={C.accent} fontSize={40} fontFamily={num} fontWeight={700}>
            52分
          </text>
          <path d={`M${X(39)} 770H${X(51)}`} stroke={C.text} strokeWidth={4} markerEnd="url(#arr)" />
        </g>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0L10 5L0 10z" fill={C.text} />
          </marker>
        </defs>
        <text x={110} y={Y(0) + 80} fill={C.muted} fontSize={36} fontFamily={num}>
          0分
        </text>
        <text x={970} y={Y(0) + 80} fill={C.muted} fontSize={36} fontFamily={num} textAnchor="end">
          60分
        </text>
      </svg>
      <div style={{ position: 'absolute', left: 110, top: 1440, display: 'flex', gap: 50, fontSize: 32, color: C.muted }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 40, height: 7, background: C.faint }} />
          これまで
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 40, height: 9, background: C.accent }} />
          コーチと走ると
        </span>
        <span style={{ fontSize: 26, color: C.faint }}>※イメージ</span>
      </div>
    </Bg>
  )
}

// 7. 走り姿を骨格で。次に直すのは1つだけ
export function SInsight() {
  const f = useCurrentFrame()
  const g = interpolate(f, [10, 60], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 230, ...fadeUp(f, 4) }}>
        <div style={H2}>
          走り姿を、骨格で。
          <br />
          直すのは、<span style={{ color: C.accent }}>ひとつだけ。</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 520 }}>
        <div style={{ display: 'flex', height: 30, borderRadius: 15, overflow: 'hidden', gap: 4 }}>
          <div style={{ width: `${58 * g}%`, background: C.accent }} />
          <div style={{ width: `${27 * g}%`, background: C.muted }} />
          <div style={{ width: `${15 * g}%`, background: C.warn }} />
        </div>
        <div style={{ display: 'flex', gap: 40, marginTop: 20, fontSize: 34, color: C.muted, opacity: g }}>
          <span>
            良い姿勢 <b style={{ fontFamily: num, fontSize: 48, color: C.accent }}>58%</b>
          </span>
          <span>
            ふつう <b style={{ fontFamily: num, fontSize: 48 }}>27%</b>
          </span>
          <span>
            悪い <b style={{ fontFamily: num, fontSize: 48, color: C.warn }}>15%</b>
          </span>
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Figure frame={f} lean={13} head={2} upper="#6B7480" ghost={f > 70 ? { lean: 6, head: 1 } : undefined} transform="translate(200,660) scale(1.65)" />
      </svg>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 1450, padding: '28px 34px', borderRadius: 28, background: '#14181C', border: `2px solid ${C.line}`, ...fadeUp(f, 90) }}>
        <div style={{ fontSize: 28, color: C.accent, fontWeight: 700 }}>次の一歩（自分のベスト＋ひとつ）</div>
        <div style={{ fontSize: 50, fontWeight: 900, marginTop: 8 }}>骨盤を立てて、上体を起こす</div>
      </div>
    </Bg>
  )
}

// 8. 締め
export function SEnd() {
  const f = useCurrentFrame()
  const a = pop(f, 4)
  const b = pop(f, 22)
  const out = interpolate(f, [86, 100], [1, 0], clamp)
  const logo = interpolate(f, [96, 116], [0, 1], clamp)
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 90, top: 640, opacity: out }}>
        <div style={{ fontWeight: 900, fontSize: 190, letterSpacing: -6, lineHeight: 1.15 }}>
          <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>後半で、</div>
          <div style={{ opacity: b, transform: `translateY(${(1 - b) * 40}px)`, color: C.accent }}>落ちない。</div>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 46, opacity: logo }}>
        <Mark size={190} />
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 124, letterSpacing: 14 }}>RUN FORM COACH</div>
        <div style={{ fontSize: 52, fontWeight: 700 }}>置いて、立って、走るだけ。</div>
        <div style={{ fontFamily: num, fontSize: 40, color: C.muted, marginTop: 30 }}>run-form-coach.vercel.app</div>
      </div>
    </Bg>
  )
}
