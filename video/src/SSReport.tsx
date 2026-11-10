import React, { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, Easing, Freeze, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame } from 'remotion'
import { PHRASES } from '../../src/core/phrases'
import { C, FPS, jp, num } from './theme'

// SS（Singularity Society、NPO）の月1回の報告の動画（横 1920×1080、約74秒、ナレーションなし・字幕だけ）。
//   タイトル → 見る項目の一覧 → 1. カメラ版（本人の走りの録画に、アプリと同じ骨格の推定の点と角度を重ねる）
//   → 2. センサーラン（はじめの一枚と、使っているセンサーの写真〔private/ss-sensor-*.jpg、本人の写真を切り抜いたもの〕のあと、同じ録画の上で、付ける場所を骨格の点に合わせて照準で示し、頭・胸・腰の線の傾きを出す）→ 締め
// 録画と点の数字は本人だけのもの。node scripts/ss-prep.mjs で video/public/private/ に作る（git に入れない）。
// 録画は、人とトレッドミルだけ残して背景を濃くぼかしたもの（*-bg.mp4、scripts/ss-personmask.swift で作る）を使う。
// 角度・線・声の時刻は ss-data.json の値（アプリの測り方 geometry.ts の measure と、上級の猫背の線・CUE の決まりで出したもの）。
// センサーランの値は実際のセンサーの記録ではない（録画は本物）。胸の傾きは、録画で測った猫背の増えを胸のセンサーの大きさに直した作り物（SIM_GAIN）

export const SS_W = 1920
export const SS_H = 1080

type Sec = { trunk: number; neck: number; headLean: number; hunch: number } | null
type FrameData = { p: number[][] | null; ok: boolean; trunk?: number; neck?: number; hunch?: number }
export type SSData = {
  source: { file: string; t0: number; t1: number }
  line: number
  sustain: number
  baseSec: number
  base: { trunk: number; neck: number; headLean: number }
  cue: number | null
  recover: number | null
  secs: Sec[]
  frames: FrameData[]
}

// ---- 長さ（フレーム） ----
const TITLE = 75
const VIEWS = 240 // 見る項目の一覧（8秒）
const CLIP = 630 // 録画の区間 21秒
const S1_LEAD = 60
const S1_TAIL = 45
const S1 = S1_LEAD + CLIP + S1_TAIL
const INTRO = 90 // センサーランのはじめの一枚
const PRE = 8 * FPS // センサーランの録画で、区間の前に足した秒（ss-prep.mjs の5つ目の引数）
const S2_TAIL = 60
const PARTS = 120 // 使っているセンサーの写真の一枚（4秒）
const T0 = INTRO + PARTS // センサーランの録画が始まるコマ
const S2 = T0 + PRE + CLIP + S2_TAIL
const END = 210
export const SS_TOTAL = TITLE + VIEWS + S1 + S2 + END
const AT = { views: TITLE, s1: TITLE + VIEWS, s2: TITLE + VIEWS + S1, end: TITLE + VIEWS + S1 + S2 }

const CUE_LEN = Math.round(3.9 * FPS) // cueHunch.m4a の長さ
const REC_LEN = Math.round(1.5 * FPS) // recover2.m4a の長さ
// 胸のセンサーのイメージ：カメラの猫背の増え × この倍率（2026-11-03 のわざとの猫背60秒で、胸のセンサー +9.8° に対しカメラの上体 +4.8°）
const SIM_GAIN = 9.8 / 4.8
const CHEST_LINE = 5 // 胸の線（基準＋5°。src/modes/sensor/params.ts の poseLine）
const CHEST_HOLD = 3 // 続いたら震える（秒。CUE.sustain）

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const fade = (f: number, a: number, b: number, d = 10) => interpolate(f, [a, a + d, b - d, b], [0, 1, 1, 0], clamp)
const fadeUp = (f: number, at: number, dur = 14) => ({
  opacity: interpolate(f, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [at, at + dur], [30, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
})
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 14, stiffness: 170 } })
const sgn = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)

// ---- 共通の部品 ----

