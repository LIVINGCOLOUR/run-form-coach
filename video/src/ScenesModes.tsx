import React from 'react'
import type { ReactNode } from 'react'
import { Easing, interpolate, interpolateColors, spring, useCurrentFrame } from 'remotion'
import type { Frame } from '../../src/core/types'
type XY = { x: number; y: number }
import { L } from '../../src/modes/camera/landmarks'
import { Bg } from './Scenes'
import { Figure } from './Figure'
import { buzzAt, CLICK_SEC, type MItem } from './timeline-modes'
import { C, FPS, num } from './theme'

// 2本目の紹介動画（使い方は3つ）の場面。絵・色・文字の大きさは1本目（Scenes*.tsx）に合わせる
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const fadeUp = (f: number, at: number, dur = 14) => ({
  opacity: interpolate(f, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [at, at + dur], [40, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
})
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 14, stiffness: 170 } })
const H2 = { fontWeight: 900, fontSize: 76, lineHeight: 1.3, letterSpacing: -1 } as const
const mid = (a: XY, b: XY, k = 0.5) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })

// ---- 小さな部品 ----

// 使い方のアイコン（64×64 の線画）
function Icon({ kind, color = C.text, size = 120 }: { kind: 'phone' | 'camera' | 'sensor'; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      {kind === 'phone' && (
        <>
          {/* 腰のベルトとスマホ */}
          <path d="M6 36h52" strokeWidth={5} />
          <rect x={23} y={20} width={18} height={30} rx={4} fill={C.bg} />
          <path d="M29 45h6" />
        </>
      )}
      {kind === 'camera' && (
        <>
          {/* トレッドミル */}
          <path d="M6 50h40l8-8" />
          <path d="M46 50V22l8-6" />
          <circle cx={12} cy={50} r={3} />
          <circle cx={40} cy={50} r={3} />
          {/* 横に置いたスマホ */}
          <rect x={4} y={14} width={14} height={24} rx={3} />
        </>
      )}
      {kind === 'sensor' && (
        <>
          <rect x={22} y={22} width={20} height={20} rx={6} />
          <circle cx={32} cy={32} r={3} fill={color} />
          <path d="M14 22a14 14 0 0 0 0 20M50 22a14 14 0 0 1 0 20" />
          <path d="M8 16a22 22 0 0 0 0 32M56 16a22 22 0 0 1 0 32" opacity={0.6} />
        </>
      )}
    </svg>
  )
}

// 場面の見出し：番号と言葉
function Head({ n, title, at }: { n: string; title: ReactNode; at: number }) {
  const f = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', left: 80, right: 60, top: 190, ...fadeUp(f, at) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 96, lineHeight: 1, color: C.accent }}>{n}</div>
      </div>
      <div style={{ ...H2, fontSize: 70, marginTop: 14 }}>{title}</div>
    </div>
  )
}

// アプリの声かけの吹き出し（1本目と同じ形）
function Voice({ text, at, top, warn = true, out }: { text: string; at: number; top: number; warn?: boolean; out?: number }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [at, at + 8], [0, 1], clamp) * (out === undefined ? 1 : interpolate(f, [out, out + 8], [1, 0], clamp))
  const col = warn ? C.warn : C.accent
  return (
    <div style={{ position: 'absolute', left: 50, right: 50, top, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px 32px', borderRadius: 60, background: 'rgba(10,12,14,0.9)', border: `3px solid ${col}` }}>
        <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={2} style={{ flexShrink: 0 }}>
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        </svg>
        <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.4 }}>{breakAt(text, 22)}</div>
      </div>
    </div>
  )
}

// 長い文は、区切り（「。」「、」）の後ろで、なるべく同じ長さの行に分ける（1字だけ次の行に落ちるのを防ぐ）
export function breakAt(text: string, max: number): ReactNode {
  if (text.length <= max) return text
  const n = Math.ceil(text.length / max)
  const cuts = [...text.matchAll(/[。、]/g)].map((m) => m.index! + 1).filter((i) => i < text.length)
  const at: number[] = []
  for (let k = 1; k < n; k++) {
    const goal = (text.length * k) / n
    const c = cuts.filter((i) => i > (at[at.length - 1] ?? 0)).reduce<number | null>((a, b) => (a === null || Math.abs(b - goal) < Math.abs(a - goal) ? b : a), null)
    if (c !== null) at.push(c)
  }
  const bounds = [0, ...at, text.length]
  return (
    <>
      {bounds.slice(1).map((e, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {text.slice(bounds[i], e)}
        </React.Fragment>
      ))}
    </>
  )
}

