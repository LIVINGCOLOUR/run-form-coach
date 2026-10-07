import React from 'react'
import type { ReactNode } from 'react'
import { Easing, interpolate, interpolateColors, spring, useCurrentFrame } from 'remotion'
import { Bg } from './Scenes'
import { Figure } from './Figure'
import type { Item } from './timeline'
import { C, FPS, num } from './theme'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const fadeUp = (f: number, at: number, dur = 14) => ({
  opacity: interpolate(f, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [at, at + dur], [40, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
})
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 14, stiffness: 170 } })

// 9つのポイント：骨格のまわりに 01〜09 を、ナレーションに合わせて出す
// 骨格は translate(180,560) scale(2)。部位の位置はその座標で置く。吹き出しは左右の列と下に並べる
const P = (x: number, y: number) => ({ x: 180 + x * 2, y: 560 + y * 2 })
const R = 740 // 右の列の左端
const LW = 300 // 吹き出しの幅
const POINTS: { label: string; at: [number, number]; box: [number, number]; side: 'r' | 'l' | 'b' }[] = [
  { label: '頭の位置', at: [190, 82], box: [R, 650], side: 'r' },
  { label: '上体の傾き', at: [182, 200], box: [R, 850], side: 'r' },
  { label: '腕振り', at: [222, 200], box: [R, 1030], side: 'r' },
  { label: '着地の位置', at: [204, 424], box: [R, 1420], side: 'r' },
  { label: '接地時間', at: [180, 434], box: [390, 1580], side: 'b' },
  { label: 'ピッチ', at: [120, 390], box: [40, 1400], side: 'l' },
  { label: '腰の高さ', at: [170, 262], box: [40, 1040], side: 'l' },
  { label: '上下動', at: [160, 238], box: [40, 860], side: 'l' },
  { label: '左右の差', at: [150, 330], box: [40, 1220], side: 'l' },
]
const end = (p: (typeof POINTS)[number]) =>
  p.side === 'r' ? { x: p.box[0], y: p.box[1] + 34 } : p.side === 'l' ? { x: p.box[0] + LW, y: p.box[1] + 34 } : { x: p.box[0] + LW / 2, y: p.box[1] }

export function SPoints({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  const [n4, n5, n6, n7] = items
  // 3つずつ、そのナレーションの長さを3等分した時刻に出す
  const times = [n5, n6, n7].flatMap((it) => [0, 1, 2].map((k) => it.start + Math.round((it.len * k) / 3)))
  const nine = pop(f, n4.start + 10)
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 60, top: 200, display: 'flex', alignItems: 'flex-end', gap: 26, ...fadeUp(f, n4.start) }}>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 220, lineHeight: 0.8, color: C.accent, transform: `scale(${0.7 + 0.3 * nine})`, transformOrigin: 'left bottom' }}>9</div>
        <div style={{ fontWeight: 900, fontSize: 70, lineHeight: 1.25, paddingBottom: 6 }}>
          つのポイントを、
          <br />
          見続ける。
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Figure frame={f} lean={8} head={1} upper={C.limb} transform="translate(180,560) scale(2)" />
        {POINTS.map((p, i) => {
          const s = pop(f, times[i])
          if (s <= 0.01) return null
          const a = P(...p.at)
          const e = end(p)
          return (
            <g key={p.label} opacity={Math.min(1, s)}>
              <path d={`M${a.x} ${a.y}L${e.x} ${e.y}`} stroke={C.accent} strokeWidth={2.5} />
              <circle cx={a.x} cy={a.y} r={12 * s} fill={C.accent} />
            </g>
          )
        })}
      </svg>
      {POINTS.map((p, i) => {
        const s = pop(f, times[i])
        return (
          <div
            key={p.label}
            style={{
              position: 'absolute',
              left: p.box[0],
              top: p.box[1],
              width: LW,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 16px',
              borderRadius: 18,
              background: 'rgba(20,24,28,0.92)',
              border: `2px solid ${C.line}`,
              opacity: Math.min(1, s * 1.3),
              transform: `scale(${0.8 + 0.2 * Math.min(1, s)})`,
            }}
          >
            <span style={{ fontFamily: num, fontWeight: 700, fontSize: 38, color: C.accent }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ fontSize: 36, fontWeight: 900 }}>{p.label}</span>
          </div>
        )
      })}
    </Bg>
  )
}