function Bg({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: jp, color: C.text }}>
      <svg width={SS_W} height={SS_H} style={{ position: 'absolute', inset: 0 }}>
        <g stroke={C.grid} strokeWidth={1.5}>
          {Array.from({ length: 6 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${(i + 1) * 160}H${SS_W}`} />
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <path key={`v${i}`} d={`M${(i + 1) * 160} 0V${SS_H}`} />
          ))}
        </g>
      </svg>
      {children}
    </AbsoluteFill>
  )
}

function Head({ n, title, at, tag }: { n: string; title: ReactNode; at: number; tag?: ReactNode }) {
  const f = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', left: 800, right: 60, top: 44, display: 'flex', alignItems: 'baseline', gap: 22, ...fadeUp(f, at) }}>
      <div style={{ fontFamily: num, fontWeight: 700, fontSize: 84, lineHeight: 1, color: C.accent }}>{n}</div>
      <div style={{ fontWeight: 900, fontSize: 46, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{title}</div>
      {tag}
    </div>
  )
}

// 説明の字幕（白い字。アプリの音声の字幕とは形を分ける）
function Note({ text, from, to, top = 860 }: { text: ReactNode; from: number; to: number; top?: number }) {
  const f = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', left: 800, right: 60, top, opacity: fade(f, from, to), fontSize: 36, fontWeight: 700, lineHeight: 1.45, color: C.text }}>
      <span style={{ borderLeft: `6px solid ${C.muted}`, paddingLeft: 18, display: 'inline-block' }}>{text}</span>
    </div>
  )
}

// しくみの4段（測る → 比べる → 決める → 知らせる）。いまの段を明るくする
function Steps({ active, items }: { active: number; items: string[] }) {
  return (
    <div style={{ position: 'absolute', left: 800, right: 60, top: 1000, display: 'flex', alignItems: 'center', gap: 10 }}>
      {items.map((t, i) => {
        const on = i === active
        const done = i < active
        return (
          <React.Fragment key={t}>
            {i > 0 && <div style={{ color: C.faint, fontSize: 26, fontWeight: 900 }}>→</div>}
            <div style={{ padding: '6px 16px', borderRadius: 12, fontSize: 26, fontWeight: 900, background: on ? C.accent : 'transparent', color: on ? C.bg : done ? C.text : C.faint, border: `2px solid ${on ? C.accent : done ? C.muted : C.line}`, whiteSpace: 'nowrap' }}>
              {i + 1}. {t}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// アプリの音声の字幕：「アプリの音声：『…』」。スピーカーの印と色の枠で、説明の字幕と分ける
function VoiceCap({ text, from, to, warn, top }: { text: string; from: number; to: number; warn: boolean; top: number }) {
  const f = useCurrentFrame()
  const col = warn ? C.warn : C.accent
  const s = pop(f, from)
  return (
    <div style={{ position: 'absolute', left: 790, right: 50, top, opacity: fade(f, from, to, 6), transform: `scale(${0.92 + 0.08 * Math.min(1, s)})`, transformOrigin: 'left center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 18, padding: '18px 28px', borderRadius: 24, background: 'rgba(10,12,14,0.94)', border: `4px solid ${col}`, boxShadow: `0 0 40px ${col}55` }}>
        <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={2} style={{ flexShrink: 0 }}>
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        </svg>
        <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1.35 }}>
          <span style={{ color: col }}>アプリの音声：</span>
          <br />『{text}』
        </div>
      </div>
    </div>
  )
}

// ---- タイトル ----

function Title() {
  const f = useCurrentFrame()
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 160, top: 360, opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
        <div style={{ fontWeight: 900, fontSize: 110, lineHeight: 1.2 }}>ランフォームコーチ</div>
        <div style={{ fontWeight: 700, fontSize: 52, marginTop: 20 }}>走りながら、フォームを直すアプリ</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: C.muted, marginTop: 30 }}>Singularity Society 活動報告　2026年11月　しくみの説明</div>
      </div>
    </Bg>
  )
}

// ---- 見る項目の一覧 ----
// アプリが見ている項目と、どの機器で見るか（2026-11-10 時点のコードと文書から）。
//   ● 崩れたら知らせる（カメラ＝声、センサー＝振動、腰のスマホ＝声）。「記録のみ」は測って残すだけで、まだ知らせない
//   姿勢・腰・着地：src/modes/camera/params.ts の LIMITS・REL_LIMITS・FORM（着地の FORM.landing.say は true）、言葉は src/core/phrases.ts の cue…
//   センサー：胸＝猫背、頭＝頭が前（lean.ts）、足首＝接地が長い・左右差と、大またでピッチが落ちた（contactCoach.ts）。腰落ちはセンサーランの腰のスマホで記録だけ（開発中。waistSit.ts）。上体の前傾・体ごとは測らない（docs/sensor-mode.md の表）
//   カメラのピッチ：gait.ts で測って結果に出すだけ（docs/camera-mode.md の「見る項目」）
//   腰のスマホ：声はピッチだけ。接地・上下動は仮の線で記録だけ、ブレーキは測り方を確かめ中、腰落ちは接地の割合と上下の山で見分ける形をセンサーランで試し中
//     （src/modes/phone/params.ts、session.ts の PHONE_VOICED、docs/phone-spec.md の 6）。どれも「開発中」として出す。左右差は腰では取り違えが多く入れない
//   上下動：カメラは gait.ts で測って結果に出すだけ
type Mark = 'on' | 'rec' | 'dev' | null
const VIEW_GROUPS: { name: string; rows: { item: string; sub: string; m: [Mark, Mark, Mark] }[] }[] = [
  {
    name: '姿勢',
    rows: [
      { item: '猫背', sub: '背中が丸まる', m: ['on', 'on', null] },
      { item: '頭が前', sub: '頭が前に出る', m: ['on', 'on', null] },
      { item: '上体の前傾', sub: '前かがみ・起きすぎ', m: ['on', null, null] },
      { item: '体ごとの前傾', sub: '倒れすぎ・後ろに残る', m: ['on', null, null] },
    ],
  },
  {
    name: '腰の高さ',
    rows: [
      { item: '腰落ち', sub: '腰が落ちる', m: ['on', 'dev', 'dev'] },
      { item: '上下動', sub: '上に弾みすぎる', m: ['rec', null, 'dev'] },
    ],
  },
  {
    name: '足の運び',
    rows: [
      { item: '着地の位置', sub: '足が体より前に着く', m: ['on', null, null] },
      { item: 'ピッチ', sub: '1分の歩数が下がる（大また）', m: ['rec', 'on', 'on'] },
      { item: '接地時間', sub: '足が地面に長く着く', m: [null, 'on', 'dev'] },
      { item: '左右差', sub: '接地が左右でちがう', m: [null, 'on', null] },
      { item: 'ブレーキ', sub: '着地で前へ進む力が止まる', m: [null, null, 'dev'] },
    ],
  },
]
const VIEW_DEV = ['カメラ', 'センサー', '腰のスマホ']
const VIEW_HOW = ['声', '振動', '声']

function Views() {
  const f = useCurrentFrame()
  const COL0 = 160
  const COLX = [1200, 1470, 1740] // 機器の列の中心
  const RH = 58 // 1行の高さ
  let row = 0
  return (
    <Bg>
      <div style={{ position: 'absolute', left: COL0, top: 70, opacity: interpolate(f, [0, 10, VIEWS - 8, VIEWS], [0, 1, 1, 0], clamp) }}>
        <div style={{ fontWeight: 900, fontSize: 64, lineHeight: 1.2, ...fadeUp(f, 0) }}>フォームをどんな視点で見るか</div>
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: interpolate(f, [VIEWS - 8, VIEWS], [1, 0], clamp) }}>
        {/* 機器の見出し */}
        {VIEW_DEV.map((t, i) => (
          <div key={t} style={{ position: 'absolute', left: COLX[i] - 140, width: 280, top: 160, textAlign: 'center', ...fadeUp(f, 6) }}>
            <div style={{ fontWeight: 900, fontSize: 40 }}>{t}</div>
            <div style={{ fontWeight: 700, fontSize: 26, color: C.muted }}>（{VIEW_HOW[i]}）</div>
          </div>
        ))}
        {VIEW_GROUPS.map((g, gi) => {
          const top0 = 270 + row * RH + gi * 16
          const els = g.rows.map((r, ri) => {
            const y = top0 + ri * RH
            const at = 10 + (row + ri) * 3
            return (
              <div key={r.item} style={{ position: 'absolute', left: 0, right: 0, top: y, height: RH, ...fadeUp(f, at) }}>
                <div style={{ position: 'absolute', left: COL0 + 240, top: 0, height: RH, display: 'flex', alignItems: 'center', fontWeight: 900, fontSize: 40, whiteSpace: 'nowrap' }}>
                  {r.item}
                  <span style={{ fontSize: 28, fontWeight: 700, color: C.muted, marginLeft: 20 }}>{r.sub}</span>
                </div>
                {r.m.map((m, i) =>
                  m === null ? null : m === 'on' ? (
                    <div key={i} style={{ position: 'absolute', left: COLX[i] - 22, top: (RH - 44) / 2, width: 44, height: 44, borderRadius: 22, background: C.accent }} />
                  ) : m === 'dev' ? (
                    // 開発中：薄い丸の上に「開発中」
                    <div key={i} style={{ position: 'absolute', left: COLX[i] - 100, width: 200, top: 0, height: RH }}>
                      <div style={{ position: 'absolute', left: 100 - 27, top: (RH - 54) / 2, width: 54, height: 54, borderRadius: 27, background: C.accent, opacity: 0.45 }} />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 900, color: C.text, textShadow: `0 0 6px ${C.bg}, 0 0 3px ${C.bg}` }}>開発中</div>
                    </div>
                  ) : (
                    <div key={i} style={{ position: 'absolute', left: COLX[i] - 100, width: 200, top: 0, height: RH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, color: C.faint }}>
                      記録のみ
                    </div>
                  ),
                )}
              </div>
            )
          })
          const h = g.rows.length * RH
          const gEl = (
            <div key={`g${g.name}`} style={{ position: 'absolute', left: COL0, top: top0, height: h, width: 240, borderLeft: `6px solid ${C.accent}`, paddingLeft: 18, display: 'flex', alignItems: 'center', fontWeight: 900, fontSize: 38, color: C.accent, ...fadeUp(f, 10 + row * 3) }}>
              {g.name}
            </div>
          )
          row += g.rows.length
          return (
            <React.Fragment key={g.name}>
              {gEl}
              {els}
            </React.Fragment>
          )
        })}
        <div style={{ position: 'absolute', left: COL0, top: 1005, fontSize: 28, fontWeight: 700, color: C.muted, ...fadeUp(f, 40) }}>
          <span style={{ display: 'inline-block', width: 26, height: 26, borderRadius: 13, background: C.accent, verticalAlign: 'middle', marginRight: 10 }} />
          崩れが続いたら知らせる　　記録のみ：測って残すだけ（まだ知らせない）　　
          <span style={{ position: 'relative', display: 'inline-block', width: 96, height: 30, verticalAlign: 'middle', marginRight: 10 }}>
            <span style={{ position: 'absolute', left: 28, top: -5, width: 40, height: 40, borderRadius: 20, background: C.accent, opacity: 0.45 }} />
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 900, color: C.text, textShadow: `0 0 5px ${C.bg}` }}>開発中</span>
          </span>
          作っているところ
        </div>
      </div>
    </Bg>
  )
}

// ---- 1. カメラ版 ----

const VX = 110 // 録画を置く左のふち
const VS = SS_H / 1920 // 縦 1920 の録画を高さ 1080 に
const VW = 1080 * VS
const toScr = (p: number[]) => ({ x: VX + p[0] * VW, y: p[1] * SS_H })
const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
]
const LEFT = new Set([11, 13, 15, 23, 25, 27, 29, 31, 7])
// 前へ倒れた角度 a（度、前が正）の向きの点。dir は進む向き（画面の左へ走るので −1）
const dirPt = (c: { x: number; y: number }, r: number, a: number, dir: number) => ({ x: c.x + r * Math.sin((a * Math.PI) / 180) * dir, y: c.y - r * Math.cos((a * Math.PI) / 180) })
function arc(c: { x: number; y: number }, r: number, a0: number, a1: number, dir: number) {
  const p0 = dirPt(c, r, a0, dir)
  const p1 = dirPt(c, r, a1, dir)
  const sweep = (a1 > a0) !== dir < 0 ? 1 : 0
  return `M${p0.x} ${p0.y}A${r} ${r} 0 0 ${sweep} ${p1.x} ${p1.y}`
}

function Skeleton({ fd, warn }: { fd: FrameData; warn: boolean }) {
  if (!fd.p) return null
  const P = fd.p
  const vis = (i: number) => P[i][2]
  const nearLeft = vis(11) + vis(23) + vis(25) + vis(7) >= vis(12) + vis(24) + vis(26) + vis(8)
  const near = (i: number) => LEFT.has(i) === nearLeft
  const s = (i: number) => toScr(P[i])
  const dir = -1
  const hipC = { x: (s(23).x + s(24).x) / 2, y: (s(23).y + s(24).y) / 2 }
  const shC = { x: (s(11).x + s(12).x) / 2, y: (s(11).y + s(12).y) / 2 }
  const shN = s(nearLeft ? 11 : 12)
  const hipN = s(nearLeft ? 23 : 24)
  const ear = s(nearLeft ? 7 : 8)
  const col = warn ? C.warn : C.accent
  const trunkA = fd.trunk ?? 0
  const nearTrunk = (Math.atan2((shN.x - hipN.x) * dir, hipN.y - shN.y) * 180) / Math.PI
  const neckA = fd.neck ?? 0
  const tlen = Math.hypot(shC.x - hipC.x, shC.y - hipC.y)
  return (
    <g>
      {BONES.map(([a, b]) => (
        <path key={`${a}-${b}`} d={`M${s(a).x} ${s(a).y}L${s(b).x} ${s(b).y}`} stroke={near(a) ? '#FFFFFF' : '#FFFFFF'} strokeOpacity={near(a) ? 0.85 : 0.35} strokeWidth={near(a) ? 4 : 3} strokeLinecap="round" />
      ))}
      {/* 首：手前の肩→耳 */}
      <path d={`M${shN.x} ${shN.y}L${ear.x} ${ear.y}`} stroke={col} strokeWidth={5} strokeLinecap="round" />
      {/* 上体：腰の中心→肩の中心 */}
      <path d={`M${hipC.x} ${hipC.y}L${shC.x} ${shC.y}`} stroke={col} strokeWidth={7} strokeLinecap="round" />
      {/* 腰の鉛直と、上体の前傾の弧 */}
      <path d={`M${hipC.x} ${hipC.y}L${hipC.x} ${hipC.y - tlen * 0.95}`} stroke={C.text} strokeOpacity={0.6} strokeWidth={2.5} strokeDasharray="8 7" />
      <path d={arc(hipC, 70, 0, trunkA, dir)} stroke={col} strokeWidth={5} fill="none" />
      <text x={hipC.x + 18} y={hipC.y - 70} fill={col} fontFamily={num} fontWeight={700} fontSize={40} stroke={C.bg} strokeWidth={6} paintOrder="stroke">
        {trunkA.toFixed(1)}°
      </text>
      {/* 肩：上体の線の延長と、肩→耳の弧 */}
      <path d={`M${shN.x} ${shN.y}L${dirPt(shN, 80, nearTrunk, dir).x} ${dirPt(shN, 80, nearTrunk, dir).y}`} stroke={C.text} strokeOpacity={0.6} strokeWidth={2.5} strokeDasharray="6 6" />
      <path d={arc(shN, 46, nearTrunk, nearTrunk + neckA, dir)} stroke={col} strokeWidth={4} fill="none" />
      <text x={shN.x + 26} y={shN.y - 26} fill={col} fontFamily={num} fontWeight={700} fontSize={34} stroke={C.bg} strokeWidth={6} paintOrder="stroke">
        {neckA.toFixed(0)}°
      </text>
      {Array.from({ length: 33 }, (_, i) => i)
        .filter((i) => i >= 11 && i !== 17 && i !== 18 && i !== 19 && i !== 20 && i !== 21 && i !== 22)
        .map((i) => (
          <circle key={i} cx={s(i).x} cy={s(i).y} r={near(i) ? 7 : 5} fill={near(i) ? C.bg : C.bg} stroke={near(i) ? col : C.muted} strokeWidth={3} />
        ))}
      <circle cx={ear.x} cy={ear.y} r={8} fill={C.bg} stroke={col} strokeWidth={3} />
    </g>
  )
}

function Readout({ label, sub, value, base, warn, at }: { label: string; sub: string; value: number; base: number; warn: boolean; at: number }) {
  const f = useCurrentFrame()
  const col = warn ? C.warn : C.text
  return (
    <div style={{ width: 490, padding: '20px 26px', borderRadius: 20, background: 'rgba(20,24,28,0.92)', border: `2px solid ${warn ? C.warn : C.line}`, ...fadeUp(f, at) }}>
      <div style={{ fontSize: 30, fontWeight: 900 }}>
        {label} <span style={{ fontSize: 24, color: C.muted, fontWeight: 700 }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 4 }}>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 84, lineHeight: 1, color: col }}>{value.toFixed(1)}°</div>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 44, color: warn ? C.warn : C.muted }}>{sgn(value - base)}°</div>
      </div>
      <div style={{ fontSize: 24, color: C.faint, fontWeight: 700 }}>今日の基準 {base.toFixed(1)}°</div>
    </div>
  )
}

// 猫背の値のメーター（今日の基準 0 から、線まで）と、1秒ごとの値の棒
function HunchMeter({ d, t, at }: { d: SSData; t: number; at: number }) {
  const f = useCurrentFrame()
  const X0 = 0
  const WID = 1020
  const lo = -3
  const hi = 10
  const xOf = (v: number) => X0 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * WID
  const k = Math.min(CLIP - 1, Math.max(0, Math.round(t * FPS)))
  const v = d.frames[k].hunch ?? 0
  const warn = t >= d.baseSec && v > d.line
  const nowSec = Math.floor(t)
  // 1秒の値が線の外に続いている秒数
  let run = 0
  for (let s = nowSec - 1; s >= d.baseSec; s--) {
    const x = d.secs[s]
    if (x && x.hunch > d.line) run++
    else break
  }
  const cued = d.cue !== null && t >= d.cue
  const BW = WID / 21
  const yOf = (h: number) => 300 - ((Math.max(lo, Math.min(hi, h)) - lo) / (hi - lo)) * 200
  return (
    <div style={{ position: 'absolute', left: 800, top: 410, width: WID, ...fadeUp(f, at) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 32, fontWeight: 900 }}>
          猫背の度合い <span style={{ fontSize: 24, color: C.muted, fontWeight: 700 }}>上体と首が、いっしょに前へ倒れた分</span>
        </div>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 56, color: warn ? C.warn : C.accent }}>{sgn(v)}°</div>
      </div>
      <svg width={WID} height={320} style={{ overflow: 'visible' }}>
        {/* メーター */}
        <rect x={0} y={20} width={WID} height={44} rx={22} fill="#161B20" stroke={C.line} strokeWidth={2} />
        <rect x={xOf(0)} y={20} width={xOf(d.line) - xOf(0)} height={44} fill={C.accent} opacity={0.14} />
        <rect x={xOf(d.line)} y={20} width={WID - xOf(d.line)} height={44} rx={0} fill={C.warn} opacity={0.12} />
        <rect x={Math.min(xOf(0), xOf(v))} y={28} width={Math.abs(xOf(v) - xOf(0))} height={28} rx={8} fill={warn ? C.warn : C.accent} />
        <path d={`M${xOf(0)} 10V74`} stroke={C.text} strokeWidth={3} />
        <path d={`M${xOf(d.line)} 4V80`} stroke={C.warn} strokeWidth={4} strokeDasharray="6 5" />
        <text x={xOf(0)} y={104} textAnchor="middle" fill={C.text} fontFamily={jp} fontWeight={700} fontSize={22}>
          今日の基準
        </text>
        <text x={xOf(d.line) + 8} y={104} fill={C.warn} fontFamily={jp} fontWeight={900} fontSize={22}>
          線 ＋{d.line}°（上級）
        </text>
        {/* 1秒ごとの値 */}
        <path d={`M0 ${yOf(0)}H${WID}`} stroke={C.muted} strokeWidth={1.5} />
        <path d={`M0 ${yOf(d.line)}H${WID}`} stroke={C.warn} strokeWidth={2} strokeDasharray="6 5" />
        <rect x={0} y={yOf(hi)} width={BW * d.baseSec} height={yOf(lo) - yOf(hi)} fill={C.text} opacity={0.05} />
        <text x={8} y={yOf(hi) + 50} fill={C.muted} fontFamily={jp} fontWeight={700} fontSize={20}>
          今日の基準の代わり
        </text>
        <text x={8} y={yOf(hi) + 74} fill={C.muted} fontFamily={jp} fontWeight={700} fontSize={20}>
          （この映像では最初の{d.baseSec}秒）
        </text>
        {d.secs.map((s, i) => {
          if (!s || i >= nowSec) return null
          const h = s.hunch
          const over = i >= d.baseSec && h > d.line
          return <rect key={i} x={i * BW + 6} y={Math.min(yOf(0), yOf(h))} width={BW - 12} height={Math.max(2, Math.abs(yOf(h) - yOf(0)))} rx={4} fill={over ? C.warn : i < d.baseSec ? C.muted : C.accent} />
        })}
        <text x={WID} y={yOf(lo) + 24} textAnchor="end" fill={C.faint} fontFamily={jp} fontWeight={700} fontSize={20}>
          1秒ごとの値
        </text>
      </svg>
      {/* 線の外に続いた秒 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: -6, opacity: t >= d.baseSec ? 1 : 0 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.muted }}>線の外が続いた秒</div>
        {Array.from({ length: d.sustain }, (_, i) => (
          <div key={i} style={{ width: 46, height: 22, borderRadius: 6, background: cued || i < run ? C.warn : '#1C2126', border: `2px solid ${cued || i < run ? C.warn : C.line}` }} />
        ))}
        <div style={{ fontSize: 26, fontWeight: 900, color: cued ? C.warn : C.muted }}>{cued ? '→ 声で知らせる' : `${Math.min(run, d.sustain)} / ${d.sustain}秒`}</div>
      </div>
    </div>
  )
}

function Scene1({ d }: { d: SSData }) {
  const f = useCurrentFrame()
  const c = Math.min(CLIP - 1, Math.max(0, f - S1_LEAD))
  const t = c / FPS
  const fd = d.frames[c]
  const v = fd.hunch ?? 0
  const warn = f >= S1_LEAD && t >= d.baseSec && v > d.line
  const cueAt = d.cue !== null ? S1_LEAD + d.cue * FPS : null
  const recAt = d.recover !== null ? S1_LEAD + d.recover * FPS : null
  const video = <OffthreadVideo src={staticFile('private/ss-clip-bg.mp4')} muted style={{ width: VW, height: SS_H }} />
  // 線をこえた最初の秒の頭（決める段の始まり）
  const firstOver = d.secs.findIndex((x, i) => i >= d.baseSec && x !== null && x.hunch > d.line)
  const overAt = firstOver >= 0 ? S1_LEAD + firstOver * FPS : (cueAt ?? S1)
  const MEAS_END = S1_LEAD + 4 * FPS
  const flash = cueAt !== null ? interpolate(f, [cueAt, cueAt + 4, cueAt + 30], [0, 0.9, 0], clamp) : 0
  return (
    <Bg>
      <div style={{ position: 'absolute', left: VX, top: 0, width: VW, height: SS_H, overflow: 'hidden', boxShadow: `0 0 0 3px ${warn ? C.warn : C.line}` }}>
        {f < S1_LEAD ? <Freeze frame={0}>{video}</Freeze> : f >= S1_LEAD + CLIP ? <Freeze frame={CLIP - 1}>{video}</Freeze> : <Sequence from={S1_LEAD}>{video}</Sequence>}
        <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 ${10 * flash}px ${C.warn}` }} />
      </div>
      <svg width={SS_W} height={SS_H} style={{ position: 'absolute', inset: 0, opacity: interpolate(f, [20, 40], [0, 1], clamp) }}>
        <Skeleton fd={fd} warn={warn} />
      </svg>
      {/* 録画の注記 */}
      <div style={{ position: 'absolute', left: VX + 16, top: 16, padding: '8px 16px', borderRadius: 12, background: 'rgba(10,12,14,0.8)', fontSize: 22, fontWeight: 700, color: C.muted }}>
        本人の走り（11月9日・自宅のトレッドミル）
        <br />
        <span style={{ fontFamily: num, color: C.text, fontSize: 26 }}>{(t + 0).toFixed(1)}s</span>
      </div>

      <Head n="01" at={4} title="カメラ版　トレッドミルの横にスマホ1台" />
      <div style={{ position: 'absolute', left: 800, top: 170, display: 'flex', gap: 40 }}>
        <Readout label="上体の傾き" sub="腰→肩" value={fd.trunk ?? d.base.trunk} base={d.base.trunk} warn={warn} at={14} />
        <Readout label="首の角度" sub="肩→耳" value={fd.neck ?? d.base.neck} base={d.base.neck} warn={warn} at={20} />
      </div>
      <HunchMeter d={d} t={f < S1_LEAD ? 0 : t} at={26} />

      {/* しくみの字幕：測る → 比べる → 決める → 知らせる */}
      <Note from={6} to={MEAS_END} text={<>測る：スマホのカメラで骨格の点をとり、上体（腰→肩）と<br />首（肩→耳）が前へ倒れた角度を、1秒ごとに見る</>} />
      <Note from={MEAS_END} to={overAt} text={<>比べる：走り出しに正しいフォームへ整えた形が基準。<br />そこから上体と首がいっしょに前へ倒れたら猫背</>} />
      <Note from={overAt} to={cueAt ?? S1} text={<>決める：線（基準＋{d.line}°・上級）の外が<br />{d.sustain}秒続いたら</>} />
      <Steps items={['測る', '比べる', '決める', '知らせる（声）']} active={f < MEAS_END ? 0 : f < overAt ? 1 : cueAt === null || f < cueAt ? 2 : 3} />
      {cueAt !== null && <VoiceCap text={PHRASES.cueHunch} from={cueAt} to={cueAt + CUE_LEN + 20} warn top={860} />}
      {recAt !== null && <VoiceCap text={PHRASES.recover2} from={Math.max(recAt, (cueAt ?? 0) + CUE_LEN + 20)} to={S1} warn={false} top={860} />}

      {cueAt !== null && (
        <Sequence from={cueAt}>
          <Audio src={staticFile('ss/cueHunch.m4a')} />
        </Sequence>
      )}
      {recAt !== null && (
        <Sequence from={Math.max(recAt, (cueAt ?? 0) + CUE_LEN + 20)}>
          <Audio src={staticFile('ss/recover2.m4a')} />
        </Sequence>
      )}
    </Bg>
  )
}