// 振動の印（ふるえる四角）
function Vibe({ color, size }: { color: string; size: number }) {
  const f = useCurrentFrame()
  const dx = Math.sin(f * 2.4) * 1.2
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <rect x={8 + dx} y={5} width={8} height={14} rx={2} />
      <path d="M4 8v8M20 8v8M1.5 10v4M22.5 10v4" />
    </svg>
  )
}

// 外を走っている感じ：地面の線と、後ろへ流れていく道の印と木
function Road({ f, y, x0 = 0, x1 = 1080 }: { f: number; y: number; x0?: number; x1?: number }) {
  const speed = 7
  const dash = (k: number) => x1 - ((f * speed + k * 220) % (x1 - x0 + 220))
  const tree = (k: number) => x1 + 120 - ((f * speed * 0.45 + k * 430) % (x1 - x0 + 360))
  return (
    <g>
      {[0, 1, 2].map((k) => {
        const x = tree(k)
        return (
          <g key={`t${k}`} opacity={0.5}>
            <path d={`M${x} ${y - 10}V${y - 90}`} stroke={C.line} strokeWidth={8} />
            <path d={`M${x - 46} ${y - 70}L${x} ${y - 210}L${x + 46} ${y - 70}Z`} fill={C.grid} stroke={C.line} strokeWidth={4} />
          </g>
        )
      })}
      <path d={`M${x0} ${y}H${x1}`} stroke={C.line} strokeWidth={4} />
      {Array.from({ length: 6 }, (_, k) => {
        const x = dash(k)
        return <path key={k} d={`M${x} ${y + 72}h90`} stroke={C.line} strokeWidth={8} strokeLinecap="round" />
      })}
    </g>
  )
}

// ---- 場面 ----

// 3. ロゴと、使い方は3つ
const MODES: { kind: 'phone' | 'camera' | 'sensor'; title: string; sub: string }[] = [
  { kind: 'phone', title: 'スマホ1台', sub: '腰に付けて、外を走る' },
  { kind: 'camera', title: 'トレッドミル', sub: '横にスマホを置いて、骨格で見る' },
  { kind: 'sensor', title: 'センサー', sub: '体に付けて、振動で知らせる' },
]
export function SIntro({ items }: { items: MItem[] }) {
  const f = useCurrentFrame()
  const [m5] = items
  const s = pop(f, 0)
  const three = m5.start + Math.round(m5.len * 0.45)
  return (
    <Bg>
      <div style={{ position: 'absolute', top: 200, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <svg width={120} height={120} viewBox="0 0 28 28" fill="none" stroke={C.accent} strokeWidth={2} style={{ transform: `scale(${0.6 + 0.4 * s})` }}>
          <circle cx={14} cy={14} r={12} />
          <circle cx={14} cy={14} r={4.5} />
          <path d="M14 2v4M14 22v4" />
        </svg>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 108, letterSpacing: 12, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>RUN FORM COACH</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: C.muted, ...fadeUp(f, 12) }}>
          走っている間ずっと、フォームを<span style={{ color: C.accent }}>見守る</span>コーチ。
        </div>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 650, ...fadeUp(f, three - 6) }}>
        <div style={{ ...H2, fontSize: 96 }}>
          使い方は、<span style={{ fontFamily: num, fontSize: 130, color: C.accent }}>3</span>つ。
        </div>
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 860, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {MODES.map((m, i) => {
          const p = pop(f, three + 6 + i * 7)
          return (
            <div
              key={m.kind}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 34,
                height: 210,
                padding: '0 36px',
                borderRadius: 36,
                background: '#14181C',
                border: `2px solid ${C.line}`,
                opacity: Math.min(1, p * 1.3),
                transform: `translateX(${(1 - Math.min(1, p)) * -80}px)`,
              }}
            >
              <div style={{ fontFamily: num, fontWeight: 700, fontSize: 72, color: C.accent, width: 80 }}>{String(i + 1).padStart(2, '0')}</div>
              <Icon kind={m.kind} size={110} />
              <div>
                <div style={{ fontSize: 54, fontWeight: 900 }}>{m.title}</div>
                <div style={{ fontSize: 32, color: C.muted, marginTop: 6 }}>{m.sub}</div>
              </div>
            </div>
          )
        })}
      </div>
    </Bg>
  )
}