// 具体例：走行中の画面で、崩れた所をオレンジにし、アプリの声かけを出す
type Kind = 'over' | 'hip' | 'head' | 'lr' | 'good'
const EX: Record<Kind, { title: ReactNode; chip: string }> = {
  over: { title: <>足が前に出すぎる着地は、<br /><span style={{ color: C.warn }}>ブレーキ</span>になる。</>, chip: '着地が前すぎます' },
  hip: { title: <>腰が落ちて、<br /><span style={{ color: C.warn }}>接地が長くなる。</span></>, chip: '腰が落ちています' },
  head: { title: <>頭が落ちると、<br /><span style={{ color: C.warn }}>上体ごと崩れる。</span></>, chip: '頭が前に出ています' },
  lr: { title: <>左右の差も、<br /><span style={{ color: C.accent }}>見逃さない。</span></>, chip: '右の接地が長い' },
  good: { title: <>直れば、<br /><span style={{ color: C.accent }}>すぐに伝える。</span></>, chip: '' },
}

export function SExample({ kind, items }: { kind: Kind; items: Item[] }) {
  const f = useCurrentFrame()
  const [narr, app] = items
  const ex = EX[kind]
  // 「直れば」の場面は、声かけの前に崩れ → 声のあとに直る
  const fix = kind === 'good' ? interpolate(f, [app.start - 30, app.start - 6], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) }) : 0
  const upperBad = kind === 'head' || kind === 'good'
  const upper = upperBad ? interpolateColors(fix, [0, 1], [C.warn, C.accent]) : C.limb
  const legColor = kind === 'over' ? C.warn : C.limb
  const sec = 44 * 60 + 5 + Math.floor((f + (kind === 'hip' ? 300 : kind === 'head' ? 600 : kind === 'lr' ? 900 : kind === 'good' ? 1200 : 0)) / FPS)
  const capO = interpolate(f, [app.start, app.start + 8], [0, 1], clamp)
  const ok = kind === 'good' && fix > 0.5
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 80, top: 220, ...fadeUp(f, Math.max(0, narr.start - 4)) }}>
        <div style={{ fontWeight: 900, fontSize: 74, lineHeight: 1.3, letterSpacing: -1 }}>{ex.title}</div>
      </div>
      <div style={{ position: 'absolute', left: 50, right: 50, top: 560, height: 560, borderRadius: 56, background: C.stage, border: '6px solid #3A424B', overflow: 'hidden' }}>
        <svg width={968} height={548} style={{ position: 'absolute', inset: 0 }}>
          <g stroke={C.grid}>
            <path d="M0 137H968M0 274H968M0 411H968M242 0V548M484 0V548M726 0V548" />
          </g>
          <Figure
            frame={f}
            lean={kind === 'head' || kind === 'good' ? 12 - 5 * fix : 9}
            head={kind === 'head' ? 12 : kind === 'good' ? 12 * (1 - fix) : 1}
            drop={kind === 'hip' ? 16 : 0}
            over={kind === 'over' ? 1 - fix : 0}
            upper={upper}
            legColor={legColor}
            transform="translate(330,40) scale(1.06)"
          />
          {kind === 'over' && (
            <g>
              <path d="M510 100V520" stroke={C.warn} strokeWidth={3} strokeDasharray="10 10" />
              <text x={520} y={130} fill={C.warn} fontSize={28} fontWeight={700}>
                腰の真下
              </text>
            </g>
          )}
          {kind === 'hip' && (
            <g>
              <path d="M300 300H720" stroke={C.muted} strokeWidth={3} strokeDasharray="10 10" />
              <path d="M300 340H720" stroke={C.warn} strokeWidth={4} />
              <path d="M280 296V326" stroke={C.warn} strokeWidth={4} />
              <path d="M268 324L292 324L280 342Z" fill={C.warn} />
              <text x={740} y={312} fill={C.muted} fontSize={24}>いつもの高さ</text>
              <text x={740} y={350} fill={C.warn} fontSize={24} fontWeight={700}>いまの高さ</text>
            </g>
          )}
        </svg>
        <div style={{ position: 'absolute', left: 34, top: 28, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: C.accent }} />
          <div style={{ fontFamily: num, fontSize: 32, letterSpacing: 5, color: C.muted }}>COACHING</div>
        </div>
        <div style={{ position: 'absolute', right: 34, top: 18, fontFamily: num, fontWeight: 700, fontSize: 84 }}>
          {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
        </div>
        {ex.chip && !ok && (
          <div style={{ position: 'absolute', right: 34, top: 120, padding: '12px 22px', borderRadius: 30, background: C.warn, color: C.bg, fontWeight: 900, fontSize: 30 }}>{ex.chip}</div>
        )}
        <div style={{ position: 'absolute', left: 34, bottom: 28, display: 'flex', gap: 40 }}>
          {kind === 'hip' && <Metric label="接地時間" value="0.28s" warn />}
          {kind === 'over' && <Metric label="着地の位置" value="腰より前" warn />}
          {kind === 'lr' && (
            <>
              <Metric label="接地時間 左" value="0.24s" />
              <Metric label="接地時間 右" value="0.29s" warn />
            </>
          )}
          {(kind === 'head' || kind === 'good') && <Metric label="姿勢スコア" value={String(Math.round(interpolate(fix, [0, 1], [56, 92])))} warn={!ok} good={ok} />}
        </div>
      </div>
      {kind === 'lr' && (
        <div style={{ position: 'absolute', left: 80, right: 80, top: 1160, display: 'flex', flexDirection: 'column', gap: 18, ...fadeUp(f, narr.start + 10) }}>
          <Bar label="左" v={0.24} />
          <Bar label="右" v={0.29} warn />
        </div>
      )}
      <div style={{ position: 'absolute', left: 50, right: 50, top: kind === 'lr' ? 1370 : 1180, display: 'flex', justifyContent: 'center', opacity: capO }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px 32px', borderRadius: 60, background: 'rgba(10,12,14,0.9)', border: `3px solid ${ok ? C.accent : C.warn}` }}>
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={ok ? C.accent : C.warn} strokeWidth={2}>
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.4 }}>{app.text}</div>
        </div>
      </div>
    </Bg>
  )
}

function Metric({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 24, color: '#C9CFD5' }}>{label}</div>
      <div style={{ fontFamily: num, fontWeight: 700, fontSize: 72, lineHeight: 1, color: good ? C.accent : warn ? C.warn : C.text }}>{value}</div>
    </div>
  )
}

function Bar({ label, v, warn }: { label: string; v: number; warn?: boolean }) {
  const f = useCurrentFrame()
  const g = interpolate(f, [20, 50], [0, 1], clamp)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ fontSize: 36, fontWeight: 900, width: 50 }}>{label}</div>
      <div style={{ flexGrow: 1, height: 28, borderRadius: 14, background: C.line }}>
        <div style={{ width: `${(v / 0.32) * 100 * g}%`, height: 28, borderRadius: 14, background: warn ? C.warn : C.muted }} />
      </div>
      <div style={{ fontFamily: num, fontWeight: 700, fontSize: 44, width: 110, color: warn ? C.warn : C.text }}>{v.toFixed(2)}s</div>
    </div>
  )
}