// ---- 2. センサーラン（同じ録画の上に、センサーを付ける場所と値のイメージ） ----

type Pt = { x: number; y: number }
type SpotKey = 'head' | 'chest' | 'wrist' | 'waist' | 'ankleL' | 'ankleR'
const SPOT_KEYS: SpotKey[] = ['head', 'chest', 'wrist', 'waist', 'ankleL', 'ankleR']
type Track = Record<SpotKey, Pt[]>
const SPOTS: { label: string; sub: string; keys: SpotKey[] }[] = [
  { label: '頭', sub: '額のヘッドバンド', keys: ['head'] },
  { label: '胸', sub: '胸の真ん中', keys: ['chest'] },
  { label: '腕', sub: '左手首', keys: ['wrist'] },
  { label: '腰', sub: 'スマホ（ウエストポーチ）', keys: ['waist'] },
  { label: '足首', sub: '左右', keys: ['ankleL', 'ankleR'] },
]
const SCAN_AT = (i: number) => 15 + i * 39 // 前の秒の中で、照準を合わせるコマ
const LINE_AT = 212 // 頭・胸・腰を結ぶ線を引き始めるコマ（前の秒の中）
const VIB = FPS // 震える長さ（buzzMs 1000）

// 1コマの点から、付ける場所の画面の位置（見えていない点は null）
function rawSpots(p: number[][] | null): Record<SpotKey, Pt | null> {
  const none = { head: null, chest: null, wrist: null, waist: null, ankleL: null, ankleR: null }
  if (!p) return none
  const s = (i: number) => (p[i][2] >= 0.5 ? toScr(p[i]) : null)
  const eye = s(2)
  const ear = s(7)
  const nose = s(0)
  const sh = s(11)
  const hip = s(23)
  const hd = ear && nose ? Math.hypot(nose.x - ear.x, nose.y - ear.y) : 0
  const tl = sh && hip ? Math.hypot(sh.x - hip.x, sh.y - hip.y) : 0
  return {
    // 額：目の少し上
    head: eye && hd ? { x: eye.x + 0.05 * hd, y: eye.y - 0.6 * hd } : null,
    // 胸の真ん中：肩から腰へ3割の高さで、体の前の面（進む向き＝画面の左）へ寄せる
    chest: sh && hip ? { x: sh.x + (hip.x - sh.x) * 0.3 - 0.24 * tl, y: sh.y + (hip.y - sh.y) * 0.3 } : null,
    wrist: s(15),
    waist: hip ? { x: hip.x, y: hip.y - 0.06 * tl } : null,
    ankleL: s(27),
    ankleR: s(28),
  }
}