// 4. スマホ1台を腰に、外を走る。走っている間ずっと、ピッチ・上下動・接地時間を見て、崩れたらその場で声
export function SPhone({ items }: { items: MItem[] }) {
  const f = useCurrentFrame()
  const [m14, m15, cue] = items
  const tx = 200
  const ty = 470
  const sc = 1.5
  // m15 の「足の回転」「上下動」「接地の長さ」「崩れたら」の、文の中のおよその位置
  const at = (r: number) => m15.start + Math.round(m15.len * r)
  // ピッチ：「崩れたら」で落ち、声とメトロノームのあとに戻る
  const clickAt = Array.from({ length: 4 }, (_, k) => cue.start + cue.len + 6 + Math.round(k * CLICK_SEC * FPS))
  const drop = interpolate(f, [at(0.6), at(0.6) + 36], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const back = interpolate(f, [clickAt[1], clickAt[3] + 6], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const bad = drop - back
  const phonePulse = 0.5 + 0.5 * Math.sin(f * 0.25)
  // 走っている間の値（少しゆらす）
  const wob = (k: number) => Math.sin(f * 0.21 + k * 2.1) * 0.5 + Math.sin(f * 0.07 + k) * 0.5
  const stats: { label: string; value: string; unit: string; at: number; big?: boolean; warn?: boolean }[] = [
    { label: 'ピッチ', value: String(Math.round(176 - 12 * bad)), unit: '歩/分', at: at(0.2), big: true, warn: bad > 0.5 },
    { label: '上下動', value: (8.3 + 0.1 * wob(1)).toFixed(1), unit: 'cm', at: at(0.33) },
    { label: '接地時間', value: (0.24 + 0.004 * wob(2)).toFixed(2), unit: '秒', at: at(0.44) },
  ]
  return (
    <Bg>
      <Head n="01" at={m14.start - 4} title={<>スマホ1台を腰に、<br /><span style={{ color: C.accent }}>外を走る。</span></>} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Road f={f} y={ty + 434 * sc} />
        <Figure
          frame={f}
          lean={8}
          head={1}
          upper={C.limb}
          transform={`translate(${tx},${ty}) scale(${sc})`}
          overlay={(fr) => <WaistPhone fr={fr} glow={phonePulse} pop={pop(f, m14.start + Math.round(m14.len * 0.4))} />}
        />
      </svg>
      {/* 見続けている3つ */}
      <div style={{ position: 'absolute', right: 60, top: 560, width: 300, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {stats.map((s) => {
          const p = pop(f, s.at)
          const col = s.warn ? C.warn : C.text
          return (
            <div
              key={s.label}
              style={{
                padding: '16px 24px',
                borderRadius: 26,
                background: '#14181C',
                border: `3px solid ${s.warn ? C.warn : C.line}`,
                opacity: Math.min(1, p * 1.3),
                transform: `translateX(${(1 - Math.min(1, p)) * 60}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: s.warn ? C.warn : C.accent, opacity: 0.45 + 0.55 * phonePulse }} />
                <div style={{ fontSize: 30, color: C.muted, fontWeight: 700 }}>{s.label}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontFamily: num, fontWeight: 700, fontSize: s.big ? 116 : 76, lineHeight: 1.05, color: col }}>{s.value}</div>
                <div style={{ fontSize: 26, color: C.muted }}>{s.unit}</div>
              </div>
            </div>
          )
        })}
      </div>
      <Voice text={cue.text} at={cue.start} top={1220} />
      {/* メトロノーム */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1440, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, opacity: interpolate(f, [clickAt[0] - 8, clickAt[0]], [0, 1], clamp) }}>
        <div style={{ fontSize: 32, color: C.muted, fontWeight: 700 }}>メトロノーム</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {clickAt.map((a, k) => {
            const hit = interpolate(f, [a, a + 2, a + 9], [0, 1, 0.35], clamp)
            return <div key={k} style={{ width: 34, height: 34, borderRadius: 17, background: hit > 0.01 ? C.accent : C.line, opacity: hit > 0.01 ? 0.4 + 0.6 * hit : 1, transform: `scale(${1 + 0.35 * hit})` }} />
          })}
        </div>
      </div>
    </Bg>
  )
}

// 腰のベルトとスマホ（骨格の座標で描く）
function WaistPhone({ fr, glow, pop: p }: { fr: Frame; glow: number; pop: number }) {
  const hip = fr[L.leftHip]
  const sh = fr[L.leftShoulder]
  const ang = (Math.atan2(sh.x - hip.x, hip.y - sh.y) * 180) / Math.PI // 体幹の傾き（右回りが正）
  const s = Math.min(1, p)
  return (
    <g transform={`translate(${hip.x} ${hip.y - 6}) rotate(${ang})`} opacity={s}>
      <rect x={-20} y={-6} width={40} height={11} rx={4} fill="#1C2126" stroke={C.muted} strokeWidth={2} />
      <rect x={-9} y={-20} width={18} height={30} rx={4} fill={C.bg} stroke={C.accent} strokeWidth={3} transform={`scale(${0.6 + 0.4 * p})`} />
      <circle r={22 + 6 * glow} fill="none" stroke={C.accent} strokeWidth={1.5} opacity={0.25 + 0.25 * glow} />
    </g>
  )
}

// 5. トレッドミルの横にスマホ。骨格でフォームを見る
export function SCamera({ items }: { items: MItem[] }) {
  const f = useCurrentFrame()
  const [m9] = items
  const scan = (f * 9) % 548
  const sec = 21 * 60 + 40 + Math.floor(f / FPS)
  const screen = pop(f, m9.start + Math.round(m9.len * 0.35))
  const bone = m9.start + Math.round(m9.len * 0.7)
  return (
    <Bg>
      <Head n="02" at={m9.start - 4} title={<>トレッドミルの横に、<br /><span style={{ color: C.accent }}>スマホを置く。</span></>} />
      {/* 横向きのスマホの画面 */}
      <div style={{ position: 'absolute', left: 50, right: 50, top: 540, height: 560, borderRadius: 56, background: C.stage, border: '6px solid #3A424B', overflow: 'hidden', opacity: Math.min(1, screen * 1.3), transform: `scale(${0.92 + 0.08 * Math.min(1, screen)})` }}>
        <svg width={968} height={548} style={{ position: 'absolute', inset: 0 }}>
          <g stroke={C.grid}>
            <path d="M0 137H968M0 274H968M0 411H968M242 0V548M484 0V548M726 0V548" />
          </g>
          <Treadmill f={f} transform="translate(330,40) scale(1.06)" />
          <Figure frame={f} lean={8} head={1} upper={C.limb} transform="translate(330,40) scale(1.06)" overlay={(fr) => <g opacity={interpolate(f, [bone, bone + 10], [0, 1], clamp)}><Joints fr={fr} /></g>} />
          <rect x={0} y={scan} width={968} height={6} fill={C.accent} opacity={0.3} />
        </svg>
        <div style={{ position: 'absolute', right: 34, top: 18, fontFamily: num, fontWeight: 700, fontSize: 84 }}>
          {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
        </div>
      </div>
      {/* 置いたスマホの脚 */}
      <svg width={1080} height={120} style={{ position: 'absolute', left: 0, top: 1100, opacity: Math.min(1, screen) }}>
        <path d="M540 4V60M440 60H640" stroke="#3A424B" strokeWidth={10} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1260, textAlign: 'center', ...fadeUp(f, bone) }}>
        <div style={{ fontSize: 52, fontWeight: 900 }}>
          <span style={{ color: C.accent }}>骨格</span>で、フォームを見る。
        </div>
        <div style={{ fontSize: 34, color: C.muted, marginTop: 18 }}>映像は、保存も送信もしません。</div>
      </div>
    </Bg>
  )
}

// トレッドミル（骨格と同じ座標。地面の線が y=434）
function Treadmill({ f, transform }: { f: number; transform: string }) {
  const off = (f * 6) % 40
  return (
    <g transform={transform}>
      <rect x={10} y={436} width={330} height={22} rx={11} fill="#1A1F24" stroke="#3A424B" strokeWidth={3} />
      <g stroke="#2E353D" strokeWidth={3}>
        {Array.from({ length: 9 }, (_, i) => {
          const x = 330 - ((i * 40 + off) % 320)
          return <path key={i} d={`M${x} 440v14`} />
        })}
      </g>
      <path d="M335 446L362 250" stroke="#3A424B" strokeWidth={8} strokeLinecap="round" />
      <path d="M362 250L300 238" stroke="#3A424B" strokeWidth={7} strokeLinecap="round" />
      <rect x={344} y={226} width={34} height={22} rx={5} fill="#1A1F24" stroke="#3A424B" strokeWidth={3} />
    </g>
  )
}

// 骨格の点（カメラが見ている所）
function Joints({ fr }: { fr: Frame }) {
  const ids = [L.leftEar, L.leftShoulder, L.leftElbow, L.leftWrist, L.leftHip, L.leftKnee, L.leftAnkle, L.leftFoot, L.rightKnee, L.rightAnkle, L.rightElbow, L.rightWrist]
  return (
    <g>
      {ids.map((i) => (
        <circle key={i} cx={fr[i].x} cy={fr[i].y} r={fr[i].v < 1 ? 4 : 5.5} fill={C.accent} opacity={fr[i].v < 1 ? 0.5 : 0.95} />
      ))}
    </g>
  )
}

// 8. センサーを6か所（額・両手首・胸・両足首）に付けて、外を走る。猫背になったら胸のセンサーが振動で知らせる
type Spot = 'head' | 'chest' | 'wrist' | 'ankle'
export function SSensor({ items }: { items: MItem[] }) {
  const f = useCurrentFrame()
  const [m20, m21] = items
  const tx = 150
  const ty = 470
  const sc = 1.5
  // m20 の「頭、両腕、胸、両足首」の、文の中のおよその位置
  const at = (r: number) => m20.start + Math.round(m20.len * r)
  const show: Record<Spot, number> = { head: pop(f, at(0.33)), wrist: pop(f, at(0.41)), chest: pop(f, at(0.49)), ankle: pop(f, at(0.56)) }
  // 猫背になり（m21）、胸のセンサーが震えたあとに戻る
  const buzz = buzzAt(m21)
  const hunch = interpolate(f, [m21.start + 4, m21.start + 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const fix = interpolate(f, [buzz + 16, buzz + 38], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })
  const bad = hunch * (1 - fix)
  const shaking = f >= buzz && f < buzz + 15 ? 1 : 0
  const upper = fix > 0 ? interpolateColors(fix, [0, 1], [C.warn, C.accent]) : interpolateColors(hunch, [0, 1], [C.limb, C.warn])
  // 札の位置（画面の座標 → 骨格の座標）
  const toFig = (x: number, y: number) => ({ x: (x - tx) / sc, y: (y - ty) / sc })
  const labels: { spot: Spot; text: string; x: number; y: number }[] = [
    { spot: 'head', text: '頭（額）', x: 740, y: 560 },
    { spot: 'chest', text: '胸', x: 740, y: 700 },
    { spot: 'wrist', text: '両腕（手首）', x: 740, y: 840 },
    { spot: 'ankle', text: '両足首', x: 740, y: 1050 },
  ]
  const tell = interpolate(f, [buzz - 2, buzz + 6], [0, 1], clamp)
  return (
    <Bg>
      <Head n="03" at={m20.start - 4} title={<>センサーを付けて、<br /><span style={{ color: C.accent }}>外を走る。</span></>} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Road f={f} y={ty + 434 * sc} />
        <Figure
          frame={f}
          lean={8 + 9 * bad}
          head={9 * bad}
          upper={upper}
          transform={`translate(${tx},${ty}) scale(${sc})`}
          overlay={(fr) => <Sensors fr={fr} f={f} show={show} warn={bad > 0.5} shaking={shaking} labels={labels.map((l) => ({ ...l, ...toFig(l.x, l.y) }))} />}
        />
      </svg>
      {labels.map((l) => {
        const s = Math.min(1, show[l.spot])
        const warn = l.spot === 'chest' && bad > 0.5
        return (
          <div key={l.spot} style={{ position: 'absolute', left: l.x, top: l.y - 34, opacity: s, transform: `translateX(${(1 - s) * 40}px)` }}>
            <div style={{ padding: '10px 22px', borderRadius: 26, background: warn ? C.warn : 'rgba(20,24,28,0.92)', color: warn ? C.bg : C.text, border: `2px solid ${warn ? C.warn : C.accent}`, fontWeight: 900, fontSize: 36 }}>{l.text}</div>
          </div>
        )
      })}
      {/* センサーで見るもの */}
      <div style={{ position: 'absolute', left: 60, right: 60, top: 1220, display: 'flex', gap: 18, justifyContent: 'center', ...fadeUp(f, m21.start) }}>
        {['猫背', '左右の差'].map((t, i) => {
          const warn = i === 0 && bad > 0.5
          return (
            <div key={t} style={{ padding: '12px 28px', borderRadius: 20, background: warn ? C.warn : 'rgba(20,24,28,0.92)', color: warn ? C.bg : C.text, border: `2px solid ${warn ? C.warn : C.line}`, fontSize: 38, fontWeight: 900 }}>
              {t}
            </div>
          )
        })}
      </div>
      {/* 振動で知らせる（声はなし） */}
      <div style={{ position: 'absolute', left: 50, right: 50, top: 1360, display: 'flex', justifyContent: 'center', opacity: tell }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px 36px', borderRadius: 60, background: 'rgba(10,12,14,0.9)', border: `3px solid ${fix > 0.5 ? C.accent : C.warn}` }}>
          <Vibe color={fix > 0.5 ? C.accent : C.warn} size={56} />
          <div style={{ fontSize: 38, fontWeight: 900 }}>{fix > 0.5 ? '胸が開きました' : '胸のセンサーが、ブルッ。'}</div>
        </div>
      </div>
    </Bg>
  )
}

// センサーの印。胸は振動しているとき震えて、波が出る
function Sensors({
  fr,
  f,
  show,
  warn,
  shaking,
  labels,
}: {
  fr: Frame
  f: number
  show: Record<Spot, number>
  warn: boolean
  shaking: number
  labels: { spot: Spot; x: number; y: number }[]
}) {
  const ear = fr[L.leftEar]
  const nose = fr[L.nose]
  const head = { x: (ear.x + nose.x) / 2, y: (ear.y + nose.y) / 2 - 8 }
  const brow = { x: head.x + 21, y: head.y - 12 } // 額（ヘッドバンドの前）
  const sh = fr[L.leftShoulder]
  const hip = fr[L.leftHip]
  const chest = mid(sh, hip, 0.28)
  const ang = (Math.atan2(sh.x - hip.x, hip.y - sh.y) * 180) / Math.PI
  const jit = shaking ? Math.sin(f * 2.6) * 2.4 : 0
  const node = (p: XY, key: string, s: number, color = C.accent, far = false, shake = 0) => (
    <g key={key} transform={`translate(${p.x + shake} ${p.y})`} opacity={Math.min(1, s) * (far ? 0.55 : 1)}>
      <rect x={-8} y={-8} width={16} height={16} rx={5} fill={C.bg} stroke={color} strokeWidth={3} transform={`scale(${0.5 + 0.5 * Math.min(1.2, s)})`} />
      <circle r={2.6} fill={color} />
    </g>
  )
  const waves = (p: XY) =>
    shaking ? (
      <g>
        {[0, 1].map((k) => {
          const r = 14 + (((f * 1.4 + k * 9) % 18) | 0)
          return <circle key={k} cx={p.x} cy={p.y} r={r} fill="none" stroke={C.warn} strokeWidth={2.2} opacity={1 - (r - 14) / 18} />
        })}
      </g>
    ) : null
  const anchor: Record<Spot, XY> = { head: brow, chest, wrist: fr[L.leftWrist], ankle: fr[L.leftAnkle] }
  return (
    <g>
      {/* 札への線（センサーの位置から） */}
      {labels.map((l) => {
        const a = anchor[l.spot]
        return <path key={`l${l.spot}`} d={`M${a.x} ${a.y}L${l.x - 4} ${l.y}`} stroke={C.accent} strokeWidth={1.6} opacity={0.6 * Math.min(1, show[l.spot])} />
      })}
      {/* ヘッドバンド */}
      <path d={`M${head.x - 25} ${head.y - 4}L${brow.x} ${brow.y}`} stroke={C.muted} strokeWidth={6} strokeLinecap="round" opacity={Math.min(1, show.head)} />
      {/* 胸のベルト */}
      <g transform={`translate(${chest.x} ${chest.y}) rotate(${ang})`} opacity={Math.min(1, show.chest)}>
        <rect x={-19} y={-5} width={38} height={10} rx={4} fill="#1C2126" stroke={C.muted} strokeWidth={2} />
      </g>
      {node(fr[L.rightWrist], 'w2', show.wrist, C.accent, true)}
      {node(fr[L.rightAnkle], 'a2', show.ankle, C.accent, true)}
      {node(brow, 'head', show.head)}
      {waves(chest)}
      {node(chest, 'chest', show.chest, warn ? C.warn : C.accent, false, jit)}
      {node(fr[L.leftAnkle], 'a1', show.ankle)}
      {node(fr[L.leftWrist], 'w1', show.wrist)}
    </g>
  )
}