// 抜けを前後でつなぎ、5コマの中央値で飛びを消してから、ガウスでならす（録画の後から作るので前後のコマを使ってよい）
function smoothSeries(xs: (number | null)[], sigma: number) {
  const n = xs.length
  const filled = xs.slice()
  let prev = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && xs[i] === null) continue
    const a = prev >= 0 ? (xs[prev] as number) : null
    const b = i < n ? (xs[i] as number) : null
    for (let j = prev + 1; j < i; j++) filled[j] = a !== null && b !== null ? a + ((b - a) * (j - prev)) / (i - prev) : (a ?? b ?? 0)
    prev = i
  }
  const v = filled as number[]
  const med = v.map((_, i) => {
    const w = v.slice(Math.max(0, i - 2), Math.min(n, i + 3)).sort((p, q) => p - q)
    return w[w.length >> 1]
  })
  const R = Math.ceil(sigma * 3)
  return med.map((_, i) => {
    let s = 0
    let ws = 0
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) {
      const w = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma))
      s += med[j] * w
      ws += w
    }
    return s / ws
  })
}

const SIGMA: Record<SpotKey, number> = { head: 2, chest: 2.5, wrist: 1.2, waist: 2.5, ankleL: 1.2, ankleR: 1.2 }
function buildTrack(frames: (number[][] | null)[]): Track {
  const raw = frames.map(rawSpots)
  const out = {} as Track
  for (const k of SPOT_KEYS) {
    const xs = smoothSeries(raw.map((r) => r[k]?.x ?? null), SIGMA[k])
    const ys = smoothSeries(raw.map((r) => r[k]?.y ?? null), SIGMA[k])
    out[k] = xs.map((x, i) => ({ x, y: ys[i] }))
  }
  return out
}

// 照準：回る輪がしぼんで、点に合う
function Scope({ p, f, at, done, color = C.accent, sc = 1.7 }: { p: Pt; f: number; at: number; done: boolean; color?: string; sc?: number }) {
  if (f < at) return null
  const k = interpolate(f, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const r = 60 - 40 * k
  const rot = (f - at) * 6
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${sc})`} opacity={done ? 0.45 : 1}>
      <g transform={`rotate(${rot})`}>
        <circle r={r} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray="10 8" opacity={1 - 0.4 * k} />
      </g>
      <circle r={r * 0.55} fill="none" stroke={color} strokeWidth={1.6} />
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d={`M0 ${-(r + 10)}V${-(r - 4)}`} stroke={color} strokeWidth={2.4} transform={`rotate(${a})`} />
      ))}
      {k >= 1 && !done && <circle r={26 + ((f - at - 16) % 30)} fill="none" stroke={color} strokeWidth={1.4} opacity={Math.max(0, 1 - ((f - at - 16) % 30) / 30)} />}
    </g>
  )
}

function Sensor({ p, color, shake = 0, s = 1.5 }: { p: Pt; color: string; shake?: number; s?: number }) {
  return (
    <g transform={`translate(${p.x + shake} ${p.y}) scale(${s})`}>
      <rect x={-8} y={-8} width={16} height={16} rx={5} fill={C.bg} stroke={color} strokeWidth={3} />
      <circle r={2.6} fill={color} />
    </g>
  )
}

// 胸の傾きのイメージ（度、走り始めからの増え）。録画で測った猫背の増え × SIM_GAIN
function simChest(d: SSData) {
  // 1秒ごとの値を、秒の終わりの点としてなめらかにつなぎ、走るリズムの小さな揺れを足す
  const sec = d.secs.map((s) => (s ? Math.max(-2, s.hunch * SIM_GAIN) : 0))
  const perFrame = d.frames.map((_, k) => {
    const x = k / FPS - 1 // 秒 i の値は、その秒の終わり（i + 1）に出る
    const i = Math.max(0, Math.floor(x))
    const a = sec[Math.min(sec.length - 1, i)]
    const b = sec[Math.min(sec.length - 1, i + 1)]
    const u = x < 0 ? 0 : x - i
    const e = (1 - Math.cos(Math.PI * u)) / 2
    return (x < 0 ? sec[0] : a + (b - a) * e) + 0.6 * Math.sin((k / FPS) * 2 * Math.PI * 1.4)
  })
  const perSec = d.secs.map((s) => (s ? s.hunch * SIM_GAIN : 0))
  let buzz: number | null = null
  for (let s = CHEST_HOLD - 1; s < perSec.length && buzz === null; s++) {
    if (s >= d.baseSec && perSec.slice(s - CHEST_HOLD + 1, s + 1).every((v) => v > CHEST_LINE)) buzz = s + 1
  }
  return { perFrame, perSec, buzz }
}

function ChestPanel({ d, sim, k, at }: { d: SSData; sim: ReturnType<typeof simChest>; k: number; at: number }) {
  const f = useCurrentFrame()
  const t = k / FPS
  const v = sim.perFrame[k]
  const over = v > CHEST_LINE
  const lo = -4
  const hi = 18
  // 半円のメーター
  const R = 140
  const cx = 190
  const cy = 196
  const ang = (x: number) => -90 + ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo)) * 180
  const pt = (a: number, r: number) => ({ x: cx + r * Math.cos(((a - 90) * Math.PI) / 180), y: cy + r * Math.sin(((a - 90) * Math.PI) / 180) })
  const arcD = (a0: number, a1: number, r: number) => {
    const p0 = pt(a0, r)
    const p1 = pt(a1, r)
    return `M${p0.x} ${p0.y}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`
  }
  const needle = pt(ang(v), R - 18)
  // グラフ
  const GW = 1000
  const GH = 200
  const xOf = (s: number) => (s / 21) * GW
  const yOf = (x: number) => GH - ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo)) * GH
  const pts = sim.perFrame.slice(0, k + 1).map((x, i) => `${xOf(i / FPS).toFixed(1)},${yOf(x).toFixed(1)}`)
  const col = over ? C.warn : C.accent
  // 1秒の値が線の外に続いている秒数
  const nowSec = Math.floor(t)
  let run = 0
  for (let s = nowSec - 1; s >= d.baseSec; s--) {
    if (sim.perSec[s] > CHEST_LINE) run++
    else break
  }
  const buzzed = sim.buzz !== null && t >= sim.buzz
  return (
    <div style={{ position: 'absolute', left: 800, top: 170, width: 1040, ...fadeUp(f, at) }}>
      <div style={{ fontSize: 32, fontWeight: 900 }}>
        胸のセンサーの傾き <span style={{ fontSize: 24, color: C.muted, fontWeight: 700 }}>胸を開いた立ち方の基準から、前へ倒れた分（値はイメージ）</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
        <svg width={390} height={220}>
          <path d={arcD(-90, 90, R)} stroke="#1C2126" strokeWidth={30} fill="none" />
          <path d={arcD(-90, ang(0), R)} stroke={C.muted} strokeWidth={30} fill="none" opacity={0.35} />
          <path d={arcD(ang(0), ang(CHEST_LINE), R)} stroke={C.accent} strokeWidth={30} fill="none" opacity={0.45} />
          <path d={arcD(ang(CHEST_LINE), 90, R)} stroke={C.warn} strokeWidth={30} fill="none" opacity={0.4} />
          <path d={`M${cx} ${cy}L${needle.x} ${needle.y}`} stroke={col} strokeWidth={8} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={13} fill={col} />
          <text x={pt(ang(CHEST_LINE), R + 30).x} y={pt(ang(CHEST_LINE), R + 30).y} textAnchor="middle" fill={C.warn} fontFamily={jp} fontWeight={900} fontSize={22}>
            線 ＋{CHEST_LINE}°
          </text>
        </svg>
        <div>
          <div style={{ fontFamily: num, fontWeight: 700, fontSize: 110, lineHeight: 1, color: col }}>{sgn(v)}°</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: over ? C.warn : C.muted, marginTop: 8 }}>{t < d.baseSec ? `基準の代わり（はじめの${d.baseSec}秒）` : over ? '線をこえています' : 'ふつうの走り'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, opacity: t >= d.baseSec ? 1 : 0 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.muted }}>線の外が続いた秒</div>
            {Array.from({ length: CHEST_HOLD }, (_, i) => (
              <div key={i} style={{ width: 42, height: 20, borderRadius: 6, background: buzzed || i < run ? C.warn : '#1C2126', border: `2px solid ${buzzed || i < run ? C.warn : C.line}` }} />
            ))}
            <div style={{ fontSize: 24, fontWeight: 900, color: buzzed ? C.warn : C.muted }}>{buzzed ? '→ 震えて知らせる' : `${Math.min(run, CHEST_HOLD)} / ${CHEST_HOLD}秒`}</div>
          </div>
        </div>
      </div>
      <svg width={GW} height={GH + 34} style={{ marginTop: 6, overflow: 'visible' }}>
        <rect x={0} y={0} width={GW} height={GH} fill="#11161A" stroke={C.line} strokeWidth={2} rx={10} />
        <rect x={0} y={0} width={xOf(d.baseSec)} height={GH} fill={C.text} opacity={0.05} />
        <text x={8} y={24} fill={C.muted} fontFamily={jp} fontWeight={700} fontSize={20}>
          基準（この映像では最初の{d.baseSec}秒で代用）
        </text>
        <path d={`M0 ${yOf(0)}H${GW}`} stroke={C.muted} strokeWidth={1.5} />
        <path d={`M0 ${yOf(CHEST_LINE)}H${GW}`} stroke={C.warn} strokeWidth={2.5} strokeDasharray="8 6" />
        <polyline points={pts.join(' ')} fill="none" stroke={C.accent} strokeWidth={4} strokeLinejoin="round" />
        {sim.buzz !== null && t >= sim.buzz && (
          <g transform={`translate(${xOf(sim.buzz)} ${yOf(sim.perFrame[Math.round(sim.buzz * FPS)])})`}>
            <circle r={13} fill={C.warn} />
            <circle r={13 + ((f % 24) / 24) * 24} fill="none" stroke={C.warn} strokeWidth={3} opacity={1 - (f % 24) / 24} />
          </g>
        )}
        <text x={8} y={GH + 28} fill={C.faint} fontFamily={jp} fontWeight={700} fontSize={20}>
          時間 →
        </text>
        <text x={GW - 8} y={yOf(CHEST_LINE) - 10} textAnchor="end" fill={C.warn} fontFamily={jp} fontWeight={900} fontSize={22}>
          線 ＋{CHEST_LINE}°　3秒こえ続けたら震える
        </text>
      </svg>
    </div>
  )
}

function Intro() {
  const f = useCurrentFrame()
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 160, top: 380, opacity: interpolate(f, [0, 10, INTRO - 8, INTRO], [0, 1, 1, 0], clamp) }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, ...fadeUp(f, 0) }}>
          <div style={{ fontFamily: num, fontWeight: 700, fontSize: 84, lineHeight: 1, color: C.accent }}>02</div>
          <div style={{ fontWeight: 900, fontSize: 46, color: C.accent }}>センサーラン</div>
        </div>
        <div style={{ fontWeight: 900, fontSize: 84, lineHeight: 1.3, marginTop: 34, ...fadeUp(f, 8) }}>外で走るときは、体にセンサーを付けます</div>
      </div>
    </Bg>
  )
}

// 使っているセンサー（自作）の写真。部品の名前は hardware/sensor/CLAUDE.md・docs/haptic.md のとおり。
// 振動モーターは子基板の裏にあって写真では見えないので、子基板を「振動の回路」と呼ぶ
const PH = { x: 110, y: 190, w: 880, srcW: 1200 } // 部品の写真（private/ss-sensor-parts.jpg、1200×956）
const phPt = (x: number, y: number) => ({ x: PH.x + (x * PH.w) / PH.srcW, y: PH.y + (y * PH.w) / PH.srcW })
const PART_TAGS: { at: number; dot: [number, number]; box: [number, number]; text: ReactNode }[] = [
  { at: 16, dot: [250, 230], box: [430, 90], text: <>マイコン＋動きのセンサー<br /><span style={{ fontFamily: num, fontSize: 24, color: C.muted }}>XIAO nRF52840＋LSM6DSV16X</span></> },
  { at: 26, dot: [620, 780], box: [90, 820], text: <>電池</> },
  { at: 36, dot: [960, 470], box: [800, 620], text: <>振動の回路</> },
]

function Parts() {
  const f = useCurrentFrame()
  const out = interpolate(f, [PARTS - 8, PARTS], [1, 0], clamp)
  const ph = Math.min(1, pop(f, 4))
  const band = Math.min(1, pop(f, 46))
  const imgBox = { position: 'absolute', borderRadius: 28, overflow: 'hidden', border: `3px solid ${C.line}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } as const
  return (
    <Bg>
      <div style={{ opacity: out }}>
        <div style={{ position: 'absolute', left: 110, top: 60, display: 'flex', alignItems: 'baseline', gap: 22, ...fadeUp(f, 0) }}>
          <div style={{ fontFamily: num, fontWeight: 700, fontSize: 64, lineHeight: 1, color: C.accent }}>02</div>
          <div style={{ fontWeight: 900, fontSize: 56 }}>使っているセンサー（自作）</div>
        </div>
        <div style={{ ...imgBox, left: PH.x, top: PH.y, width: PH.w, height: (956 * PH.w) / PH.srcW, opacity: ph, transform: `scale(${0.94 + 0.06 * ph})` }}>
          <Img src={staticFile('private/ss-sensor-parts.jpg')} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
        <svg width={SS_W} height={SS_H} style={{ position: 'absolute', inset: 0 }}>
          {PART_TAGS.map((t) => {
            const o = interpolate(f, [t.at, t.at + 8], [0, 1], clamp)
            const a = phPt(...t.dot)
            const b = phPt(...t.box)
            return (
              <g key={t.at} opacity={o}>
                <path d={`M${a.x} ${a.y}L${b.x + 20} ${b.y + 20}`} stroke={C.accent} strokeWidth={4} />
                <circle cx={a.x} cy={a.y} r={11} fill={C.accent} stroke={C.bg} strokeWidth={4} />
              </g>
            )
          })}
        </svg>
        {PART_TAGS.map((t) => {
          const s = Math.min(1, pop(f, t.at))
          const b = phPt(...t.box)
          return (
            <div key={t.at} style={{ position: 'absolute', left: b.x, top: b.y, opacity: s, transform: `scale(${0.9 + 0.1 * s})`, transformOrigin: 'left top', padding: '8px 18px', borderRadius: 14, background: 'rgba(10,12,14,0.92)', border: `3px solid ${C.accent}`, fontSize: 34, fontWeight: 900, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
              {t.text}
            </div>
          )
        })}
        <div style={{ ...imgBox, left: 1070, top: 230, width: 740, height: (878 * 740) / 1100, opacity: band, transform: `scale(${0.94 + 0.06 * band})` }}>
          <Img src={staticFile('private/ss-sensor-band.jpg')} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
        <div style={{ position: 'absolute', left: 1070, width: 740, top: 850, textAlign: 'center', fontSize: 44, fontWeight: 900, ...fadeUp(f, 52) }}>リストバンドなどに入れて付けます</div>
      </div>
    </Bg>
  )
}

function Scene2({ d, track }: { d: SSData; track: Track }) {
  const f = useCurrentFrame()
  const sim = simChest(d)
  const PRE_F = track.head.length - CLIP
  const LEN = PRE_F + CLIP
  const c = Math.min(LEN - 1, Math.max(0, f - T0)) // センサーランの録画のコマ
  const k = Math.max(0, c - PRE_F) // 区間（カメラ版と同じ 21秒）のコマ
  const main = c >= PRE_F
  const at = (key: SpotKey) => track[key][c]
  const scanF = c // 前の秒の中のコマ
  const v = sim.perFrame[k]
  const over = main && v > CHEST_LINE
  const buzzAt = sim.buzz !== null ? T0 + PRE_F + sim.buzz * FPS : null
  const vibOn = buzzAt !== null && f >= buzzAt && f < buzzAt + VIB
  const jit = vibOn ? Math.sin(f * 2.6) * 5 : 0
  // 決める段の始まり：画面の値が、基準の秒のあとで初めて線をこえたコマ
  const firstOver = sim.perFrame.findIndex((x, i) => i >= d.baseSec * FPS && x > CHEST_LINE)
  const overAt = firstOver >= 0 ? T0 + PRE_F + firstOver : (buzzAt ?? S2)
  const mainAt = T0 + PRE_F
  const scanned = (i: number) => scanF >= SCAN_AT(i) + 16
  const lineK = interpolate(scanF, [LINE_AT, LINE_AT + 24], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const listOut = interpolate(scanF, [LINE_AT - 4, LINE_AT + 10], [1, 0], clamp)
  // 頭・胸・腰を結ぶ線と、走り始め（区間の基準の秒）の向き
  const head = at('head')
  const chest = at('chest')
  const waist = at('waist')
  const angOf = (i: number) => (Math.atan2(-(track.head[i].x - track.waist[i].x), track.waist[i].y - track.head[i].y) * 180) / Math.PI // 前（画面の左）が正
  let baseAng = 0
  for (let i = 0; i < d.baseSec * FPS; i++) baseAng += angOf(PRE_F + i) / (d.baseSec * FPS)
  const bodyLen = Math.hypot(head.x - waist.x, head.y - waist.y)
  const baseTip = dirPt(waist, bodyLen * 1.3, baseAng, -1)
  const lineCol = over ? C.warn : C.accent
  const drawTo = (a: Pt, b: Pt, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  const u1 = Math.min(1, lineK * 2)
  const u2 = Math.max(0, lineK * 2 - 1)
  const p1 = drawTo(waist, chest, u1)
  const p2 = drawTo(chest, head, u2)
  const video = <OffthreadVideo src={staticFile('private/ss-clip2-bg.mp4')} muted style={{ width: VW, height: SS_H }} />
  const flash = buzzAt !== null ? interpolate(f, [buzzAt, buzzAt + 4, buzzAt + 30], [0, 0.9, 0], clamp) : 0
  // 値の札（体の前、胸と頭のあいだ）
  const tagX = Math.min(head.x, chest.x) - 70
  const tagY = (head.y + chest.y) / 2
  const cur = SPOTS.findIndex((_, i) => scanF >= SCAN_AT(i) && (i === SPOTS.length - 1 ? scanF < LINE_AT : scanF < SCAN_AT(i + 1)))
  return (
    <Bg>
      <div style={{ position: 'absolute', left: VX, top: 0, width: VW, height: SS_H, overflow: 'hidden', boxShadow: `0 0 0 3px ${over ? C.warn : C.line}` }}>
        {f < T0 ? <Freeze frame={0}>{video}</Freeze> : f >= T0 + LEN ? <Freeze frame={LEN - 1}>{video}</Freeze> : <Sequence from={T0}>{video}</Sequence>}
        <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 ${10 * flash}px ${C.warn}` }} />
      </div>
      <svg width={SS_W} height={SS_H} style={{ position: 'absolute', inset: 0 }}>
        {/* 頭・胸・腰を結ぶ線と、基準の向き */}
        {lineK > 0 && (
          <g>
            <path d={`M${waist.x} ${waist.y}L${baseTip.x} ${baseTip.y}`} stroke={C.text} strokeOpacity={0.9 * lineK} strokeWidth={4} strokeDasharray="10 8" />
            <text x={baseTip.x} y={baseTip.y - 12} textAnchor="middle" fill={C.text} opacity={lineK} fontFamily={jp} fontWeight={700} fontSize={22} stroke={C.bg} strokeWidth={5} paintOrder="stroke">
              基準の向き
            </text>
            <path d={`M${waist.x} ${waist.y}L${p1.x} ${p1.y}${u2 > 0 ? `L${p2.x} ${p2.y}` : ''}`} stroke={lineCol} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        )}
        {/* 付けたセンサー */}
        {scanned(4) && <Sensor p={at('ankleR')} color={C.accent} s={1.2} />}
        {scanned(4) && <Sensor p={at('ankleL')} color={C.accent} />}
        {scanned(3) && (
          <g transform={`translate(${waist.x} ${waist.y})`}>
            <rect x={-12} y={-19} width={24} height={38} rx={5} fill={C.bg} stroke={C.accent} strokeWidth={3} />
          </g>
        )}
        {scanned(2) && <Sensor p={at('wrist')} color={C.accent} />}
        {scanned(0) && <Sensor p={head} color={C.accent} />}
        {vibOn &&
          [0, 1, 2].map((q) => {
            const r = 20 + ((f * 2 + q * 14) % 42)
            return <circle key={q} cx={chest.x} cy={chest.y} r={r} fill="none" stroke={C.warn} strokeWidth={3.5} opacity={1 - (r - 20) / 42} />
          })}
        {scanned(1) && <Sensor p={chest} color={over || vibOn ? C.warn : C.accent} shake={jit} s={vibOn ? 2 : 1.5} />}
        {/* 照準：1か所ずつ */}
        {scanF < LINE_AT + 20 &&
          SPOTS.map((s, i) =>
            s.keys.map((key) => (i === cur ? <Scope key={key} p={at(key)} f={scanF} at={SCAN_AT(i)} done={false} /> : null)),
          )}
        {/* 線を引いたあとは、胸に照準 */}
        {scanF >= LINE_AT && <Scope p={{ x: chest.x + jit, y: chest.y }} f={scanF} at={LINE_AT} done={!over && !vibOn} color={over || vibOn ? C.warn : C.accent} sc={1.5} />}
      </svg>
      {/* 照準を合わせている場所の名前（体の前の、あいている側） */}
      {cur >= 0 &&
        (() => {
          const s = SPOTS[cur]
          const p = at(s.keys[0])
          const o = interpolate(scanF, [SCAN_AT(cur) + 8, SCAN_AT(cur) + 16], [0, 1], clamp)
          return (
            <div style={{ position: 'absolute', right: SS_W - (Math.min(...s.keys.map((kk) => at(kk).x)) - 60), top: p.y - 30, opacity: o, padding: '6px 16px', borderRadius: 12, background: 'rgba(10,12,14,0.86)', border: `2px solid ${C.accent}`, fontSize: 34, fontWeight: 900, whiteSpace: 'nowrap' }}>
              {s.label}
              <span style={{ fontSize: 24, color: C.muted, marginLeft: 10 }}>{s.sub}</span>
            </div>
          )
        })()}
      {/* 線の傾きの値 */}
      {lineK > 0.6 && (
        <div style={{ position: 'absolute', right: SS_W - tagX, top: tagY - 44, opacity: interpolate(lineK, [0.6, 1], [0, 1]), padding: '6px 14px', borderRadius: 12, background: 'rgba(10,12,14,0.86)', border: `2px solid ${lineCol}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.muted }}>傾き（イメージ）</div>
          <div style={{ fontFamily: num, fontWeight: 700, fontSize: 48, lineHeight: 1, color: lineCol }}>{main ? `${sgn(v)}°` : '—'}</div>
        </div>
      )}
      {/* 録画の注記 */}
      <div style={{ position: 'absolute', left: VX + 16, top: 16, padding: '8px 16px', borderRadius: 12, background: 'rgba(10,12,14,0.8)', fontSize: 22, fontWeight: 700, color: C.muted }}>
        本人の走り（11月9日）・センサーの値はイメージ
      </div>
      <div style={{ position: 'absolute', right: SS_W - (VX + VW) + 14, bottom: 14, padding: '6px 14px', borderRadius: 10, background: 'rgba(10,12,14,0.82)', fontSize: 22, fontWeight: 700, color: C.text }}>
        実際は外で走ります（この映像はトレッドミル）
      </div>

      <Head
        n="02"
        at={T0 + 4}
        title="センサーラン　体に付けて外を走る"
        tag={<div style={{ alignSelf: 'center', marginLeft: 'auto', padding: '6px 16px', borderRadius: 14, border: `3px solid ${C.muted}`, color: C.text, fontSize: 24, fontWeight: 900, whiteSpace: 'nowrap' }}>値はイメージ</div>}
      />
      {/* 付ける場所の一覧（照準に合わせて1つずつ） */}
      <div style={{ position: 'absolute', left: 800, top: 190, opacity: listOut }}>
        {SPOTS.map((s, i) => {
          const sp = Math.min(1, pop(scanF, SCAN_AT(i) + 10))
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 26, marginBottom: 22, opacity: f < T0 ? 0 : sp, transform: `translateX(${(1 - sp) * 50}px)` }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, border: `3px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: num, fontWeight: 700, fontSize: 36, color: C.accent }}>{i + 1}</div>
              <div style={{ fontSize: 60, fontWeight: 900, width: 170 }}>{s.label}</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.muted }}>{s.sub}</div>
            </div>
          )
        })}
      </div>
      {scanF >= LINE_AT + 14 && <ChestPanel d={d} sim={sim} k={k} at={T0 + LINE_AT + 14} />}
      <Note from={T0 + 6} to={T0 + LINE_AT} top={800} text={<>測る：頭・胸・左手首・腰（スマホ）・足首に<br />センサーを付けて、走りながら測る</>} />
      <Note from={T0 + LINE_AT} to={mainAt + 3 * FPS} top={800} text={<>頭・胸・腰を結ぶ線で、<br />上体が前へ傾いた角度を見る</>} />
      <Note from={mainAt + 3 * FPS} to={overAt} top={800} text={<>比べる：2つの立ち方で測った「胸を開いた立ち方」が基準。<br />その速さで正しい前傾より、何度前へ倒れたか</>} />
      <Note from={overAt} to={buzzAt ?? S2} top={800} text={<>決める：線（基準＋{CHEST_LINE}°）の外が{CHEST_HOLD}秒続いたら</>} />
      {buzzAt !== null && <Note from={buzzAt} to={S2} top={800} text={<>線（基準＋{CHEST_LINE}°）を{CHEST_HOLD}秒こえた → 姿勢がくずれている</>} />}
      {buzzAt !== null && <Note from={buzzAt + 10} to={S2} top={880} text={<span style={{ color: C.warn, fontWeight: 900, fontSize: 44 }}>知らせる：胸のセンサーが震えて知らせます</span>} />}
      {f >= T0 && <Steps items={['測る', '比べる', '決める', '知らせる（振動）']} active={f < mainAt + 3 * FPS ? 0 : f < overAt ? 1 : buzzAt === null || f < buzzAt ? 2 : 3} />}
      {buzzAt !== null && (
        <Sequence from={buzzAt}>
          <Audio src={staticFile('ss/buzz.wav')} volume={0.9} />
        </Sequence>
      )}
      {SPOTS.map((s, i) => (
        <Sequence key={s.label} from={T0 + SCAN_AT(i) + 14} durationInFrames={10}>
          <Audio src={staticFile('ss/beep.wav')} volume={0.7} />
        </Sequence>
      ))}
      {f < INTRO && (
        <AbsoluteFill>
          <Intro />
        </AbsoluteFill>
      )}
      {f >= INTRO && f < T0 && (
        <AbsoluteFill>
          <Sequence from={INTRO}>
            <Parts />
          </Sequence>
        </AbsoluteFill>
      )}
    </Bg>
  )
}

// ---- 締め ----

function End() {
  const f = useCurrentFrame()
  // 4段を順に出す（0.5秒ずつ）
  const rows: [string, string][] = [
    ['測る', '骨格（体の各部）の位置を測る'],
    ['比べる', '骨格の角度を、今日の基準と比べる'],
    ['決める', '線の外が3秒続いたら、フォームの崩れと判断する'],
    ['知らせる', 'その場で本人に知らせる'],
  ]
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 160, top: 170, right: 160 }}>
        <div style={{ fontWeight: 900, fontSize: 60, lineHeight: 1.4, opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
          このアプリが、フォームの崩れを見つけるしくみ
        </div>
        <div style={{ marginTop: 40 }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 36, marginTop: 22, opacity: interpolate(f, [12 + i * 15, 20 + i * 15], [0, 1], clamp) }}>
              <div style={{ width: 230, fontWeight: 900, fontSize: 56, color: C.accent, whiteSpace: 'nowrap' }}>{k}</div>
              <div style={{ fontWeight: 700, fontSize: 48 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: 44, lineHeight: 1.6, marginTop: 56, color: C.muted, opacity: interpolate(f, [80, 90], [0, 1], clamp) }}>
          トレッドミルモードは声、外でのランニングモードは振動で知らせます。
        </div>
      </div>
    </Bg>
  )
}

// ---- 全体 ----

export function SSReport() {
  const [d, setD] = useState<{ d: SSData; track: Track } | null>(null)
  const [handle] = useState(() => delayRender('ss-data'))
  useEffect(() => {
    Promise.all([fetch(staticFile('private/ss-data.json')).then((r) => r.json()), fetch(staticFile('private/ss-pts2.json')).then((r) => r.json())])
      .then(([j, p]: [SSData, { pre: number; frames: (number[][] | null)[] }]) => {
        if (j.frames.length !== CLIP) throw new Error(`ss-data.json のコマ数 ${j.frames.length} が ${CLIP} と違う`)
        if (p.frames.length !== PRE + CLIP) throw new Error(`ss-pts2.json のコマ数 ${p.frames.length} が ${PRE + CLIP} と違う`)
        setD({ d: j, track: buildTrack(p.frames) })
        continueRender(handle)
      })
      .catch((e) => cancelRender(e))
  }, [handle])
  if (!d) return null
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={TITLE}>
        <Title />
      </Sequence>
      <Sequence from={AT.views} durationInFrames={VIEWS}>
        <Views />
      </Sequence>
      <Sequence from={AT.s1} durationInFrames={S1}>
        <Scene1 d={d.d} />
      </Sequence>
      <Sequence from={AT.s2} durationInFrames={S2}>
        <Scene2 d={d.d} track={d.track} />
      </Sequence>
      <Sequence from={AT.end} durationInFrames={END}>
        <End />
      </Sequence>
    </AbsoluteFill>
  )
}
